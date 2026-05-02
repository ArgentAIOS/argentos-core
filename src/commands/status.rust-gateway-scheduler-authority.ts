import type { CronJob } from "../cron/types.js";
import { loadCronStore, resolveCronStorePath } from "../cron/store.js";

export type RustGatewaySchedulerAuthoritySummary = {
  schedulerAuthority: "node";
  rustSchedulerAuthority: "shadow-only";
  authorityRecord: "missing";
  cronEnabled: boolean;
  cronStorePath: string;
  cronJobs: number;
  enabledCronJobs: number;
  workflowRunCronJobs: number;
  nextWakeAtMs: number | null;
  notes: string[];
};

export type RustGatewaySchedulerAuthorityOptions = {
  cronEnabled?: boolean;
  cronStorePath?: string;
  loadStore?: typeof loadCronStore;
  nowMs?: number;
};

export async function getRustGatewaySchedulerAuthoritySummary(
  options: RustGatewaySchedulerAuthorityOptions = {},
): Promise<RustGatewaySchedulerAuthoritySummary> {
  const cronStorePath = resolveCronStorePath(options.cronStorePath);
  const store = await (options.loadStore ?? loadCronStore)(cronStorePath);
  const jobs = Array.isArray(store.jobs) ? store.jobs : [];
  const enabledJobs = jobs.filter((job) => job.enabled);
  const workflowRunCronJobs = jobs.filter((job) => job.payload?.kind === "workflowRun").length;
  const nextWakeAtMs = resolveNextWakeAtMs(enabledJobs);
  const cronEnabled = options.cronEnabled !== false;

  return {
    schedulerAuthority: "node",
    rustSchedulerAuthority: "shadow-only",
    authorityRecord: "missing",
    cronEnabled,
    cronStorePath,
    cronJobs: jobs.length,
    enabledCronJobs: enabledJobs.length,
    workflowRunCronJobs,
    nextWakeAtMs,
    notes: [
      "Node remains live scheduler authority.",
      "Rust scheduler authority is shadow-only until promotion gates pass.",
      "Authority record is not implemented yet; missing is the expected current state.",
    ],
  };
}

function resolveNextWakeAtMs(jobs: CronJob[]): number | null {
  const next = jobs
    .map((job) => job.state?.nextRunAtMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .toSorted((a, b) => a - b)[0];
  return typeof next === "number" ? next : null;
}
