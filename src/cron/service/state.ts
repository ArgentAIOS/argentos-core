import type { HeartbeatRunResult } from "../../infra/heartbeat-wake.js";
import type {
  CronExecutionMode,
  CronGateDecision,
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronSimulationEvidence,
  CronStoreFile,
} from "../types.js";

export type CronEvent = {
  jobId: string;
  action: "added" | "updated" | "removed" | "started" | "finished";
  runAtMs?: number;
  durationMs?: number;
  status?: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  nextRunAtMs?: number;
  executionMode?: CronExecutionMode;
  gateDecision?: CronGateDecision;
  gateReason?: string;
  simulationEvidence?: CronSimulationEvidence;
};

export type Logger = {
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export type CronServiceDeps = {
  nowMs?: () => number;
  log: Logger;
  storePath: string;
  cronEnabled: boolean;
  enqueueSystemEvent: (text: string, opts?: { agentId?: string }) => void;
  requestHeartbeatNow: (opts?: { reason?: string }) => void;
  runHeartbeatOnce?: (opts?: { reason?: string }) => Promise<HeartbeatRunResult>;
  runIsolatedAgentJob: (params: { job: CronJob; message: string }) => Promise<{
    status: "ok" | "error" | "skipped";
    summary?: string;
    /** Last non-empty agent text output (not truncated). */
    outputText?: string;
    error?: string;
  }>;
  verifyIsolatedAgentJobWatchdog?: (params: { job: CronJob }) => Promise<{
    status: "ok" | "error" | "skipped";
    summary?: string;
    error?: string;
  }>;
  /** Send a nudge through the gateway agent handler with silent delivery */
  runNudge?: (params: { job: CronJob; text: string; label?: string }) => Promise<{
    status: "ok" | "error" | "skipped";
    error?: string;
  }>;
  /** Deterministic dashboard audio alert delivery (no LLM turn). */
  runAudioAlert?: (params: {
    job: CronJob;
    message: string;
    title?: string;
    voice?: string;
    mood?: string;
    urgency?: "info" | "warning" | "urgent";
  }) => Promise<{
    status: "ok" | "error" | "skipped";
    summary?: string;
    error?: string;
  }>;
  /** Deterministic VIP email scan pipeline (no LLM turn). */
  runVipEmailScan?: (params: {
    job: CronJob;
    emitAlerts?: boolean;
    maxResults?: number;
    lookbackDays?: number;
    accounts?: string[];
  }) => Promise<{
    status: "ok" | "error" | "skipped";
    summary?: string;
    error?: string;
  }>;
  /** Deterministic Slack signal scan pipeline (no LLM turn). */
  runSlackSignalScan?: (params: {
    job: CronJob;
    emitAlerts?: boolean;
    createTasks?: boolean;
    accountId?: string;
  }) => Promise<{
    status: "ok" | "error" | "skipped";
    summary?: string;
    error?: string;
  }>;
  resumeDueWorkflowWaits?: (params: { nowMs: number }) => Promise<{
    resumed: number;
    failed?: number;
    errors: string[];
  }>;
  onEvent?: (evt: CronEvent) => void;
};

export type CronServiceDepsInternal = Omit<CronServiceDeps, "nowMs"> & {
  nowMs: () => number;
};

export type CronServiceState = {
  deps: CronServiceDepsInternal;
  store: CronStoreFile | null;
  timer: NodeJS.Timeout | null;
  running: boolean;
  op: Promise<unknown>;
  warnedDisabled: boolean;
  storeLoadedAtMs: number | null;
  storeFileMtimeMs: number | null;
};

export function createCronServiceState(deps: CronServiceDeps): CronServiceState {
  return {
    deps: { ...deps, nowMs: deps.nowMs ?? (() => Date.now()) },
    store: null,
    timer: null,
    running: false,
    op: Promise.resolve(),
    warnedDisabled: false,
    storeLoadedAtMs: null,
    storeFileMtimeMs: null,
  };
}

export type CronRunMode = "due" | "force";
export type CronWakeMode = "now" | "next-heartbeat";

export type CronStatusSummary = {
  enabled: boolean;
  storePath: string;
  jobs: number;
  nextWakeAtMs: number | null;
};

export type CronRunResult =
  | { ok: true; ran: true }
  | { ok: true; ran: false; reason: "not-due" }
  | { ok: false };

export type CronRemoveResult = { ok: true; removed: boolean } | { ok: false; removed: false };

export type CronAddResult = CronJob;
export type CronUpdateResult = CronJob;

export type CronListResult = CronJob[];
export type CronAddInput = CronJobCreate;
export type CronUpdateInput = CronJobPatch;
