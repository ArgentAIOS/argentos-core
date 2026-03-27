import type { ArgentConfig } from "../config/config.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import { loadConfig } from "../config/config.js";
import { getStorageAdapter } from "../data/storage-factory.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  consolidateKnowledgeObservations,
  sweepKnowledgeObservationScopeRevalidation,
} from "../memory/observations/consolidator.js";

const log = createSubsystemLogger("gateway/knowledge-observations");
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_REVALIDATION_INTERVAL_MS = 60 * 60 * 1000;

export type KnowledgeObservationRunner = {
  stop: () => void;
  updateConfig: (cfg: ArgentConfig) => void;
};

function isPgBackedObservationStorage(cfg: ArgentConfig): boolean {
  const storageCfg = (
    cfg as { storage?: { backend?: string; readFrom?: string; writeTo?: string[] } }
  ).storage;
  const backend = storageCfg?.backend;
  return (
    backend === "postgres" ||
    (backend === "dual" &&
      (storageCfg?.readFrom === "postgres" || storageCfg?.writeTo?.includes("postgres") === true))
  );
}

function canRunObservationConsolidation(cfg: ArgentConfig): boolean {
  const observationsEnabled = cfg.memory?.observations?.enabled === true;
  const consolidationEnabled = cfg.memory?.observations?.consolidation?.enabled !== false;
  return observationsEnabled && consolidationEnabled && isPgBackedObservationStorage(cfg);
}

function canRunObservationRevalidation(cfg: ArgentConfig): boolean {
  const observationsEnabled = cfg.memory?.observations?.enabled === true;
  const revalidationEnabled = cfg.memory?.observations?.revalidation?.enabled !== false;
  return observationsEnabled && revalidationEnabled && isPgBackedObservationStorage(cfg);
}

function supportsKnowledgeObservations(cfg: ArgentConfig): boolean {
  return canRunObservationConsolidation(cfg) || canRunObservationRevalidation(cfg);
}

function resolveConsolidationIntervalMs(cfg: ArgentConfig): number {
  const raw = cfg.memory?.observations?.consolidation?.interval?.trim();
  if (!raw) {
    return DEFAULT_INTERVAL_MS;
  }
  try {
    return Math.max(30_000, parseDurationMs(raw, { defaultUnit: "m" }));
  } catch {
    return DEFAULT_INTERVAL_MS;
  }
}

function resolveRevalidationIntervalMs(cfg: ArgentConfig): number {
  const raw = cfg.memory?.observations?.revalidation?.interval?.trim();
  if (!raw) {
    return DEFAULT_REVALIDATION_INTERVAL_MS;
  }
  try {
    return Math.max(30_000, parseDurationMs(raw, { defaultUnit: "m" }));
  } catch {
    return DEFAULT_REVALIDATION_INTERVAL_MS;
  }
}

function resolveMaxScopesPerRun(cfg: ArgentConfig): number {
  const raw = cfg.memory?.observations?.consolidation?.maxScopesPerRun;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 12;
  }
  return Math.max(1, Math.min(100, Math.floor(raw)));
}

export function startKnowledgeObservationRunner(opts: {
  cfg?: ArgentConfig;
}): KnowledgeObservationRunner {
  let cfg = opts.cfg ?? loadConfig();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let initialized = false;
  let running = false;
  let nextConsolidationAt = canRunObservationConsolidation(cfg)
    ? Date.now() + resolveConsolidationIntervalMs(cfg)
    : 0;
  let nextRevalidationAt = canRunObservationRevalidation(cfg)
    ? Date.now() + resolveRevalidationIntervalMs(cfg)
    : 0;

  function resetDueTimes() {
    const now = Date.now();
    nextConsolidationAt = canRunObservationConsolidation(cfg)
      ? now + resolveConsolidationIntervalMs(cfg)
      : 0;
    nextRevalidationAt = canRunObservationRevalidation(cfg)
      ? now + resolveRevalidationIntervalMs(cfg)
      : 0;
  }

  function scheduleNext() {
    if (stopped) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!supportsKnowledgeObservations(cfg)) {
      return;
    }
    const now = Date.now();
    const dueAt = [nextConsolidationAt, nextRevalidationAt]
      .filter((value) => value > 0)
      .toSorted((left, right) => left - right)[0];
    if (!dueAt) {
      return;
    }
    const intervalMs = Math.max(1_000, dueAt - now);
    timer = setTimeout(() => {
      void runCycle();
    }, intervalMs);
    timer.unref?.();
    if (!initialized) {
      initialized = true;
      log.info("knowledge observations: started", {
        intervalMs,
        maxScopesPerRun: resolveMaxScopesPerRun(cfg),
        revalidationIntervalMs: resolveRevalidationIntervalMs(cfg),
      });
    }
  }

  async function runCycle() {
    if (stopped || running || !supportsKnowledgeObservations(cfg)) {
      scheduleNext();
      return;
    }
    running = true;
    try {
      const now = new Date();
      const nowMs = now.getTime();
      const storage = await getStorageAdapter();
      const defaultAgentId = resolveDefaultAgentId(cfg);
      const memory =
        defaultAgentId && storage.memory.withAgentId
          ? storage.memory.withAgentId(defaultAgentId)
          : storage.memory;

      if (canRunObservationConsolidation(cfg) && nowMs >= nextConsolidationAt) {
        const results = await consolidateKnowledgeObservations({
          memory,
          maxScopes: resolveMaxScopesPerRun(cfg),
          now,
        });
        nextConsolidationAt = nowMs + resolveConsolidationIntervalMs(cfg);
        if (results.length > 0) {
          log.info("knowledge observations: consolidation cycle", {
            count: results.length,
            actions: results.map((result) => result.action),
          });
        }
      }

      if (canRunObservationRevalidation(cfg) && nowMs >= nextRevalidationAt) {
        const revalidation = await sweepKnowledgeObservationScopeRevalidation({
          memory,
          now,
          kindDays: cfg.memory?.observations?.revalidation?.kindDays,
        });
        nextRevalidationAt = nowMs + resolveRevalidationIntervalMs(cfg);
        if (revalidation.markedStale > 0) {
          log.info("knowledge observations: revalidation sweep", revalidation);
        }
      }
    } catch (err) {
      log.warn("knowledge observations: cycle failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
      scheduleNext();
    }
  }

  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    updateConfig(nextCfg: ArgentConfig) {
      cfg = nextCfg;
      resetDueTimes();
      scheduleNext();
    },
  };
}
