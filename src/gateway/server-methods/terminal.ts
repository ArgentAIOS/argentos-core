/**
 * Gateway Terminal Methods
 *
 * Manages live PTY terminal sessions accessible from both the dashboard
 * and the agent. Sessions are tracked in a shared module-level registry
 * so the agent tool can spawn/write terminals directly without RPC.
 */

import type { PtyHandle, PtySpawn } from "@lydell/node-pty";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";
import { getShellConfig } from "../../agents/shell-utils.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

// ============================================================================
// Shared Terminal Session Registry
// ============================================================================

const MAX_BUFFER_SIZE = 50 * 1024; // 50KB rolling output buffer
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface TerminalSession {
  id: string;
  pty: PtyHandle;
  connId: string | null; // null = created by agent
  shell: string;
  cwd: string;
  createdAt: number;
  lastWriteAt: number;
  outputBuffer: string;
  outputOffset: number; // monotonic counter for snapshot-based reads
  exited: boolean;
  exitCode: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** Shared registry — both gateway RPC handlers and agent tool operate on this. */
export const terminalSessions = new Map<string, TerminalSession>();

// ============================================================================
// Helpers
// ============================================================================

let cachedSpawnPty: PtySpawn | null = null;

async function getSpawnPty(): Promise<PtySpawn> {
  if (cachedSpawnPty) return cachedSpawnPty;
  const ptyModule = (await import("@lydell/node-pty")) as unknown as {
    spawn?: PtySpawn;
    default?: { spawn?: PtySpawn };
  };
  const spawnPty = ptyModule.spawn ?? ptyModule.default?.spawn;
  if (!spawnPty) {
    throw new Error("PTY support is unavailable (node-pty spawn not found).");
  }
  cachedSpawnPty = spawnPty;
  return spawnPty;
}

function appendBuffer(session: TerminalSession, chunk: string): void {
  session.outputBuffer += chunk;
  session.outputOffset += chunk.length;
  // Trim from front if exceeding max
  if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
    session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_SIZE);
  }
}

function resetIdleTimer(session: TerminalSession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    killSession(session.id);
  }, IDLE_TIMEOUT_MS);
}

function killSession(id: string): void {
  const session = terminalSessions.get(id);
  if (!session) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  if (!session.exited) {
    try {
      session.pty.kill();
    } catch {
      // PTY already dead
    }
  }
  terminalSessions.delete(id);
}

// ============================================================================
// Create a terminal session (shared by both RPC and agent tool)
// ============================================================================

export async function createTerminalSession(opts: {
  cwd?: string;
  connId?: string | null;
  broadcast?: GatewayRequestContext["broadcast"];
}): Promise<{ id: string; shell: string; cwd: string }> {
  const spawnPty = await getSpawnPty();
  const { shell } = getShellConfig();
  const home = os.homedir();
  // Resolve ~ and ~/ to absolute home path (tilde is shell expansion, not OS path)
  let cwd = opts.cwd || home || "/tmp";
  if (cwd === "~") cwd = home;
  else if (cwd.startsWith("~/")) cwd = path.join(home, cwd.slice(2));
  const id = `term-${crypto.randomUUID().slice(0, 8)}`;

  // Build clean env — filter out undefined values that break node-pty
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v != null) env[k] = v;
  }
  env.TERM = env.TERM || "xterm-256color";

  const pty = spawnPty(shell, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env,
  });

  const session: TerminalSession = {
    id,
    pty,
    connId: opts.connId ?? null,
    shell,
    cwd,
    createdAt: Date.now(),
    lastWriteAt: Date.now(),
    outputBuffer: "",
    outputOffset: 0,
    exited: false,
    exitCode: null,
    idleTimer: null,
  };

  terminalSessions.set(id, session);
  resetIdleTimer(session);

  // Stream PTY output
  pty.onData((chunk: string) => {
    const offset = session.outputOffset; // position BEFORE this chunk
    appendBuffer(session, chunk);
    opts.broadcast?.("terminal", { id, stream: "data", chunk, offset });
  });

  pty.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    opts.broadcast?.("terminal", { id, stream: "exit", code: exitCode });
    // Clean up after a delay so dashboard can receive the exit event
    setTimeout(() => terminalSessions.delete(id), 5000);
  });

  return { id, shell, cwd };
}

// ============================================================================
// Cleanup: kill all terminals owned by a specific connection
// ============================================================================

export function cleanupTerminalsForConn(connId: string): void {
  for (const [id, session] of terminalSessions) {
    if (session.connId === connId) {
      killSession(id);
    }
  }
}

// ============================================================================
// Gateway RPC Handlers
// ============================================================================

export const terminalHandlers: GatewayRequestHandlers = {
  "terminal.create": async ({ params, respond, context, client }) => {
    const cwd = (params.cwd as string) || undefined;
    const connId = client?.connId ?? null;
    try {
      const result = await createTerminalSession({
        cwd,
        connId,
        broadcast: context.broadcast,
      });
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },

  "terminal.write": async ({ params, respond }) => {
    const id = params.id as string;
    const data = params.data as string;
    if (!id || data == null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "id and data required"));
      return;
    }
    const session = terminalSessions.get(id);
    if (!session) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, `terminal ${id} not found`));
      return;
    }
    if (session.exited) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `terminal ${id} has exited`),
      );
      return;
    }
    session.lastWriteAt = Date.now();
    resetIdleTimer(session);
    try {
      session.pty.write(data);
    } catch {
      // PTY may have exited between the check and the write
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `terminal ${id} has exited`),
      );
      return;
    }
    respond(true, { ok: true });
  },

  "terminal.resize": async ({ params, respond }) => {
    const id = params.id as string;
    const cols = params.cols as number;
    const rows = params.rows as number;
    if (!id || !cols || !rows) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_PARAMS, "id, cols, and rows required"),
      );
      return;
    }
    const session = terminalSessions.get(id);
    if (!session) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, `terminal ${id} not found`));
      return;
    }
    if (session.exited) {
      respond(true, { ok: true }); // no-op for exited terminals
      return;
    }
    try {
      session.pty.resize(cols, rows);
      respond(true, { ok: true });
    } catch {
      // EBADF / ioctl errors happen when the PTY process already exited — non-fatal
      respond(true, { ok: true });
    }
  },

  "terminal.read": async ({ params, respond }) => {
    const id = params.id as string;
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "id required"));
      return;
    }
    const session = terminalSessions.get(id);
    if (!session) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, `terminal ${id} not found`));
      return;
    }
    respond(true, {
      buffer: session.outputBuffer,
      offset: session.outputOffset,
      exited: session.exited,
      exitCode: session.exitCode,
    });
  },

  "terminal.kill": async ({ params, respond }) => {
    const id = params.id as string;
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "id required"));
      return;
    }
    const session = terminalSessions.get(id);
    if (!session) {
      respond(true, { ok: true }); // idempotent
      return;
    }
    killSession(id);
    respond(true, { ok: true });
  },
};
