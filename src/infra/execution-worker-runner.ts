import type { ArgentConfig } from "../config/config.js";

export type ExecutionWorkerStatusHint = {
  kind: "paused" | "running" | "queued" | "waiting" | "blocked" | "idle";
  summary: string;
  detail?: string;
  taskSnapshot?: {
    openVisibleCount: number;
    runnableCount: number;
    dependencyBlockedCount: number;
    blockedStatusCount: number;
    pendingCount: number;
    inProgressCount: number;
    evaluatedAt: number;
  };
};

export type ExecutionWorkerControlResult = {
  ok: boolean;
  scope: "global" | "agent";
  agentId?: string;
  paused: boolean;
};

export type ExecutionWorkerMetricsResetResult = {
  ok: boolean;
  scope: "global" | "agent";
  agentId?: string;
  resetCount: number;
};

export type ExecutionWorkerDispatchResult = {
  ok: boolean;
  scope: "global" | "agent";
  agentId?: string;
  dispatched: number;
  paused: boolean;
  running: boolean;
  reason?: string;
};

export type ExecutionWorkerAgentStatus = {
  agentId: string;
  enabled: boolean;
  paused: boolean;
  running: boolean;
  rerunRequested: boolean;
  nextDueAt: number | null;
  lastRunAt: number | null;
  lastDispatchRequestedAt: number | null;
  lastDispatchReason?: string;
  statusHint: ExecutionWorkerStatusHint;
  config: {
    every: string;
    model?: string;
    sessionMainKey: string;
    maxRunMinutes: number;
    maxTasksPerCycle: number;
    scope: "assigned" | "all" | "unassigned_or_assigned";
    requireEvidence: boolean;
    maxNoProgressAttempts: number;
  };
  metrics: {
    totalRuns: number;
    totalSkips: number;
    totalAttempted: number;
    totalProgressed: number;
    totalCompleted: number;
    totalBlocked: number;
    lastStatus: "ran" | "skipped";
    lastReason?: string;
    lastAttempted: number;
    lastProgressed: number;
    lastCompleted: number;
    lastBlocked: number;
    lastFinishedAt: number | null;
  };
};

export type ExecutionWorkerStatus = {
  enabled: boolean;
  globalPaused: boolean;
  agentCount: number;
  agents: ExecutionWorkerAgentStatus[];
};

export type ExecutionWorkerRunner = {
  stop: () => void;
  updateConfig: (cfg: ArgentConfig) => void;
  getStatus: (opts?: { agentId?: string }) => ExecutionWorkerStatus;
  dispatchNow: (opts?: { agentId?: string; reason?: string }) => ExecutionWorkerDispatchResult;
  pause: (opts?: { agentId?: string }) => ExecutionWorkerControlResult;
  resume: (opts?: { agentId?: string }) => ExecutionWorkerControlResult;
  resetMetrics: (opts?: { agentId?: string }) => ExecutionWorkerMetricsResetResult;
};

function createDisabledStatus(): ExecutionWorkerStatus {
  return {
    enabled: false,
    globalPaused: false,
    agentCount: 0,
    agents: [],
  };
}

export function startExecutionWorkerRunner(_opts: { cfg?: ArgentConfig }): ExecutionWorkerRunner {
  return {
    stop: () => {},
    updateConfig: (_cfg) => {},
    getStatus: (_opts) => createDisabledStatus(),
    dispatchNow: (opts) => ({
      ok: false,
      scope: opts?.agentId ? "agent" : "global",
      agentId: opts?.agentId,
      dispatched: 0,
      paused: false,
      running: false,
      reason: opts?.reason ?? "execution-worker-unavailable-in-core",
    }),
    pause: (opts) => ({
      ok: false,
      scope: opts?.agentId ? "agent" : "global",
      agentId: opts?.agentId,
      paused: false,
    }),
    resume: (opts) => ({
      ok: false,
      scope: opts?.agentId ? "agent" : "global",
      agentId: opts?.agentId,
      paused: false,
    }),
    resetMetrics: (opts) => ({
      ok: false,
      scope: opts?.agentId ? "agent" : "global",
      agentId: opts?.agentId,
      resetCount: 0,
    }),
  };
}
