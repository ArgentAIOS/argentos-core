import type { ArgentConfig } from "../config/types.js";
import type { InternalHookEvent } from "../hooks/internal-hooks.js";
import { loadConfig } from "../config/config.js";
import { getStorageAdapter } from "../data/storage-factory.js";
import { registerInternalHook, unregisterInternalHook } from "../hooks/internal-hooks.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/job-orchestrator");

const DEFAULT_POLL_MS = 5_000;
const INTERNAL_HOOK_TYPES: InternalHookEvent["type"][] = ["command", "session", "agent", "gateway"];

export type JobOrchestratorStatus = {
  enabled: boolean;
  pollMs: number;
  running: boolean;
  lastCycleAt: number | null;
  lastCycleMs: number | null;
  lastError?: string;
  metrics: {
    cycles: number;
    eventsAccepted: number;
    eventsDeduped: number;
    timeTasksCreated: number;
    eventTasksCreated: number;
    eventsProcessed: number;
  };
};

export type JobOrchestratorRunner = {
  stop: () => void;
  updateConfig: (cfg: ArgentConfig) => void;
  getStatus: () => JobOrchestratorStatus;
  enqueueEvent: (params: {
    eventType: string;
    source: "manual" | "system" | "webhook" | "internal_hook";
    idempotencyKey?: string;
    targetAgentId?: string;
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) => Promise<{ accepted: boolean; eventId?: string }>;
};

type ExecutionWorkerRunnerLike = {
  dispatchNow?: (opts?: { reason?: string; agentId?: string }) => unknown;
};

export function startJobOrchestratorRunner(opts: {
  cfg?: ArgentConfig;
  executionWorkerRunner?: ExecutionWorkerRunnerLike;
}): JobOrchestratorRunner {
  let cfg = opts.cfg ?? loadConfig();
  let stopped = false;
  let pollMs = resolvePollMs(cfg);
  let timer: NodeJS.Timeout | null = null;
  let inCycle = false;
  let rerunRequested = false;
  let lastCycleAt: number | null = null;
  let lastCycleMs: number | null = null;
  let lastError: string | undefined;
  const metrics: JobOrchestratorStatus["metrics"] = {
    cycles: 0,
    eventsAccepted: 0,
    eventsDeduped: 0,
    timeTasksCreated: 0,
    eventTasksCreated: 0,
    eventsProcessed: 0,
  };

  const hookHandler = (event: InternalHookEvent) => {
    if (stopped) return;
    const eventType = `${event.type}:${event.action}`;
    const idempotencyKey = `${eventType}:${event.sessionKey}:${event.timestamp.getTime()}`;
    void enqueueEvent({
      eventType,
      source: "internal_hook",
      idempotencyKey,
      targetAgentId: tryGetAgentId(event.context),
      payload: {
        sessionKey: event.sessionKey,
        action: event.action,
        type: event.type,
        context: sanitizeContext(event.context),
      },
      metadata: { via: "internal-hook" },
    });
  };

  for (const type of INTERNAL_HOOK_TYPES) {
    registerInternalHook(type, hookHandler);
  }

  function resolvePollMs(nextCfg: ArgentConfig): number {
    const raw = readOrchestratorPollMs(nextCfg);
    if (!Number.isFinite(raw)) return DEFAULT_POLL_MS;
    const bounded = Math.max(1_000, Math.min(60_000, Math.floor(raw ?? DEFAULT_POLL_MS)));
    return bounded;
  }

  function scheduleNext() {
    if (stopped) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    timer = setTimeout(() => {
      void runCycle();
    }, pollMs);
    timer.unref?.();
  }

  function scheduleImmediate() {
    if (stopped) return;
    if (inCycle) {
      rerunRequested = true;
      return;
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    timer = setTimeout(() => {
      void runCycle();
    }, 0);
    timer.unref?.();
  }

  async function enqueueEvent(params: {
    eventType: string;
    source: "manual" | "system" | "webhook" | "internal_hook";
    idempotencyKey?: string;
    targetAgentId?: string;
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<{ accepted: boolean; eventId?: string }> {
    const storage = await getStorageAdapter();
    const result = await storage.jobs.enqueueEvent(params);
    if (result.accepted) {
      metrics.eventsAccepted += 1;
      scheduleImmediate();
      if (result.event?.id) {
        return { accepted: true, eventId: result.event.id };
      }
      return { accepted: true };
    }
    metrics.eventsDeduped += 1;
    return { accepted: false };
  }

  async function runCycle() {
    if (stopped || inCycle) {
      scheduleNext();
      return;
    }
    inCycle = true;
    const startedAt = Date.now();
    try {
      const storage = await getStorageAdapter();
      const timeTasksCreated = await storage.jobs.ensureDueTasks({ now: startedAt });
      const eventResult = await storage.jobs.ensureEventTasks({ now: startedAt, limit: 100 });
      metrics.cycles += 1;
      metrics.timeTasksCreated += timeTasksCreated;
      metrics.eventTasksCreated += eventResult.createdTasks;
      metrics.eventsProcessed += eventResult.processedEvents;
      if (timeTasksCreated > 0 || eventResult.createdTasks > 0) {
        opts.executionWorkerRunner?.dispatchNow({
          reason: eventResult.createdTasks > 0 ? "job-orchestrator-event" : "job-orchestrator-due",
        });
      }
      lastCycleAt = Date.now();
      lastCycleMs = lastCycleAt - startedAt;
      lastError = undefined;
      if (timeTasksCreated > 0 || eventResult.createdTasks > 0 || eventResult.processedEvents > 0) {
        log.info(
          `cycle: timeTasks=${timeTasksCreated} eventTasks=${eventResult.createdTasks} eventsProcessed=${eventResult.processedEvents}`,
        );
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log.error(`cycle failed: ${lastError}`);
    } finally {
      inCycle = false;
      if (rerunRequested) {
        rerunRequested = false;
        scheduleImmediate();
      } else {
        scheduleNext();
      }
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
      for (const type of INTERNAL_HOOK_TYPES) {
        unregisterInternalHook(type, hookHandler);
      }
    },
    updateConfig(nextCfg) {
      cfg = nextCfg;
      pollMs = resolvePollMs(cfg);
      scheduleNext();
    },
    getStatus() {
      return {
        enabled: true,
        pollMs,
        running: inCycle,
        lastCycleAt,
        lastCycleMs,
        lastError,
        metrics: { ...metrics },
      };
    },
    enqueueEvent,
  };
}

function readOrchestratorPollMs(cfg: ArgentConfig): number | undefined {
  const container = cfg as unknown as {
    jobs?: { orchestrator?: { pollMs?: number } };
  };
  return container.jobs?.orchestrator?.pollMs;
}

function tryGetAgentId(context: Record<string, unknown>): string | undefined {
  const raw = context.agentId;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (value === null) {
      out[key] = null;
      continue;
    }
    // Keep payload bounded.
    out[key] = "[complex]";
  }
  return out;
}
