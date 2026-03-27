/**
 * Curiosity Queue Web Monitor
 *
 * External browser monitor for curiosity queue health. Polls PostgreSQL and
 * gateway logs on a fixed interval, persists JSONL snapshots, and serves a
 * lightweight dashboard over HTTP.
 *
 * Usage:
 *   node --import tsx scripts/curiosity-monitor-web.ts
 *   node --import tsx scripts/curiosity-monitor-web.ts --port 19427 --interval-sec 30
 */

import express from "express";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import postgres from "postgres";
import { resolvePostgresUrl } from "../src/data/storage-resolver.js";
import {
  loadConsciousnessKernelSelfState,
  resolveConsciousnessKernelDerivedAgendaTitle,
  resolveConsciousnessKernelInnerStateSummary,
} from "../src/infra/consciousness-kernel-state.js";

type ThreadStatus = "open" | "in_progress" | "resolved" | "dormant" | "stalled";
type AlertLevel = "info" | "warn" | "error";
type EventType =
  | "selected"
  | "progress_delta"
  | "executive_action"
  | "no_actionable"
  | "suspicious_progress"
  | "enqueue"
  | "feed_checked"
  | "feed_filtered"
  | "reflection"
  | "reflection_unchanged"
  | "conversation_sync";

type Options = {
  port: number;
  intervalSec: number;
  outDir: string;
  logFile: string;
  logFileSource: string;
  retention: number;
  kernelStatePath: string | null;
};

type CountSlice = {
  total: number;
  byStatus: Record<ThreadStatus, number>;
  byOrigin: Record<string, number>;
};

type Counts = CountSlice & {
  current: CountSlice;
  backlog: CountSlice;
  currentWindowHours: number;
};

type ThreadSummary = {
  id: string;
  title: string;
  originKind: string;
  originRef: string;
  canonicalKey: string | null;
  coreQuestion: string;
  valueProposition: string;
  stopCondition: string;
  status: ThreadStatus;
  attemptCount: number;
  cyclesOnCurrent: number;
  maxAttempts: number;
  lastWorkedAt: string | null;
  resolvedBy: string | null;
  statusReason: string | null;
  lastActionKind: string | null;
  lastActionQuery: string | null;
  lastArtifactType: string | null;
  lastArtifactPath: string | null;
  lastArtifactSummary: string | null;
  lastMeaningfulArtifactType: string | null;
  lastMeaningfulArtifactPath: string | null;
  lastMeaningfulArtifactSummary: string | null;
  lastSurfaceMode: string | null;
  lastStopConditionResult: string | null;
  lastStopConditionMatched: boolean | null;
  lastProgressSummary: string | null;
  tensionScore: number;
  noveltyScore: number;
  compositeScore: number;
  lastDeltaScore: number | null;
  lastDeltaDimensions: Record<string, unknown> | null;
  lastDeltaFlags: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type ThreadMetrics = {
  tensionScore: number;
  noveltyScore: number;
  compositeScore: number;
  lastDeltaScore?: number;
  lastDeltaDimensions?: Record<string, unknown>;
  lastDeltaFlags?: Record<string, unknown>;
};

type ThreadLifecycle = {
  status: ThreadStatus;
  attemptCount: number;
  cyclesOnCurrent: number;
  maxAttempts: number;
  lastWorkedAt: string | null;
  resolvedBy?: string;
  statusReason?: string;
  lastActionKind?: string;
  lastActionQuery?: string;
  lastArtifactType?: string;
  lastArtifactPath?: string;
  lastArtifactSummary?: string;
  lastMeaningfulArtifactType?: string;
  lastMeaningfulArtifactPath?: string;
  lastMeaningfulArtifactSummary?: string;
  lastSurfaceMode?: string;
  lastStopConditionResult?: string;
  lastStopConditionMatched?: boolean;
  lastProgressSummary?: string;
};

type LogEvent = {
  ts: string;
  type: EventType;
  line: string;
  originKind?: string | null;
  threadId?: string | null;
  title?: string | null;
  reason?: string | null;
  deduplicated?: boolean | null;
  flags?: string[] | null;
};

type LogCounts = Record<EventType, number>;

type FeedOriginActivity = {
  checked24h: number;
  filtered24h: number;
  enqueued24h: number;
  lastChecked: LogEvent | null;
  lastFiltered: LogEvent | null;
  lastEnqueued: LogEvent | null;
};

type FeedActivity = {
  byOrigin: Record<string, FeedOriginActivity>;
  recentFeedEvents: LogEvent[];
  recentEnqueues: LogEvent[];
};

type KernelSummary = {
  path: string;
  wakefulness: string | null;
  desiredAction: string | null;
  currentFocus: string | null;
  focusProvenance: string | null;
  carriedTaskFocus: string | null;
  carriedTaskLane: string | null;
  carriedTaskThreadTitle: string | null;
  conversationDerivedFocus: string | null;
  agendaDerivedFocus: string | null;
  reflectionFocus: string | null;
  activeThread: string | null;
  backgroundThread: string | null;
  agendaTitle: string | null;
  agendaSource: string | null;
  owner: string | null;
  activeLane: string | null;
  workingLane: string | null;
  lastReflectionAt: string | null;
  lastPersistedAt: string | null;
  lastTickAt: string | null;
  dailyBudget: number | null;
  spentToday: number | null;
  artifactCount: number | null;
  lastActionKind: string | null;
  lastArtifactType: string | null;
  pendingSurfaceMode: string | null;
  pendingSurfaceTitle: string | null;
  pendingSurfaceSummary: string | null;
  pendingSurfaceThreadId: string | null;
  pendingSurfaceRationale: string | null;
  pendingSurfaceRequestKind: string | null;
  pendingSurfaceRequiresOperatorAttention: boolean;
  pendingSurfaceRequiresOperatorDecision: boolean;
  pendingSurfaceSuggestedActions: string[];
  lastActionSummary: string | null;
  lastActionQuery: string | null;
  lastArtifactPath: string | null;
};

type AlertRecord = {
  ts: string;
  level: AlertLevel;
  code: string;
  message: string;
  startedAt: string;
  lastSeenAt: string;
  occurrences: number;
  details?: Record<string, unknown>;
};

type Snapshot = {
  ts: string;
  counts: Counts;
  logCounts: LogCounts;
  kernel: KernelSummary | null;
  feedActivity: FeedActivity;
  activeThreads: ThreadSummary[];
  recentThreads: ThreadSummary[];
  backlogThreads: ThreadSummary[];
  alerts: AlertRecord[];
  meta: {
    sampleMs: number;
    logOffset: number;
    queueNonEmpty: boolean;
  };
};

type MonitorState = {
  logOffset: number;
  logCarryover: string;
  snapshots: Snapshot[];
  events: LogEvent[];
  alerts: AlertRecord[];
  activeAlerts: Map<string, AlertRecord>;
  lastSnapshot: Snapshot | null;
  consecutiveActiveWithoutSelection: number;
  consecutiveStagnantTopThread: number;
  consecutiveReflectingEmptyQueue: number;
  lastTopThreadKey: string | null;
  feedEvents: LogEvent[];
  hasWarmStarted: boolean;
};

const DEFAULT_PORT = 19427;
const DEFAULT_INTERVAL_SEC = 30;
const DEFAULT_RETENTION = 200;
const INITIAL_LOG_BYTES = 256_000;
const FEED_EVENT_RETENTION = 1000;
const CURRENT_THREAD_WINDOW_HOURS = 24;
const CURRENT_THREAD_WINDOW_MS = CURRENT_THREAD_WINDOW_HOURS * 60 * 60 * 1000;
const EVENT_PATTERNS: Array<{ type: EventType; pattern: RegExp }> = [
  { type: "reflection", pattern: /consciousness kernel: reflection$/ },
  { type: "reflection_unchanged", pattern: /consciousness kernel: reflection unchanged/ },
  { type: "conversation_sync", pattern: /consciousness kernel: conversation sync/ },
  { type: "feed_checked", pattern: /curiosity feed checked/ },
  { type: "feed_filtered", pattern: /curiosity feed filtered/ },
  { type: "enqueue", pattern: /consciousness kernel: curiosity enqueue/ },
  { type: "selected", pattern: /consciousness kernel: curiosity thread selected/ },
  { type: "progress_delta", pattern: /consciousness kernel: progress delta/ },
  { type: "executive_action", pattern: /consciousness kernel: executive action/ },
  { type: "no_actionable", pattern: /consciousness kernel: no actionable threads/ },
  { type: "suspicious_progress", pattern: /consciousness kernel: suspicious progress pattern/ },
];

function emptyLogCounts(): LogCounts {
  return {
    enqueue: 0,
    feed_checked: 0,
    feed_filtered: 0,
    reflection: 0,
    reflection_unchanged: 0,
    conversation_sync: 0,
    selected: 0,
    progress_delta: 0,
    executive_action: 0,
    no_actionable: 0,
    suspicious_progress: 0,
  };
}

function parseArgs(argv: string[]): Partial<Options> {
  const parsed: Partial<Options> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--port" && next) {
      parsed.port = Number(next);
      i++;
      continue;
    }
    if (arg.startsWith("--port=")) {
      parsed.port = Number(arg.slice("--port=".length));
      continue;
    }
    if (arg === "--interval-sec" && next) {
      parsed.intervalSec = Number(next);
      i++;
      continue;
    }
    if (arg.startsWith("--interval-sec=")) {
      parsed.intervalSec = Number(arg.slice("--interval-sec=".length));
      continue;
    }
    if (arg === "--out-dir" && next) {
      parsed.outDir = next;
      i++;
      continue;
    }
    if (arg.startsWith("--out-dir=")) {
      parsed.outDir = arg.slice("--out-dir=".length);
      continue;
    }
    if (arg === "--log-file" && next) {
      parsed.logFile = next;
      i++;
      continue;
    }
    if (arg.startsWith("--log-file=")) {
      parsed.logFile = arg.slice("--log-file=".length);
      continue;
    }
    if (arg === "--retention" && next) {
      parsed.retention = Number(next);
      i++;
      continue;
    }
    if (arg.startsWith("--retention=")) {
      parsed.retention = Number(arg.slice("--retention=".length));
    }
  }
  return parsed;
}

function resolveStateDir(): string {
  if (process.env.ARGENT_STATE_DIR) {
    return process.env.ARGENT_STATE_DIR;
  }
  return path.join(process.env.HOME ?? "", ".argentos");
}

function resolveGatewayLogFileFromLaunchAgent(): string | null {
  const home = process.env.HOME ?? "";
  const plistPath = path.join(home, "Library", "LaunchAgents", "ai.argent.gateway.plist");
  if (!fs.existsSync(plistPath)) {
    return null;
  }
  try {
    const raw = execFileSync("plutil", ["-extract", "StandardOutPath", "raw", plistPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const resolved = raw.trim();
    return resolved.length > 0 ? resolved : null;
  } catch {
    try {
      const json = execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const parsed = JSON.parse(json) as { StandardOutPath?: unknown };
      return typeof parsed.StandardOutPath === "string" && parsed.StandardOutPath.trim().length > 0
        ? parsed.StandardOutPath.trim()
        : null;
    } catch {
      return null;
    }
  }
}

function resolveGatewayLogFile(stateDir: string): { path: string; source: string } {
  const explicit = process.env.ARGENT_GATEWAY_LOG_FILE?.trim();
  if (explicit) {
    return { path: explicit, source: "env:ARGENT_GATEWAY_LOG_FILE" };
  }

  const fromLaunchAgent = resolveGatewayLogFileFromLaunchAgent();
  if (fromLaunchAgent) {
    return { path: fromLaunchAgent, source: "launchd:ai.argent.gateway" };
  }

  const candidates = [
    {
      path: path.join(process.env.HOME ?? "", ".argent", "logs", "gateway.log"),
      source: "default:~/.argent/logs/gateway.log",
    },
    {
      path: path.join(stateDir, "logs", "gateway.log"),
      source: "default:ARGENT_STATE_DIR/logs/gateway.log",
    },
  ];

  const existing = candidates
    .filter((candidate) => candidate.path.length > 0 && fs.existsSync(candidate.path))
    .toSorted((left, right) => {
      const leftMtime = fs.statSync(left.path).mtimeMs;
      const rightMtime = fs.statSync(right.path).mtimeMs;
      return rightMtime - leftMtime;
    });
  if (existing.length > 0) {
    return existing[0]!;
  }

  return (
    candidates.at(-1) ?? {
      path: path.join(stateDir, "logs", "gateway.log"),
      source: "fallback:ARGENT_STATE_DIR/logs/gateway.log",
    }
  );
}

function sanitizePositiveInt(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && typeof value === "number" && value > 0
    ? Math.floor(value)
    : fallback;
}

function buildOptions(): Options {
  const parsed = parseArgs(process.argv.slice(2));
  const stateDir = resolveStateDir();
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const resolvedLogFile = parsed.logFile
    ? { path: parsed.logFile, source: "argv:--log-file" }
    : resolveGatewayLogFile(stateDir);
  return {
    port: sanitizePositiveInt(parsed.port, DEFAULT_PORT),
    intervalSec: sanitizePositiveInt(parsed.intervalSec, DEFAULT_INTERVAL_SEC),
    retention: sanitizePositiveInt(parsed.retention, DEFAULT_RETENTION),
    logFile: resolvedLogFile.path,
    logFileSource: resolvedLogFile.source,
    outDir: parsed.outDir ?? path.join(stateDir, "monitoring", "curiosity-monitor", stamp),
    kernelStatePath: resolveKernelStatePath(stateDir),
  };
}

function resolveKernelStatePath(stateDir: string): string | null {
  const direct = path.join(stateDir, "agents", "argent", "agent", "kernel", "self-state.json");
  if (fs.existsSync(direct)) {
    return direct;
  }

  try {
    const agentRoot = path.join(stateDir, "agents");
    const candidates = fs
      .readdirSync(agentRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(agentRoot, entry.name, "agent", "kernel", "self-state.json"))
      .filter((candidate) => fs.existsSync(candidate))
      .toSorted((a, b) => {
        const aMtime = fs.statSync(a).mtimeMs;
        const bMtime = fs.statSync(b).mtimeMs;
        return bMtime - aMtime;
      });
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function trimToRetention<T>(items: T[], retention: number): T[] {
  if (items.length <= retention) {
    return items;
  }
  return items.slice(items.length - retention);
}

function appendJsonl(filePath: string, payload: unknown): void {
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function extractQuotedField(line: string, field: string): string | null {
  const match = line.match(new RegExp(`"${field}":"([^"]+)"`));
  return match?.[1] ?? null;
}

function extractInlineTokenField(line: string, field: string): string | null {
  const match = line.match(new RegExp(`${field}=([^\\s]+)`));
  return match?.[1] ?? null;
}

function extractInlineJsonStringField(line: string, field: string): string | null {
  const match = line.match(new RegExp(`${field}=("(?:\\\\.|[^"])*")`));
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return match[1].slice(1, -1);
  }
}

function extractBracketedFeedMetadata(line: string): {
  originKind: string | null;
  reason: string | null;
} {
  const match = line.match(
    /curiosity (?:feed checked|feed filtered|enqueue) \[([a-z_]+)(?::([a-z0-9_:-]+))?\]/i,
  );
  return {
    originKind: match?.[1] ?? null,
    reason: match?.[2] ?? null,
  };
}

function extractBooleanField(line: string, field: string): boolean | null {
  const match = line.match(new RegExp(`"${field}":(true|false)`));
  if (!match) {
    return null;
  }
  return match[1] === "true";
}

function extractBooleanMapField(line: string, field: string): Record<string, boolean> | null {
  const match = line.match(new RegExp(`"${field}":(\\{[^}]+\\})`));
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1]) as Record<string, boolean>;
  } catch {
    return null;
  }
}

function inferDeduplicated(reason: string | null, explicit: boolean | null): boolean | null {
  if (explicit !== null) {
    return explicit;
  }
  if (reason === "deduplicated") {
    return true;
  }
  if (reason === "created") {
    return false;
  }
  return null;
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return parseJsonField(JSON.parse(value), fallback);
    } catch {
      return fallback;
    }
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return value as T;
}

function initialLogOffset(logFile: string): number {
  try {
    const size = fs.statSync(logFile).size;
    return Math.max(0, size - INITIAL_LOG_BYTES);
  } catch {
    return 0;
  }
}

async function readNewLogEvents(
  logFile: string,
  offset: number,
  carryover: string,
): Promise<{
  nextOffset: number;
  carryover: string;
  events: LogEvent[];
  counts: LogCounts;
}> {
  const counts = emptyLogCounts();
  if (!fs.existsSync(logFile)) {
    return { nextOffset: 0, carryover: "", events: [], counts };
  }
  const stat = await fs.promises.stat(logFile);
  const start = stat.size < offset ? 0 : offset;
  if (stat.size === start) {
    return { nextOffset: stat.size, carryover, events: [], counts };
  }
  const handle = await fs.promises.open(logFile, "r");
  try {
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const prefix = start === 0 ? "" : carryover;
    const text = `${prefix}${buffer.toString("utf8")}`;
    const parts = text.split("\n");
    const nextCarryover = text.endsWith("\n") ? "" : (parts.pop() ?? "");
    const events: LogEvent[] = [];
    for (const line of parts) {
      if (!line.trim()) {
        continue;
      }
      for (const { type, pattern } of EVENT_PATTERNS) {
        if (!pattern.test(line)) {
          continue;
        }
        counts[type] += 1;
        const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+)/);
        const event: LogEvent = {
          ts: match?.[1] ?? new Date().toISOString(),
          type,
          line,
        };
        if (type === "enqueue" || type === "feed_checked" || type === "feed_filtered") {
          const bracketed = extractBracketedFeedMetadata(line);
          event.originKind = extractQuotedField(line, "originKind") ?? bracketed.originKind;
          event.threadId =
            extractQuotedField(line, "threadId") ?? extractInlineTokenField(line, "thread");
          event.title =
            extractQuotedField(line, "title") ??
            extractInlineJsonStringField(line, "title") ??
            extractQuotedField(line, "query") ??
            extractQuotedField(line, "conflictingOn") ??
            extractQuotedField(line, "context");
          event.reason = extractQuotedField(line, "reason") ?? bracketed.reason;
          event.deduplicated = inferDeduplicated(
            event.reason,
            extractBooleanField(line, "deduplicated"),
          );
        }
        if (type === "suspicious_progress") {
          const rawFlags = extractBooleanMapField(line, "flags");
          event.threadId = extractQuotedField(line, "threadId");
          event.title = extractQuotedField(line, "title");
          event.flags = rawFlags
            ? Object.entries(rawFlags)
                .filter(([, value]) => value)
                .map(([key]) => key)
            : null;
        }
        events.push({
          ...event,
        });
        break;
      }
    }
    return { nextOffset: stat.size, carryover: nextCarryover, events, counts };
  } finally {
    await handle.close();
  }
}

function readKernelSummary(kernelStatePath: string | null): KernelSummary | null {
  if (!kernelStatePath || !fs.existsSync(kernelStatePath)) {
    return null;
  }

  try {
    const selfState = loadConsciousnessKernelSelfState(kernelStatePath);
    const raw = JSON.parse(fs.readFileSync(kernelStatePath, "utf8")) as Record<string, unknown>;
    const wakefulness = (raw.wakefulness ?? {}) as Record<string, unknown>;
    const budgets = (raw.budgets ?? {}) as Record<string, unknown>;
    const agency = (raw.agency ?? {}) as Record<string, unknown>;
    const activeWork = (raw.activeWork ?? {}) as Record<string, unknown>;
    const backgroundWork = (raw.backgroundWork ?? {}) as Record<string, unknown>;
    const agenda = (raw.agenda ?? {}) as Record<string, unknown>;
    const activeItem = (agenda.activeItem ?? {}) as Record<string, unknown>;
    const executive = (raw.executive ?? {}) as Record<string, unknown>;
    const work = (executive.work ?? {}) as Record<string, unknown>;
    const provenance = parseJsonField<Record<string, unknown>>(work.provenance, {});
    const continuity = (raw.continuity ?? {}) as Record<string, unknown>;
    const shadow = (raw.shadow ?? {}) as Record<string, unknown>;
    const innerState = selfState ? resolveConsciousnessKernelInnerStateSummary(selfState) : null;
    const derivedAgendaTitle = selfState
      ? resolveConsciousnessKernelDerivedAgendaTitle(selfState)
      : asNullableString((agenda.activeItem as Record<string, unknown> | undefined)?.title);
    const activeLane =
      asNullableString(work.lane) ??
      asNullableString(
        activeItem.source === "operator" || activeItem.source === "background"
          ? activeItem.source
          : null,
      );
    const rawReflectionFocus = asNullableString(agency.currentFocus);
    const activeThread = asNullableString(activeWork.threadTitle);
    const backgroundThread = asNullableString(backgroundWork.threadTitle);
    const executiveTitle = asNullableString(work.title);
    const canonicalFocus =
      innerState?.carriedTaskFocus ??
      executiveTitle ??
      activeThread ??
      backgroundThread ??
      derivedAgendaTitle ??
      rawReflectionFocus ??
      innerState?.conversationDerivedFocus ??
      null;
    const owner =
      asNullableString(work.source) ??
      asNullableString(provenance.originKind) ??
      asNullableString(activeItem.source);

    return {
      path: kernelStatePath,
      wakefulness: asNullableString(wakefulness.state),
      desiredAction: asNullableString(agency.desiredAction),
      currentFocus: canonicalFocus,
      focusProvenance: innerState?.provenance ?? null,
      carriedTaskFocus: innerState?.carriedTaskFocus ?? null,
      carriedTaskLane: innerState?.carriedTaskLane ?? null,
      carriedTaskThreadTitle: innerState?.carriedTaskThreadTitle ?? null,
      conversationDerivedFocus: innerState?.conversationDerivedFocus ?? null,
      agendaDerivedFocus: innerState?.agendaDerivedFocus ?? null,
      reflectionFocus: rawReflectionFocus !== canonicalFocus ? rawReflectionFocus : null,
      activeThread,
      backgroundThread,
      agendaTitle: derivedAgendaTitle,
      agendaSource: asNullableString(activeItem.source),
      owner,
      activeLane,
      workingLane:
        activeLane ??
        asNullableString(
          activeItem.source === "operator" || activeItem.source === "background"
            ? activeItem.source
            : null,
        ),
      lastReflectionAt: asNullableString(agency.lastReflectionAt),
      lastPersistedAt: asNullableString(continuity.lastPersistedAt),
      lastTickAt: asNullableString(shadow.lastTickAt),
      dailyBudget: Number.isFinite(asNumber(budgets.dailyBudget))
        ? asNumber(budgets.dailyBudget)
        : null,
      spentToday: Number.isFinite(asNumber(budgets.spentToday))
        ? asNumber(budgets.spentToday)
        : null,
      artifactCount: Number.isFinite(asNumber(executive.artifactCount))
        ? asNumber(executive.artifactCount)
        : null,
      lastActionKind: asNullableString(executive.lastActionKind),
      lastArtifactType: asNullableString(executive.lastArtifactType),
      lastActionSummary: asNullableString(executive.lastActionSummary),
      lastActionQuery: asNullableString(executive.lastActionQuery),
      pendingSurfaceMode: asNullableString(
        (executive.pendingSurface as Record<string, unknown> | undefined)?.mode,
      ),
      pendingSurfaceTitle: asNullableString(
        (executive.pendingSurface as Record<string, unknown> | undefined)?.title,
      ),
      pendingSurfaceSummary: asNullableString(
        (executive.pendingSurface as Record<string, unknown> | undefined)?.summary,
      ),
      pendingSurfaceThreadId: asNullableString(
        (executive.pendingSurface as Record<string, unknown> | undefined)?.threadId,
      ),
      pendingSurfaceRationale: asNullableString(
        (executive.pendingSurface as Record<string, unknown> | undefined)?.rationale,
      ),
      pendingSurfaceRequestKind: asNullableString(
        (executive.pendingSurface as Record<string, unknown> | undefined)?.requestKind,
      ),
      pendingSurfaceRequiresOperatorAttention:
        (executive.pendingSurface as Record<string, unknown> | undefined)
          ?.requiresOperatorAttention === true,
      pendingSurfaceRequiresOperatorDecision:
        (executive.pendingSurface as Record<string, unknown> | undefined)
          ?.requiresOperatorDecision === true,
      pendingSurfaceSuggestedActions: Array.isArray(
        (executive.pendingSurface as Record<string, unknown> | undefined)?.suggestedActions,
      )
        ? ((executive.pendingSurface as Record<string, unknown>).suggestedActions as unknown[])
            .map((entry) => String(entry).trim())
            .filter(Boolean)
        : [],
      lastArtifactPath: asNullableString(executive.lastArtifactPath),
    };
  } catch {
    return null;
  }
}

function countRecentEvents(
  events: LogEvent[],
  types: EventType[],
  sampleTs: string,
  windowMs: number,
): number {
  const sampleMs = Date.parse(sampleTs);
  if (!Number.isFinite(sampleMs)) {
    return 0;
  }
  return events.reduce((count, event) => {
    if (!types.includes(event.type)) {
      return count;
    }
    const eventMs = Date.parse(event.ts);
    if (!Number.isFinite(eventMs)) {
      return count;
    }
    return sampleMs - eventMs <= windowMs ? count + 1 : count;
  }, 0);
}

function createEmptyFeedOriginActivity(): FeedOriginActivity {
  return {
    checked24h: 0,
    filtered24h: 0,
    enqueued24h: 0,
    lastChecked: null,
    lastFiltered: null,
    lastEnqueued: null,
  };
}

function buildFeedActivity(feedEvents: LogEvent[], sampleTs: string): FeedActivity {
  const sampleMs = Date.parse(sampleTs);
  const windowMs = 24 * 60 * 60 * 1000;
  const byOrigin: Record<string, FeedOriginActivity> = {
    memu_miss: createEmptyFeedOriginActivity(),
    sis_contradiction: createEmptyFeedOriginActivity(),
    exec_deadend: createEmptyFeedOriginActivity(),
  };
  const recentFeedEvents = feedEvents
    .filter((event) => {
      const eventMs = Date.parse(event.ts);
      return (
        Number.isFinite(sampleMs) && Number.isFinite(eventMs) && sampleMs - eventMs <= windowMs
      );
    })
    .slice(-20);

  for (const event of recentFeedEvents) {
    const originKind = event.originKind ?? "unknown";
    const activity = (byOrigin[originKind] ??= createEmptyFeedOriginActivity());
    if (event.type === "feed_checked") {
      activity.checked24h += 1;
      activity.lastChecked = event;
    } else if (event.type === "feed_filtered") {
      activity.filtered24h += 1;
      activity.lastFiltered = event;
    } else if (event.type === "enqueue") {
      activity.enqueued24h += 1;
      activity.lastEnqueued = event;
    }
  }

  return {
    byOrigin,
    recentFeedEvents,
    recentEnqueues: recentFeedEvents.filter((event) => event.type === "enqueue"),
  };
}

function asMetrics(value: unknown): ThreadMetrics {
  const candidate = parseJsonField<Record<string, unknown> | null>(value, null);
  if (!candidate || typeof candidate !== "object") {
    return {
      tensionScore: 0,
      noveltyScore: 0,
      compositeScore: 0,
    };
  }
  return {
    tensionScore: asNumber(candidate.tensionScore),
    noveltyScore: asNumber(candidate.noveltyScore),
    compositeScore: asNumber(candidate.compositeScore),
    lastDeltaScore:
      candidate.lastDeltaScore === undefined || candidate.lastDeltaScore === null
        ? undefined
        : asNumber(candidate.lastDeltaScore),
    lastDeltaDimensions:
      candidate.lastDeltaDimensions && typeof candidate.lastDeltaDimensions === "object"
        ? (candidate.lastDeltaDimensions as Record<string, unknown>)
        : undefined,
    lastDeltaFlags:
      candidate.lastDeltaFlags && typeof candidate.lastDeltaFlags === "object"
        ? (candidate.lastDeltaFlags as Record<string, unknown>)
        : undefined,
  };
}

function asLifecycle(value: unknown): ThreadLifecycle {
  const candidate = parseJsonField<Record<string, unknown> | null>(value, null);
  if (!candidate || typeof candidate !== "object") {
    return {
      status: "open",
      attemptCount: 0,
      cyclesOnCurrent: 0,
      maxAttempts: 0,
      lastWorkedAt: null,
    };
  }
  const rawStatus = candidate.status;
  const status: ThreadStatus =
    rawStatus === "open" ||
    rawStatus === "in_progress" ||
    rawStatus === "resolved" ||
    rawStatus === "dormant" ||
    rawStatus === "stalled"
      ? rawStatus
      : "open";
  return {
    status,
    attemptCount: asNumber(candidate.attemptCount),
    cyclesOnCurrent: asNumber(candidate.cyclesOnCurrent),
    maxAttempts: asNumber(candidate.maxAttempts),
    lastWorkedAt: asNullableString(candidate.lastWorkedAt),
    resolvedBy: asNullableString(candidate.resolvedBy) ?? undefined,
    statusReason: asNullableString(candidate.statusReason) ?? undefined,
    lastActionKind: asNullableString(candidate.lastActionKind) ?? undefined,
    lastActionQuery: asNullableString(candidate.lastActionQuery) ?? undefined,
    lastArtifactType: asNullableString(candidate.lastArtifactType) ?? undefined,
    lastArtifactPath: asNullableString(candidate.lastArtifactPath) ?? undefined,
    lastArtifactSummary: asNullableString(candidate.lastArtifactSummary) ?? undefined,
    lastMeaningfulArtifactType: asNullableString(candidate.lastMeaningfulArtifactType) ?? undefined,
    lastMeaningfulArtifactPath: asNullableString(candidate.lastMeaningfulArtifactPath) ?? undefined,
    lastMeaningfulArtifactSummary:
      asNullableString(candidate.lastMeaningfulArtifactSummary) ?? undefined,
    lastSurfaceMode: asNullableString(candidate.lastSurfaceMode) ?? undefined,
    lastStopConditionResult: asNullableString(candidate.lastStopConditionResult) ?? undefined,
    lastStopConditionMatched:
      typeof candidate.lastStopConditionMatched === "boolean"
        ? candidate.lastStopConditionMatched
        : undefined,
    lastProgressSummary: asNullableString(candidate.lastProgressSummary) ?? undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function threadToFeedEvent(thread: ThreadSummary): LogEvent {
  return {
    ts: thread.createdAt,
    type: "enqueue",
    line: `[curiosity-thread] ${thread.originKind} ${thread.title}`,
    originKind: thread.originKind,
    threadId: thread.id,
    title: thread.title,
    reason: "created",
    deduplicated: false,
  };
}

function buildFeedActivityFromState(
  feedEvents: LogEvent[],
  recentThreads: ThreadSummary[],
  sampleTs: string,
): FeedActivity {
  const sampleMs = Date.parse(sampleTs);
  const windowMs = 24 * 60 * 60 * 1000;
  const dbEvents = recentThreads
    .filter((thread) => {
      const createdMs = Date.parse(thread.createdAt);
      return (
        Number.isFinite(sampleMs) && Number.isFinite(createdMs) && sampleMs - createdMs <= windowMs
      );
    })
    .map(threadToFeedEvent);
  const dbThreadIds = new Set(dbEvents.map((event) => event.threadId).filter(Boolean));
  const merged = new Map<string, LogEvent>();

  for (const event of dbEvents) {
    const key = event.threadId ? `thread:${event.threadId}` : `db:${event.ts}:${event.title}`;
    merged.set(key, event);
  }

  for (const event of feedEvents) {
    const eventMs = Date.parse(event.ts);
    if (!Number.isFinite(sampleMs) || !Number.isFinite(eventMs) || sampleMs - eventMs > windowMs) {
      continue;
    }
    if (
      event.type === "enqueue" &&
      event.deduplicated !== true &&
      event.threadId &&
      dbThreadIds.has(event.threadId)
    ) {
      continue;
    }
    const key =
      event.type === "enqueue" && event.deduplicated === true
        ? `dedup:${event.ts}:${event.threadId ?? event.title ?? "unknown"}`
        : event.threadId
          ? `thread:${event.threadId}`
          : `log:${event.type}:${event.ts}:${event.title ?? event.line}`;
    merged.set(key, event);
  }

  return buildFeedActivity(
    Array.from(merged.values()).toSorted(
      (left, right) => Date.parse(left.ts) - Date.parse(right.ts),
    ),
    sampleTs,
  );
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function emptyStatusCounts(): Record<ThreadStatus, number> {
  return {
    open: 0,
    in_progress: 0,
    resolved: 0,
    dormant: 0,
    stalled: 0,
  };
}

function emptyCountSlice(): CountSlice {
  return {
    total: 0,
    byStatus: emptyStatusCounts(),
    byOrigin: {},
  };
}

function accumulateCountSlice(slice: CountSlice, originKind: string, status: ThreadStatus): void {
  slice.total += 1;
  slice.byStatus[status] += 1;
  slice.byOrigin[originKind] = (slice.byOrigin[originKind] ?? 0) + 1;
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCurrentThread(params: {
  status: ThreadStatus;
  updatedAt: string | null;
  nowMs: number;
}): boolean {
  if (params.status === "open" || params.status === "in_progress") {
    return true;
  }
  const updatedAtMs = parseIsoMs(params.updatedAt);
  return updatedAtMs != null && params.nowMs - updatedAtMs <= CURRENT_THREAD_WINDOW_MS;
}

async function queryCounts(sql: postgres.Sql): Promise<Counts> {
  const rows = await sql<Array<{ origin_kind: string; lifecycle: unknown; updated_at: string }>>`
    SELECT origin_kind, lifecycle, updated_at::text AS updated_at
    FROM curiosity_threads
  `;
  const nowMs = Date.now();
  const total = emptyCountSlice();
  const current = emptyCountSlice();
  const backlog = emptyCountSlice();
  for (const row of rows) {
    const originKind = String(row.origin_kind);
    const lifecycle = asLifecycle(row.lifecycle);
    accumulateCountSlice(total, originKind, lifecycle.status);
    accumulateCountSlice(
      isCurrentThread({
        status: lifecycle.status,
        updatedAt: row.updated_at,
        nowMs,
      })
        ? current
        : backlog,
      originKind,
      lifecycle.status,
    );
  }
  return {
    ...total,
    current,
    backlog,
    currentWindowHours: CURRENT_THREAD_WINDOW_HOURS,
  };
}

async function queryThreads(
  sql: postgres.Sql,
  limit: number,
  mode: "active" | "current" | "backlog",
): Promise<ThreadSummary[]> {
  const rows = await sql<
    Array<{
      id: string;
      title: string;
      origin_kind: string;
      origin_ref: string;
      core_question: string;
      value_proposition: string;
      stop_condition: string;
      provenance: unknown;
      lifecycle: unknown;
      metrics: unknown;
      created_at: string;
      updated_at: string;
    }>
  >`
    SELECT
      id,
      title,
      origin_kind,
      origin_ref,
      core_question,
      value_proposition,
      stop_condition,
      provenance,
      lifecycle,
      metrics,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM curiosity_threads
    ORDER BY updated_at DESC
  `;
  const nowMs = Date.now();
  return rows
    .map((row) => {
      const lifecycle = asLifecycle(row.lifecycle);
      const metrics = asMetrics(row.metrics);
      const provenance = asRecord(
        parseJsonField<Record<string, unknown> | null>(row.provenance, null),
      );
      return {
        id: String(row.id),
        title: String(row.title),
        originKind: String(row.origin_kind),
        originRef: String(row.origin_ref),
        canonicalKey: asNullableString(provenance.canonicalKey),
        coreQuestion: String(row.core_question),
        valueProposition: String(row.value_proposition),
        stopCondition: String(row.stop_condition),
        status: lifecycle.status,
        attemptCount: lifecycle.attemptCount,
        cyclesOnCurrent: lifecycle.cyclesOnCurrent,
        maxAttempts: lifecycle.maxAttempts,
        lastWorkedAt: lifecycle.lastWorkedAt,
        resolvedBy: lifecycle.resolvedBy ?? null,
        statusReason: lifecycle.statusReason ?? null,
        lastActionKind: lifecycle.lastActionKind ?? null,
        lastActionQuery: lifecycle.lastActionQuery ?? null,
        lastArtifactType: lifecycle.lastArtifactType ?? null,
        lastArtifactPath: lifecycle.lastArtifactPath ?? null,
        lastArtifactSummary: lifecycle.lastArtifactSummary ?? null,
        lastMeaningfulArtifactType: lifecycle.lastMeaningfulArtifactType ?? null,
        lastMeaningfulArtifactPath: lifecycle.lastMeaningfulArtifactPath ?? null,
        lastMeaningfulArtifactSummary: lifecycle.lastMeaningfulArtifactSummary ?? null,
        lastSurfaceMode: lifecycle.lastSurfaceMode ?? null,
        lastStopConditionResult: lifecycle.lastStopConditionResult ?? null,
        lastStopConditionMatched: lifecycle.lastStopConditionMatched ?? null,
        lastProgressSummary: lifecycle.lastProgressSummary ?? null,
        tensionScore: metrics.tensionScore,
        noveltyScore: metrics.noveltyScore,
        compositeScore: metrics.compositeScore,
        lastDeltaScore: metrics.lastDeltaScore ?? null,
        lastDeltaDimensions: metrics.lastDeltaDimensions ?? null,
        lastDeltaFlags: metrics.lastDeltaFlags ?? null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      } satisfies ThreadSummary;
    })
    .filter((row) => {
      if (mode === "active") {
        return row.status === "open" || row.status === "in_progress";
      }
      const current = isCurrentThread({
        status: row.status,
        updatedAt: row.updatedAt,
        nowMs,
      });
      return mode === "current" ? current : !current;
    })
    .slice(0, limit);
}

type PendingAlert = {
  level: AlertLevel;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

function pushPendingAlert(
  alerts: PendingAlert[],
  level: AlertLevel,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  alerts.push({
    level,
    code,
    message,
    details,
  });
}

function reconcileAlerts(
  state: MonitorState,
  outDir: string,
  pending: PendingAlert[],
): AlertRecord[] {
  const now = new Date().toISOString();
  const seenCodes = new Set<string>();
  for (const alert of pending) {
    seenCodes.add(alert.code);
    const existing = state.activeAlerts.get(alert.code);
    if (existing) {
      existing.ts = now;
      existing.lastSeenAt = now;
      existing.occurrences += 1;
      existing.level = alert.level;
      existing.message = alert.message;
      existing.details = alert.details;
      continue;
    }

    const record: AlertRecord = {
      ts: now,
      startedAt: now,
      lastSeenAt: now,
      occurrences: 1,
      level: alert.level,
      code: alert.code,
      message: alert.message,
      details: alert.details,
    };
    state.activeAlerts.set(alert.code, record);
    appendJsonl(path.join(outDir, "alerts.jsonl"), {
      event: "opened",
      alert: record,
    });
  }

  for (const [code, alert] of state.activeAlerts.entries()) {
    if (seenCodes.has(code)) {
      continue;
    }
    appendJsonl(path.join(outDir, "alerts.jsonl"), {
      event: "resolved",
      alert: {
        ...alert,
        resolvedAt: now,
      },
    });
    state.activeAlerts.delete(code);
  }

  return Array.from(state.activeAlerts.values()).toSorted(
    (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
  );
}

function evaluateAlerts(params: {
  state: MonitorState;
  snapshot: Snapshot;
  outDir: string;
}): AlertRecord[] {
  const { state, snapshot, outDir } = params;
  const alerts: PendingAlert[] = [];
  const activeCount =
    snapshot.counts.current.byStatus.open + snapshot.counts.current.byStatus.in_progress;
  const dailyBudget = snapshot.kernel?.dailyBudget ?? null;
  const spentToday = snapshot.kernel?.spentToday ?? null;

  if (dailyBudget !== null && dailyBudget > 0 && spentToday !== null && spentToday >= dailyBudget) {
    pushPendingAlert(
      alerts,
      activeCount > 0 ? "error" : "warn",
      "budget-exhausted",
      "Daily executive budget is exhausted; active work may fall back to reflection-only behavior.",
      {
        dailyBudget,
        spentToday,
        activeCount,
      },
    );
  }

  if (activeCount > 0 && snapshot.logCounts.no_actionable > 0) {
    pushPendingAlert(
      alerts,
      "error",
      "queue-nonempty-no-actionable",
      "Queue is non-empty but the kernel logged no actionable threads.",
      { activeCount, noActionable: snapshot.logCounts.no_actionable },
    );
  }

  if (activeCount > 0 && snapshot.logCounts.selected === 0) {
    state.consecutiveActiveWithoutSelection += 1;
  } else {
    state.consecutiveActiveWithoutSelection = 0;
  }
  if (state.consecutiveActiveWithoutSelection >= 2) {
    pushPendingAlert(
      alerts,
      "warn",
      "active-without-selection",
      "Queue has active threads but no curiosity thread selection has happened across multiple intervals.",
      { intervals: state.consecutiveActiveWithoutSelection, activeCount },
    );
  }

  if (snapshot.logCounts.suspicious_progress > 0) {
    const latestSuspiciousEvent = state.events
      .toReversed()
      .find((event) => event.type === "suspicious_progress");
    pushPendingAlert(
      alerts,
      "warn",
      "suspicious-progress",
      "Kernel reported suspicious progress patterns during this interval.",
      {
        count: snapshot.logCounts.suspicious_progress,
        threadId: latestSuspiciousEvent?.threadId ?? null,
        title: latestSuspiciousEvent?.title ?? null,
        flags: latestSuspiciousEvent?.flags ?? [],
      },
    );
  }

  if (snapshot.kernel?.pendingSurfaceRequiresOperatorAttention) {
    const needsDecision = snapshot.kernel.pendingSurfaceRequiresOperatorDecision;
    pushPendingAlert(
      alerts,
      needsDecision ? "warn" : "info",
      "operator-attention-required",
      needsDecision
        ? "Kernel parked a thread that now needs an operator decision."
        : "Kernel parked an interrupt-worthy update for operator review.",
      {
        threadId: snapshot.kernel.pendingSurfaceThreadId,
        title: snapshot.kernel.pendingSurfaceTitle,
        summary: snapshot.kernel.pendingSurfaceSummary,
        rationale: snapshot.kernel.pendingSurfaceRationale,
        requestKind: snapshot.kernel.pendingSurfaceRequestKind,
        suggestedActions: snapshot.kernel.pendingSurfaceSuggestedActions,
      },
    );
  }

  const reflecting15m = countRecentEvents(
    state.events,
    ["reflection", "reflection_unchanged"],
    snapshot.ts,
    15 * 60 * 1000,
  );
  const noActionable15m = countRecentEvents(
    state.events,
    ["no_actionable"],
    snapshot.ts,
    15 * 60 * 1000,
  );
  const enqueue15m = countRecentEvents(state.feedEvents, ["enqueue"], snapshot.ts, 15 * 60 * 1000);
  if (
    snapshot.counts.current.total === 0 &&
    reflecting15m >= 5 &&
    noActionable15m >= 5 &&
    enqueue15m === 0
  ) {
    state.consecutiveReflectingEmptyQueue += 1;
  } else {
    state.consecutiveReflectingEmptyQueue = 0;
  }
  if (state.consecutiveReflectingEmptyQueue >= 2) {
    pushPendingAlert(
      alerts,
      "warn",
      "reflecting-empty-queue",
      "Kernel has been reflecting with an empty curiosity queue and no recent feed inflow.",
      {
        reflections15m: reflecting15m,
        noActionable15m,
        enqueue15m,
      },
    );
  }

  const topThread = snapshot.activeThreads[0] ?? null;
  const topKey = topThread ? `${topThread.id}:${topThread.lastDeltaScore ?? "null"}` : null;
  if (topKey && topKey === state.lastTopThreadKey && activeCount > 0) {
    state.consecutiveStagnantTopThread += 1;
  } else {
    state.consecutiveStagnantTopThread = 0;
  }
  state.lastTopThreadKey = topKey;
  if (state.consecutiveStagnantTopThread >= 3 && topThread) {
    pushPendingAlert(
      alerts,
      "warn",
      "stagnant-top-thread",
      "Same active thread has remained at the top with no new delta across multiple intervals.",
      {
        threadId: topThread.id,
        title: topThread.title,
        lastDeltaScore: topThread.lastDeltaScore,
        intervals: state.consecutiveStagnantTopThread,
      },
    );
  }

  if (state.lastSnapshot) {
    const prev = state.lastSnapshot.counts.current;
    if (snapshot.counts.current.byStatus.stalled > prev.byStatus.stalled) {
      pushPendingAlert(
        alerts,
        "warn",
        "stalled-threads-increased",
        "Current curiosity queue stalled thread count increased.",
        {
          previous: prev.byStatus.stalled,
          current: snapshot.counts.current.byStatus.stalled,
        },
      );
    }
    if (snapshot.counts.current.byStatus.resolved > prev.byStatus.resolved) {
      pushPendingAlert(
        alerts,
        "info",
        "resolved-threads-increased",
        "Current curiosity queue resolved thread count increased.",
        {
          previous: prev.byStatus.resolved,
          current: snapshot.counts.current.byStatus.resolved,
        },
      );
    }
  }

  return reconcileAlerts(state, outDir, alerts);
}

async function sampleMonitor(params: {
  sql: postgres.Sql;
  options: Options;
  state: MonitorState;
}): Promise<Snapshot> {
  const started = Date.now();
  const { sql, options, state } = params;
  const [counts, activeThreads, recentThreads, backlogThreads, logBatch] = await Promise.all([
    queryCounts(sql),
    queryThreads(sql, 12, "active"),
    queryThreads(sql, 12, "current"),
    queryThreads(sql, 12, "backlog"),
    readNewLogEvents(options.logFile, state.logOffset, state.logCarryover),
  ]);
  const kernel = readKernelSummary(options.kernelStatePath);
  state.logOffset = logBatch.nextOffset;
  state.logCarryover = logBatch.carryover;
  state.events = trimToRetention([...state.events, ...logBatch.events], options.retention);
  state.feedEvents = trimToRetention(
    [
      ...state.feedEvents,
      ...logBatch.events.filter(
        (event) =>
          event.type === "enqueue" ||
          event.type === "feed_checked" ||
          event.type === "feed_filtered",
      ),
    ],
    FEED_EVENT_RETENTION,
  );
  for (const event of logBatch.events) {
    appendJsonl(path.join(options.outDir, "events.jsonl"), event);
  }

  const intervalCounts = state.hasWarmStarted ? logBatch.counts : emptyLogCounts();
  state.hasWarmStarted = true;
  const feedActivity = buildFeedActivityFromState(
    state.feedEvents,
    recentThreads,
    new Date().toISOString(),
  );
  const snapshot: Snapshot = {
    ts: new Date().toISOString(),
    counts,
    logCounts: intervalCounts,
    kernel,
    feedActivity,
    activeThreads,
    recentThreads,
    backlogThreads,
    alerts: [],
    meta: {
      sampleMs: 0,
      logOffset: state.logOffset,
      queueNonEmpty: counts.current.total > 0,
    },
  };
  snapshot.alerts = evaluateAlerts({
    state,
    snapshot,
    outDir: options.outDir,
  });
  state.alerts = snapshot.alerts;
  snapshot.meta.sampleMs = Date.now() - started;
  state.snapshots = trimToRetention([...state.snapshots, snapshot], options.retention);
  state.lastSnapshot = snapshot;
  appendJsonl(path.join(options.outDir, "snapshots.jsonl"), snapshot);
  fs.writeFileSync(
    path.join(options.outDir, "latest.json"),
    JSON.stringify(snapshot, null, 2),
    "utf8",
  );
  return snapshot;
}

function renderIndexHtml(options: Options): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Curiosity Queue Monitor</title>
  <style>
    :root {
      --bg: #0f1418;
      --panel: #172027;
      --panel-alt: #1d2932;
      --text: #e6eef5;
      --muted: #97a7b5;
      --good: #52b788;
      --warn: #ffb703;
      --bad: #ef476f;
      --accent: #7bdff2;
      --border: #26333d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: linear-gradient(180deg, #0b1014 0%, #111a21 100%);
      color: var(--text);
    }
    main { padding: 20px; max-width: 1600px; margin: 0 auto; }
    h1, h2 { margin: 0 0 12px; }
    .subtle { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
      margin: 16px 0;
    }
    .card {
      background: rgba(23, 32, 39, 0.92);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.18);
    }
    .metric { font-size: 28px; font-weight: 700; }
    .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .row { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
    .header-right {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .stack { display: grid; gap: 10px; }
    .kv {
      display: grid;
      grid-template-columns: 180px 1fr;
      gap: 6px 12px;
      font-size: 13px;
      align-items: start;
    }
    .kv .k { color: var(--muted); }
    .kv .v { word-break: break-word; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 8px 6px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; }
    .pill {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid var(--border);
      background: var(--panel-alt);
    }
    .alert-error { color: var(--bad); }
    .alert-warn { color: var(--warn); }
    .alert-info { color: var(--accent); }
    .status-good { color: var(--good); }
    .columns {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 12px;
    }
    .columns-equal {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 1100px) {
      .columns { grid-template-columns: 1fr; }
      .columns-equal { grid-template-columns: 1fr; }
    }
    pre {
      white-space: pre-wrap;
      margin: 0;
      font-size: 12px;
      color: #d7e3ed;
    }
    .callout {
      border-left: 3px solid var(--accent);
      padding-left: 10px;
      color: var(--muted);
      font-size: 12px;
      margin-top: 8px;
    }
    .feed-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 12px;
    }
    .thread-card {
      background: rgba(18, 24, 29, 0.92);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      display: grid;
      gap: 10px;
    }
    .thread-card h3 {
      margin: 0;
      font-size: 18px;
    }
    .thread-meta {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .thread-lines {
      display: grid;
      gap: 6px;
      font-size: 13px;
    }
    .thread-lines strong {
      color: var(--muted);
      font-weight: 600;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
      background: var(--panel-alt);
    }
    .badge-quiescent {
      color: var(--muted);
      border-color: #41515e;
    }
    .badge-reflecting {
      color: var(--accent);
      border-color: rgba(123, 223, 242, 0.45);
      box-shadow: inset 0 0 0 1px rgba(123, 223, 242, 0.08);
    }
    .badge-queue {
      color: var(--good);
      border-color: rgba(82, 183, 136, 0.45);
      box-shadow: inset 0 0 0 1px rgba(82, 183, 136, 0.08);
    }
  </style>
</head>
<body>
  <main>
    <div class="row">
      <div>
        <h1>Curiosity Queue Monitor</h1>
        <div class="subtle">External watcher on port ${options.port}. Auto-refresh every 10s.</div>
      </div>
      <div class="header-right">
        <div class="subtle" id="meta"></div>
        <div id="mode-badge"></div>
      </div>
    </div>

    <section class="grid" id="cards"></section>

    <section class="columns-equal" style="margin-bottom: 12px;">
      <div class="card">
        <h2>Persisted Kernel State</h2>
        <div id="kernel-state"></div>
      </div>
      <div class="card">
        <h2>State / Stream Alignment</h2>
        <div id="alignment-state"></div>
      </div>
    </section>

    <section class="card" style="margin-bottom: 12px;">
      <h2>Feed Activity</h2>
      <div id="feed-activity"></div>
    </section>

    <section class="columns">
      <div class="card">
        <h2>Active Threads</h2>
        <table id="active-threads"></table>
      </div>
      <div class="card">
        <h2>Alerts</h2>
        <div id="alerts"></div>
      </div>
    </section>

    <section class="columns" style="margin-top: 12px;">
      <div class="card">
        <h2>Current Queue Activity</h2>
        <table id="recent-threads"></table>
      </div>
      <div class="card">
        <h2>Recent Kernel Events</h2>
        <div id="events"></div>
      </div>
    </section>

    <section class="card" style="margin-top: 12px;">
      <h2>Historical Backlog</h2>
      <table id="backlog-threads"></table>
    </section>

    <section class="card" style="margin-top: 12px;">
      <h2>Thread Audit Detail</h2>
      <div id="thread-audit"></div>
    </section>
  </main>

  <script>
    function esc(value) {
      return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[char]));
    }

    function parseTs(value) {
      const parsed = Date.parse(value ?? "");
      return Number.isFinite(parsed) ? parsed : null;
    }

    function recentCount(data, types, windowMs) {
      const sampleMs = parseTs(data.snapshot.ts) ?? Date.now();
      return data.events.reduce((count, event) => {
        const eventMs = parseTs(event.ts);
        if (eventMs == null) return count;
        if (!types.includes(event.type)) return count;
        if (sampleMs - eventMs > windowMs) return count;
        return count + 1;
      }, 0);
    }

    function inferMode(data) {
      const active = data.snapshot.counts.current.byStatus.open + data.snapshot.counts.current.byStatus.in_progress;
      const selected15m = recentCount(data, ["selected"], 15 * 60 * 1000);
      const reflections5m = recentCount(data, ["reflection", "reflection_unchanged"], 5 * 60 * 1000);
      const noActionable5m = recentCount(data, ["no_actionable"], 5 * 60 * 1000);

      if (active > 0 || selected15m > 0) {
        return {
          label: "Queue Active",
          cls: "badge-queue",
          reason: active > 0 ? "active thread present" : "recent queue selection",
        };
      }
      if (reflections5m > 0 || noActionable5m > 0) {
        return {
          label: "Reflecting",
          cls: "badge-reflecting",
          reason: "recent reflection without queue work",
        };
      }
      return {
        label: "Quiescent",
        cls: "badge-quiescent",
        reason: "no recent queue or reflection activity",
      };
    }

function renderFeedActivity(data) {
      const feed = data.snapshot.feedActivity;
      const origins = [
        ["memu_miss", "MemU Miss"],
        ["sis_contradiction", "SIS Contradiction"],
        ["exec_deadend", "Exec Dead-End"],
      ];
      const cards = origins.map(([key, label]) => {
        const activity = feed.byOrigin[key] ?? {
          checked24h: 0,
          filtered24h: 0,
          enqueued24h: 0,
          lastChecked: null,
          lastFiltered: null,
          lastEnqueued: null,
        };
        return \`
          <div class="card">
            <div class="label">\${esc(label)} / 24h</div>
            <div class="kv" style="margin-top: 10px; grid-template-columns: 110px 1fr;">
              <div class="k">Checked</div><div class="v">\${esc(activity.checked24h)}</div>
              <div class="k">Filtered</div><div class="v">\${esc(activity.filtered24h)}</div>
              <div class="k">Enqueued</div><div class="v">\${esc(activity.enqueued24h)}</div>
              <div class="k">Last Check</div><div class="v">\${esc(activity.lastChecked?.ts ?? "-")}</div>
              <div class="k">Last Filter</div><div class="v">\${esc(activity.lastFiltered ? \`\${activity.lastFiltered.ts} (\${activity.lastFiltered.reason ?? "filtered"})\` : "-")}</div>
              <div class="k">Last Enqueue</div><div class="v">\${esc(activity.lastEnqueued ? \`\${activity.lastEnqueued.ts} (\${activity.lastEnqueued.reason ?? (activity.lastEnqueued.deduplicated === true ? "deduplicated" : "created")})\` : "-")}</div>
            </div>
          </div>
        \`;
      }).join("");
      const recent = feed.recentFeedEvents.slice().reverse().slice(0, 10);
      const recentHtml = recent.length === 0
        ? '<div class="subtle">No feed events captured yet</div>'
        : recent.map((event) => \`
            <div style="margin-bottom: 8px;">
              <div>
                <span class="pill">\${esc(event.originKind ?? "unknown")}</span>
                <span class="pill">\${esc(event.type)}</span>
                \${event.reason ? \`<span class="pill">\${esc(event.reason)}</span>\` : ""}
              </div>
              <div class="subtle">\${esc(event.ts)}\${event.deduplicated === true ? " (dedup)" : event.reason === "created" ? " (created)" : ""}</div>
              <div>\${esc(event.title ?? event.threadId ?? event.reason ?? event.line)}</div>
            </div>
          \`).join("");
      document.getElementById("feed-activity").innerHTML =
        \`<div class="feed-grid">\${cards}</div>\` +
        '<div style="margin-top: 12px;">' +
        '<div class="label" style="margin-bottom: 8px;">Recent Feed Events</div>' +
        recentHtml +
        '</div>';
    }

    function renderModeBadge(data) {
      const mode = inferMode(data);
      document.getElementById("mode-badge").innerHTML =
        \`<div class="badge \${esc(mode.cls)}" title="\${esc(mode.reason)}">\${esc(mode.label)}</div>\`;
    }

    function renderCards(data) {
      const current = data.snapshot.counts.current;
      const backlog = data.snapshot.counts.backlog;
      const active = current.byStatus.open + current.byStatus.in_progress;
      const reflections = data.snapshot.logCounts.reflection + data.snapshot.logCounts.reflection_unchanged;
      const rollingReflections5m = recentCount(data, ["reflection", "reflection_unchanged"], 5 * 60 * 1000);
      const rollingNoActionable5m = recentCount(data, ["no_actionable"], 5 * 60 * 1000);
      const rollingSelected15m = recentCount(data, ["selected"], 15 * 60 * 1000);
      const rollingDelta15m = recentCount(data, ["progress_delta"], 15 * 60 * 1000);
      const cards = [
        [\`Current Queue / \${data.snapshot.counts.currentWindowHours}h\`, current.total],
        ["Active", active],
        [\`Resolved / \${data.snapshot.counts.currentWindowHours}h\`, current.byStatus.resolved],
        ["Historical Backlog", backlog.total],
        ["Historical Stalled", backlog.byStatus.stalled],
        [\`MemU Miss / \${data.snapshot.counts.currentWindowHours}h\`, current.byOrigin.memu_miss ?? 0],
        [\`SIS Contradiction / \${data.snapshot.counts.currentWindowHours}h\`, current.byOrigin.sis_contradiction ?? 0],
        ["Reflections / Interval", reflections],
        ["No Actionable / Interval", data.snapshot.logCounts.no_actionable],
        ["Selected / Interval", data.snapshot.logCounts.selected],
        ["Progress Delta / Interval", data.snapshot.logCounts.progress_delta],
        ["Reflections / 5m", rollingReflections5m],
        ["No Actionable / 5m", rollingNoActionable5m],
        ["Selected / 15m", rollingSelected15m],
        ["Progress Delta / 15m", rollingDelta15m],
      ];
      document.getElementById("cards").innerHTML = cards.map(([label, value]) => \`
        <div class="card">
          <div class="label">\${esc(label)}</div>
          <div class="metric">\${esc(value)}</div>
        </div>
      \`).join("");
    }

    function renderKernelState(data) {
      const kernel = data.snapshot.kernel;
      if (!kernel) {
        document.getElementById("kernel-state").innerHTML = '<div class="subtle">Kernel state file not found</div>';
        return;
      }
      const spent = kernel.spentToday == null || kernel.dailyBudget == null
        ? "-"
        : \`\${kernel.spentToday}/\${kernel.dailyBudget}\`;
      const rows = [
        ["Wakefulness", kernel.wakefulness ?? "-"],
        ["Intent", kernel.desiredAction ?? "-"],
        ["Focus", kernel.currentFocus ?? "-"],
        ["Focus Provenance", kernel.focusProvenance ?? "-"],
        ["Carried Task Focus", kernel.carriedTaskFocus ?? "-"],
        ["Carried Task Lane", kernel.carriedTaskLane ?? "-"],
        ["Carried Task Thread", kernel.carriedTaskThreadTitle ?? "-"],
        ["Conversation-Derived Focus", kernel.conversationDerivedFocus ?? "-"],
        ["Agenda-Derived Focus", kernel.agendaDerivedFocus ?? "-"],
        ["Reflection Focus", kernel.reflectionFocus ?? "-"],
        ["Active Thread", kernel.activeThread ?? "-"],
        ["Background Thread", kernel.backgroundThread ?? "-"],
        ["Agenda", kernel.agendaTitle ? \`\${kernel.agendaTitle} (\${kernel.agendaSource ?? "unknown"})\` : "-"],
        ["Budget", spent],
        ["Last Action", kernel.lastActionKind ?? "-"],
        ["Last Action Summary", kernel.lastActionSummary ?? "-"],
        ["Last Action Query", kernel.lastActionQuery ?? "-"],
        ["Last Artifact", kernel.lastArtifactType ?? "-"],
        ["Last Artifact Path", kernel.lastArtifactPath ?? "-"],
        ["Pending Surface", kernel.pendingSurfaceMode ?? "-"],
        ["Pending Surface Title", kernel.pendingSurfaceTitle ?? "-"],
        ["Pending Surface Request", kernel.pendingSurfaceRequestKind ?? "-"],
        ["Pending Surface Summary", kernel.pendingSurfaceSummary ?? "-"],
        ["Pending Surface Rationale", kernel.pendingSurfaceRationale ?? "-"],
        [
          "Pending Surface Actions",
          kernel.pendingSurfaceSuggestedActions.length > 0
            ? kernel.pendingSurfaceSuggestedActions.join(", ")
            : "-",
        ],
        ["Artifacts", kernel.artifactCount ?? "-"],
        ["Last Reflection", kernel.lastReflectionAt ?? "-"],
        ["Last Persisted", kernel.lastPersistedAt ?? "-"],
        ["Kernel State Path", kernel.path],
      ];
      const operatorAttentionMessage = kernel.pendingSurfaceRequiresOperatorDecision
        ? "Operator decision needed on " + (kernel.pendingSurfaceTitle ?? "the active thread")
        : "Interrupt-worthy update waiting on " + (kernel.pendingSurfaceTitle ?? "the active thread");
      const operatorAttentionCallout = kernel.pendingSurfaceRequiresOperatorAttention
        ? '<div class="callout">' +
          esc(operatorAttentionMessage) +
          (kernel.pendingSurfaceSuggestedActions.length > 0
            ? "<br />Suggested actions: " + esc(kernel.pendingSurfaceSuggestedActions.join(", "))
            : "") +
          "</div>"
        : "";
      document.getElementById("kernel-state").innerHTML =
        '<div class="kv">' +
        rows.map(([k, v]) => \`<div class="k">\${esc(k)}</div><div class="v">\${esc(v)}</div>\`).join("") +
        '</div>' +
        operatorAttentionCallout +
        '<div class="callout">This box is the latest persisted kernel snapshot from self-state.json. It can be slightly ahead of or behind the recent event stream.</div>';
    }

    function latestEvent(data, types) {
      return data.events
        .slice()
        .reverse()
        .find((event) => types.includes(event.type)) ?? null;
    }

    function renderAlignmentState(data) {
      const kernel = data.snapshot.kernel;
      const lastReflection = latestEvent(data, ["reflection", "reflection_unchanged"]);
      const lastConversationSync = latestEvent(data, ["conversation_sync"]);
      const lastNoActionable = latestEvent(data, ["no_actionable"]);

      const rows = [
        ["Last Sampled", data.snapshot.ts ?? "-"],
        ["Last Reflection Event", lastReflection ? \`\${lastReflection.ts} (\${lastReflection.type})\` : "-"],
        ["Last No-Actionable Event", lastNoActionable ? lastNoActionable.ts : "-"],
        ["Last Conversation Sync", lastConversationSync ? lastConversationSync.ts : "-"],
        ["Log File", data.meta?.logFile ?? "-"],
        ["Log Source", data.meta?.logFileSource ?? "-"],
        ["Last Persisted State", kernel?.lastPersistedAt ?? "-"],
        ["Last Persisted Reflection", kernel?.lastReflectionAt ?? "-"],
        ["Last Tick", kernel?.lastTickAt ?? "-"],
      ];

      const rawReflection = lastReflection?.line ?? "No recent reflection event captured in the current retention window.";
      document.getElementById("alignment-state").innerHTML =
        '<div class="kv">' +
        rows.map(([k, v]) => \`<div class="k">\${esc(k)}</div><div class="v">\${esc(v)}</div>\`).join("") +
        '</div>' +
        '<div style="margin-top: 12px;">' +
        '<div class="label" style="margin-bottom: 6px;">Last Streamed Reflection Event</div>' +
        \`<pre>\${esc(rawReflection)}</pre>\` +
        '</div>' +
        '<div class="callout">The event stream comes from gateway.log. The persisted state comes from self-state.json. They should be close, but they are not the same source.</div>';
    }

    function renderTable(elId, rows, columns) {
      const head = "<tr>" + columns.map((column) => \`<th>\${esc(column.label)}</th>\`).join("") + "</tr>";
      const body = rows.length === 0
        ? \`<tr><td colspan="\${columns.length}" class="subtle">No rows</td></tr>\`
        : rows.map((row) => "<tr>" + columns.map((column) => \`<td>\${column.render(row)}</td>\`).join("") + "</tr>").join("");
      document.getElementById(elId).innerHTML = head + body;
    }

    function flagList(flags) {
      if (!flags || typeof flags !== "object") {
        return [];
      }
      return Object.entries(flags)
        .filter(([, value]) => value === true)
        .map(([key]) => key);
    }

    function renderDeltaDetails(dimensions, flags) {
      if (!dimensions || typeof dimensions !== "object") {
        return '<div class="subtle">No delta detail recorded.</div>';
      }
      const entries = [
        ["Evidence", dimensions.evidenceAdded],
        ["Hypothesis", dimensions.hypothesisMovement],
        ["Next Step", dimensions.nextStepSharpened],
        ["Uncertainty", dimensions.uncertaintyReduced],
      ];
      const lines = entries.map(([label, value]) => {
        const score = value && typeof value === "object" ? value.score ?? 0 : 0;
        const details = value && typeof value === "object" ? value.details ?? "-" : "-";
        return \`<div><strong>\${esc(label)}</strong> \${esc(score)} · \${esc(details)}</div>\`;
      });
      const activeFlags = flagList(flags);
      if (activeFlags.length > 0) {
        lines.push(
          \`<div><strong>Flags</strong> \${activeFlags.map((flag) => \`<span class="pill">\${esc(flag)}</span>\`).join(" ")}</div>\`,
        );
      }
      return lines.join("");
    }

    function renderThreadAudit(data) {
      const threads = [
        ...data.snapshot.activeThreads,
        ...data.snapshot.recentThreads,
        ...data.snapshot.backlogThreads,
      ]
        .filter((row, index, all) => all.findIndex((candidate) => candidate.id === row.id) === index)
        .toSorted((left, right) => {
          const leftMs = parseTs(left.updatedAt) ?? 0;
          const rightMs = parseTs(right.updatedAt) ?? 0;
          return rightMs - leftMs;
        })
        .slice(0, 8);
      const container = document.getElementById("thread-audit");
      if (threads.length === 0) {
        container.innerHTML = '<div class="subtle">No thread detail available yet.</div>';
        return;
      }
      container.innerHTML = \`<div class="detail-grid">\${threads
        .map((thread) => {
          const meta = [
            \`<span class="pill">\${esc(thread.originKind)}</span>\`,
            \`<span class="pill">\${esc(thread.status)}</span>\`,
            thread.canonicalKey ? \`<span class="pill">\${esc(thread.canonicalKey)}</span>\` : "",
          ]
            .filter(Boolean)
            .join("");
          const resolution = thread.resolvedBy
            ? \`<div><strong>Resolved By</strong> \${esc(thread.resolvedBy)}</div>\`
            : "";
          const artifact = thread.lastArtifactType || thread.lastArtifactPath || thread.lastArtifactSummary
            ? \`<div><strong>Latest Artifact</strong> \${esc(thread.lastArtifactType ?? "-")} · \${esc(thread.lastSurfaceMode ?? "-")} · \${esc(thread.lastArtifactSummary ?? thread.lastArtifactPath ?? "-")}</div>\`
            : "";
          const meaningfulArtifact = thread.lastMeaningfulArtifactType || thread.lastMeaningfulArtifactPath || thread.lastMeaningfulArtifactSummary
            ? \`<div><strong>Meaningful Artifact</strong> \${esc(thread.lastMeaningfulArtifactType ?? thread.lastArtifactType ?? "-")} · \${esc(thread.lastMeaningfulArtifactSummary ?? thread.lastMeaningfulArtifactPath ?? "-")}</div>\`
            : "";
          return \`
            <div class="thread-card">
              <div>
                <h3>\${esc(thread.title)}</h3>
                <div class="thread-meta">\${meta}</div>
              </div>
              <div class="thread-lines">
                <div><strong>Question</strong> \${esc(thread.coreQuestion)}</div>
                <div><strong>Why It Matters</strong> \${esc(thread.valueProposition)}</div>
                <div><strong>Stop Condition</strong> \${esc(thread.stopCondition)}</div>
                <div><strong>Status Reason</strong> \${esc(thread.statusReason ?? "-")}</div>
                <div><strong>Stop Eval</strong> \${esc(thread.lastStopConditionMatched == null ? "-" : thread.lastStopConditionMatched ? "matched" : "not matched")} · \${esc(thread.lastStopConditionResult ?? "-")}</div>
                <div><strong>Last Action</strong> \${esc(thread.lastActionKind ?? "-")} · \${esc(thread.lastActionQuery ?? "-")}</div>
                <div><strong>Progress</strong> \${esc(thread.lastProgressSummary ?? "-")}</div>
                \${artifact}
                \${meaningfulArtifact}
                \${resolution}
                <div><strong>Delta</strong> \${esc(thread.lastDeltaScore ?? "-")}</div>
                <div>\${renderDeltaDetails(thread.lastDeltaDimensions, thread.lastDeltaFlags)}</div>
              </div>
            </div>
          \`;
        })
        .join("")}</div>\`;
    }

    async function refresh() {
      const response = await fetch("/api/status", { cache: "no-store" });
      const data = await response.json();
      document.getElementById("meta").textContent =
        \`sampled \${data.snapshot.ts} | sample=\${data.snapshot.meta.sampleMs}ms | current-window=\${data.snapshot.counts.currentWindowHours}h | out=\${data.meta.outDir} | log=\${data.meta.logFile}\`;
      renderModeBadge(data);
      renderCards(data);
      renderKernelState(data);
      renderAlignmentState(data);
      renderFeedActivity(data);
      renderTable("active-threads", data.snapshot.activeThreads, [
        { label: "Title", render: (row) => esc(row.title) },
        { label: "Origin", render: (row) => \`<span class="pill">\${esc(row.originKind)}</span>\` },
        { label: "Status", render: (row) => esc(row.status) },
        { label: "Score", render: (row) => esc(row.compositeScore.toFixed(1)) },
        { label: "Delta", render: (row) => esc(row.lastDeltaScore ?? "-") },
        { label: "Last Action", render: (row) => esc(row.lastActionKind ?? "-") },
        { label: "Reason", render: (row) => esc(row.statusReason ?? row.lastProgressSummary ?? "-") },
      ]);
      renderTable("recent-threads", data.snapshot.recentThreads.slice(0, 12), [
        { label: "Title", render: (row) => esc(row.title) },
        { label: "Status", render: (row) => esc(row.status) },
        { label: "Updated", render: (row) => esc(row.updatedAt) },
        { label: "Delta", render: (row) => esc(row.lastDeltaScore ?? "-") },
        { label: "Reason", render: (row) => esc(row.statusReason ?? row.lastProgressSummary ?? "-") },
      ]);
      renderTable("backlog-threads", data.snapshot.backlogThreads.slice(0, 12), [
        { label: "Title", render: (row) => esc(row.title) },
        { label: "Status", render: (row) => esc(row.status) },
        { label: "Updated", render: (row) => esc(row.updatedAt) },
        { label: "Delta", render: (row) => esc(row.lastDeltaScore ?? "-") },
        { label: "Reason", render: (row) => esc(row.statusReason ?? row.lastProgressSummary ?? "-") },
      ]);
      renderThreadAudit(data);

      const alerts = data.alerts.slice(0, 20);
      document.getElementById("alerts").innerHTML = alerts.length === 0
        ? '<div class="subtle">No alerts</div>'
        : alerts.map((alert) => \`
          <div style="margin-bottom: 10px;">
            <div class="alert-\${esc(alert.level)}"><strong>\${esc(alert.code)}</strong> \${esc(alert.message)}</div>
            <div class="subtle">Started \${esc(alert.startedAt)} · Last seen \${esc(alert.lastSeenAt)} · Hits \${esc(alert.occurrences)}</div>
            \${alert.details?.title || alert.details?.threadId || (Array.isArray(alert.details?.flags) && alert.details.flags.length > 0)
              ? \`<div class="subtle" style="margin-top: 4px;">\${esc(alert.details?.title ?? alert.details?.threadId ?? "")}\${Array.isArray(alert.details?.flags) && alert.details.flags.length > 0 ? \` · flags=\${esc(alert.details.flags.join(","))}\` : ""}</div>\`
              : ""}
          </div>
        \`).join("");

      const events = data.events.slice().reverse().slice(0, 30);
      document.getElementById("events").innerHTML = events.length === 0
        ? '<div class="subtle">No recent events</div>'
        : events.map((event) => \`
          <div style="margin-bottom: 8px;">
            <div>
              <span class="pill">\${esc(event.type)}</span>
              \${event.title ? \`<span class="pill">\${esc(event.title)}</span>\` : ""}
              \${Array.isArray(event.flags) ? event.flags.map((flag) => \`<span class="pill">\${esc(flag)}</span>\`).join("") : ""}
            </div>
            <div class="subtle">\${esc(event.ts)}</div>
            <pre>\${esc(event.line)}</pre>
          </div>
        \`).join("");
    }

    refresh().catch((error) => {
      document.body.insertAdjacentHTML("beforeend", \`<pre>\${esc(String(error))}</pre>\`);
    });
    setInterval(() => refresh().catch(() => {}), 10000);
  </script>
</body>
</html>`;
}

async function main() {
  const options = buildOptions();
  ensureDir(options.outDir);
  const state: MonitorState = {
    logOffset: initialLogOffset(options.logFile),
    logCarryover: "",
    snapshots: [],
    events: [],
    alerts: [],
    activeAlerts: new Map(),
    lastSnapshot: null,
    consecutiveActiveWithoutSelection: 0,
    consecutiveStagnantTopThread: 0,
    consecutiveReflectingEmptyQueue: 0,
    lastTopThreadKey: null,
    feedEvents: [],
    hasWarmStarted: false,
  };
  fs.writeFileSync(
    path.join(options.outDir, "metadata.json"),
    JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        options,
      },
      null,
      2,
    ),
    "utf8",
  );

  const sql = postgres(resolvePostgresUrl(), {
    max: 3,
    idle_timeout: 10,
    connect_timeout: 5,
  });
  await sql`SELECT 1`;

  const app = express();
  app.get("/", (_req, res) => {
    res.type("html").send(renderIndexHtml(options));
  });
  app.get("/api/status", (_req, res) => {
    res.json({
      meta: {
        port: options.port,
        intervalSec: options.intervalSec,
        outDir: options.outDir,
        logFile: options.logFile,
        logFileSource: options.logFileSource,
      },
      snapshot: state.lastSnapshot,
      alerts: state.alerts,
      events: state.events,
    });
  });
  app.get("/api/snapshots", (_req, res) => {
    res.json(state.snapshots);
  });
  app.get("/api/events", (_req, res) => {
    res.json(state.events);
  });
  app.get("/api/alerts", (_req, res) => {
    res.json(state.alerts);
  });

  const server = app.listen(options.port, "127.0.0.1", () => {
    console.log(
      `[curiosity-monitor] listening on http://127.0.0.1:${options.port} | outDir=${options.outDir}`,
    );
  });

  let running = true;
  const shutdown = async (signal: string) => {
    if (!running) {
      return;
    }
    running = false;
    console.log(`[curiosity-monitor] shutting down on ${signal}`);
    server.close();
    await sql.end({ timeout: 2 });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  while (running) {
    try {
      const snapshot = await sampleMonitor({ sql, options, state });
      const activeCount =
        snapshot.counts.current.byStatus.open + snapshot.counts.current.byStatus.in_progress;
      console.log(
        `[curiosity-monitor] ${snapshot.ts} current=${snapshot.counts.current.total} backlog=${snapshot.counts.backlog.total} active=${activeCount} selected=${snapshot.logCounts.selected} delta=${snapshot.logCounts.progress_delta} alerts=${snapshot.alerts.length}`,
      );
    } catch (error) {
      pushAlert(
        state.alerts,
        options.outDir,
        "error",
        "sample-failed",
        "Curiosity monitor sample failed.",
        { error: error instanceof Error ? error.message : String(error) },
      );
      state.alerts = trimToRetention(state.alerts, options.retention);
      console.error("[curiosity-monitor] sample failed", error);
    }
    await sleep(options.intervalSec * 1000);
  }
}

await main();
