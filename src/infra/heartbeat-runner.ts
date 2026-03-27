import fs from "node:fs/promises";
import path from "node:path";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { ChannelHeartbeatDeps } from "../channels/plugins/types.js";
import type { ArgentConfig } from "../config/config.js";
import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";
import type { ScoreState } from "./heartbeat-score.js";
import type { TaskVerdict } from "./heartbeat-verifier.js";
import type { OutboundSendDeps } from "./outbound/deliver.js";
import {
  resolveAgentConfig,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { resolveEffectiveMessagesConfig } from "../agents/identity.js";
import { DEFAULT_HEARTBEAT_FILENAME } from "../agents/workspace.js";
import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_EVERY,
  isHeartbeatContentEffectivelyEmpty,
  resolveHeartbeatPrompt as resolveHeartbeatPromptText,
  stripHeartbeatToken,
} from "../auto-reply/heartbeat.js";
import { getReplyFromConfig } from "../auto-reply/reply.js";
import { HEARTBEAT_TOKEN } from "../auto-reply/tokens.js";
import { getChannelPlugin } from "../channels/plugins/index.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import { loadConfig } from "../config/config.js";
import {
  canonicalizeMainSessionAlias,
  loadSessionStore,
  resolveAgentIdFromSessionKey,
  resolveAgentMainSessionKey,
  resolveStorePath,
  saveSessionStore,
  updateSessionStore,
} from "../config/sessions.js";
import { getMemoryAdapter } from "../data/storage-factory.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getQueueSize } from "../process/command-queue.js";
import { CommandLane } from "../process/lanes.js";
import { normalizeAgentId, toAgentStoreSessionKey } from "../routing/session-key.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { formatErrorMessage } from "./errors.js";
import { isWithinActiveHours } from "./heartbeat-active-hours.js";
import {
  type HeartbeatContract,
  buildContractPromptSupplement,
  initCycleProgress,
  loadHeartbeatContract,
  loadProgress,
  saveProgress,
} from "./heartbeat-contract.js";
import { emitHeartbeatEvent, resolveIndicatorType } from "./heartbeat-events.js";
import { collectGroundTruth, formatGroundTruthForVerifier } from "./heartbeat-ground-truth.js";
import { appendJournalEntry } from "./heartbeat-journal.js";
import {
  type VerdictInput,
  type CycleFeedback,
  buildScorePromptSection,
  buildFeedbackPromptSection,
  clearLastFeedback,
  computeDailyTarget,
  getScoreIntervalOverride,
  loadLastFeedback,
  loadScoreState,
  recordVerdicts as recordScoreVerdicts,
  saveLastFeedback,
  saveScoreState,
  shouldForceAllRequired,
} from "./heartbeat-score.js";
import { applyVerdicts, setVerifierModel, verifyHeartbeatResponse } from "./heartbeat-verifier.js";
import { resolveHeartbeatVisibility } from "./heartbeat-visibility.js";
import {
  type HeartbeatRunResult,
  type HeartbeatWakeHandler,
  requestHeartbeatNow,
  setHeartbeatWakeHandler,
} from "./heartbeat-wake.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";
import {
  resolveHeartbeatDeliveryTarget,
  resolveHeartbeatSenderContext,
} from "./outbound/targets.js";
import { resolveServiceKey } from "./service-keys.js";
import { enqueueSystemEvent, peekSystemEvents } from "./system-events.js";

type HeartbeatDeps = OutboundSendDeps &
  ChannelHeartbeatDeps & {
    runtime?: RuntimeEnv;
    getQueueSize?: (lane?: string) => number;
    nowMs?: () => number;
  };

const log = createSubsystemLogger("gateway/heartbeat");
let heartbeatsEnabled = true;

export function setHeartbeatsEnabled(enabled: boolean) {
  heartbeatsEnabled = enabled;
}

type HeartbeatConfig = AgentDefaultsConfig["heartbeat"];
type HeartbeatAgent = {
  agentId: string;
  heartbeat?: HeartbeatConfig;
};

export type HeartbeatSummary = {
  enabled: boolean;
  every: string;
  everyMs: number | null;
  prompt: string;
  target: string;
  model?: string;
  ackMaxChars: number;
};

const DEFAULT_HEARTBEAT_TARGET = "last";

// Prompt used when an async exec has completed and the result should be relayed to the user.
// This overrides the standard heartbeat prompt to ensure the model responds with the exec result
// instead of just "HEARTBEAT_OK".
const EXEC_EVENT_PROMPT =
  "An async command you ran earlier has completed. The result is shown in the system messages above. " +
  "Please relay the command output to the user in a helpful way. If the command succeeded, share the relevant output. " +
  "If it failed, explain what went wrong.";

type HeartbeatAgentState = {
  agentId: string;
  heartbeat?: HeartbeatConfig;
  intervalMs: number;
  lastRunMs?: number;
  nextDueMs: number;
};

export type HeartbeatRunner = {
  stop: () => void;
  updateConfig: (cfg: ArgentConfig) => void;
};

function hasExplicitHeartbeatAgents(cfg: ArgentConfig) {
  const list = cfg.agents?.list ?? [];
  return list.some((entry) => Boolean(entry?.heartbeat));
}

export function isHeartbeatEnabledForAgent(cfg: ArgentConfig, agentId?: string): boolean {
  const resolvedAgentId = normalizeAgentId(agentId ?? resolveDefaultAgentId(cfg));
  const list = cfg.agents?.list ?? [];
  const hasExplicit = hasExplicitHeartbeatAgents(cfg);
  if (hasExplicit) {
    return list.some(
      (entry) => Boolean(entry?.heartbeat) && normalizeAgentId(entry?.id) === resolvedAgentId,
    );
  }
  return resolvedAgentId === resolveDefaultAgentId(cfg);
}

function resolveHeartbeatConfig(cfg: ArgentConfig, agentId?: string): HeartbeatConfig | undefined {
  const defaults = cfg.agents?.defaults?.heartbeat;
  if (!agentId) {
    return defaults;
  }
  const overrides = resolveAgentConfig(cfg, agentId)?.heartbeat;
  if (!defaults && !overrides) {
    return overrides;
  }
  return { ...defaults, ...overrides };
}

export function resolveHeartbeatSummaryForAgent(
  cfg: ArgentConfig,
  agentId?: string,
): HeartbeatSummary {
  const defaults = cfg.agents?.defaults?.heartbeat;
  const overrides = agentId ? resolveAgentConfig(cfg, agentId)?.heartbeat : undefined;
  const enabled = isHeartbeatEnabledForAgent(cfg, agentId);

  if (!enabled) {
    return {
      enabled: false,
      every: "disabled",
      everyMs: null,
      prompt: resolveHeartbeatPromptText(defaults?.prompt),
      target: defaults?.target ?? DEFAULT_HEARTBEAT_TARGET,
      model: defaults?.model,
      ackMaxChars: Math.max(0, defaults?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS),
    };
  }

  const merged = defaults || overrides ? { ...defaults, ...overrides } : undefined;
  const every = merged?.every ?? defaults?.every ?? overrides?.every ?? DEFAULT_HEARTBEAT_EVERY;
  const everyMs = resolveHeartbeatIntervalMs(cfg, undefined, merged);
  const prompt = resolveHeartbeatPromptText(
    merged?.prompt ?? defaults?.prompt ?? overrides?.prompt,
  );
  const target =
    merged?.target ?? defaults?.target ?? overrides?.target ?? DEFAULT_HEARTBEAT_TARGET;
  const model = merged?.model ?? defaults?.model ?? overrides?.model;
  const ackMaxChars = Math.max(
    0,
    merged?.ackMaxChars ??
      defaults?.ackMaxChars ??
      overrides?.ackMaxChars ??
      DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  );

  return {
    enabled: true,
    every,
    everyMs,
    prompt,
    target,
    model,
    ackMaxChars,
  };
}

function resolveHeartbeatAgents(cfg: ArgentConfig): HeartbeatAgent[] {
  const list = cfg.agents?.list ?? [];
  if (hasExplicitHeartbeatAgents(cfg)) {
    return list
      .filter((entry) => entry?.heartbeat)
      .map((entry) => {
        const id = normalizeAgentId(entry.id);
        return { agentId: id, heartbeat: resolveHeartbeatConfig(cfg, id) };
      })
      .filter((entry) => entry.agentId);
  }
  const fallbackId = resolveDefaultAgentId(cfg);
  return [{ agentId: fallbackId, heartbeat: resolveHeartbeatConfig(cfg, fallbackId) }];
}

export function resolveHeartbeatIntervalMs(
  cfg: ArgentConfig,
  overrideEvery?: string,
  heartbeat?: HeartbeatConfig,
) {
  const raw =
    overrideEvery ??
    heartbeat?.every ??
    cfg.agents?.defaults?.heartbeat?.every ??
    DEFAULT_HEARTBEAT_EVERY;
  if (!raw) {
    return null;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return null;
  }
  let ms: number;
  try {
    ms = parseDurationMs(trimmed, { defaultUnit: "m" });
  } catch {
    return null;
  }
  if (ms <= 0) {
    return null;
  }
  return ms;
}

export function resolveHeartbeatPrompt(cfg: ArgentConfig, heartbeat?: HeartbeatConfig) {
  return resolveHeartbeatPromptText(heartbeat?.prompt ?? cfg.agents?.defaults?.heartbeat?.prompt);
}

/**
 * Resolve a ground truth API key.
 * Uses the centralized service-keys resolver:
 *   1. ~/.argentos/service-keys.json (dashboard-managed)
 *   2. process.env (gateway plist)
 *   3. argent.json env.vars (config fallback)
 */
function resolveGroundTruthKey(cfg: ArgentConfig, envName: string): string | undefined {
  return resolveServiceKey(envName, cfg);
}

function resolveHeartbeatAckMaxChars(cfg: ArgentConfig, heartbeat?: HeartbeatConfig) {
  return Math.max(
    0,
    heartbeat?.ackMaxChars ??
      cfg.agents?.defaults?.heartbeat?.ackMaxChars ??
      DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  );
}

function resolveHeartbeatSession(cfg: ArgentConfig, agentId?: string, heartbeat?: HeartbeatConfig) {
  const sessionCfg = cfg.session;
  const scope = sessionCfg?.scope ?? "per-sender";
  const resolvedAgentId = normalizeAgentId(agentId ?? resolveDefaultAgentId(cfg));
  const mainSessionKey =
    scope === "global" ? "global" : resolveAgentMainSessionKey({ cfg, agentId: resolvedAgentId });
  const storeAgentId = scope === "global" ? resolveDefaultAgentId(cfg) : resolvedAgentId;
  const storePath = resolveStorePath(sessionCfg?.store, {
    agentId: storeAgentId,
  });
  const store = loadSessionStore(storePath);
  const mainEntry = store[mainSessionKey];

  if (scope === "global") {
    return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
  }

  const trimmed = heartbeat?.session?.trim() ?? "";
  if (!trimmed) {
    return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === "main" || normalized === "global") {
    return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
  }

  const candidate = toAgentStoreSessionKey({
    agentId: resolvedAgentId,
    requestKey: trimmed,
    mainKey: cfg.session?.mainKey,
  });
  const canonical = canonicalizeMainSessionAlias({
    cfg,
    agentId: resolvedAgentId,
    sessionKey: candidate,
  });
  if (canonical !== "global") {
    const sessionAgentId = resolveAgentIdFromSessionKey(canonical);
    if (sessionAgentId === normalizeAgentId(resolvedAgentId)) {
      return {
        sessionKey: canonical,
        storePath,
        store,
        entry: store[canonical],
      };
    }
  }

  return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
}

function resolveHeartbeatReplyPayload(
  replyResult: ReplyPayload | ReplyPayload[] | undefined,
): ReplyPayload | undefined {
  if (!replyResult) {
    return undefined;
  }
  if (!Array.isArray(replyResult)) {
    return replyResult;
  }
  for (let idx = replyResult.length - 1; idx >= 0; idx -= 1) {
    const payload = replyResult[idx];
    if (!payload) {
      continue;
    }
    if (payload.text || payload.mediaUrl || (payload.mediaUrls && payload.mediaUrls.length > 0)) {
      return payload;
    }
  }
  return undefined;
}

function resolveHeartbeatReasoningPayloads(
  replyResult: ReplyPayload | ReplyPayload[] | undefined,
): ReplyPayload[] {
  const payloads = Array.isArray(replyResult) ? replyResult : replyResult ? [replyResult] : [];
  return payloads.filter((payload) => {
    const text = typeof payload.text === "string" ? payload.text : "";
    return text.trimStart().startsWith("Reasoning:");
  });
}

async function restoreHeartbeatUpdatedAt(params: {
  storePath: string;
  sessionKey: string;
  updatedAt?: number;
}) {
  const { storePath, sessionKey, updatedAt } = params;
  if (typeof updatedAt !== "number") {
    return;
  }
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  if (!entry) {
    return;
  }
  const nextUpdatedAt = Math.max(entry.updatedAt ?? 0, updatedAt);
  if (entry.updatedAt === nextUpdatedAt) {
    return;
  }
  await updateSessionStore(storePath, (nextStore) => {
    const nextEntry = nextStore[sessionKey] ?? entry;
    if (!nextEntry) {
      return;
    }
    const resolvedUpdatedAt = Math.max(nextEntry.updatedAt ?? 0, updatedAt);
    if (nextEntry.updatedAt === resolvedUpdatedAt) {
      return;
    }
    nextStore[sessionKey] = { ...nextEntry, updatedAt: resolvedUpdatedAt };
  });
}

function normalizeHeartbeatReply(
  payload: ReplyPayload,
  responsePrefix: string | undefined,
  ackMaxChars: number,
) {
  const stripped = stripHeartbeatToken(payload.text, {
    mode: "heartbeat",
    maxAckChars: ackMaxChars,
  });
  const hasMedia = Boolean(payload.mediaUrl || (payload.mediaUrls?.length ?? 0) > 0);
  if (stripped.shouldSkip && !hasMedia) {
    return {
      shouldSkip: true,
      text: "",
      hasMedia,
    };
  }
  let finalText = stripped.text;
  if (responsePrefix && finalText && !finalText.startsWith(responsePrefix)) {
    finalText = `${responsePrefix} ${finalText}`;
  }
  return { shouldSkip: false, text: finalText, hasMedia };
}

// ── Accountability Memory Persistence ──────────────────────────────────────

/**
 * Store heartbeat accountability results in MemU so the agent can learn from
 * past performance. Creates a memory item (type: "self", significance based on
 * outcome) and a reflection entry with lessons extracted from failures.
 *
 * This is the bridge between the external accountability system (ANGEL/RALF)
 * and the agent's subjective memory — she remembers what she did right and
 * wrong, and can recall those memories in future heartbeats.
 */
async function persistAccountabilityToMemory(
  verdicts: TaskVerdict[],
  taskMap: Map<string, { id: string; action: string; required: boolean }>,
  scoreState: ScoreState,
  pointsDelta: number,
): Promise<void> {
  try {
    const store = await getMemoryAdapter();

    const verified = verdicts.filter((v) => v.status === "verified");
    const failed = verdicts.filter((v) => v.status === "not_verified");
    const unclear = verdicts.filter((v) => v.status === "unclear");
    const score = scoreState.today.score;

    // Build a concise summary of what happened
    const summaryParts: string[] = [];
    summaryParts.push(
      `Heartbeat accountability check: ${verified.length} verified, ${failed.length} failed, ${unclear.length} unclear. Score: ${score} (${pointsDelta >= 0 ? "+" : ""}${pointsDelta}).`,
    );

    if (verified.length > 0) {
      const names = verified.map((v) => taskMap.get(v.taskId)?.action ?? v.taskId).join("; ");
      summaryParts.push(`Completed: ${names}.`);
    }

    if (failed.length > 0) {
      const details = failed
        .map((v) => {
          const task = taskMap.get(v.taskId);
          return `${task?.action ?? v.taskId} — ${v.reason}`;
        })
        .join("; ");
      summaryParts.push(`Failed: ${details}.`);
    }

    if (unclear.length > 0) {
      const names = unclear.map((v) => taskMap.get(v.taskId)?.action ?? v.taskId).join("; ");
      summaryParts.push(`Unclear: ${names}.`);
    }

    const summary = summaryParts.join(" ");

    // Determine significance based on outcome
    // Failures are more important to remember than routine successes
    let significance: "routine" | "noteworthy" | "important" | "core" = "routine";
    if (failed.length > 0 || pointsDelta < -10) {
      significance = "important"; // failures need to stick
    } else if (pointsDelta >= 15 || scoreState.today.targetReached) {
      significance = "noteworthy"; // good performance worth noting
    }

    // Emotional context — failures hurt, successes feel good
    const emotionalValence = failed.length > 0 ? -1.0 : pointsDelta > 0 ? 0.8 : 0;
    const emotionalArousal = failed.length > 0 ? 0.7 : pointsDelta >= 15 ? 0.5 : 0.2;

    // Extract lessons from failures
    const lessons = failed.map((v) => {
      const task = taskMap.get(v.taskId);
      return `Failed "${task?.action ?? v.taskId}": ${v.reason}`;
    });
    const lesson = lessons.length > 0 ? lessons.join(". ") : undefined;

    // Reflection text for self-improvement
    let reflection: string | undefined;
    if (failed.length > 0) {
      reflection =
        `I need to improve on: ${failed.map((v) => taskMap.get(v.taskId)?.action ?? v.taskId).join(", ")}. ` +
        `The verifier found these tasks were not completed properly. ` +
        `My score dropped by ${Math.abs(pointsDelta)} points.`;
    } else if (pointsDelta >= 15) {
      reflection = `Strong heartbeat — all tasks verified. Score improved by ${pointsDelta} points.`;
    }

    // Store as a "self" memory item — this is introspection about own performance
    const item = await store.createItem({
      memoryType: "self",
      summary,
      happenedAt: new Date().toISOString(),
      significance,
      emotionalValence,
      emotionalArousal,
      reflection,
      lesson,
      extra: {
        source: "heartbeat_accountability",
        verified: verified.length,
        failed: failed.length,
        unclear: unclear.length,
        score,
        pointsDelta,
        targetReached: scoreState.today.targetReached,
      },
    });

    // Link to "Accountability" category
    const category = await store.getOrCreateCategory(
      "Accountability",
      "Heartbeat verification results — what I did right and wrong",
    );
    await store.linkItemToCategory(item.id, category.id);

    // If there were failures, also create a structured reflection
    if (failed.length > 0) {
      await store.createReflection({
        triggerType: "heartbeat_accountability",
        content:
          `Heartbeat verification found ${failed.length} failed task(s). ` +
          `Details: ${failed.map((v) => `${taskMap.get(v.taskId)?.action ?? v.taskId} — ${v.reason}`).join("; ")}. ` +
          `Score impact: ${pointsDelta} points. Current score: ${score}.`,
        lessonsExtracted: lessons,
        selfInsights: [
          `${failed.length} task(s) failed verification this heartbeat`,
          ...(pointsDelta < -20 ? ["Significant score drop — need to be more thorough"] : []),
        ],
      });
    }

    log.info("accountability persisted to memory", {
      itemId: item.id,
      significance,
      hasReflection: failed.length > 0,
    });
  } catch (err) {
    // Non-fatal — don't let memory errors break heartbeat
    log.warn("failed to persist accountability to memory", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runHeartbeatOnce(opts: {
  cfg?: ArgentConfig;
  agentId?: string;
  heartbeat?: HeartbeatConfig;
  reason?: string;
  deps?: HeartbeatDeps;
}): Promise<HeartbeatRunResult> {
  const cfg = opts.cfg ?? loadConfig();
  const agentId = normalizeAgentId(opts.agentId ?? resolveDefaultAgentId(cfg));
  const heartbeat = opts.heartbeat ?? resolveHeartbeatConfig(cfg, agentId);
  if (!heartbeatsEnabled) {
    return { status: "skipped", reason: "disabled" };
  }
  if (!isHeartbeatEnabledForAgent(cfg, agentId)) {
    return { status: "skipped", reason: "disabled" };
  }
  if (!resolveHeartbeatIntervalMs(cfg, undefined, heartbeat)) {
    return { status: "skipped", reason: "disabled" };
  }

  const startedAt = opts.deps?.nowMs?.() ?? Date.now();
  if (!isWithinActiveHours(cfg, heartbeat, startedAt)) {
    return { status: "skipped", reason: "quiet-hours" };
  }

  const getLaneSize = opts.deps?.getQueueSize ?? getQueueSize;
  const queueSize = getLaneSize(CommandLane.Main) + getLaneSize(CommandLane.Interactive);
  if (queueSize > 0) {
    return { status: "skipped", reason: "requests-in-flight" };
  }

  // Skip heartbeat if HEARTBEAT.md exists but has no actionable content.
  // This saves API calls/costs when the file is effectively empty (only comments/headers).
  // EXCEPTION: Don't skip for exec events - they have pending system events to process.
  const isExecEventReason = opts.reason === "exec-event";
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const heartbeatFilePath = path.join(workspaceDir, DEFAULT_HEARTBEAT_FILENAME);
  try {
    const heartbeatFileContent = await fs.readFile(heartbeatFilePath, "utf-8");
    if (isHeartbeatContentEffectivelyEmpty(heartbeatFileContent) && !isExecEventReason) {
      emitHeartbeatEvent({
        status: "skipped",
        reason: "empty-heartbeat-file",
        durationMs: Date.now() - startedAt,
      });
      return { status: "skipped", reason: "empty-heartbeat-file" };
    }
  } catch {
    // File doesn't exist or can't be read - proceed with heartbeat.
    // The LLM prompt says "if it exists" so this is expected behavior.
  }

  const { entry, sessionKey, storePath } = resolveHeartbeatSession(cfg, agentId, heartbeat);
  const previousUpdatedAt = entry?.updatedAt;
  const delivery = resolveHeartbeatDeliveryTarget({ cfg, entry, heartbeat });
  const heartbeatAccountId = heartbeat?.accountId?.trim();
  if (delivery.reason === "unknown-account") {
    log.warn("heartbeat: unknown accountId", {
      accountId: delivery.accountId ?? heartbeatAccountId ?? null,
      target: heartbeat?.target ?? "last",
    });
  } else if (heartbeatAccountId) {
    log.info("heartbeat: using explicit accountId", {
      accountId: delivery.accountId ?? heartbeatAccountId,
      target: heartbeat?.target ?? "last",
      channel: delivery.channel,
    });
  }
  const visibility =
    delivery.channel !== "none"
      ? resolveHeartbeatVisibility({
          cfg,
          channel: delivery.channel,
          accountId: delivery.accountId,
        })
      : { showOk: false, showAlerts: true, useIndicator: true };
  const { sender } = resolveHeartbeatSenderContext({ cfg, entry, delivery });
  const responsePrefix = resolveEffectiveMessagesConfig(cfg, agentId, {
    channel: delivery.channel !== "none" ? delivery.channel : undefined,
    accountId: delivery.accountId,
  }).responsePrefix;

  // ── Contract System: load task contract + progress ──
  // If HEARTBEAT.md has a ## Tasks section, parse it into a structured contract.
  // The contract tasks are injected into the prompt so the agent knows what's expected.
  // After the agent responds, the verification sidecar audits the response.
  let contract: HeartbeatContract | null = null;
  let cycleProgress = await loadProgress(workspaceDir);
  let scoreState = await loadScoreState(workspaceDir);
  try {
    contract = await loadHeartbeatContract(heartbeatFilePath);
    if (contract) {
      cycleProgress = initCycleProgress(contract, cycleProgress);
      // Configure verifier model from config if specified
      const verifierModel = heartbeat?.verifier?.model;
      if (typeof verifierModel === "string" && verifierModel.trim()) {
        setVerifierModel(verifierModel.trim());
      }
    }
  } catch (err) {
    log.debug("heartbeat contract: load error (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Check if this is an exec event with pending exec completion system events.
  // If so, use a specialized prompt that instructs the model to relay the result
  // instead of the standard heartbeat prompt with "reply HEARTBEAT_OK".
  const isExecEvent = opts.reason === "exec-event";
  const pendingEvents = isExecEvent ? peekSystemEvents(sessionKey) : [];
  const hasExecCompletion = pendingEvents.some((evt) => evt.includes("Exec finished"));

  let prompt = hasExecCompletion ? EXEC_EVENT_PROMPT : resolveHeartbeatPrompt(cfg, heartbeat);

  // Inject contract tasks into the prompt (if any tasks are pending/retryable)
  if (contract && !hasExecCompletion) {
    const supplement = buildContractPromptSupplement(contract, cycleProgress);
    if (supplement) {
      prompt = `${prompt}\n\n${supplement}`;
    }

    // Inject accountability score — she sees this every heartbeat
    const scoreSection = buildScorePromptSection(scoreState);
    prompt = `${prompt}\n\n${scoreSection}`;

    // Inject last cycle feedback — detailed results with evidence (shown once, then cleared)
    const lastFeedback = await loadLastFeedback(workspaceDir);
    if (lastFeedback) {
      const feedbackSection = buildFeedbackPromptSection(lastFeedback);
      prompt = `${prompt}\n\n${feedbackSection}`;
      await clearLastFeedback(workspaceDir);
    }
  }

  const ctx = {
    Body: prompt,
    From: sender,
    To: sender,
    Provider: hasExecCompletion ? "exec-event" : "heartbeat",
    SessionKey: sessionKey,
  };
  if (!visibility.showAlerts && !visibility.showOk && !visibility.useIndicator) {
    emitHeartbeatEvent({
      status: "skipped",
      reason: "alerts-disabled",
      durationMs: Date.now() - startedAt,
      channel: delivery.channel !== "none" ? delivery.channel : undefined,
      accountId: delivery.accountId,
    });
    return { status: "skipped", reason: "alerts-disabled" };
  }

  const heartbeatOkText = responsePrefix ? `${responsePrefix} ${HEARTBEAT_TOKEN}` : HEARTBEAT_TOKEN;
  const canAttemptHeartbeatOk = Boolean(
    visibility.showOk && delivery.channel !== "none" && delivery.to,
  );
  const maybeSendHeartbeatOk = async () => {
    if (!canAttemptHeartbeatOk || delivery.channel === "none" || !delivery.to) {
      return false;
    }
    const heartbeatPlugin = getChannelPlugin(delivery.channel);
    if (heartbeatPlugin?.heartbeat?.checkReady) {
      const readiness = await heartbeatPlugin.heartbeat.checkReady({
        cfg,
        accountId: delivery.accountId,
        deps: opts.deps,
      });
      if (!readiness.ok) {
        return false;
      }
    }
    await deliverOutboundPayloads({
      cfg,
      channel: delivery.channel,
      to: delivery.to,
      accountId: delivery.accountId,
      payloads: [{ text: heartbeatOkText }],
      deps: opts.deps,
    });
    return true;
  };

  try {
    const heartbeatModelOverride = heartbeat?.model?.trim() || undefined;
    const replyOpts = heartbeatModelOverride
      ? { isHeartbeat: true, heartbeatModelOverride, lane: "background" as const }
      : { isHeartbeat: true, lane: "background" as const };
    const replyResult = await getReplyFromConfig(ctx, replyOpts, cfg);
    const replyPayload = resolveHeartbeatReplyPayload(replyResult);
    const includeReasoning = heartbeat?.includeReasoning === true;
    const reasoningPayloads = includeReasoning
      ? resolveHeartbeatReasoningPayloads(replyResult).filter((payload) => payload !== replyPayload)
      : [];

    // ── Contract Verification: run sidecar auditor ──
    // If we have a contract with tasks, verify the agent's response against it.
    // The verifier (local Ollama → Haiku fallback) checks whether each task was done.
    const verifierEnabled = heartbeat?.verifier?.enabled !== false; // on by default
    if (contract && replyPayload?.text && verifierEnabled) {
      try {
        // Collect ground truth from real APIs before verification
        const groundTruthReport = await collectGroundTruth({
          moltyverseEmailApiKey: resolveGroundTruthKey(cfg, "MOLTYVERSE_EMAIL_API_KEY"),
          moltyverseApiKey: resolveGroundTruthKey(cfg, "MOLTYVERSE_API_KEY"),
        });
        const groundTruthText = formatGroundTruthForVerifier(groundTruthReport);

        const verResult = await verifyHeartbeatResponse(
          contract,
          cycleProgress,
          replyPayload.text,
          groundTruthText || undefined,
        );
        if (verResult && verResult.verdicts.length > 0) {
          cycleProgress = applyVerdicts(cycleProgress, verResult.verdicts);
          await saveProgress(workspaceDir, cycleProgress);

          const verified = verResult.verdicts.filter((v) => v.status === "verified").length;
          const failed = verResult.verdicts.filter((v) => v.status === "not_verified").length;
          const unclear = verResult.verdicts.filter((v) => v.status === "unclear").length;

          // ── Accountability Score: record verdicts ──
          // Detect ground truth contradictions: if a task was "not_verified" and
          // ground truth had data for it, the agent fabricated a claim.
          const groundTruthTaskIds = new Set(groundTruthReport.checks.map((c) => c.taskId));
          const taskMap = new Map(contract.tasks.map((t) => [t.id, t]));
          const scoreVerdicts: VerdictInput[] = verResult.verdicts.map((v) => ({
            taskId: v.taskId,
            verdict: v.status,
            required: taskMap.get(v.taskId)?.required ?? true,
            groundTruthContradiction:
              v.status === "not_verified" && groundTruthTaskIds.has(v.taskId),
          }));
          const scoreResult = recordScoreVerdicts(scoreState, scoreVerdicts);
          scoreState = scoreResult.state;
          await saveScoreState(workspaceDir, scoreState);

          // ── Gollum Journal: structured heartbeat activity log ──
          try {
            const prevScore = scoreState.today.score - scoreResult.pointsDelta;
            appendJournalEntry(workspaceDir, {
              cycleNumber: 0,
              occurredAt: new Date().toISOString(),
              durationMs: Date.now() - startedAt,
              score: {
                before: prevScore,
                after: scoreState.today.score,
                delta: scoreResult.pointsDelta,
                target: computeDailyTarget(scoreState),
                targetReached: scoreState.today.targetReached,
              },
              verification: {
                model: verResult.model,
                verified,
                failed,
                unclear,
              },
              failures: verResult.verdicts
                .filter((v) => v.status === "not_verified")
                .map((v) => ({ taskId: v.taskId, reason: v.reason })),
            });
          } catch (journalErr) {
            log.warn("heartbeat journal write failed (non-fatal)", {
              error: journalErr instanceof Error ? journalErr.message : String(journalErr),
            });
          }

          // ── Persist to MemU: agent remembers what she did right/wrong ──
          await persistAccountabilityToMemory(
            verResult.verdicts,
            taskMap,
            scoreState,
            scoreResult.pointsDelta,
          );

          // ── Save structured feedback for next cycle's prompt injection ──
          const target = computeDailyTarget(scoreState);
          const recentPositive = scoreState.history.filter((d) => d.score > 0).slice(0, 7);
          const rollingAvg =
            recentPositive.length > 0
              ? Math.round(recentPositive.reduce((s, d) => s + d.score, 0) / recentPositive.length)
              : 0;
          const prevScore = scoreState.today.score - scoreResult.pointsDelta;
          const trend: "up" | "down" | "flat" =
            scoreResult.pointsDelta > 0 ? "up" : scoreResult.pointsDelta < 0 ? "down" : "flat";

          const cycleFeedback: CycleFeedback = {
            timestamp: new Date().toISOString(),
            verdicts: verResult.verdicts.map((v) => ({
              taskId: v.taskId,
              action: taskMap.get(v.taskId)?.action ?? v.taskId,
              required: taskMap.get(v.taskId)?.required ?? true,
              status: v.status,
              quality: v.quality,
              reason: v.reason,
              groundTruthContradiction:
                v.status === "not_verified" && groundTruthTaskIds.has(v.taskId),
            })),
            scoreAfter: scoreState.today.score,
            pointsDelta: scoreResult.pointsDelta,
            target,
            rollingAvg7d: rollingAvg,
            trend,
            targetReached: scoreState.today.targetReached,
            streak: scoreState.lifetime.currentStreak,
          };
          await saveLastFeedback(workspaceDir, cycleFeedback);

          // ── Side-channel alert: agent receives this on her next interaction ──
          // This is NOT shown in chat UI — it arrives as a system event that gets
          // prefixed to her next prompt (heartbeat or regular chat), like an SMS alert.
          const alertParts: string[] = [];
          alertParts.push(
            `Accountability: ${verified}✓ ${failed}✗ ${unclear}? | Score: ${scoreState.today.score} (${scoreResult.pointsDelta >= 0 ? "+" : ""}${scoreResult.pointsDelta})`,
          );
          if (failed > 0) {
            const qualityGated = verResult.verdicts.filter(
              (v) => v.quality === "shallow" && v.reason.startsWith("QUALITY GATE:"),
            );
            const otherFailed = verResult.verdicts.filter(
              (v) =>
                v.status === "not_verified" &&
                !(v.quality === "shallow" && v.reason.startsWith("QUALITY GATE:")),
            );
            if (otherFailed.length > 0) {
              const failedNames = otherFailed
                .map((v) => taskMap.get(v.taskId)?.action ?? v.taskId)
                .join(", ");
              alertParts.push(`Failed: ${failedNames}`);
            }
            if (qualityGated.length > 0) {
              const gatedNames = qualityGated
                .map((v) => taskMap.get(v.taskId)?.action ?? v.taskId)
                .join(", ");
              alertParts.push(`Quality gate (shallow output, redo with specifics): ${gatedNames}`);
            }
          }
          enqueueSystemEvent(alertParts.join(" | "), { sessionKey });

          log.info("heartbeat verification complete", {
            model: verResult.model,
            durationMs: verResult.durationMs,
            verified,
            failed,
            unclear,
            score: scoreState.today.score,
            scoreDelta: scoreResult.pointsDelta,
          });

          // Publish heartbeat result to Redis for dashboard and cross-agent visibility
          try {
            const { onHeartbeatCycleComplete } = await import("../data/redis-agent-state.js");
            void onHeartbeatCycleComplete({
              verified,
              failed,
              unclear,
              score: scoreState.today.score,
              pointsDelta: scoreResult.pointsDelta,
              trend,
            });
          } catch {
            /* Redis is optional */
          }
        } else if (contract.tasks.length > 0) {
          // No verifier available — save progress as-is (graceful degradation)
          await saveProgress(workspaceDir, cycleProgress);
        }
      } catch (verErr) {
        log.warn("heartbeat verification error (non-fatal)", {
          error: verErr instanceof Error ? verErr.message : String(verErr),
        });
        await saveProgress(workspaceDir, cycleProgress);
      }
    }

    if (
      !replyPayload ||
      (!replyPayload.text && !replyPayload.mediaUrl && !replyPayload.mediaUrls?.length)
    ) {
      await restoreHeartbeatUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      const okSent = await maybeSendHeartbeatOk();
      emitHeartbeatEvent({
        status: "ok-empty",
        reason: opts.reason,
        durationMs: Date.now() - startedAt,
        channel: delivery.channel !== "none" ? delivery.channel : undefined,
        accountId: delivery.accountId,
        silent: !okSent,
        indicatorType: visibility.useIndicator ? resolveIndicatorType("ok-empty") : undefined,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    const ackMaxChars = resolveHeartbeatAckMaxChars(cfg, heartbeat);
    const normalized = normalizeHeartbeatReply(replyPayload, responsePrefix, ackMaxChars);
    // For exec completion events, don't skip even if the response looks like HEARTBEAT_OK.
    // The model should be responding with exec results, not ack tokens.
    // Also, if normalized.text is empty due to token stripping but we have exec completion,
    // fall back to the original reply text.
    const execFallbackText =
      hasExecCompletion && !normalized.text.trim() && replyPayload.text?.trim()
        ? replyPayload.text.trim()
        : null;
    if (execFallbackText) {
      normalized.text = execFallbackText;
      normalized.shouldSkip = false;
    }
    const shouldSkipMain = normalized.shouldSkip && !normalized.hasMedia && !hasExecCompletion;
    if (shouldSkipMain && reasoningPayloads.length === 0) {
      await restoreHeartbeatUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      const okSent = await maybeSendHeartbeatOk();
      emitHeartbeatEvent({
        status: "ok-token",
        reason: opts.reason,
        durationMs: Date.now() - startedAt,
        channel: delivery.channel !== "none" ? delivery.channel : undefined,
        accountId: delivery.accountId,
        silent: !okSent,
        indicatorType: visibility.useIndicator ? resolveIndicatorType("ok-token") : undefined,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    const mediaUrls =
      replyPayload.mediaUrls ?? (replyPayload.mediaUrl ? [replyPayload.mediaUrl] : []);

    // Suppress duplicate heartbeats (same payload) within a short window.
    // This prevents "nagging" when nothing changed but the model repeats the same items.
    const prevHeartbeatText =
      typeof entry?.lastHeartbeatText === "string" ? entry.lastHeartbeatText : "";
    const prevHeartbeatAt =
      typeof entry?.lastHeartbeatSentAt === "number" ? entry.lastHeartbeatSentAt : undefined;
    const isDuplicateMain =
      !shouldSkipMain &&
      !mediaUrls.length &&
      Boolean(prevHeartbeatText.trim()) &&
      normalized.text.trim() === prevHeartbeatText.trim() &&
      typeof prevHeartbeatAt === "number" &&
      startedAt - prevHeartbeatAt < 24 * 60 * 60 * 1000;

    if (isDuplicateMain) {
      await restoreHeartbeatUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      emitHeartbeatEvent({
        status: "skipped",
        reason: "duplicate",
        preview: normalized.text.slice(0, 200),
        durationMs: Date.now() - startedAt,
        hasMedia: false,
        channel: delivery.channel !== "none" ? delivery.channel : undefined,
        accountId: delivery.accountId,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    // Reasoning payloads are text-only; any attachments stay on the main reply.
    const previewText = shouldSkipMain
      ? reasoningPayloads
          .map((payload) => payload.text)
          .filter((text): text is string => Boolean(text?.trim()))
          .join("\n")
      : normalized.text;

    if (delivery.channel === "none" || !delivery.to) {
      emitHeartbeatEvent({
        status: "skipped",
        reason: delivery.reason ?? "no-target",
        preview: previewText?.slice(0, 200),
        durationMs: Date.now() - startedAt,
        hasMedia: mediaUrls.length > 0,
        accountId: delivery.accountId,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    if (!visibility.showAlerts) {
      await restoreHeartbeatUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      emitHeartbeatEvent({
        status: "skipped",
        reason: "alerts-disabled",
        preview: previewText?.slice(0, 200),
        durationMs: Date.now() - startedAt,
        channel: delivery.channel,
        hasMedia: mediaUrls.length > 0,
        accountId: delivery.accountId,
        indicatorType: visibility.useIndicator ? resolveIndicatorType("sent") : undefined,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    const deliveryAccountId = delivery.accountId;
    const heartbeatPlugin = getChannelPlugin(delivery.channel);
    if (heartbeatPlugin?.heartbeat?.checkReady) {
      const readiness = await heartbeatPlugin.heartbeat.checkReady({
        cfg,
        accountId: deliveryAccountId,
        deps: opts.deps,
      });
      if (!readiness.ok) {
        emitHeartbeatEvent({
          status: "skipped",
          reason: readiness.reason,
          preview: previewText?.slice(0, 200),
          durationMs: Date.now() - startedAt,
          hasMedia: mediaUrls.length > 0,
          channel: delivery.channel,
          accountId: delivery.accountId,
        });
        log.info("heartbeat: channel not ready", {
          channel: delivery.channel,
          reason: readiness.reason,
        });
        return { status: "skipped", reason: readiness.reason };
      }
    }

    await deliverOutboundPayloads({
      cfg,
      channel: delivery.channel,
      to: delivery.to,
      accountId: deliveryAccountId,
      payloads: [
        ...reasoningPayloads,
        ...(shouldSkipMain
          ? []
          : [
              {
                text: normalized.text,
                mediaUrls,
              },
            ]),
      ],
      deps: opts.deps,
    });

    // Record last delivered heartbeat payload for dedupe.
    if (!shouldSkipMain && normalized.text.trim()) {
      const store = loadSessionStore(storePath);
      const current = store[sessionKey];
      if (current) {
        store[sessionKey] = {
          ...current,
          lastHeartbeatText: normalized.text,
          lastHeartbeatSentAt: startedAt,
        };
        await saveSessionStore(storePath, store);
      }
    }

    emitHeartbeatEvent({
      status: "sent",
      to: delivery.to,
      preview: previewText?.slice(0, 200),
      durationMs: Date.now() - startedAt,
      hasMedia: mediaUrls.length > 0,
      channel: delivery.channel,
      accountId: delivery.accountId,
      indicatorType: visibility.useIndicator ? resolveIndicatorType("sent") : undefined,
    });

    // ── Contemplation Wakeup: forward significant heartbeat output to dashboard ──
    // Check for wakeup markers or high-significance content
    const heartbeatText = normalized.text;
    const hasWakeup = /\[WAKEUP:true\]/i.test(heartbeatText);
    const hasHighSignificance = /\[SIGNIFICANCE:high\]/i.test(heartbeatText);
    const hasInsight =
      /\b(?:I think|I found|I noticed|I realized|proposal:|insight:|update:)/i.test(heartbeatText);
    if (hasWakeup || hasHighSignificance || hasInsight) {
      try {
        const dashboardPort = cfg.dashboard?.apiPort ?? 9242;
        const wakeupUrl = `http://127.0.0.1:${dashboardPort}/api/contemplation/wakeup`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        await fetch(wakeupUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: heartbeatText,
            source: "heartbeat",
            significance: hasHighSignificance ? "high" : "normal",
          }),
          signal: controller.signal,
        }).catch(() => {});
        clearTimeout(timeout);
      } catch {
        // Dashboard not running — non-fatal
      }
    }

    return { status: "ran", durationMs: Date.now() - startedAt };
  } catch (err) {
    const reason = formatErrorMessage(err);
    emitHeartbeatEvent({
      status: "failed",
      reason,
      durationMs: Date.now() - startedAt,
      channel: delivery.channel !== "none" ? delivery.channel : undefined,
      accountId: delivery.accountId,
      indicatorType: visibility.useIndicator ? resolveIndicatorType("failed") : undefined,
    });
    log.error(`heartbeat failed: ${reason}`, { error: reason });
    return { status: "failed", reason };
  }
}

export function startHeartbeatRunner(opts: {
  cfg?: ArgentConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  runOnce?: typeof runHeartbeatOnce;
}): HeartbeatRunner {
  const runtime = opts.runtime ?? defaultRuntime;
  const runOnce = opts.runOnce ?? runHeartbeatOnce;
  const state = {
    cfg: opts.cfg ?? loadConfig(),
    runtime,
    agents: new Map<string, HeartbeatAgentState>(),
    timer: null as NodeJS.Timeout | null,
    stopped: false,
  };
  let initialized = false;

  const resolveNextDue = (now: number, intervalMs: number, prevState?: HeartbeatAgentState) => {
    if (typeof prevState?.lastRunMs === "number") {
      return prevState.lastRunMs + intervalMs;
    }
    if (prevState && prevState.intervalMs === intervalMs && prevState.nextDueMs > now) {
      return prevState.nextDueMs;
    }
    return now + intervalMs;
  };

  const scheduleNext = () => {
    if (state.stopped) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.agents.size === 0) {
      return;
    }
    const now = Date.now();
    let nextDue = Number.POSITIVE_INFINITY;
    for (const agent of state.agents.values()) {
      if (agent.nextDueMs < nextDue) {
        nextDue = agent.nextDueMs;
      }
    }
    if (!Number.isFinite(nextDue)) {
      return;
    }
    const delay = Math.max(0, nextDue - now);
    state.timer = setTimeout(() => {
      requestHeartbeatNow({ reason: "interval", coalesceMs: 0 });
    }, delay);
    state.timer.unref?.();
  };

  const updateConfig = (cfg: ArgentConfig) => {
    if (state.stopped) {
      return;
    }
    const now = Date.now();
    const prevAgents = state.agents;
    const prevEnabled = prevAgents.size > 0;
    const nextAgents = new Map<string, HeartbeatAgentState>();
    const intervals: number[] = [];
    for (const agent of resolveHeartbeatAgents(cfg)) {
      const intervalMs = resolveHeartbeatIntervalMs(cfg, undefined, agent.heartbeat);
      if (!intervalMs) {
        continue;
      }
      intervals.push(intervalMs);
      const prevState = prevAgents.get(agent.agentId);
      const nextDueMs = resolveNextDue(now, intervalMs, prevState);
      nextAgents.set(agent.agentId, {
        agentId: agent.agentId,
        heartbeat: agent.heartbeat,
        intervalMs,
        lastRunMs: prevState?.lastRunMs,
        nextDueMs,
      });
    }

    state.cfg = cfg;
    state.agents = nextAgents;
    const nextEnabled = nextAgents.size > 0;
    if (!initialized) {
      if (!nextEnabled) {
        log.info("heartbeat: disabled", { enabled: false });
      } else {
        log.info("heartbeat: started", { intervalMs: Math.min(...intervals) });
      }
      initialized = true;
    } else if (prevEnabled !== nextEnabled) {
      if (!nextEnabled) {
        log.info("heartbeat: disabled", { enabled: false });
      } else {
        log.info("heartbeat: started", { intervalMs: Math.min(...intervals) });
      }
    }

    scheduleNext();
  };

  const run: HeartbeatWakeHandler = async (params) => {
    if (!heartbeatsEnabled) {
      return {
        status: "skipped",
        reason: "disabled",
      } satisfies HeartbeatRunResult;
    }
    if (state.agents.size === 0) {
      return {
        status: "skipped",
        reason: "disabled",
      } satisfies HeartbeatRunResult;
    }

    const reason = params?.reason;
    const isInterval = reason === "interval";
    const startedAt = Date.now();
    const now = startedAt;
    let ran = false;

    for (const agent of state.agents.values()) {
      if (isInterval && now < agent.nextDueMs) {
        continue;
      }

      const res = await runOnce({
        cfg: state.cfg,
        agentId: agent.agentId,
        heartbeat: agent.heartbeat,
        reason,
        deps: { runtime: state.runtime },
      });
      if (res.status === "skipped" && res.reason === "requests-in-flight") {
        return res;
      }
      if (res.status !== "skipped" || res.reason !== "disabled") {
        agent.lastRunMs = now;
        agent.nextDueMs = now + agent.intervalMs;
      }
      if (res.status === "ran") {
        ran = true;
      }
    }

    scheduleNext();
    if (ran) {
      return { status: "ran", durationMs: Date.now() - startedAt };
    }
    return { status: "skipped", reason: isInterval ? "not-due" : "disabled" };
  };

  setHeartbeatWakeHandler(async (params) => run({ reason: params.reason }));
  updateConfig(state.cfg);

  const cleanup = () => {
    state.stopped = true;
    setHeartbeatWakeHandler(null);
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = null;
  };

  opts.abortSignal?.addEventListener("abort", cleanup, { once: true });

  return { stop: cleanup, updateConfig };
}
