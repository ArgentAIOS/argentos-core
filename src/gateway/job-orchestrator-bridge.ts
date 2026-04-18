import { createRequire } from "node:module";
import type { ArgentConfig } from "../config/config.js";

const requireModule = createRequire(import.meta.url);

function loadJobOrchestratorModule(): Record<string, unknown> | null {
  try {
    return requireModule("../infra/job-orchestrator-runner.js") as Record<string, unknown>;
  } catch {
    return null;
  }
}

function createNoopJobOrchestratorRunner() {
  return {
    stop: () => {},
    updateConfig: (_cfg?: ArgentConfig) => {},
    getStatus: () => ({
      enabled: false,
      pollMs: 0,
      running: false,
      lastCycleAt: null,
      lastCycleMs: null,
      metrics: {
        cycles: 0,
        eventsAccepted: 0,
        eventsDeduped: 0,
        timeTasksCreated: 0,
        eventTasksCreated: 0,
        eventsProcessed: 0,
      },
    }),
  };
}

export type JobOrchestratorRunner = ReturnType<typeof createNoopJobOrchestratorRunner>;

export function startJobOrchestratorRunner(params: {
  cfg: ArgentConfig;
  executionWorkerRunner: unknown;
}): JobOrchestratorRunner {
  const mod = loadJobOrchestratorModule();
  const candidate = mod?.startJobOrchestratorRunner;
  if (typeof candidate === "function") {
    return candidate(params) as JobOrchestratorRunner;
  }
  return createNoopJobOrchestratorRunner();
}
