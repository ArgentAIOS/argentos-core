/**
 * Idle-salience gate for background runners — LIMBIC law 3 extended past the
 * kernel (#451) to the remaining fan-spinners (heartbeat, contemplation).
 *
 * A background turn that spends inference must point at something that
 * HAPPENED: operator activity since the last salient run, a task-board
 * delta, or a due anchor. Otherwise the runner skips with a first-class
 * reason and an idle gateway burns zero tokens.
 *
 * Deterministic by construction: the decision reuses the kernel's
 * decideTickSalience arithmetic; the board probe is the kernel's
 * non-blocking cached pattern (read cache synchronously, refresh in the
 * background — storage trouble means "no delta observable", never a noisy
 * run). Gate state is in-memory per subsystem+agent: after a gateway
 * restart the first due run is admitted as the baseline, same designed
 * behavior as the kernel's first-cognition admission.
 */

import type { ArgentConfig } from "../config/config.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { getStorageAdapter } from "../data/storage-factory.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { decideTickSalience } from "./consciousness-kernel.js";

export const DEFAULT_IDLE_SALIENCE_ANCHOR_HOURS = 24;

export type IdleSalienceVerdict =
  | { salient: true; reason: string }
  | { salient: false; skipReason: string };

type GateAgentState = {
  lastSalientRunAt: string | null;
  lastBoardMaxUpdatedAt: number | null;
  lastBoardTaskCount: number | null;
};

export type IdleSalienceGate = {
  /**
   * Decide whether a due run is salient. A salient verdict CONSUMES the
   * salience (the run is assumed to happen): the gate snapshots the board
   * and stamps lastSalientRunAt so the next evaluation measures deltas
   * from this run.
   */
  evaluate(params: {
    cfg: ArgentConfig;
    agentId: string;
    anchorHours: number;
    nowMs?: number;
  }): IdleSalienceVerdict;
};

function readLastUserMessageAtIso(cfg: ArgentConfig, agentId: string): string | null {
  try {
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    const store = loadSessionStore(storePath);
    const globalEntry = store["__lastUserMessage"] as { lastUserMessageAt?: number } | undefined;
    const at = globalEntry?.lastUserMessageAt;
    return typeof at === "number" && Number.isFinite(at) ? new Date(at).toISOString() : null;
  } catch {
    return null;
  }
}

export function resolveIdleSalienceAnchorHours(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(0, raw)
    : DEFAULT_IDLE_SALIENCE_ANCHOR_HOURS;
}

export function createIdleSalienceGate(params: { subsystem: string }): IdleSalienceGate {
  const log = createSubsystemLogger(`gateway/${params.subsystem}`);
  const states = new Map<string, GateAgentState>();
  let boardCache: { maxUpdatedAt: number | null; taskCount: number | null } = {
    maxUpdatedAt: null,
    taskCount: null,
  };
  let boardRefreshInFlight = false;
  const refreshBoardCache = () => {
    if (boardRefreshInFlight) {
      return;
    }
    boardRefreshInFlight = true;
    void (async () => {
      try {
        const storage = await getStorageAdapter();
        const tasks = await storage.tasks.list();
        let maxUpdatedAt = 0;
        for (const task of tasks) {
          if (typeof task.updatedAt === "number" && task.updatedAt > maxUpdatedAt) {
            maxUpdatedAt = task.updatedAt;
          }
        }
        boardCache = {
          maxUpdatedAt: maxUpdatedAt > 0 ? maxUpdatedAt : null,
          taskCount: tasks.length,
        };
      } catch {
        // Keep the previous cache — an unobservable board is "no delta".
      } finally {
        boardRefreshInFlight = false;
      }
    })();
  };

  return {
    evaluate({ cfg, agentId, anchorHours, nowMs = Date.now() }) {
      let state = states.get(agentId);
      if (!state) {
        state = {
          lastSalientRunAt: null,
          lastBoardMaxUpdatedAt: null,
          lastBoardTaskCount: null,
        };
        states.set(agentId, state);
      }
      const board = boardCache;
      refreshBoardCache();
      const verdict = decideTickSalience({
        nowMs,
        lastSalientCognitionAt: state.lastSalientRunAt,
        lastUserMessageAt: readLastUserMessageAtIso(cfg, agentId),
        lastBoardMaxUpdatedAt: state.lastBoardMaxUpdatedAt,
        lastBoardTaskCount: state.lastBoardTaskCount,
        boardMaxUpdatedAt: board.maxUpdatedAt,
        boardTaskCount: board.taskCount,
        salienceAnchorHours: anchorHours,
      });
      if (verdict.salient) {
        state.lastSalientRunAt = new Date(nowMs).toISOString();
        state.lastBoardMaxUpdatedAt = board.maxUpdatedAt;
        state.lastBoardTaskCount = board.taskCount;
        log.info(`${params.subsystem}: salience admitted run (${verdict.reason})`, { agentId });
      } else {
        log.debug(`${params.subsystem}: ${verdict.skipReason}`, { agentId });
      }
      return verdict;
    },
  };
}
