import type { ChannelId } from "../channels/plugins/types.js";
import type { TaskSource, TaskStatus } from "../data/types.js";

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export type CronSessionTarget = "main" | "isolated";
export type CronWakeMode = "next-heartbeat" | "now";
export type CronExecutionMode = "live" | "paper_trade";
export type CronGateDecision = "allow_live" | "simulated_paper_trade";

export type CronSimulationEvidence = {
  mode: "paper_trade";
  policy: "external_side_effect_gate";
  simulatedAtMs: number;
  payloadKind: CronPayload["kind"];
  action: string;
  reason: string;
};

export type CronMessageChannel = ChannelId | "last";

export type CronDeliveryMode = "none" | "announce";

export type CronDelivery = {
  mode: CronDeliveryMode;
  channel?: CronMessageChannel;
  to?: string;
  bestEffort?: boolean;
};

export type CronDeliveryPatch = Partial<CronDelivery>;

export type CronDocPanelArtifactRequirement = {
  documentId?: string;
  titleIncludes?: string;
  collection?: string | string[];
  sourceFileIncludes?: string;
  limit?: number;
};

export type CronTaskArtifactRequirement = {
  taskId?: string;
  titleIncludes?: string;
  assignee?: string;
  status?: TaskStatus | TaskStatus[];
  source?: TaskSource | TaskSource[];
  tags?: string[];
  parentTaskId?: string;
  agentId?: string;
  limit?: number;
};

export type CronArtifactContract = {
  docPanelDraft?: CronDocPanelArtifactRequirement;
  handoffTask?: CronTaskArtifactRequirement;
  deliveryTask?: CronTaskArtifactRequirement;
};

export type CronArtifactWatchdog = {
  afterMs?: number;
  announceOnFailure?: boolean;
  required?: CronArtifactContract;
};

export type CronAgentTurnArtifactContract = {
  required?: CronArtifactContract;
  watchdog?: CronArtifactWatchdog;
};

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "audioAlert";
      message: string;
      title?: string;
      voice?: string;
      mood?: string;
      urgency?: "info" | "warning" | "urgent";
    }
  | {
      kind: "agentTurn";
      message: string;
      /** Optional model override (provider/model or alias). */
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      allowUnsafeExternalContent?: boolean;
      artifactContract?: CronAgentTurnArtifactContract;
      deliver?: boolean;
      channel?: CronMessageChannel;
      to?: string;
      bestEffortDeliver?: boolean;
    }
  | {
      kind: "nudge";
      /** The prompt text sent to the agent as a silent nudge */
      text: string;
      /** Optional label for logging / dashboard display */
      label?: string;
    }
  | {
      kind: "vipEmailScan";
      emitAlerts?: boolean;
      maxResults?: number;
      lookbackDays?: number;
      accounts?: string[];
    }
  | {
      kind: "slackSignalScan";
      emitAlerts?: boolean;
      createTasks?: boolean;
      accountId?: string;
    }
  | {
      kind: "workflowRun";
      /** UUID of the workflow to execute. */
      workflowId: string;
      /** Optional payload forwarded to the trigger node. */
      triggerPayload?: Record<string, unknown>;
    };

export type CronPayloadPatch =
  | { kind: "systemEvent"; text?: string }
  | {
      kind: "audioAlert";
      message?: string;
      title?: string;
      voice?: string;
      mood?: string;
      urgency?: "info" | "warning" | "urgent";
    }
  | {
      kind: "agentTurn";
      message?: string;
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      allowUnsafeExternalContent?: boolean;
      artifactContract?: CronAgentTurnArtifactContract;
      deliver?: boolean;
      channel?: CronMessageChannel;
      to?: string;
      bestEffortDeliver?: boolean;
    }
  | {
      kind: "nudge";
      text?: string;
      label?: string;
    }
  | {
      kind: "vipEmailScan";
      emitAlerts?: boolean;
      maxResults?: number;
      lookbackDays?: number;
      accounts?: string[];
    }
  | {
      kind: "slackSignalScan";
      emitAlerts?: boolean;
      createTasks?: boolean;
      accountId?: string;
    }
  | {
      kind: "workflowRun";
      workflowId?: string;
      triggerPayload?: Record<string, unknown>;
    };

export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  lastExecutionMode?: CronExecutionMode;
  lastGateDecision?: CronGateDecision;
  lastGateReason?: string;
  lastSimulationEvidence?: CronSimulationEvidence;
  watchdog?: {
    status: "pending" | "ok" | "error";
    dueAtMs?: number;
    lastCheckedAtMs?: number;
    verifiedAtMs?: number;
    error?: string;
    summary?: string;
  };
};

export type CronJob = {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  executionMode?: CronExecutionMode;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  delivery?: CronDelivery;
  state: CronJobState;
};

export type CronStoreFile = {
  version: 1;
  jobs: CronJob[];
};

export type CronJobCreate = Omit<CronJob, "id" | "createdAtMs" | "updatedAtMs" | "state"> & {
  state?: Partial<CronJobState>;
};

export type CronJobPatch = Partial<Omit<CronJob, "id" | "createdAtMs" | "state" | "payload">> & {
  payload?: CronPayloadPatch;
  delivery?: CronDeliveryPatch;
  state?: Partial<CronJobState>;
};
