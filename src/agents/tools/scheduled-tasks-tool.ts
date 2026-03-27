import { Type } from "@sinclair/typebox";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../cron/normalize.js";
import {
  type CronAgentTurnArtifactContract,
  type CronArtifactContract,
  type CronDelivery,
  type CronJob,
  type CronJobCreate,
  type CronJobPatch,
  type CronSchedule,
} from "../../cron/types.js";
import {
  type AnyAgentTool,
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";

const SCHEDULED_TASK_ACTIONS = [
  "create",
  "list",
  "update",
  "pause",
  "resume",
  "remove",
  "run",
  "status",
] as const;

const SCHEDULED_TASK_RECURRENCES = ["once", "interval", "daily", "weekly"] as const;
const WEEKDAY_VALUES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MANAGED_DESCRIPTION_MARKER = "[scheduled_tasks]";

const ScheduledTasksToolSchema = Type.Object({
  action: Type.Union(SCHEDULED_TASK_ACTIONS.map((value) => Type.Literal(value))),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  id: Type.Optional(Type.String()),
  jobId: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  workflowPrompt: Type.Optional(Type.String()),
  recurrence: Type.Optional(
    Type.Union(SCHEDULED_TASK_RECURRENCES.map((value) => Type.Literal(value))),
  ),
  runAt: Type.Optional(Type.String()),
  timeZone: Type.Optional(Type.String()),
  hour: Type.Optional(Type.Number()),
  minute: Type.Optional(Type.Number()),
  intervalMinutes: Type.Optional(Type.Number()),
  weekdays: Type.Optional(
    Type.Array(Type.Union(WEEKDAY_VALUES.map((value) => Type.Literal(value))), { minItems: 1 }),
  ),
  agentId: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  deliveryMode: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("announce")])),
  deliveryChannel: Type.Optional(Type.String()),
  deliveryTo: Type.Optional(Type.String()),
  deliveryBestEffort: Type.Optional(Type.Boolean()),
  wakeMode: Type.Optional(Type.Union([Type.Literal("now"), Type.Literal("next-heartbeat")])),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  timeoutSeconds: Type.Optional(Type.Number()),
  requireDocPanelDraftTitle: Type.Optional(Type.String()),
  requireHandoffTaskTitle: Type.Optional(Type.String()),
  requireDeliveryTaskTitle: Type.Optional(Type.String()),
  watchdogAfterMinutes: Type.Optional(Type.Number()),
  announceOnWatchdogFailure: Type.Optional(Type.Boolean()),
  includeDisabled: Type.Optional(Type.Boolean()),
});

function toGatewayOptions(params: Record<string, unknown>): GatewayCallOptions {
  return {
    gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
    gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
    timeoutMs: readNumberParam(params, "timeoutMs") ?? 60_000,
  };
}

function resolveJobId(params: Record<string, unknown>): string {
  return (
    readStringParam(params, "jobId") ??
    readStringParam(params, "id", { required: true, label: "jobId" })
  );
}

function clampHour(raw: number | undefined): number {
  const value = raw ?? 9;
  return Math.max(0, Math.min(23, Math.trunc(value)));
}

function clampMinute(raw: number | undefined): number {
  const value = raw ?? 0;
  return Math.max(0, Math.min(59, Math.trunc(value)));
}

function buildSchedule(params: Record<string, unknown>): CronSchedule {
  const recurrence = readStringParam(params, "recurrence", {
    required: true,
    label: "recurrence",
  }) as (typeof SCHEDULED_TASK_RECURRENCES)[number];

  if (recurrence === "once") {
    const runAt = readStringParam(params, "runAt", { required: true, label: "runAt" });
    return { kind: "at", at: runAt };
  }

  if (recurrence === "interval") {
    const intervalMinutes = readNumberParam(params, "intervalMinutes", {
      required: true,
      label: "intervalMinutes",
    });
    if (!intervalMinutes || intervalMinutes <= 0) {
      throw new Error("intervalMinutes must be greater than 0");
    }
    const anchor = readStringParam(params, "runAt");
    return {
      kind: "every",
      everyMs: Math.max(1, Math.trunc(intervalMinutes)) * 60_000,
      ...(anchor ? { anchorMs: Date.parse(anchor) } : {}),
    };
  }

  const hour = clampHour(readNumberParam(params, "hour"));
  const minute = clampMinute(readNumberParam(params, "minute"));
  const tz = readStringParam(params, "timeZone");

  if (recurrence === "daily") {
    return {
      kind: "cron",
      expr: `${minute} ${hour} * * *`,
      ...(tz ? { tz } : {}),
    };
  }

  const weekdays = readStringArrayParam(params, "weekdays", {
    required: true,
    label: "weekdays",
  }).map((value) => value.trim().toUpperCase());
  return {
    kind: "cron",
    expr: `${minute} ${hour} * * ${weekdays.join(",")}`,
    ...(tz ? { tz } : {}),
  };
}

function buildRequiredContract(params: Record<string, unknown>): CronArtifactContract | undefined {
  const docTitle = readStringParam(params, "requireDocPanelDraftTitle");
  const handoffTitle = readStringParam(params, "requireHandoffTaskTitle");
  const contract: CronArtifactContract = {};
  if (docTitle) {
    contract.docPanelDraft = { titleIncludes: docTitle };
  }
  if (handoffTitle) {
    contract.handoffTask = { titleIncludes: handoffTitle };
  }
  return Object.keys(contract).length > 0 ? contract : undefined;
}

function buildWatchdogContract(
  params: Record<string, unknown>,
): CronAgentTurnArtifactContract["watchdog"] {
  const deliveryTitle = readStringParam(params, "requireDeliveryTaskTitle");
  const watchdogAfterMinutes = readNumberParam(params, "watchdogAfterMinutes");
  const announceOnFailure =
    typeof params.announceOnWatchdogFailure === "boolean"
      ? params.announceOnWatchdogFailure
      : undefined;

  if (!deliveryTitle && watchdogAfterMinutes === undefined && announceOnFailure === undefined) {
    return undefined;
  }

  return {
    afterMs: Math.max(1, Math.trunc(watchdogAfterMinutes ?? 5)) * 60_000,
    announceOnFailure: announceOnFailure ?? true,
    required: deliveryTitle ? { deliveryTask: { titleIncludes: deliveryTitle } } : undefined,
  };
}

function buildArtifactContract(
  params: Record<string, unknown>,
): CronAgentTurnArtifactContract | undefined {
  const required = buildRequiredContract(params);
  const watchdog = buildWatchdogContract(params);
  if (!required && !watchdog) {
    return undefined;
  }
  return {
    ...(required ? { required } : {}),
    ...(watchdog ? { watchdog } : {}),
  };
}

function buildManagedDescription(userDescription?: string): string {
  const base = userDescription?.trim();
  return base ? `${MANAGED_DESCRIPTION_MARKER}\n${base}` : MANAGED_DESCRIPTION_MARKER;
}

function isManagedScheduledTask(job: unknown): job is CronJob {
  if (!job || typeof job !== "object") return false;
  const description = (job as { description?: unknown }).description;
  return typeof description === "string" && description.includes(MANAGED_DESCRIPTION_MARKER);
}

function summarizeSchedule(schedule: CronSchedule): string {
  switch (schedule.kind) {
    case "at":
      return `once at ${schedule.at}`;
    case "every":
      return `every ${Math.max(1, Math.round(schedule.everyMs / 60_000))} minute(s)`;
    case "cron":
      return `${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ""}`;
  }
}

function summarizeManagedJob(job: CronJob): string {
  const payload = job.payload.kind === "agentTurn" ? job.payload.message : job.payload.kind;
  const trimmedPayload = payload.length > 120 ? `${payload.slice(0, 117).trimEnd()}...` : payload;
  return [
    `- [${job.id.slice(0, 8)}] ${job.name}`,
    `  enabled=${job.enabled} schedule=${summarizeSchedule(job.schedule)}`,
    `  delivery=${job.delivery?.mode ?? "announce"} wake=${job.wakeMode}`,
    `  prompt=${JSON.stringify(trimmedPayload)}`,
  ].join("\n");
}

function buildCreateJob(params: Record<string, unknown>): CronJobCreate {
  const name = readStringParam(params, "name", { required: true, label: "name" });
  const workflowPrompt = readStringParam(params, "workflowPrompt", {
    required: true,
    label: "workflowPrompt",
  });
  const recurrence = readStringParam(params, "recurrence", {
    required: true,
    label: "recurrence",
  }) as (typeof SCHEDULED_TASK_RECURRENCES)[number];
  const schedule = buildSchedule(params);
  const artifactContract = buildArtifactContract(params);

  const deliveryChannel = readStringParam(params, "deliveryChannel") as CronDelivery["channel"];
  const job: CronJobCreate = {
    name,
    description: buildManagedDescription(readStringParam(params, "description")),
    agentId: readStringParam(params, "agentId"),
    enabled: typeof params.enabled === "boolean" ? params.enabled : true,
    deleteAfterRun: recurrence === "once",
    schedule,
    sessionTarget: "isolated",
    wakeMode: readStringParam(params, "wakeMode") === "now" ? "now" : "next-heartbeat",
    payload: {
      kind: "agentTurn",
      message: workflowPrompt,
      model: readStringParam(params, "model"),
      thinking: readStringParam(params, "thinking"),
      timeoutSeconds: readNumberParam(params, "timeoutSeconds") ?? undefined,
      artifactContract,
    },
    delivery: {
      mode: readStringParam(params, "deliveryMode") === "none" ? "none" : "announce",
      channel: deliveryChannel,
      to: readStringParam(params, "deliveryTo"),
      bestEffort:
        typeof params.deliveryBestEffort === "boolean" ? params.deliveryBestEffort : undefined,
    },
  };
  return normalizeCronJobCreate(job) ?? job;
}

function buildUpdatePatch(params: Record<string, unknown>): CronJobPatch {
  const patch: CronJobPatch = {};

  const name = readStringParam(params, "name");
  if (name) patch.name = name;

  if ("description" in params) {
    patch.description = buildManagedDescription(
      readStringParam(params, "description", { allowEmpty: true }) ?? "",
    );
  }

  if ("enabled" in params && typeof params.enabled === "boolean") {
    patch.enabled = params.enabled;
  }

  if ("agentId" in params) {
    const agentId = readStringParam(params, "agentId");
    if (agentId) {
      patch.agentId = agentId;
    }
  }

  if ("recurrence" in params) {
    patch.schedule = buildSchedule(params);
    if (readStringParam(params, "recurrence") === "once") {
      patch.deleteAfterRun = true;
    }
  }

  const workflowPrompt = readStringParam(params, "workflowPrompt");
  const model = readStringParam(params, "model");
  const thinking = readStringParam(params, "thinking");
  const timeoutSeconds = readNumberParam(params, "timeoutSeconds");
  const artifactContract = buildArtifactContract(params);
  if (workflowPrompt || model || thinking || timeoutSeconds !== undefined || artifactContract) {
    patch.payload = {
      kind: "agentTurn",
      ...(workflowPrompt ? { message: workflowPrompt } : {}),
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
      ...(artifactContract ? { artifactContract } : {}),
    };
  }

  const deliveryMode = readStringParam(params, "deliveryMode");
  const deliveryChannel = readStringParam(params, "deliveryChannel") as CronDelivery["channel"];
  const deliveryTo = readStringParam(params, "deliveryTo");
  const bestEffort =
    typeof params.deliveryBestEffort === "boolean" ? params.deliveryBestEffort : undefined;
  if (deliveryMode || deliveryChannel || deliveryTo || bestEffort !== undefined) {
    const deliveryPatch: CronDelivery = {
      mode: deliveryMode === "none" ? "none" : "announce",
    };
    if (deliveryChannel) {
      deliveryPatch.channel = deliveryChannel;
    }
    if (deliveryTo) {
      deliveryPatch.to = deliveryTo;
    }
    if (bestEffort !== undefined) {
      deliveryPatch.bestEffort = bestEffort;
    }
    patch.delivery = deliveryPatch;
  }

  const wakeMode = readStringParam(params, "wakeMode");
  if (wakeMode === "now" || wakeMode === "next-heartbeat") {
    patch.wakeMode = wakeMode;
  }

  return normalizeCronJobPatch(patch) ?? patch;
}

export function createScheduledTasksTool(): AnyAgentTool {
  return {
    label: "Scheduled Tasks",
    name: "scheduled_tasks",
    description:
      "Create and manage first-class scheduled workflows for user-facing recurring work such as morning briefs, reports, check-ins, and delivery pipelines. Use this instead of raw cron whenever the work is a managed scheduled task with a workflow prompt, delivery target, or artifact/verification requirements. Raw cron remains for low-level reminders, wake events, and deterministic monitors.",
    parameters: ScheduledTasksToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = toGatewayOptions(params);

      if (action === "status") {
        return jsonResult(await callGatewayTool("cron.status", gatewayOpts, {}));
      }

      if (action === "list") {
        const listed = await callGatewayTool<{ jobs?: unknown[] }>("cron.list", gatewayOpts, {
          includeDisabled: Boolean(params.includeDisabled),
        });
        const jobs = Array.isArray(listed?.jobs) ? listed.jobs.filter(isManagedScheduledTask) : [];
        if (jobs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No managed scheduled tasks found.",
              },
            ],
            details: { jobs: [] },
          };
        }
        return {
          content: [{ type: "text", text: jobs.map(summarizeManagedJob).join("\n") }],
          details: { jobs },
        };
      }

      if (action === "create") {
        const job = buildCreateJob(params);
        const created = await callGatewayTool("cron.add", gatewayOpts, job);
        return jsonResult(created);
      }

      if (action === "update") {
        const id = resolveJobId(params);
        const patch = buildUpdatePatch(params);
        return jsonResult(await callGatewayTool("cron.update", gatewayOpts, { id, patch }));
      }

      if (action === "pause" || action === "resume") {
        const id = resolveJobId(params);
        return jsonResult(
          await callGatewayTool("cron.update", gatewayOpts, {
            id,
            patch: { enabled: action === "resume" },
          }),
        );
      }

      if (action === "remove") {
        const id = resolveJobId(params);
        return jsonResult(await callGatewayTool("cron.remove", gatewayOpts, { id }));
      }

      if (action === "run") {
        const id = resolveJobId(params);
        return jsonResult(await callGatewayTool("cron.run", gatewayOpts, { id }));
      }

      throw new Error(`unsupported action: ${action}`);
    },
  };
}
