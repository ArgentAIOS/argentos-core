/**
 * Ephemeral worker sessions (Worker Runtime v2 D1).
 *
 * Each job run executes in a fresh session keyed
 * `agent:<agentId>:worker:<assignmentId>:<runId>`. The session entry is born
 * carrying the role profile's tool grants — the policy IS the session, so
 * grant filtering is structural (no mutate/restore on shared state, which is
 * what `withSessionToolPolicyOverride` used to do). The session is discarded
 * after the run; the job run record is the durable artifact.
 *
 * Set ARGENT_WORKER_KEEP_SESSIONS=1 to keep transcripts on disk for law
 * audits (prompt-cleanliness inspection); the store entry is always removed.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { ArgentConfig } from "../config/config.js";
import {
  resolveSessionFilePath,
  resolveStorePath,
  updateSessionStore,
} from "../config/sessions.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeAgentId } from "../routing/session-key.js";

const log = createSubsystemLogger("gateway/worker-session");

export type EphemeralWorkerSession = {
  sessionKey: string;
  sessionId: string;
  /** Remove the session entry (and transcript, unless kept) — call after the run. */
  dispose: () => Promise<void>;
};

export function buildWorkerSessionKey(params: {
  agentId: string;
  assignmentId: string;
  runId: string;
}): string {
  return `agent:${normalizeAgentId(params.agentId)}:worker:${params.assignmentId}:${params.runId}`;
}

export function shouldKeepWorkerSessions(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ARGENT_WORKER_KEEP_SESSIONS === "1";
}

export async function createEphemeralWorkerSession(params: {
  cfg: ArgentConfig;
  agentId: string;
  assignmentId: string;
  runId: string;
  toolsAllow: string[];
  toolsDeny?: string[];
}): Promise<EphemeralWorkerSession> {
  const agentId = normalizeAgentId(params.agentId);
  const sessionKey = buildWorkerSessionKey({
    agentId,
    assignmentId: params.assignmentId,
    runId: params.runId,
  });
  const sessionId = randomUUID();
  const storePath = resolveStorePath(params.cfg.session?.store, { agentId });

  await updateSessionStore(storePath, (store) => {
    store[sessionKey] = {
      sessionId,
      updatedAt: Date.now(),
      toolsAllow: params.toolsAllow,
      ...(params.toolsDeny && params.toolsDeny.length > 0 ? { toolsDeny: params.toolsDeny } : {}),
    };
  });

  const dispose = async () => {
    let transcriptPath: string | undefined;
    try {
      await updateSessionStore(storePath, (store) => {
        const entry = store[sessionKey];
        transcriptPath = resolveSessionFilePath(entry?.sessionId ?? sessionId, entry, { agentId });
        delete store[sessionKey];
      });
    } catch (err) {
      log.warn(`worker session ${sessionKey}: store cleanup failed: ${String(err)}`);
    }
    if (shouldKeepWorkerSessions()) {
      log.info(
        `worker session ${sessionKey}: transcript kept for inspection (ARGENT_WORKER_KEEP_SESSIONS=1): ${transcriptPath ?? "unknown"}`,
      );
      return;
    }
    if (transcriptPath) {
      await fs.rm(transcriptPath, { force: true }).catch((err) => {
        log.warn(`worker session ${sessionKey}: transcript cleanup failed: ${String(err)}`);
      });
    }
  };

  return { sessionKey, sessionId, dispose };
}
