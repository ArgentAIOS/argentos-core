import crypto from "node:crypto";
import type {
  CronDelivery,
  CronDeliveryPatch,
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronPayload,
  CronPayloadPatch,
} from "../types.js";
import type { CronServiceState } from "./state.js";
import { parseAbsoluteTimeMs } from "../parse.js";
import { computeNextRunAtMs } from "../schedule.js";
import {
  normalizeOptionalAgentId,
  normalizeOptionalText,
  normalizePayloadToSystemText,
  normalizeRequiredName,
} from "./normalize.js";

const STUCK_RUN_MS = 2 * 60 * 60 * 1000;

export function assertSupportedJobSpec(job: Pick<CronJob, "sessionTarget" | "payload">) {
  if (
    job.sessionTarget === "main" &&
    job.payload.kind !== "systemEvent" &&
    job.payload.kind !== "audioAlert"
  ) {
    throw new Error('main cron jobs require payload.kind="systemEvent" or "audioAlert"');
  }
  if (
    job.sessionTarget === "isolated" &&
    job.payload.kind !== "agentTurn" &&
    job.payload.kind !== "nudge" &&
    job.payload.kind !== "vipEmailScan" &&
    job.payload.kind !== "slackSignalScan"
  ) {
    throw new Error(
      'isolated cron jobs require payload.kind="agentTurn", "nudge", "vipEmailScan", or "slackSignalScan"',
    );
  }
}

function assertDeliverySupport(job: Pick<CronJob, "sessionTarget" | "delivery">) {
  if (job.delivery && job.sessionTarget !== "isolated") {
    throw new Error('cron delivery config is only supported for sessionTarget="isolated"');
  }
}

export function findJobOrThrow(state: CronServiceState, id: string) {
  const job = state.store?.jobs.find((j) => j.id === id);
  if (!job) {
    throw new Error(`unknown cron job id: ${id}`);
  }
  return job;
}

export function computeJobNextRunAtMs(job: CronJob, nowMs: number): number | undefined {
  if (!job.enabled) {
    return undefined;
  }
  if (job.schedule.kind === "at") {
    // One-shot jobs stay due until they successfully finish.
    if (job.state.lastStatus === "ok" && job.state.lastRunAtMs) {
      return undefined;
    }
    const atMs = parseAbsoluteTimeMs(job.schedule.at);
    return atMs !== null ? atMs : undefined;
  }
  return computeNextRunAtMs(job.schedule, nowMs);
}

export function recomputeNextRuns(state: CronServiceState) {
  if (!state.store) {
    return;
  }
  const now = state.deps.nowMs();
  for (const job of state.store.jobs) {
    if (!job.state) {
      job.state = {};
    }
    if (!job.enabled) {
      job.state.nextRunAtMs = undefined;
      job.state.runningAtMs = undefined;
      continue;
    }
    const runningAt = job.state.runningAtMs;
    if (typeof runningAt === "number" && now - runningAt > STUCK_RUN_MS) {
      state.deps.log.warn(
        { jobId: job.id, runningAtMs: runningAt },
        "cron: clearing stuck running marker",
      );
      job.state.runningAtMs = undefined;
    }
    // Preserve nextRunAtMs for jobs that are currently due so runDueJobs
    // can pick them up before the schedule advances past the window.
    const next = job.state.nextRunAtMs;
    if (typeof next === "number" && now >= next) {
      continue;
    }
    job.state.nextRunAtMs = computeJobNextRunAtMs(job, now);
  }
}

export function nextWakeAtMs(state: CronServiceState) {
  const jobs = state.store?.jobs ?? [];
  const enabled = jobs.filter((j) => j.enabled && typeof j.state.nextRunAtMs === "number");
  if (enabled.length === 0) {
    return undefined;
  }
  return enabled.reduce(
    (min, j) => Math.min(min, j.state.nextRunAtMs as number),
    enabled[0].state.nextRunAtMs as number,
  );
}

export function createJob(state: CronServiceState, input: CronJobCreate): CronJob {
  const now = state.deps.nowMs();
  const id = crypto.randomUUID();
  const deleteAfterRun =
    typeof input.deleteAfterRun === "boolean"
      ? input.deleteAfterRun
      : input.schedule.kind === "at"
        ? true
        : undefined;
  const enabled = typeof input.enabled === "boolean" ? input.enabled : true;
  const job: CronJob = {
    id,
    agentId: normalizeOptionalAgentId(input.agentId),
    name: normalizeRequiredName(input.name),
    description: normalizeOptionalText(input.description),
    enabled,
    deleteAfterRun,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: input.schedule,
    sessionTarget: input.sessionTarget,
    executionMode: input.executionMode ?? "live",
    wakeMode: input.wakeMode,
    payload: input.payload,
    delivery: input.delivery,
    state: {
      ...input.state,
    },
  };
  assertSupportedJobSpec(job);
  assertDeliverySupport(job);
  job.state.nextRunAtMs = computeJobNextRunAtMs(job, now);
  return job;
}

export function applyJobPatch(job: CronJob, patch: CronJobPatch) {
  if ("name" in patch) {
    job.name = normalizeRequiredName(patch.name);
  }
  if ("description" in patch) {
    job.description = normalizeOptionalText(patch.description);
  }
  if (typeof patch.enabled === "boolean") {
    job.enabled = patch.enabled;
  }
  if (typeof patch.deleteAfterRun === "boolean") {
    job.deleteAfterRun = patch.deleteAfterRun;
  }
  if (patch.schedule) {
    job.schedule = patch.schedule;
  }
  if (patch.sessionTarget) {
    job.sessionTarget = patch.sessionTarget;
  }
  if (patch.executionMode) {
    job.executionMode = patch.executionMode;
  }
  if (patch.wakeMode) {
    job.wakeMode = patch.wakeMode;
  }
  if (patch.payload) {
    job.payload = mergeCronPayload(job.payload, patch.payload);
  }
  if (!patch.delivery && patch.payload?.kind === "agentTurn") {
    // Back-compat: legacy clients still update delivery via payload fields.
    const legacyDeliveryPatch = buildLegacyDeliveryPatch(patch.payload);
    if (
      legacyDeliveryPatch &&
      job.sessionTarget === "isolated" &&
      job.payload.kind === "agentTurn"
    ) {
      job.delivery = mergeCronDelivery(job.delivery, legacyDeliveryPatch);
    }
  }
  if (patch.delivery) {
    job.delivery = mergeCronDelivery(job.delivery, patch.delivery);
  }
  if (job.sessionTarget === "main" && job.delivery) {
    job.delivery = undefined;
  }
  if (patch.state) {
    job.state = { ...job.state, ...patch.state };
  }
  if ("agentId" in patch) {
    job.agentId = normalizeOptionalAgentId((patch as { agentId?: unknown }).agentId);
  }
  assertSupportedJobSpec(job);
  assertDeliverySupport(job);
}

function mergeCronPayload(existing: CronPayload, patch: CronPayloadPatch): CronPayload {
  if (patch.kind !== existing.kind) {
    return buildPayloadFromPatch(patch);
  }

  if (patch.kind === "systemEvent") {
    if (existing.kind !== "systemEvent") {
      return buildPayloadFromPatch(patch);
    }
    const text = typeof patch.text === "string" ? patch.text : existing.text;
    return { kind: "systemEvent", text };
  }

  if (patch.kind === "audioAlert") {
    if (existing.kind !== "audioAlert") {
      return buildPayloadFromPatch(patch);
    }
    const message = typeof patch.message === "string" ? patch.message : existing.message;
    return {
      kind: "audioAlert",
      message,
      title: typeof patch.title === "string" ? patch.title : existing.title,
      voice: typeof patch.voice === "string" ? patch.voice : existing.voice,
      mood: typeof patch.mood === "string" ? patch.mood : existing.mood,
      urgency: typeof patch.urgency === "string" ? patch.urgency : existing.urgency,
    };
  }

  if (patch.kind === "nudge") {
    if (existing.kind !== "nudge") {
      return buildPayloadFromPatch(patch);
    }
    const text = typeof patch.text === "string" ? patch.text : existing.text;
    const label = typeof patch.label === "string" ? patch.label : existing.label;
    return { kind: "nudge", text, label };
  }

  if (patch.kind === "vipEmailScan") {
    if (existing.kind !== "vipEmailScan") {
      return buildPayloadFromPatch(patch);
    }
    return {
      kind: "vipEmailScan",
      emitAlerts: typeof patch.emitAlerts === "boolean" ? patch.emitAlerts : existing.emitAlerts,
      maxResults: typeof patch.maxResults === "number" ? patch.maxResults : existing.maxResults,
      lookbackDays:
        typeof patch.lookbackDays === "number" ? patch.lookbackDays : existing.lookbackDays,
      accounts: Array.isArray(patch.accounts) ? patch.accounts : existing.accounts,
    };
  }

  if (patch.kind === "slackSignalScan") {
    if (existing.kind !== "slackSignalScan") {
      return buildPayloadFromPatch(patch);
    }
    return {
      kind: "slackSignalScan",
      emitAlerts: typeof patch.emitAlerts === "boolean" ? patch.emitAlerts : existing.emitAlerts,
      createTasks:
        typeof patch.createTasks === "boolean" ? patch.createTasks : existing.createTasks,
      accountId: typeof patch.accountId === "string" ? patch.accountId : existing.accountId,
    };
  }

  if (existing.kind !== "agentTurn") {
    return buildPayloadFromPatch(patch);
  }

  const next: Extract<CronPayload, { kind: "agentTurn" }> = { ...existing };
  if (typeof patch.message === "string") {
    next.message = patch.message;
  }
  if (typeof patch.model === "string") {
    next.model = patch.model;
  }
  if (typeof patch.thinking === "string") {
    next.thinking = patch.thinking;
  }
  if (typeof patch.timeoutSeconds === "number") {
    next.timeoutSeconds = patch.timeoutSeconds;
  }
  if (typeof patch.deliver === "boolean") {
    next.deliver = patch.deliver;
  }
  if (typeof patch.channel === "string") {
    next.channel = patch.channel;
  }
  if (typeof patch.to === "string") {
    next.to = patch.to;
  }
  if (typeof patch.bestEffortDeliver === "boolean") {
    next.bestEffortDeliver = patch.bestEffortDeliver;
  }
  return next;
}

function buildLegacyDeliveryPatch(
  payload: Extract<CronPayloadPatch, { kind: "agentTurn" }>,
): CronDeliveryPatch | null {
  const deliver = payload.deliver;
  const toRaw = typeof payload.to === "string" ? payload.to.trim() : "";
  const hasLegacyHints =
    typeof deliver === "boolean" ||
    typeof payload.bestEffortDeliver === "boolean" ||
    Boolean(toRaw);
  if (!hasLegacyHints) {
    return null;
  }

  const patch: CronDeliveryPatch = {};
  let hasPatch = false;

  if (deliver === false) {
    patch.mode = "none";
    hasPatch = true;
  } else if (deliver === true || toRaw) {
    patch.mode = "announce";
    hasPatch = true;
  }

  if (typeof payload.channel === "string") {
    const channel = payload.channel.trim().toLowerCase();
    patch.channel = channel ? channel : undefined;
    hasPatch = true;
  }
  if (typeof payload.to === "string") {
    patch.to = payload.to.trim();
    hasPatch = true;
  }
  if (typeof payload.bestEffortDeliver === "boolean") {
    patch.bestEffort = payload.bestEffortDeliver;
    hasPatch = true;
  }

  return hasPatch ? patch : null;
}

function buildPayloadFromPatch(patch: CronPayloadPatch): CronPayload {
  if (patch.kind === "systemEvent") {
    if (typeof patch.text !== "string" || patch.text.length === 0) {
      throw new Error('cron.update payload.kind="systemEvent" requires text');
    }
    return { kind: "systemEvent", text: patch.text };
  }

  if (patch.kind === "audioAlert") {
    if (typeof patch.message !== "string" || patch.message.length === 0) {
      throw new Error('cron.update payload.kind="audioAlert" requires message');
    }
    return {
      kind: "audioAlert",
      message: patch.message,
      title: patch.title,
      voice: patch.voice,
      mood: patch.mood,
      urgency: patch.urgency,
    };
  }

  if (patch.kind === "nudge") {
    if (typeof patch.text !== "string" || patch.text.length === 0) {
      throw new Error('cron.update payload.kind="nudge" requires text');
    }
    return { kind: "nudge", text: patch.text, label: patch.label };
  }

  if (patch.kind === "vipEmailScan") {
    return {
      kind: "vipEmailScan",
      emitAlerts: patch.emitAlerts,
      maxResults: patch.maxResults,
      lookbackDays: patch.lookbackDays,
      accounts: patch.accounts,
    };
  }

  if (patch.kind === "slackSignalScan") {
    return {
      kind: "slackSignalScan",
      emitAlerts: patch.emitAlerts,
      createTasks: patch.createTasks,
      accountId: patch.accountId,
    };
  }

  if (typeof patch.message !== "string" || patch.message.length === 0) {
    throw new Error('cron.update payload.kind="agentTurn" requires message');
  }

  return {
    kind: "agentTurn",
    message: patch.message,
    model: patch.model,
    thinking: patch.thinking,
    timeoutSeconds: patch.timeoutSeconds,
    deliver: patch.deliver,
    channel: patch.channel,
    to: patch.to,
    bestEffortDeliver: patch.bestEffortDeliver,
  };
}

function mergeCronDelivery(
  existing: CronDelivery | undefined,
  patch: CronDeliveryPatch,
): CronDelivery {
  const next: CronDelivery = {
    mode: existing?.mode ?? "none",
    channel: existing?.channel,
    to: existing?.to,
    bestEffort: existing?.bestEffort,
  };

  if (typeof patch.mode === "string") {
    next.mode = (patch.mode as string) === "deliver" ? "announce" : patch.mode;
  }
  if ("channel" in patch) {
    const channel = typeof patch.channel === "string" ? patch.channel.trim() : "";
    next.channel = channel ? channel : undefined;
  }
  if ("to" in patch) {
    const to = typeof patch.to === "string" ? patch.to.trim() : "";
    next.to = to ? to : undefined;
  }
  if (typeof patch.bestEffort === "boolean") {
    next.bestEffort = patch.bestEffort;
  }

  return next;
}

export function isJobDue(job: CronJob, nowMs: number, opts: { forced: boolean }) {
  if (opts.forced) {
    return true;
  }
  return job.enabled && typeof job.state.nextRunAtMs === "number" && nowMs >= job.state.nextRunAtMs;
}

export function resolveJobPayloadTextForMain(job: CronJob): string | undefined {
  if (job.payload.kind !== "systemEvent") {
    return undefined;
  }
  const text = normalizePayloadToSystemText(job.payload);
  return text.trim() ? text : undefined;
}
