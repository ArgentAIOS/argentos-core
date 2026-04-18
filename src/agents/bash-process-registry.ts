import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSessionSlug as createSessionSlugId } from "./session-slug.js";

const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_JOB_TTL_MS = 60 * 1000; // 1 minute
const MAX_JOB_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const DEFAULT_PENDING_OUTPUT_CHARS = 30_000;

function clampTtl(value: number | undefined) {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_JOB_TTL_MS;
  }
  return Math.min(Math.max(value, MIN_JOB_TTL_MS), MAX_JOB_TTL_MS);
}

let jobTtlMs = clampTtl(Number.parseInt(process.env.PI_BASH_JOB_TTL_MS ?? "", 10));

export type ProcessStatus = "running" | "completed" | "failed" | "killed";

export type SessionStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: () => void;
  destroyed?: boolean;
};

export interface ProcessSession {
  id: string;
  command: string;
  scopeKey?: string;
  sessionKey?: string;
  notifyOnExit?: boolean;
  exitNotified?: boolean;
  child?: ChildProcessWithoutNullStreams;
  stdin?: SessionStdin;
  pid?: number;
  startedAt: number;
  cwd?: string;
  maxOutputChars: number;
  pendingMaxOutputChars?: number;
  totalOutputChars: number;
  pendingStdout: string[];
  pendingStderr: string[];
  pendingStdoutChars: number;
  pendingStderrChars: number;
  aggregated: string;
  tail: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  exited: boolean;
  truncated: boolean;
  backgrounded: boolean;
}

export interface FinishedSession {
  id: string;
  command: string;
  scopeKey?: string;
  startedAt: number;
  endedAt: number;
  cwd?: string;
  status: ProcessStatus;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  aggregated: string;
  tail: string;
  truncated: boolean;
  totalOutputChars: number;
}

const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, FinishedSession>();

let sweeper: NodeJS.Timeout | null = null;
let registryLoaded = false;

type PersistedRegistry = {
  running: Array<{
    id: string;
    command: string;
    scopeKey?: string;
    sessionKey?: string;
    notifyOnExit?: boolean;
    startedAt: number;
    cwd?: string;
    maxOutputChars: number;
    pendingMaxOutputChars?: number;
    totalOutputChars: number;
    aggregated: string;
    tail: string;
    truncated: boolean;
    backgrounded: boolean;
  }>;
  finished: FinishedSession[];
};

function resolveRegistryPath() {
  return path.join(resolveStateDir(), "process", "bash-process-registry.json");
}

function ensureRegistryLoaded() {
  if (registryLoaded) {
    return;
  }
  registryLoaded = true;
  const filePath = resolveRegistryPath();
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as PersistedRegistry;
    const now = Date.now();
    for (const session of parsed.finished ?? []) {
      finishedSessions.set(session.id, session);
    }
    for (const session of parsed.running ?? []) {
      if (!session.backgrounded) {
        continue;
      }
      const orphaned: FinishedSession = {
        id: session.id,
        command: session.command,
        scopeKey: session.scopeKey,
        startedAt: session.startedAt,
        endedAt: now,
        cwd: session.cwd,
        status: "failed",
        exitCode: null,
        exitSignal: null,
        aggregated: session.aggregated,
        tail: session.tail,
        truncated: session.truncated,
        totalOutputChars: session.totalOutputChars,
      };
      if (!orphaned.aggregated.includes("background session was not restorable")) {
        const note = "Note: background session was not restorable after registry reload.";
        orphaned.aggregated = [orphaned.aggregated, note].filter(Boolean).join("\n\n");
        orphaned.tail = tail(orphaned.aggregated, 2000);
      }
      finishedSessions.set(orphaned.id, orphaned);
    }
  } catch {
    // Ignore unreadable registry snapshots; runtime will continue with empty in-memory state.
  }
}

function persistRegistry() {
  if (!registryLoaded) {
    return;
  }
  const filePath = resolveRegistryPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const payload: PersistedRegistry = {
      running: Array.from(runningSessions.values())
        .filter((session) => session.backgrounded)
        .map((session) => ({
          id: session.id,
          command: session.command,
          scopeKey: session.scopeKey,
          sessionKey: session.sessionKey,
          notifyOnExit: session.notifyOnExit,
          startedAt: session.startedAt,
          cwd: session.cwd,
          maxOutputChars: session.maxOutputChars,
          pendingMaxOutputChars: session.pendingMaxOutputChars,
          totalOutputChars: session.totalOutputChars,
          aggregated: session.aggregated,
          tail: session.tail,
          truncated: session.truncated,
          backgrounded: session.backgrounded,
        })),
      finished: listFinishedSessions(),
    };
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Non-fatal: background sessions still live in memory even if persistence fails.
  }
}

function isSessionIdTaken(id: string) {
  ensureRegistryLoaded();
  return runningSessions.has(id) || finishedSessions.has(id);
}

export function createSessionSlug(): string {
  return createSessionSlugId(isSessionIdTaken);
}

export function addSession(session: ProcessSession) {
  ensureRegistryLoaded();
  runningSessions.set(session.id, session);
  persistRegistry();
  startSweeper();
}

export function getSession(id: string) {
  ensureRegistryLoaded();
  return runningSessions.get(id);
}

export function getFinishedSession(id: string) {
  ensureRegistryLoaded();
  return finishedSessions.get(id);
}

export function deleteSession(id: string) {
  ensureRegistryLoaded();
  runningSessions.delete(id);
  finishedSessions.delete(id);
  persistRegistry();
}

export function appendOutput(session: ProcessSession, stream: "stdout" | "stderr", chunk: string) {
  session.pendingStdout ??= [];
  session.pendingStderr ??= [];
  session.pendingStdoutChars ??= sumPendingChars(session.pendingStdout);
  session.pendingStderrChars ??= sumPendingChars(session.pendingStderr);
  const buffer = stream === "stdout" ? session.pendingStdout : session.pendingStderr;
  const bufferChars = stream === "stdout" ? session.pendingStdoutChars : session.pendingStderrChars;
  const pendingCap = Math.min(
    session.pendingMaxOutputChars ?? DEFAULT_PENDING_OUTPUT_CHARS,
    session.maxOutputChars,
  );
  buffer.push(chunk);
  let pendingChars = bufferChars + chunk.length;
  if (pendingChars > pendingCap) {
    session.truncated = true;
    pendingChars = capPendingBuffer(buffer, pendingChars, pendingCap);
  }
  if (stream === "stdout") {
    session.pendingStdoutChars = pendingChars;
  } else {
    session.pendingStderrChars = pendingChars;
  }
  session.totalOutputChars += chunk.length;
  const aggregated = trimWithCap(session.aggregated + chunk, session.maxOutputChars);
  session.truncated =
    session.truncated || aggregated.length < session.aggregated.length + chunk.length;
  session.aggregated = aggregated;
  session.tail = tail(session.aggregated, 2000);
}

export function drainSession(session: ProcessSession) {
  const stdout = session.pendingStdout.join("");
  const stderr = session.pendingStderr.join("");
  session.pendingStdout = [];
  session.pendingStderr = [];
  session.pendingStdoutChars = 0;
  session.pendingStderrChars = 0;
  return { stdout, stderr };
}

export function markExited(
  session: ProcessSession,
  exitCode: number | null,
  exitSignal: NodeJS.Signals | number | null,
  status: ProcessStatus,
) {
  ensureRegistryLoaded();
  session.exited = true;
  session.exitCode = exitCode;
  session.exitSignal = exitSignal;
  session.tail = tail(session.aggregated, 2000);
  moveToFinished(session, status);
}

export function markBackgrounded(session: ProcessSession) {
  ensureRegistryLoaded();
  session.backgrounded = true;
  persistRegistry();
}

function moveToFinished(session: ProcessSession, status: ProcessStatus) {
  runningSessions.delete(session.id);
  if (!session.backgrounded) {
    return;
  }
  finishedSessions.set(session.id, {
    id: session.id,
    command: session.command,
    scopeKey: session.scopeKey,
    startedAt: session.startedAt,
    endedAt: Date.now(),
    cwd: session.cwd,
    status,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    aggregated: session.aggregated,
    tail: session.tail,
    truncated: session.truncated,
    totalOutputChars: session.totalOutputChars,
  });
  persistRegistry();
}

export function tail(text: string, max = 2000) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

function sumPendingChars(buffer: string[]) {
  let total = 0;
  for (const chunk of buffer) {
    total += chunk.length;
  }
  return total;
}

function capPendingBuffer(buffer: string[], pendingChars: number, cap: number) {
  if (pendingChars <= cap) {
    return pendingChars;
  }
  const last = buffer.at(-1);
  if (last && last.length >= cap) {
    buffer.length = 0;
    buffer.push(last.slice(last.length - cap));
    return cap;
  }
  while (buffer.length && pendingChars - buffer[0].length >= cap) {
    pendingChars -= buffer[0].length;
    buffer.shift();
  }
  if (buffer.length && pendingChars > cap) {
    const overflow = pendingChars - cap;
    buffer[0] = buffer[0].slice(overflow);
    pendingChars = cap;
  }
  return pendingChars;
}

export function trimWithCap(text: string, max: number) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

export function listRunningSessions() {
  ensureRegistryLoaded();
  return Array.from(runningSessions.values()).filter((s) => s.backgrounded);
}

export function listFinishedSessions() {
  ensureRegistryLoaded();
  return Array.from(finishedSessions.values());
}

export function clearFinished() {
  ensureRegistryLoaded();
  finishedSessions.clear();
  persistRegistry();
}

export function resetProcessRegistryForTests() {
  runningSessions.clear();
  finishedSessions.clear();
  registryLoaded = true;
  stopSweeper();
  const filePath = resolveRegistryPath();
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore
  }
}

export function reloadProcessRegistryForTests() {
  runningSessions.clear();
  finishedSessions.clear();
  registryLoaded = false;
  stopSweeper();
}

export function setJobTtlMs(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return;
  }
  jobTtlMs = clampTtl(value);
  stopSweeper();
  startSweeper();
}

function pruneFinishedSessions() {
  ensureRegistryLoaded();
  const cutoff = Date.now() - jobTtlMs;
  for (const [id, session] of finishedSessions.entries()) {
    if (session.endedAt < cutoff) {
      finishedSessions.delete(id);
    }
  }
  persistRegistry();
}

function startSweeper() {
  if (sweeper) {
    return;
  }
  sweeper = setInterval(pruneFinishedSessions, Math.max(30_000, jobTtlMs / 6));
  sweeper.unref?.();
}

function stopSweeper() {
  if (!sweeper) {
    return;
  }
  clearInterval(sweeper);
  sweeper = null;
}
