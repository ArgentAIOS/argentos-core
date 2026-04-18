import { useState, useEffect, useCallback } from "react";

export type CronExecutionMode = "live" | "paper_trade";

export interface CronSchedule {
  kind: string;
  expr?: string;
  tz?: string;
  at?: string;
  everyMs?: number;
  anchorMs?: number;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  executionMode?: CronExecutionMode;
  schedule: CronSchedule;
  payload: {
    kind: string;
    text?: string;
    message?: string;
  };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastExecutionMode?: "live" | "paper_trade";
    lastGateDecision?: "allow_live" | "simulated_paper_trade";
    lastGateReason?: string;
    lastSimulationEvidence?: {
      mode: "paper_trade";
      policy: "external_side_effect_gate";
      simulatedAtMs: number;
      payloadKind: string;
      action: string;
      reason: string;
    };
  };
}

export interface CronJobUpdatePatch {
  name?: string;
  enabled?: boolean;
  executionMode?: CronExecutionMode;
  schedule?: CronSchedule;
}

type CronRunResult = {
  ok: boolean;
  ran: boolean;
  reason?: "not-due";
};

const STORAGE_KEY = "argent-cron-jobs";
const MAX_CACHED_JOBS = 500;
const MAX_PAYLOAD_PREVIEW = 240;
const MIN_CACHED_JOBS = 25;

let cronCacheStorageDisabled = false;
let cronCacheWarned = false;
let lastPersistedSnapshot: string | null = null;

interface UseCronJobsOptions {
  /** Gateway request function for fetching live cron data via WebSocket. */
  gatewayRequest?: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  /** Whether the gateway is connected. */
  gatewayConnected?: boolean;
  /** Polling interval in ms (default: 10000). */
  pollInterval?: number;
  /** Whether live refresh should run. */
  enabled?: boolean;
}

function toCachedJobs(jobs: CronJob[]): CronJob[] {
  return jobs.slice(0, MAX_CACHED_JOBS).map((job) => ({
    id: job.id,
    name: job.name,
    enabled: job.enabled,
    executionMode: job.executionMode,
    schedule: {
      kind: job.schedule?.kind ?? "",
      ...(job.schedule?.expr ? { expr: job.schedule.expr } : {}),
      ...(job.schedule?.tz ? { tz: job.schedule.tz } : {}),
      ...(job.schedule?.at ? { at: job.schedule.at } : {}),
      ...(typeof job.schedule?.everyMs === "number" ? { everyMs: job.schedule.everyMs } : {}),
      ...(typeof job.schedule?.anchorMs === "number" ? { anchorMs: job.schedule.anchorMs } : {}),
    },
    payload: {
      kind: job.payload?.kind ?? "",
      ...(job.payload?.text ? { text: job.payload.text.slice(0, MAX_PAYLOAD_PREVIEW) } : {}),
      ...(job.payload?.message
        ? { message: job.payload.message.slice(0, MAX_PAYLOAD_PREVIEW) }
        : {}),
    },
    state: job.state
      ? {
          ...(typeof job.state.nextRunAtMs === "number"
            ? { nextRunAtMs: job.state.nextRunAtMs }
            : {}),
          ...(typeof job.state.lastRunAtMs === "number"
            ? { lastRunAtMs: job.state.lastRunAtMs }
            : {}),
          ...(typeof job.state.lastExecutionMode === "string"
            ? { lastExecutionMode: job.state.lastExecutionMode }
            : {}),
          ...(typeof job.state.lastGateDecision === "string"
            ? { lastGateDecision: job.state.lastGateDecision }
            : {}),
          ...(typeof job.state.lastGateReason === "string"
            ? { lastGateReason: job.state.lastGateReason.slice(0, MAX_PAYLOAD_PREVIEW) }
            : {}),
          ...(job.state.lastSimulationEvidence &&
          typeof job.state.lastSimulationEvidence === "object"
            ? {
                lastSimulationEvidence: {
                  ...job.state.lastSimulationEvidence,
                  reason: String(job.state.lastSimulationEvidence.reason ?? "").slice(
                    0,
                    MAX_PAYLOAD_PREVIEW,
                  ),
                },
              }
            : {}),
        }
      : undefined,
  }));
}

function tryPersistSnapshot(jobs: CronJob[], cap: number): boolean {
  const snapshot = JSON.stringify(toCachedJobs(jobs).slice(0, cap));
  if (snapshot === lastPersistedSnapshot) return true;
  localStorage.setItem(STORAGE_KEY, snapshot);
  lastPersistedSnapshot = snapshot;
  return true;
}

function safePersistCronJobs(jobs: CronJob[]): void {
  if (cronCacheStorageDisabled) return;
  try {
    // Write a full cache first, then progressively degrade if storage is tight.
    if (tryPersistSnapshot(jobs, MAX_CACHED_JOBS)) return;
  } catch (err) {
    try {
      if (tryPersistSnapshot(jobs, 200)) return;
    } catch {}
    try {
      if (tryPersistSnapshot(jobs, 100)) return;
    } catch {}
    try {
      if (tryPersistSnapshot(jobs, 50)) return;
    } catch {}
    try {
      if (tryPersistSnapshot(jobs, MIN_CACHED_JOBS)) return;
    } catch {}

    const message = err instanceof Error ? err.message : String(err);
    if (!cronCacheWarned) {
      console.warn("[CronJobs] localStorage cache disabled (quota/storage error):", message);
      cronCacheWarned = true;
    }
    cronCacheStorageDisabled = true;
    try {
      localStorage.removeItem(STORAGE_KEY);
      lastPersistedSnapshot = null;
    } catch {
      // Ignore secondary storage errors.
    }
  }
}

export function useCronJobs(options: UseCronJobsOptions = {}) {
  const {
    gatewayRequest,
    gatewayConnected = false,
    pollInterval = 10000,
    enabled = true,
  } = options;

  const [cronJobs, setCronJobs] = useState<CronJob[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? (parsed as CronJob[]) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(false);

  const upsertCronJob = useCallback((job: CronJob) => {
    setCronJobs((prev) => {
      const exists = prev.some((current) => current.id === job.id);
      if (!exists) {
        return [...prev, job];
      }
      return prev.map((current) => (current.id === job.id ? job : current));
    });
  }, []);

  // Fetch cron jobs from the gateway (live) or API server (fallback)
  const refreshCronJobs = useCallback(async () => {
    try {
      // Prefer gateway WebSocket — this returns the live cron scheduler state
      if (gatewayRequest && gatewayConnected) {
        const data = await gatewayRequest<{ jobs: CronJob[] }>("cron.list", {
          includeDisabled: true,
        });
        if (data.jobs) {
          setCronJobs(data.jobs);
          return;
        }
      }

      // Fallback: HTTP API (reads static file — may be stale)
      const response = await fetch("/api/cron/jobs");
      if (response.ok) {
        const data = await response.json();
        setCronJobs(Array.isArray(data.jobs) ? (data.jobs as CronJob[]) : []);
      }
    } catch (err) {
      console.error("[CronJobs] Failed to fetch:", err);
    }
  }, [gatewayRequest, gatewayConnected]);

  const updateCronJob = useCallback(
    async (id: string, patch: CronJobUpdatePatch) => {
      if (!gatewayRequest || !gatewayConnected) {
        throw new Error("Gateway is not connected.");
      }
      const job = await gatewayRequest<CronJob>("cron.update", { id, patch });
      upsertCronJob(job);
      return job;
    },
    [gatewayConnected, gatewayRequest, upsertCronJob],
  );

  const deleteCronJob = useCallback(
    async (id: string) => {
      if (!gatewayRequest || !gatewayConnected) {
        throw new Error("Gateway is not connected.");
      }
      const result = await gatewayRequest<{ ok: boolean; removed: boolean }>("cron.remove", { id });
      if (result.removed) {
        setCronJobs((prev) => prev.filter((job) => job.id !== id));
      }
      return result;
    },
    [gatewayConnected, gatewayRequest],
  );

  const runCronJob = useCallback(
    async (id: string, mode: "due" | "force" = "force") => {
      if (!gatewayRequest || !gatewayConnected) {
        throw new Error("Gateway is not connected.");
      }
      const result = await gatewayRequest<CronRunResult>("cron.run", { id, mode });
      await refreshCronJobs();
      return result;
    },
    [gatewayConnected, gatewayRequest, refreshCronJobs],
  );

  // Initial fetch + polling
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refreshCronJobs().finally(() => setLoading(false));

    const interval = setInterval(refreshCronJobs, pollInterval);
    return () => clearInterval(interval);
  }, [enabled, refreshCronJobs, pollInterval]);

  // Save to localStorage whenever jobs change (cache for instant mount)
  useEffect(() => {
    safePersistCronJobs(cronJobs);
  }, [cronJobs]);

  // Expose globally for agent to update
  useEffect(() => {
    (window as any).argentCronJobs = {
      set: (jobs: CronJob[]) => setCronJobs(jobs),
      add: (job: CronJob) =>
        setCronJobs((prev) => {
          const exists = prev.find((j) => j.id === job.id);
          if (exists) {
            return prev.map((j) => (j.id === job.id ? job : j));
          }
          return [...prev, job];
        }),
      remove: (id: string) => setCronJobs((prev) => prev.filter((j) => j.id !== id)),
      update: (job: CronJob) => upsertCronJob(job),
      list: () => cronJobs,
      refresh: refreshCronJobs,
    };
  }, [cronJobs, refreshCronJobs, upsertCronJob]);

  const formatSchedule = useCallback((job: CronJob) => {
    if (job.schedule?.kind === "at" && job.schedule?.at) {
      const at = new Date(job.schedule.at);
      return Number.isNaN(at.getTime()) ? "At unknown time" : `At ${at.toLocaleString()}`;
    }
    if (job.schedule?.kind === "every" && typeof job.schedule?.everyMs === "number") {
      const everyMs = Math.max(job.schedule.everyMs, 1);
      const minutes = Math.round(everyMs / 60_000);
      if (minutes < 60) return `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
      const hours = Math.round(minutes / 60);
      if (minutes % 60 === 0) return `Every ${hours} hour${hours === 1 ? "" : "s"}`;
      return `Every ${minutes} minutes`;
    }
    const expr = job.schedule?.expr;
    if (!expr) return job.schedule?.kind || "Unknown";
    // Parse common cron expressions
    if (expr === "*/15 * * * *") return "Every 15 minutes";
    if (expr === "*/30 * * * *") return "Every 30 minutes";
    if (expr === "0 * * * *") return "Every hour";
    if (expr.match(/^0 \d+ \* \* \*$/)) {
      const hour = parseInt(expr.split(" ")[1]);
      const ampm = hour >= 12 ? "PM" : "AM";
      const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      return `Daily at ${h12}:00 ${ampm}`;
    }
    // Handle minute + hour expressions like "30 8 * * *"
    if (expr.match(/^\d+ \d+ \* \* \*$/)) {
      const parts = expr.split(" ");
      const min = parseInt(parts[0]);
      const hour = parseInt(parts[1]);
      const ampm = hour >= 12 ? "PM" : "AM";
      const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      return `Daily at ${h12}:${min.toString().padStart(2, "0")} ${ampm}`;
    }
    return expr;
  }, []);

  const getNextRun = useCallback((job: CronJob) => {
    if (!job.state?.nextRunAtMs) return null;
    const next = new Date(job.state.nextRunAtMs);
    const now = new Date();
    const diffMs = next.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 1) return "Any moment";
    if (diffMins < 60) return `In ${diffMins}m`;
    if (diffMins < 1440) return `In ${Math.round(diffMins / 60)}h`;
    return next.toLocaleDateString();
  }, []);

  return {
    cronJobs,
    loading,
    formatSchedule,
    getNextRun,
    refreshCronJobs,
    updateCronJob,
    deleteCronJob,
    runCronJob,
  };
}
