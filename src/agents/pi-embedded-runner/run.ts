import fs from "node:fs/promises";
import type { ThinkLevel } from "../../auto-reply/thinking.js";
import type { RunEmbeddedPiAgentParams } from "./run/params.js";
import type { EmbeddedPiAgentMeta, EmbeddedPiRunResult } from "./types.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import { getMemoryAdapter } from "../../data/storage-factory.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { sleepWithAbort } from "../../infra/backoff.js";
import { recordConsciousnessKernelConversationTurn } from "../../infra/consciousness-kernel.js";
import { runSelfEvaluation } from "../../infra/sis-self-eval.js";
import { routeModel } from "../../models/router.js";
import { enqueueCommandInLane } from "../../process/command-queue.js";
import { resolveUserPath } from "../../utils.js";
import { isMarkdownCapableMessageChannel } from "../../utils/message-channel.js";
import { resolveArgentAgentDir } from "../agent-paths.js";
import { resolveSessionAgentIds } from "../agent-scope.js";
import {
  clearExpiredCooldowns,
  isProviderInCooldown,
  isProfileInCooldown,
  markAuthProfileFailure,
  markAuthProfileGood,
  markAuthProfileUsed,
} from "../auth-profiles.js";
import { persistCommitmentMemory } from "../commitment-memory.js";
import {
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
  evaluateContextWindowGuard,
  resolveContextWindowInfo,
} from "../context-window-guard.js";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_MODEL, DEFAULT_PROVIDER } from "../defaults.js";
import { FailoverError, resolveFailoverStatus, resolveRetryAfterMs } from "../failover-error.js";
import { resolveEffectiveIntentForAgent } from "../intent.js";
import {
  ensureAuthProfileStore,
  getApiKeyForModel,
  resolveAuthProfileOrder,
  type ResolvedProviderAuth,
} from "../model-auth.js";
import { normalizeProviderId, selectionDiffersFromConfiguredPrimary } from "../model-selection.js";
import { ensureArgentModelsJson } from "../models-config.js";
import {
  classifyFailoverReason,
  formatAssistantErrorText,
  isAuthAssistantError,
  isCompactionFailureError,
  isContextOverflowError,
  isFailoverAssistantError,
  isFailoverErrorMessage,
  isLikelyContextOverflowError,
  isModelUnavailableErrorMessage,
  parseImageSizeError,
  parseImageDimensionError,
  isRateLimitAssistantError,
  isRateLimitErrorMessage,
  isTimeoutErrorMessage,
  pickFallbackThinkingLevel,
  type FailoverReason,
} from "../pi-embedded-helpers.js";
import { validateToolClaims } from "../tool-claim-validation.js";
import { normalizeUsage, type UsageLike } from "../usage.js";
import { compactEmbeddedPiSessionDirect } from "./compact.js";
import { resolveGlobalLane, resolveSessionLane } from "./lanes.js";
import { log } from "./logger.js";
import { resolveModel } from "./model.js";
import { runEmbeddedAttempt } from "./run/attempt.js";
import { buildEmbeddedRunPayloads } from "./run/payloads.js";
import { inferSessionChannelFromKey } from "./run/session-context.js";
import {
  buildSupportQualityGuardrailText,
  type SupportQualityValidation,
  validateSupportReplyQuality,
} from "./run/support-quality.js";
import { describeUnknownError } from "./utils.js";

type ApiKeyInfo = ResolvedProviderAuth;

// Avoid Anthropic's refusal test token poisoning session transcripts.
const ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL = "ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL";
const ANTHROPIC_MAGIC_STRING_REPLACEMENT = "ANTHROPIC MAGIC STRING TRIGGER REFUSAL (redacted)";
const LONG_RETRY_AFTER_THRESHOLD_MS = 60_000;
const IMAGE_INPUT_TOKEN_BUDGET = 1_200;
const MAX_MODEL_OVERLOAD_RETRIES = 1;
const OVERLOAD_RETRY_BASE_DELAY_MS = 350;
const DEFAULT_OVERLOADED_MODEL_QUARANTINE_MS = 45_000;
const MIN_OVERLOADED_MODEL_QUARANTINE_MS = 1_000;
const MAX_OVERLOADED_MODEL_QUARANTINE_MS = 10 * 60_000;
const DEFAULT_UNAVAILABLE_MODEL_QUARANTINE_MS = 24 * 60 * 60_000;
const MIN_UNAVAILABLE_MODEL_QUARANTINE_MS = 60_000;
const MAX_UNAVAILABLE_MODEL_QUARANTINE_MS = 7 * 24 * 60 * 60_000;
// Allow one extra retry to recover from transient "tool call as plain text" outputs.
const MAX_TOOL_CLAIM_RETRIES = 2;
const MAX_TOOL_CLAIM_EMERGENCY_RETRIES = 1;
const MAX_SUPPORT_QUALITY_RETRIES = 1;
const STRUCTURED_BROWSER_JSON_SNIPPET_RE =
  /\{[\s\S]{0,1200}?"action"\s*:\s*"(?:act|open|navigate|focus|close|snapshot|screenshot|tabs|status|start|stop|console|pdf|upload|dialog)"[\s\S]{0,1200}?"request"\s*:\s*\{[\s\S]{0,400}?"kind"\s*:\s*"(?:click|type|press|hover|wait|evaluate|fill|select|navigate|scroll|upload|dialog|close|open|snapshot|screenshot)"[\s\S]{0,400}?\}[\s\S]{0,400}?\}/i;
const STRUCTURED_ACTION_JSON_SNIPPET_RE =
  /\{[\s\S]{0,1400}?"action"\s*:\s*"[a-z0-9_.-]{2,80}"[\s\S]{0,1400}?\}/i;
const overloadedModelQuarantineUntil = new Map<string, number>();
const unavailableModelQuarantineUntil = new Map<string, number>();

function resolveOverloadedModelQuarantineMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ARGENT_MODEL_OVERLOAD_QUARANTINE_MS?.trim();
  if (!raw) {
    return DEFAULT_OVERLOADED_MODEL_QUARANTINE_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_OVERLOADED_MODEL_QUARANTINE_MS;
  }
  return Math.max(
    MIN_OVERLOADED_MODEL_QUARANTINE_MS,
    Math.min(MAX_OVERLOADED_MODEL_QUARANTINE_MS, Math.floor(parsed)),
  );
}

function modelQuarantineKey(provider: string, modelId: string): string {
  return `${normalizeProviderId(provider)}/${modelId.trim().toLowerCase()}`;
}

function resolveUnavailableModelQuarantineMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ARGENT_MODEL_UNAVAILABLE_QUARANTINE_MS?.trim();
  if (!raw) {
    return DEFAULT_UNAVAILABLE_MODEL_QUARANTINE_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_UNAVAILABLE_MODEL_QUARANTINE_MS;
  }
  return Math.max(
    MIN_UNAVAILABLE_MODEL_QUARANTINE_MS,
    Math.min(MAX_UNAVAILABLE_MODEL_QUARANTINE_MS, Math.floor(parsed)),
  );
}

function clearExpiredOverloadedModelQuarantines(now = Date.now()): void {
  for (const [key, until] of overloadedModelQuarantineUntil.entries()) {
    if (!Number.isFinite(until) || until <= now) {
      overloadedModelQuarantineUntil.delete(key);
    }
  }
}

function clearExpiredUnavailableModelQuarantines(now = Date.now()): void {
  for (const [key, until] of unavailableModelQuarantineUntil.entries()) {
    if (!Number.isFinite(until) || until <= now) {
      unavailableModelQuarantineUntil.delete(key);
    }
  }
}

function getOverloadedModelQuarantineUntil(provider: string, modelId: string): number | null {
  clearExpiredOverloadedModelQuarantines();
  const until = overloadedModelQuarantineUntil.get(modelQuarantineKey(provider, modelId));
  if (!until || until <= Date.now()) {
    return null;
  }
  return until;
}

function getUnavailableModelQuarantineUntil(provider: string, modelId: string): number | null {
  clearExpiredUnavailableModelQuarantines();
  const until = unavailableModelQuarantineUntil.get(modelQuarantineKey(provider, modelId));
  if (!until || until <= Date.now()) {
    return null;
  }
  return until;
}

function markOverloadedModelQuarantine(
  provider: string,
  modelId: string,
  now = Date.now(),
): number {
  const quarantineMs = resolveOverloadedModelQuarantineMs(process.env);
  const key = modelQuarantineKey(provider, modelId);
  const nextUntil = now + quarantineMs;
  const existingUntil = overloadedModelQuarantineUntil.get(key) ?? 0;
  if (nextUntil > existingUntil) {
    overloadedModelQuarantineUntil.set(key, nextUntil);
    return nextUntil;
  }
  return existingUntil;
}

function markUnavailableModelQuarantine(
  provider: string,
  modelId: string,
  now = Date.now(),
): number {
  const quarantineMs = resolveUnavailableModelQuarantineMs(process.env);
  const key = modelQuarantineKey(provider, modelId);
  const nextUntil = now + quarantineMs;
  const existingUntil = unavailableModelQuarantineUntil.get(key) ?? 0;
  if (nextUntil > existingUntil) {
    unavailableModelQuarantineUntil.set(key, nextUntil);
    return nextUntil;
  }
  return existingUntil;
}

function formatMissingToolClaims(claims: string[]): string {
  return claims.map((claim) => (claim === "tool_json" ? "raw tool action JSON" : claim)).join(", ");
}

type CommitmentValidation = ReturnType<typeof validateToolClaims>;

function hasCommitmentMismatch(validation: CommitmentValidation): boolean {
  return validation.missingClaims.length > 0 || validation.missingCommitments.length > 0;
}

function hasHighConfidenceCommitmentMismatch(validation: CommitmentValidation): boolean {
  return (
    validation.highConfidenceMissingClaims.length > 0 ||
    validation.highConfidenceMissingCommitments.length > 0
  );
}

function formatMissingValidationClaims(validation: CommitmentValidation): string {
  if (validation.missingClaimLabels.length > 0) {
    return formatMissingToolClaims(validation.missingClaimLabels);
  }
  return formatMissingToolClaims(validation.missingClaims);
}

function buildCommitmentGuardrailText(validation: CommitmentValidation): string {
  const missingClaims = formatMissingValidationClaims(validation);
  const needsQuestions = validation.missingCommitments.some(
    (commitment) => commitment.satisfactionMode === "questions",
  );
  return (
    "[TOOL_EXECUTION_GUARDRAIL]\n" +
    `Your previous response made a same-turn action claim (${missingClaims}) without completing it.\n` +
    (validation.primaryClaimText ? `Claim text: ${validation.primaryClaimText}\n` : "") +
    "Retry this request now. If you say you are doing something, execute the tool or create the artifact first.\n" +
    (needsQuestions
      ? "If clarification is required, ask the concrete questions in the same reply.\n"
      : "") +
    "Do not simulate tool activity in plain text.\n" +
    "[/TOOL_EXECUTION_GUARDRAIL]"
  );
}

function resolveCommitmentClaimText(validation: CommitmentValidation): string {
  if (validation.primaryClaimText?.trim()) {
    return validation.primaryClaimText.trim();
  }
  if (validation.missingClaimLabels.length > 0) {
    return validation.missingClaimLabels.join(", ");
  }
  if (validation.claimedTools.length > 0) {
    return validation.claimedTools.join(", ");
  }
  return "unspecified same-turn commitment";
}

function scrubAnthropicRefusalMagic(prompt: string): string {
  if (!prompt.includes(ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL)) {
    return prompt;
  }
  return prompt.replaceAll(
    ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL,
    ANTHROPIC_MAGIC_STRING_REPLACEMENT,
  );
}

function estimatePromptTokens(input: string): number {
  const text = input.trim();
  if (!text) {
    return 0;
  }
  // Cheap heuristic good enough for overflow diagnostics.
  return Math.ceil(text.length / 3.5);
}

function extractStructuredToolJsonSnippet(responseText: string): string | undefined {
  const match =
    STRUCTURED_BROWSER_JSON_SNIPPET_RE.exec(responseText) ??
    STRUCTURED_ACTION_JSON_SNIPPET_RE.exec(responseText);
  if (!match?.[0]) {
    return undefined;
  }
  const snippet = match[0].trim();
  if (!snippet) {
    return undefined;
  }
  if (snippet.length <= 1_200) {
    return snippet;
  }
  return `${snippet.slice(0, 1_200)}…`;
}

function resolveOpenAiCodexFallbackCandidates(modelId: string): string[] {
  if (modelId === "gpt-5.3-codex-spark") {
    return ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.2"];
  }
  if (modelId === "gpt-5.3-codex") {
    return ["gpt-5.2-codex", "gpt-5.2"];
  }
  if (/-spark$/i.test(modelId)) {
    return [modelId.replace(/-spark$/i, "")];
  }
  return [];
}

function pickNextOpenAiCodexFallbackModel(params: {
  provider: string;
  modelId: string;
  tried: Set<string>;
}): string | undefined {
  if (normalizeProviderId(params.provider) !== "openai-codex") {
    return undefined;
  }
  const candidates = resolveOpenAiCodexFallbackCandidates(params.modelId);
  return candidates.find(
    (candidate) => candidate !== params.modelId && !params.tried.has(candidate),
  );
}

export async function runEmbeddedPiAgent(
  params: RunEmbeddedPiAgentParams,
): Promise<EmbeddedPiRunResult> {
  const sessionLane = resolveSessionLane(params.sessionKey?.trim() || params.sessionId);
  const globalLane = resolveGlobalLane(params.lane);
  const isPriority = params.priority === true;
  const enqueueGlobal =
    params.enqueue ??
    ((task, opts) => enqueueCommandInLane(globalLane, task, { ...opts, priority: isPriority }));
  const enqueueSession =
    params.enqueue ??
    ((task, opts) => enqueueCommandInLane(sessionLane, task, { ...opts, priority: isPriority }));
  const channelHint = params.messageChannel ?? params.messageProvider;
  const resolvedToolResultFormat =
    params.toolResultFormat ??
    (channelHint
      ? isMarkdownCapableMessageChannel(channelHint)
        ? "markdown"
        : "plain"
      : "markdown");
  const isProbeSession = params.sessionId?.startsWith("probe-") ?? false;

  return enqueueSession(() =>
    enqueueGlobal(async () => {
      const started = Date.now();
      const resolvedWorkspace = resolveUserPath(params.workspaceDir);
      const prevCwd = process.cwd();

      const rawProvider = (params.provider ?? DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
      const rawModelId = (params.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
      clearExpiredOverloadedModelQuarantines();
      const agentDir = params.agentDir ?? resolveArgentAgentDir();
      const fallbackConfigured =
        (params.config?.agents?.defaults?.model?.fallbacks?.length ?? 0) > 0;
      await ensureArgentModelsJson(params.config, agentDir);

      // Model Router: route to cheapest capable model based on complexity
      const routerConfig = params.config?.agents?.defaults?.modelRouter;
      // Only treat as a user override if the model was explicitly changed
      // from config defaults (e.g., via /model command or API param).
      // The gateway always passes config defaults as params, so we compare.
      const configPrimary = params.config?.agents?.defaults?.model?.primary;
      const hasProvidedSelection =
        (params.provider?.trim().length ?? 0) > 0 || (params.model?.trim().length ?? 0) > 0;
      const isExplicitOverride =
        params.respectProvidedModel && hasProvidedSelection
          ? true
          : params.provider !== undefined || params.model !== undefined
            ? selectionDiffersFromConfiguredPrimary({
                configPrimary,
                provider: params.provider,
                model: params.model,
                defaultProvider: rawProvider,
                defaultModel: rawModelId,
              })
            : false;
      // Detect and strip active tool/mode from prompt markers.
      // Markers are prepended by the dashboard and preserved by the gateway
      // before timestamp injection, so they appear at the front:
      //   [DEEP_THINK] [APP_FORGE] [Mon 2026-02-17 11:20 CST] actual prompt
      let promptText = params.prompt ?? "";
      let forceMaxTier = false;
      let deepResearchMode = false;
      let detectedToolName: string | undefined;
      const MARKER_RE = /^\[(?:DEEP_THINK|DEEP_RESEARCH|APP_FORGE|AUDIO_ENABLED)\]\s*/;
      let mm: RegExpMatchArray | null;
      while ((mm = MARKER_RE.exec(promptText)) !== null) {
        const tag = mm[0].trim().slice(1, -1); // e.g. "DEEP_THINK"
        if (tag === "DEEP_THINK") {
          forceMaxTier = true;
        }
        if (tag === "DEEP_RESEARCH") {
          deepResearchMode = true;
        }
        if (tag === "APP_FORGE") {
          detectedToolName = "apps";
        }
        promptText = promptText.slice(mm[0].length);
      }
      const basePromptText = promptText;
      let toolClaimRetryCount = 0;
      let toolClaimEmergencyRetryCount = 0;
      let commitmentRepairCount = 0;
      let sawCommitmentMismatch = false;
      let firstCommitmentMismatchAt: number | undefined;
      let lastCommitmentMismatchValidation: CommitmentValidation | undefined;
      let supportQualityRetryCount = 0;
      let lastSupportQualityValidation: SupportQualityValidation | undefined;
      const resolvedSupportIntent = (() => {
        if (!params.config) {
          return null;
        }
        const { sessionAgentId } = resolveSessionAgentIds({
          sessionKey: params.sessionKey,
          config: params.config,
        });
        const resolvedIntent = resolveEffectiveIntentForAgent({
          config: params.config,
          agentId: sessionAgentId,
        });
        const departmentId = resolvedIntent?.departmentId?.trim().toLowerCase();
        const isSupportDepartment =
          departmentId === "support" || Boolean(departmentId?.startsWith("support-"));
        return {
          agentId: sessionAgentId,
          departmentId: resolvedIntent?.departmentId,
          runtimeMode: resolvedIntent?.runtimeMode ?? "off",
          enabled: isSupportDepartment,
        };
      })();
      const supportQualityEnabled = resolvedSupportIntent?.enabled === true;
      const supportQualityEnforce =
        supportQualityEnabled && resolvedSupportIntent.runtimeMode === "enforce";
      const supportQualityWarnOnly =
        supportQualityEnabled &&
        (resolvedSupportIntent.runtimeMode === "advisory" ||
          resolvedSupportIntent.runtimeMode === "enforce");
      const effectiveThinkingLevel = params.thinkLevel ?? (forceMaxTier ? "xhigh" : undefined);
      const searchBudgetInstruction = deepResearchMode
        ? "Research mode is ON. For web_search in this run, target up to 20 search calls total and up to 20 results per call unless lower is sufficient."
        : "Research mode is OFF (normal). For web_search in this run, target up to 10 search calls total and up to 10 results per call unless lower is sufficient.";
      const effectiveExtraSystemPrompt = [params.extraSystemPrompt, searchBudgetInstruction]
        .filter((part) => typeof part === "string" && part.trim().length > 0)
        .join("\n\n");
      const isSisSession =
        params.messageChannel === "sis" || params.sessionKey?.includes("sis") === true;
      const effectiveRouterConfig =
        isSisSession && routerConfig ? { ...routerConfig, enabled: false } : routerConfig;
      const routing = routeModel({
        signals: {
          prompt: promptText,
          thinkingLevel: effectiveThinkingLevel,
          hasImages: (params.images?.length ?? 0) > 0,
          sessionType: isProbeSession
            ? "heartbeat"
            : params.sessionKey?.includes("heartbeat")
              ? "heartbeat"
              : params.sessionKey?.includes("contemplation")
                ? "contemplation"
                : params.sessionKey?.includes("sub-")
                  ? "subagent"
                  : "main",
          hasHistory: !!(params.sessionId || params.sessionKey),
          toolName: detectedToolName,
          forceMaxTier,
        },
        config: effectiveRouterConfig,
        requestedProvider: isExplicitOverride ? params.provider : undefined,
        requestedModel: isExplicitOverride ? params.model : undefined,
        defaultProvider: rawProvider,
        defaultModel: rawModelId,
      });

      let provider = routing.provider;
      let modelId = routing.model;

      log.info(
        `[model-router] ${routing.routed ? "ROUTED" : "PASSTHROUGH"} tier=${routing.tier} → ${provider}/${modelId} score=${routing.score.toFixed(2)} reason="${routing.reason}" configPresent=${!!routerConfig} enabled=${routerConfig?.enabled}`,
      );

      let { model, error, authStorage, modelRegistry } = resolveModel(
        provider,
        modelId,
        agentDir,
        params.config,
      );
      // Graceful fallback: if the routed model can't be resolved, fall back to default
      if (!model && routing.routed) {
        log.warn(
          `[model-router] Routed model ${provider}/${modelId} not resolvable (${error}), falling back to ${rawProvider}/${rawModelId}`,
        );
        provider = rawProvider;
        modelId = rawModelId;
        ({ model, error, authStorage, modelRegistry } = resolveModel(
          provider,
          modelId,
          agentDir,
          params.config,
        ));
      }
      if (!model) {
        throw new Error(error ?? `Unknown model: ${provider}/${modelId}`);
      }
      const unavailableUntil = getUnavailableModelQuarantineUntil(provider, modelId);
      if (unavailableUntil) {
        const remainingMs = Math.max(0, unavailableUntil - Date.now());
        const retryInSec = (remainingMs / 1000).toFixed(1);
        log.warn(
          `Model ${provider}/${modelId} is quarantined as unavailable. Skipping immediate retry for ${retryInSec}s.`,
        );
        throw new FailoverError(
          `Model ${provider}/${modelId} is unavailable or retired. Retry in ~${retryInSec}s or use a fallback model.`,
          {
            reason: "overloaded",
            provider,
            model: modelId,
            status: resolveFailoverStatus("overloaded"),
          },
        );
      }

      const overloadedUntil = getOverloadedModelQuarantineUntil(provider, modelId);
      if (overloadedUntil) {
        const remainingMs = Math.max(0, overloadedUntil - Date.now());
        const retryInSec = (remainingMs / 1000).toFixed(1);
        log.warn(
          `Model ${provider}/${modelId} is temporarily quarantined after overload. Skipping immediate retry for ${retryInSec}s.`,
        );
        throw new FailoverError(
          `Model ${provider}/${modelId} is temporarily overloaded. Retry in ~${retryInSec}s or use a fallback model.`,
          {
            reason: "overloaded",
            provider,
            model: modelId,
            status: resolveFailoverStatus("overloaded"),
          },
        );
      }

      // Emit model selection event so the dashboard can show which model is handling the request
      emitAgentEvent({
        runId: params.runId,
        stream: "lifecycle",
        data: {
          phase: "model_selected",
          provider,
          model: modelId,
          tier: routing.tier,
          score: routing.score,
          routed: routing.routed,
        },
      });

      const ctxInfo = resolveContextWindowInfo({
        cfg: params.config,
        provider,
        modelId,
        modelContextWindow: model.contextWindow,
        defaultTokens: DEFAULT_CONTEXT_TOKENS,
      });
      const ctxGuard = evaluateContextWindowGuard({
        info: ctxInfo,
        warnBelowTokens: CONTEXT_WINDOW_WARN_BELOW_TOKENS,
        hardMinTokens: CONTEXT_WINDOW_HARD_MIN_TOKENS,
      });
      const estimatedPromptTokens =
        estimatePromptTokens(params.prompt) +
        (params.images?.length ?? 0) * IMAGE_INPUT_TOKEN_BUDGET;
      if (ctxGuard.shouldWarn) {
        log.warn(
          `low context window: ${provider}/${modelId} ctx=${ctxGuard.tokens} (warn<${CONTEXT_WINDOW_WARN_BELOW_TOKENS}) source=${ctxGuard.source}`,
        );
      }
      if (ctxGuard.shouldBlock) {
        log.error(
          `blocked model (context window too small): ${provider}/${modelId} ctx=${ctxGuard.tokens} (min=${CONTEXT_WINDOW_HARD_MIN_TOKENS}) source=${ctxGuard.source}`,
        );
        throw new FailoverError(
          `Model context window too small (${ctxGuard.tokens} tokens). Minimum is ${CONTEXT_WINDOW_HARD_MIN_TOKENS}.`,
          { reason: "unknown", provider, model: modelId },
        );
      }

      const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
      const preferredProfileId = params.authProfileId?.trim();
      let lockedProfileId = params.authProfileIdSource === "user" ? preferredProfileId : undefined;
      if (lockedProfileId) {
        const lockedProfile = authStore.profiles[lockedProfileId];
        if (
          !lockedProfile ||
          normalizeProviderId(lockedProfile.provider) !== normalizeProviderId(provider)
        ) {
          lockedProfileId = undefined;
        }
      }
      const profileOrder = resolveAuthProfileOrder({
        cfg: params.config,
        store: authStore,
        provider,
        preferredProfile: preferredProfileId,
      });
      if (lockedProfileId && !profileOrder.includes(lockedProfileId)) {
        throw new Error(`Auth profile "${lockedProfileId}" is not configured for ${provider}.`);
      }
      const profileCandidates = lockedProfileId
        ? [lockedProfileId]
        : profileOrder.length > 0
          ? profileOrder
          : [undefined];
      let profileIndex = 0;

      const initialThinkLevel = effectiveThinkingLevel ?? "off";
      let thinkLevel = initialThinkLevel;
      const attemptedThinking = new Set<ThinkLevel>();
      let apiKeyInfo: ApiKeyInfo | null = null;
      let lastProfileId: string | undefined;

      const resolveAuthProfileFailoverReason = (params: {
        allInCooldown: boolean;
        message: string;
      }): FailoverReason => {
        if (params.allInCooldown) {
          return "rate_limit";
        }
        const classified = classifyFailoverReason(params.message);
        return classified ?? "auth";
      };

      const throwAuthProfileFailover = (params: {
        allInCooldown: boolean;
        message?: string;
        error?: unknown;
      }): never => {
        const fallbackMessage = `No available auth profile for ${provider} (all in cooldown or unavailable).`;
        const message =
          params.message?.trim() ||
          (params.error ? describeUnknownError(params.error).trim() : "") ||
          fallbackMessage;
        const reason = resolveAuthProfileFailoverReason({
          allInCooldown: params.allInCooldown,
          message,
        });
        if (fallbackConfigured) {
          throw new FailoverError(message, {
            reason,
            provider,
            model: modelId,
            status: resolveFailoverStatus(reason),
            cause: params.error,
          });
        }
        if (params.error instanceof Error) {
          throw params.error;
        }
        throw new Error(message);
      };

      const resolveApiKeyForCandidate = async (candidate?: string) => {
        return getApiKeyForModel({
          model,
          cfg: params.config,
          profileId: candidate,
          store: authStore,
          agentDir,
        });
      };

      const applyApiKeyInfo = async (candidate?: string): Promise<void> => {
        apiKeyInfo = await resolveApiKeyForCandidate(candidate);
        const resolvedProfileId = apiKeyInfo.profileId ?? candidate;
        if (!apiKeyInfo.apiKey) {
          if (apiKeyInfo.mode !== "aws-sdk") {
            throw new Error(
              `No API key resolved for provider "${model.provider}" (auth mode: ${apiKeyInfo.mode}).`,
            );
          }
          lastProfileId = resolvedProfileId;
          return;
        }
        if (model.provider === "github-copilot") {
          const { resolveCopilotApiToken } =
            await import("../../providers/github-copilot-token.js");
          const copilotToken = await resolveCopilotApiToken({
            githubToken: apiKeyInfo.apiKey,
          });
          authStorage.setRuntimeApiKey(model.provider, copilotToken.token);
        } else {
          authStorage.setRuntimeApiKey(model.provider, apiKeyInfo.apiKey);
        }
        lastProfileId = apiKeyInfo.profileId;
      };

      const advanceAuthProfile = async (): Promise<boolean> => {
        if (lockedProfileId) {
          return false;
        }
        // Clear stale cooldowns so profiles that have recovered are available
        clearExpiredCooldowns(authStore);
        if (isProviderInCooldown(authStore, provider)) {
          return false;
        }
        let nextIndex = profileIndex + 1;
        while (nextIndex < profileCandidates.length) {
          const candidate = profileCandidates[nextIndex];
          if (candidate && isProfileInCooldown(authStore, candidate)) {
            nextIndex += 1;
            continue;
          }
          try {
            await applyApiKeyInfo(candidate);
            profileIndex = nextIndex;
            thinkLevel = initialThinkLevel;
            attemptedThinking.clear();
            return true;
          } catch (err) {
            if (candidate && candidate === lockedProfileId) {
              throw err;
            }
            nextIndex += 1;
          }
        }
        return false;
      };

      try {
        // Clear stale cooldowns before initial profile selection
        clearExpiredCooldowns(authStore);
        if (isProviderInCooldown(authStore, provider)) {
          throwAuthProfileFailover({
            allInCooldown: true,
            message: `Provider ${provider} is in cooldown`,
          });
        }
        while (profileIndex < profileCandidates.length) {
          const candidate = profileCandidates[profileIndex];
          if (
            candidate &&
            candidate !== lockedProfileId &&
            isProfileInCooldown(authStore, candidate)
          ) {
            profileIndex += 1;
            continue;
          }
          await applyApiKeyInfo(profileCandidates[profileIndex]);
          break;
        }
        if (profileIndex >= profileCandidates.length) {
          throwAuthProfileFailover({ allInCooldown: true });
        }
      } catch (err) {
        if (err instanceof FailoverError) {
          throw err;
        }
        if (profileCandidates[profileIndex] === lockedProfileId) {
          throwAuthProfileFailover({ allInCooldown: false, error: err });
        }
        const advanced = await advanceAuthProfile();
        if (!advanced) {
          throwAuthProfileFailover({ allInCooldown: false, error: err });
        }
      }

      let overflowCompactionAttempted = false;
      let lastOverflowCompactionReason: string | undefined;
      const triedEmptyResponseModels = new Set<string>([modelId]);
      const triedToolContractFallbackModels = new Set<string>([modelId]);
      const resolveOverflowText = (compactionFailure: boolean): string => {
        const likelySingleInputTooLarge =
          estimatedPromptTokens >= Math.floor(ctxGuard.tokens * 0.45) &&
          (lastOverflowCompactionReason
            ? /nothing to compact|already compact|insufficient reduction|no changes/i.test(
                lastOverflowCompactionReason,
              )
            : true);
        if (likelySingleInputTooLarge) {
          return (
            "Context overflow: this single message is too large for the current model context. " +
            "Split it into smaller parts or summarize logs before sending."
          );
        }
        if (compactionFailure) {
          return (
            "Context overflow: auto-compaction could not reduce context enough. " +
            "Try /compact, then resend a shorter request."
          );
        }
        return (
          "Context overflow: prompt too large for the model. " +
          "Try again with less input or a larger-context model."
        );
      };
      /** How many times we've retried the current profile after a rate-limit 429.
       *  Reset when we successfully advance to a different profile. */
      let rateLimitRetries = 0;
      const MAX_RATE_LIMIT_RETRIES = 1; // retry once with delay before advancing
      const modelOverloadRetries = new Map<string, number>();
      try {
        const tryAutoCompactionForOverflow = async (): Promise<boolean> => {
          if (overflowCompactionAttempted) {
            return false;
          }
          log.warn(
            `context overflow detected; attempting auto-compaction for ${provider}/${modelId}`,
          );
          overflowCompactionAttempted = true;
          const compactParams = {
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            messageChannel: params.messageChannel,
            messageProvider: params.messageProvider,
            agentAccountId: params.agentAccountId,
            authProfileId: lastProfileId,
            sessionFile: params.sessionFile,
            workspaceDir: params.workspaceDir,
            agentDir,
            config: params.config,
            skillsSnapshot: params.skillsSnapshot,
            senderIsOwner: params.senderIsOwner,
            provider,
            model: modelId,
            thinkLevel,
            reasoningLevel: params.reasoningLevel,
            bashElevated: params.bashElevated,
            extraSystemPrompt: effectiveExtraSystemPrompt,
            ownerNumbers: params.ownerNumbers,
          };
          let compactResult = await compactEmbeddedPiSessionDirect(compactParams);
          if (
            !compactResult.compacted &&
            /rate.limit|429|too many requests|billing|overloaded|quota/i.test(
              compactResult.reason ?? "",
            )
          ) {
            log.warn(
              `auto-compaction rate-limited on ${provider}/${modelId}; retrying with ollama/qwen3:30b-a3b`,
            );
            compactResult = await compactEmbeddedPiSessionDirect({
              ...compactParams,
              provider: "ollama",
              model: "qwen3:30b-a3b",
            });
          }
          if (compactResult.compacted) {
            log.info(`auto-compaction succeeded for ${provider}/${modelId}; retrying prompt`);
            return true;
          }
          lastOverflowCompactionReason = compactResult.reason;
          log.warn(
            `auto-compaction failed for ${provider}/${modelId}: ${compactResult.reason ?? "nothing to compact"}`,
          );
          return false;
        };

        while (true) {
          attemptedThinking.add(thinkLevel);
          await fs.mkdir(resolvedWorkspace, { recursive: true });

          const prompt =
            provider === "anthropic" ? scrubAnthropicRefusalMagic(promptText) : promptText;

          const attempt = await runEmbeddedAttempt({
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            messageChannel: params.messageChannel,
            messageProvider: params.messageProvider,
            agentAccountId: params.agentAccountId,
            messageTo: params.messageTo,
            messageThreadId: params.messageThreadId,
            groupId: params.groupId,
            groupChannel: params.groupChannel,
            groupSpace: params.groupSpace,
            spawnedBy: params.spawnedBy,
            senderIsOwner: params.senderIsOwner,
            currentChannelId: params.currentChannelId,
            currentThreadTs: params.currentThreadTs,
            replyToMode: params.replyToMode,
            hasRepliedRef: params.hasRepliedRef,
            sessionFile: params.sessionFile,
            workspaceDir: params.workspaceDir,
            agentDir,
            config: params.config,
            skillsSnapshot: params.skillsSnapshot,
            prompt,
            images: params.images,
            disableTools: params.disableTools,
            provider,
            modelId,
            model,
            authStorage,
            modelRegistry,
            thinkLevel,
            verboseLevel: params.verboseLevel,
            reasoningLevel: params.reasoningLevel,
            toolResultFormat: resolvedToolResultFormat,
            execOverrides: params.execOverrides,
            bashElevated: params.bashElevated,
            timeoutMs: params.timeoutMs,
            runId: params.runId,
            abortSignal: params.abortSignal,
            shouldEmitToolResult: params.shouldEmitToolResult,
            shouldEmitToolOutput: params.shouldEmitToolOutput,
            onPartialReply: params.onPartialReply,
            onAssistantMessageStart: params.onAssistantMessageStart,
            onBlockReply: params.onBlockReply,
            onBlockReplyFlush: params.onBlockReplyFlush,
            blockReplyBreak: params.blockReplyBreak,
            blockReplyChunking: params.blockReplyChunking,
            onReasoningStream: params.onReasoningStream,
            onToolResult: params.onToolResult,
            onAgentEvent: params.onAgentEvent,
            extraSystemPrompt: effectiveExtraSystemPrompt,
            streamParams: params.streamParams,
            ownerNumbers: params.ownerNumbers,
            enforceFinalTag: params.enforceFinalTag,
            isHeartbeat: params.isHeartbeat,
          });

          const { aborted, promptError, timedOut, sessionIdUsed, lastAssistant } = attempt;

          if (promptError && !aborted) {
            const errorText = describeUnknownError(promptError);
            if (isContextOverflowError(errorText)) {
              const isCompactionFailure = isCompactionFailureError(errorText);
              // Attempt auto-compaction on context overflow (not compaction_failure)
              if (!isCompactionFailure && (await tryAutoCompactionForOverflow())) {
                continue;
              }
              const kind = isCompactionFailure ? "compaction_failure" : "context_overflow";
              return {
                payloads: [
                  {
                    text: resolveOverflowText(isCompactionFailure || overflowCompactionAttempted),
                    isError: true,
                  },
                ],
                meta: {
                  durationMs: Date.now() - started,
                  agentMeta: {
                    sessionId: sessionIdUsed,
                    provider,
                    model: model.id,
                  },
                  systemPromptReport: attempt.systemPromptReport,
                  error: { kind, message: errorText },
                },
              };
            }
            // Handle role ordering errors with a user-friendly message
            if (/incorrect role information|roles must alternate/i.test(errorText)) {
              return {
                payloads: [
                  {
                    text:
                      "Message ordering conflict - please try again. " +
                      "If this persists, use /new to start a fresh session.",
                    isError: true,
                  },
                ],
                meta: {
                  durationMs: Date.now() - started,
                  agentMeta: {
                    sessionId: sessionIdUsed,
                    provider,
                    model: model.id,
                  },
                  systemPromptReport: attempt.systemPromptReport,
                  error: { kind: "role_ordering", message: errorText },
                },
              };
            }
            // Handle image size errors with a user-friendly message (no retry needed)
            const imageSizeError = parseImageSizeError(errorText);
            if (imageSizeError) {
              const maxMb = imageSizeError.maxMb;
              const maxMbLabel =
                typeof maxMb === "number" && Number.isFinite(maxMb) ? `${maxMb}` : null;
              const maxBytesHint = maxMbLabel ? ` (max ${maxMbLabel}MB)` : "";
              return {
                payloads: [
                  {
                    text:
                      `Image too large for the model${maxBytesHint}. ` +
                      "Please compress or resize the image and try again.",
                    isError: true,
                  },
                ],
                meta: {
                  durationMs: Date.now() - started,
                  agentMeta: {
                    sessionId: sessionIdUsed,
                    provider,
                    model: model.id,
                  },
                  systemPromptReport: attempt.systemPromptReport,
                  error: { kind: "image_size", message: errorText },
                },
              };
            }
            const promptFailoverReason = classifyFailoverReason(errorText);
            const isPromptOverflow = isLikelyContextOverflowError(errorText);
            const promptRetryAfterMs = resolveRetryAfterMs(promptError);
            const hasLongRetryAfter =
              typeof promptRetryAfterMs === "number" &&
              promptRetryAfterMs >= LONG_RETRY_AFTER_THRESHOLD_MS;

            // Rate limit retry: wait briefly and retry the SAME profile before
            // cycling through all profiles and locking them all out. Most 429s
            // are transient per-minute limits that clear in seconds. Advancing
            // profiles immediately just burns all of them in the same window.
            if (
              promptFailoverReason === "rate_limit" &&
              isRateLimitErrorMessage(errorText) &&
              !lockedProfileId &&
              !isPromptOverflow &&
              !hasLongRetryAfter &&
              rateLimitRetries < MAX_RATE_LIMIT_RETRIES
            ) {
              rateLimitRetries += 1;
              const retryDelay = 3_000 + Math.random() * 2_000; // 3-5s jitter
              log.warn(
                `rate limit on ${provider}/${lastProfileId ?? "?"}; waiting ${Math.round(retryDelay / 1000)}s before retry (attempt ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`,
              );
              await sleepWithAbort(retryDelay, params.abortSignal);
              continue;
            }
            if (promptFailoverReason === "rate_limit" && hasLongRetryAfter) {
              const retryAfterMs = promptRetryAfterMs ?? 0;
              log.warn(
                `rate limit on ${provider}/${lastProfileId ?? "?"}; honoring Retry-After ${Math.round(retryAfterMs / 1000)}s (skip short retry loop)`,
              );
            }

            // Don't mark auth profile failure for overloaded/timeout/overflow — these are model-wide, not per-account
            if (
              promptFailoverReason &&
              promptFailoverReason !== "timeout" &&
              promptFailoverReason !== "overloaded" &&
              !isPromptOverflow &&
              lastProfileId
            ) {
              await markAuthProfileFailure({
                store: authStore,
                profileId: lastProfileId,
                reason: promptFailoverReason,
                retryAfterMs: promptRetryAfterMs,
                cfg: params.config,
                agentDir: params.agentDir,
              });
            }
            // Don't rotate auth profiles for overloaded/timeout/overflow — escalate to next model instead
            if (
              isFailoverErrorMessage(errorText) &&
              promptFailoverReason !== "timeout" &&
              promptFailoverReason !== "overloaded" &&
              !isPromptOverflow &&
              (await advanceAuthProfile())
            ) {
              rateLimitRetries = 0; // reset retry counter for new profile
              continue;
            }
            const fallbackThinking = pickFallbackThinkingLevel({
              message: errorText,
              attempted: attemptedThinking,
            });
            if (fallbackThinking) {
              log.warn(
                `unsupported thinking level for ${provider}/${modelId}; retrying with ${fallbackThinking}`,
              );
              thinkLevel = fallbackThinking;
              continue;
            }
            // FIX: Throw FailoverError for prompt errors when fallbacks configured
            // This enables model fallback for quota/rate limit errors during prompt submission
            if (fallbackConfigured && isFailoverErrorMessage(errorText)) {
              throw new FailoverError(errorText, {
                reason: promptFailoverReason ?? "unknown",
                provider,
                model: modelId,
                profileId: lastProfileId,
                status: resolveFailoverStatus(promptFailoverReason ?? "unknown"),
                retryAfterMs: promptRetryAfterMs,
              });
            }
            throw promptError;
          }

          const assistantTextCount = attempt.assistantTexts?.length ?? 0;
          const nonEmptyAssistantTextCount = (attempt.assistantTexts ?? []).filter(
            (text) => String(text ?? "").trim().length > 0,
          ).length;
          const isEmptyAssistantResponse =
            !aborted &&
            !promptError &&
            !lastAssistant &&
            nonEmptyAssistantTextCount === 0 &&
            !attempt.didSendViaMessagingTool;
          if (isEmptyAssistantResponse) {
            const nextFallbackModel = pickNextOpenAiCodexFallbackModel({
              provider,
              modelId,
              tried: triedEmptyResponseModels,
            });
            if (nextFallbackModel) {
              const fallbackResolved = resolveModel(
                provider,
                nextFallbackModel,
                agentDir,
                params.config,
              );
              if (fallbackResolved.model) {
                log.warn(
                  `empty response from ${provider}/${modelId}; retrying with ${provider}/${nextFallbackModel}`,
                );
                modelId = nextFallbackModel;
                triedEmptyResponseModels.add(modelId);
                model = fallbackResolved.model;
                authStorage = fallbackResolved.authStorage;
                modelRegistry = fallbackResolved.modelRegistry;
                // Keep the same resolved auth material when staying on the same provider family.
                // Without this, fallback attempts can hit "No API key found" despite a valid profile.
                if (apiKeyInfo?.apiKey) {
                  authStorage.setRuntimeApiKey(model.provider, apiKeyInfo.apiKey);
                }
                continue;
              }
            }
          }

          const validationText = (attempt.assistantTexts ?? []).join("\n").trim();
          const toolValidation = validateToolClaims({
            responseText: validationText,
            executedToolNames: attempt.toolMetas.map((entry) => entry.toolName),
            didSendViaMessagingTool: attempt.didSendViaMessagingTool,
            taskMutationEvidence: attempt.taskMutationEvidence ?? [],
          });
          const hasToolClaimMismatch = hasCommitmentMismatch(toolValidation);
          const hasHighConfidenceToolClaimMismatch =
            hasHighConfidenceCommitmentMismatch(toolValidation);
          let hasSupportQualityMismatch = false;
          if (hasToolClaimMismatch && !aborted) {
            const missingClaims = formatMissingValidationClaims(toolValidation);
            sawCommitmentMismatch = true;
            firstCommitmentMismatchAt ??= Date.now();
            lastCommitmentMismatchValidation = toolValidation;
            const nextToolFallbackModel = pickNextOpenAiCodexFallbackModel({
              provider,
              modelId,
              tried: triedToolContractFallbackModels,
            });
            if (nextToolFallbackModel) {
              const fallbackResolved = resolveModel(
                provider,
                nextToolFallbackModel,
                agentDir,
                params.config,
              );
              if (fallbackResolved.model) {
                log.warn(
                  `tool-claim mismatch on ${provider}/${modelId}; deterministic codec fallback to ${provider}/${nextToolFallbackModel} (${missingClaims})`,
                );
                modelId = nextToolFallbackModel;
                triedToolContractFallbackModels.add(modelId);
                commitmentRepairCount += 1;
                model = fallbackResolved.model;
                authStorage = fallbackResolved.authStorage;
                modelRegistry = fallbackResolved.modelRegistry;
                if (apiKeyInfo?.apiKey) {
                  authStorage.setRuntimeApiKey(model.provider, apiKeyInfo.apiKey);
                }
                promptText = basePromptText;
                toolClaimRetryCount = 0;
                toolClaimEmergencyRetryCount = 0;
                continue;
              }
            }
            if (toolClaimRetryCount < MAX_TOOL_CLAIM_RETRIES) {
              toolClaimRetryCount += 1;
              commitmentRepairCount += 1;
              promptText = `${basePromptText}\n\n${buildCommitmentGuardrailText(toolValidation)}`;
              log.warn(
                `tool-claim mismatch on ${provider}/${modelId}; retrying once with guardrail (${missingClaims})`,
              );
              continue;
            }
            if (
              hasHighConfidenceToolClaimMismatch &&
              toolClaimEmergencyRetryCount < MAX_TOOL_CLAIM_EMERGENCY_RETRIES
            ) {
              toolClaimEmergencyRetryCount += 1;
              commitmentRepairCount += 1;
              const snippet = extractStructuredToolJsonSnippet(validationText);
              promptText =
                `${basePromptText}\n\n` +
                "[TOOL_EXECUTION_EMERGENCY]\n" +
                `Structured tool JSON or an unfulfilled same-turn action claim was emitted without real execution (${missingClaims}).\n` +
                "Execute the required tool call now. If you need clarification, ask the concrete questions now.\n" +
                "Do not output raw JSON or prose before the tool call.\n" +
                (snippet ? `Observed payload:\n${snippet}\n` : "") +
                "[/TOOL_EXECUTION_EMERGENCY]";
              log.warn(
                `tool-claim mismatch on ${provider}/${modelId}; retrying with emergency structured guardrail (${missingClaims})`,
              );
              continue;
            }
            log.warn(
              `tool-claim mismatch on ${provider}/${modelId} after retry (${missingClaims}); suppressing unverified output`,
            );
          }

          if (supportQualityWarnOnly) {
            const supportValidation = validateSupportReplyQuality({
              userPrompt: basePromptText,
              responseText: validationText,
            });
            lastSupportQualityValidation = supportValidation;
            hasSupportQualityMismatch = supportValidation.blockingCodes.length > 0;
            if (supportValidation.issues.length > 0) {
              log.warn(
                `support-quality issues on ${provider}/${modelId} (${resolvedSupportIntent?.departmentId ?? "support"}): ${supportValidation.blockingCodes.join(", ") || "none"}`,
              );
            }
            if (supportQualityEnforce && hasSupportQualityMismatch && !aborted) {
              if (supportQualityRetryCount < MAX_SUPPORT_QUALITY_RETRIES) {
                supportQualityRetryCount += 1;
                promptText =
                  `${basePromptText}\n\n` + buildSupportQualityGuardrailText(supportValidation);
                continue;
              }
              log.warn(
                `support-quality mismatch on ${provider}/${modelId} after retry; suppressing non-compliant output`,
              );
            }
          }

          const fallbackThinking = pickFallbackThinkingLevel({
            message: lastAssistant?.errorMessage,
            attempted: attemptedThinking,
          });
          if (fallbackThinking && !aborted) {
            log.warn(
              `unsupported thinking level for ${provider}/${modelId}; retrying with ${fallbackThinking}`,
            );
            thinkLevel = fallbackThinking;
            continue;
          }

          const authFailure = isAuthAssistantError(lastAssistant);
          const rateLimitFailure = isRateLimitAssistantError(lastAssistant);
          const failoverFailure = isFailoverAssistantError(lastAssistant);
          const assistantErrorMessage = lastAssistant?.errorMessage ?? "";
          const assistantFailoverReason = classifyFailoverReason(assistantErrorMessage);
          const modelUnavailableFailure = isModelUnavailableErrorMessage(assistantErrorMessage);
          const cloudCodeAssistFormatError = attempt.cloudCodeAssistFormatError;
          const imageDimensionError = parseImageDimensionError(assistantErrorMessage);

          if (imageDimensionError && lastProfileId) {
            const details = [
              imageDimensionError.messageIndex !== undefined
                ? `message=${imageDimensionError.messageIndex}`
                : null,
              imageDimensionError.contentIndex !== undefined
                ? `content=${imageDimensionError.contentIndex}`
                : null,
              imageDimensionError.maxDimensionPx !== undefined
                ? `limit=${imageDimensionError.maxDimensionPx}px`
                : null,
            ]
              .filter(Boolean)
              .join(" ");
            log.warn(
              `Profile ${lastProfileId} rejected image payload${details ? ` (${details})` : ""}.`,
            );
          }

          // Treat timeout as potential rate limit (Antigravity hangs on rate limit)
          const shouldRotate = (!aborted && failoverFailure) || timedOut;
          // Overloaded/overflow errors are model-wide (server infrastructure), not per-account.
          // Skip auth profile rotation and escalate directly to the next model.
          const isModelOverloaded = assistantFailoverReason === "overloaded";
          const isAssistantOverflow = isLikelyContextOverflowError(
            lastAssistant?.errorMessage ?? "",
          );
          if (isAssistantOverflow && (await tryAutoCompactionForOverflow())) {
            continue;
          }
          const skipProfileRotation = isModelOverloaded || isAssistantOverflow;

          if (shouldRotate) {
            if (skipProfileRotation) {
              if (isModelOverloaded) {
                const modelKey = `${provider}/${modelId}`;
                if (modelUnavailableFailure) {
                  const quarantinedUntil = markUnavailableModelQuarantine(provider, modelId);
                  const quarantineMs = Math.max(0, quarantinedUntil - Date.now());
                  const quarantineSec = (quarantineMs / 1000).toFixed(1);
                  log.warn(
                    `Model ${modelKey} is unavailable/decommissioned. Skipping auth profile rotation (non-account failure), forcing model fallback, and quarantining for ${quarantineSec}s.`,
                  );
                } else {
                  const overloadRetries = modelOverloadRetries.get(modelKey) ?? 0;
                  const quarantinedUntil = markOverloadedModelQuarantine(provider, modelId);
                  const quarantineMs = Math.max(0, quarantinedUntil - Date.now());
                  const quarantineSec = (quarantineMs / 1000).toFixed(1);
                  if (overloadRetries < MAX_MODEL_OVERLOAD_RETRIES) {
                    const nextRetry = overloadRetries + 1;
                    modelOverloadRetries.set(modelKey, nextRetry);
                    const retryDelay =
                      OVERLOAD_RETRY_BASE_DELAY_MS + Math.floor(Math.random() * 250);
                    log.warn(
                      `Model ${modelKey} is overloaded (server-wide). Skipping auth profile rotation (non-account failure). Retrying same model once before fallback (${nextRetry}/${MAX_MODEL_OVERLOAD_RETRIES}) after ${retryDelay}ms. Quarantined for ${quarantineSec}s.`,
                    );
                    await sleepWithAbort(retryDelay, params.abortSignal);
                    continue;
                  }
                  log.warn(
                    `Model ${modelKey} is still overloaded after ${MAX_MODEL_OVERLOAD_RETRIES} retry. Skipping auth profile rotation (non-account failure), forcing model fallback, and honoring overload quarantine (${quarantineSec}s).`,
                  );
                }
              } else {
                log.warn(
                  `Model ${provider}/${modelId} hit context overflow (session too large). Skipping auth profile rotation (non-account failure) and forcing model fallback.`,
                );
              }
            } else {
              log.warn(`Model ${provider}/${modelId} request failed; rotating auth profile.`);
            }

            // Rate limit retry with delay — wait and retry same profile before cycling
            if (
              rateLimitFailure &&
              !skipProfileRotation &&
              !lockedProfileId &&
              !timedOut &&
              rateLimitRetries < MAX_RATE_LIMIT_RETRIES
            ) {
              rateLimitRetries += 1;
              const retryDelay = 3_000 + Math.random() * 2_000;
              log.warn(
                `rate limit on ${provider}/${lastProfileId ?? "?"}; waiting ${Math.round(retryDelay / 1000)}s before retry (attempt ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`,
              );
              await sleepWithAbort(retryDelay, params.abortSignal);
              continue;
            }

            if (lastProfileId && !skipProfileRotation) {
              const reason =
                timedOut || assistantFailoverReason === "timeout"
                  ? "timeout"
                  : (assistantFailoverReason ?? "unknown");
              await markAuthProfileFailure({
                store: authStore,
                profileId: lastProfileId,
                reason,
                retryAfterMs: undefined,
                cfg: params.config,
                agentDir: params.agentDir,
              });
              if (timedOut && !isProbeSession) {
                log.warn(
                  `Profile ${lastProfileId} timed out (possible rate limit). Trying next account...`,
                );
              }
              if (cloudCodeAssistFormatError) {
                log.warn(
                  `Profile ${lastProfileId} hit Cloud Code Assist format error. Tool calls will be sanitized on retry.`,
                );
              }
            }

            if (!isModelOverloaded && !isAssistantOverflow) {
              const rotated = await advanceAuthProfile();
              if (rotated) {
                rateLimitRetries = 0; // reset for new profile
                continue;
              }
            }

            // ── Cross-provider profile fallback ──
            // All auth profiles for the current provider are exhausted.
            // If the routing decision includes profileFallbacks, try the
            // next profile's provider/model at the same tier.
            if (routing.profileFallbacks && routing.profileFallbacks.length > 0) {
              const nextFallback = routing.profileFallbacks.shift()!;
              log.info(
                `[model-router] Provider ${provider} exhausted — falling back to profile "${nextFallback.profile}" → ${nextFallback.provider}/${nextFallback.model}`,
              );
              provider = nextFallback.provider;
              modelId = nextFallback.model;
              const resolved = resolveModel(provider, modelId, agentDir, params.config);
              if (!resolved.model) {
                log.warn(
                  `[model-router] Fallback model ${provider}/${modelId} not resolvable, trying next`,
                );
                continue;
              }
              model = resolved.model;
              // Re-initialize auth profile candidates for the new provider
              const newProfileOrder = resolveAuthProfileOrder({
                cfg: params.config,
                store: authStore,
                provider,
                preferredProfile: undefined,
              });
              profileCandidates.length = 0;
              profileCandidates.push(
                ...(newProfileOrder.length > 0 ? newProfileOrder : [undefined]),
              );
              profileIndex = -1;
              lockedProfileId = undefined;
              try {
                await applyApiKeyInfo(profileCandidates[0]);
                profileIndex = 0;
              } catch (keyErr) {
                log.warn(
                  `[model-router] Fallback profile "${nextFallback.profile}" auth failed: ${describeUnknownError(keyErr)}`,
                );
                continue;
              }
              rateLimitRetries = 0;
              thinkLevel = initialThinkLevel;
              attemptedThinking.clear();
              continue;
            }

            if (fallbackConfigured) {
              // Prefer formatted error message (user-friendly) over raw errorMessage
              const message =
                (lastAssistant
                  ? formatAssistantErrorText(lastAssistant, {
                      cfg: params.config,
                      sessionKey: params.sessionKey ?? params.sessionId,
                    })
                  : undefined) ||
                lastAssistant?.errorMessage?.trim() ||
                (timedOut
                  ? "LLM request timed out."
                  : rateLimitFailure
                    ? "LLM request rate limited."
                    : authFailure
                      ? "LLM request unauthorized."
                      : "LLM request failed.");
              const status =
                resolveFailoverStatus(assistantFailoverReason ?? "unknown") ??
                (isTimeoutErrorMessage(message) ? 408 : undefined);
              // Record model failure for performance tracking
              try {
                const memAdapter = await getMemoryAdapter();
                await memAdapter.recordModelFeedback({
                  provider,
                  model: modelId,
                  tier: routing.tier,
                  sessionType: routing.reason.includes("heartbeat")
                    ? "heartbeat"
                    : routing.reason.includes("contemplation")
                      ? "contemplation"
                      : routing.reason.includes("subagent")
                        ? "subagent"
                        : "main",
                  complexityScore: routing.score,
                  durationMs: Date.now() - started,
                  success: false,
                  errorType: assistantFailoverReason ?? "unknown",
                  sessionKey: params.sessionKey ?? params.sessionId,
                  profile: routing.profile,
                });
              } catch {
                /* non-fatal */
              }

              throw new FailoverError(message, {
                reason: assistantFailoverReason ?? "unknown",
                provider,
                model: modelId,
                profileId: lastProfileId,
                status,
              });
            }
          }

          const usage = normalizeUsage(lastAssistant?.usage as UsageLike);
          const agentMeta: EmbeddedPiAgentMeta = {
            sessionId: sessionIdUsed,
            provider: lastAssistant?.provider ?? provider,
            model: lastAssistant?.model ?? model.id,
            usage,
          };

          const payloads = buildEmbeddedRunPayloads({
            assistantTexts: attempt.assistantTexts,
            toolMetas: attempt.toolMetas,
            lastAssistant: attempt.lastAssistant,
            lastToolError: attempt.lastToolError,
            config: params.config,
            sessionKey: params.sessionKey ?? params.sessionId,
            verboseLevel: params.verboseLevel,
            reasoningLevel: params.reasoningLevel,
            toolResultFormat: resolvedToolResultFormat,
            inlineToolResultsAllowed: false,
          });
          const emergencyAssistantText = (() => {
            const chunks: string[] = [];
            for (const text of attempt.assistantTexts ?? []) {
              const normalized = String(text ?? "").trim();
              if (normalized) {
                chunks.push(normalized);
              }
            }
            const contentBlocks = attempt.lastAssistant?.content;
            if (Array.isArray(contentBlocks)) {
              for (const block of contentBlocks) {
                if (!block || typeof block !== "object") {
                  continue;
                }
                const record = block as Record<string, unknown>;
                const directText =
                  (typeof record.text === "string" ? record.text : "") ||
                  (typeof record.output_text === "string" ? record.output_text : "") ||
                  (typeof record.content === "string" ? record.content : "");
                if (directText.trim()) {
                  chunks.push(directText.trim());
                  continue;
                }
                if (record.content && typeof record.content === "object") {
                  const nested = record.content as Record<string, unknown>;
                  if (typeof nested.text === "string" && nested.text.trim()) {
                    chunks.push(nested.text.trim());
                  }
                }
              }
            }
            const merged = chunks.join("\n").trim();
            if (!merged || isSilentReplyText(merged, SILENT_REPLY_TOKEN)) {
              return "";
            }
            return merged;
          })();
          const isUserFacingChannel =
            Boolean(params.messageChannel) && params.messageChannel !== "unknown";
          const needsEmptyReplyFallback =
            payloads.length === 0 &&
            !aborted &&
            !attempt.didSendViaMessagingTool &&
            isUserFacingChannel;
          if (needsEmptyReplyFallback) {
            const contentTypes = Array.isArray(attempt.lastAssistant?.content)
              ? attempt.lastAssistant.content
                  .map((block) => {
                    if (!block || typeof block !== "object") {
                      return typeof block;
                    }
                    const blockType = (block as { type?: unknown }).type;
                    return typeof blockType === "string" ? blockType : "unknown";
                  })
                  .join(",")
              : "none";
            log.warn(
              `empty assistant payload for ${provider}/${modelId}: stopReason=${attempt.lastAssistant?.stopReason ?? "unknown"} contentTypes=${contentTypes} promptError=${attempt.promptError ? describeUnknownError(attempt.promptError) : "none"} assistantTextCount=${assistantTextCount} nonEmptyAssistantTextCount=${nonEmptyAssistantTextCount}`,
            );
          }
          let payloadsForReturn = needsEmptyReplyFallback
            ? emergencyAssistantText
              ? [{ text: emergencyAssistantText }]
              : [
                  {
                    text:
                      "I couldn't generate a reply for that request. Please try again. " +
                      "If this keeps happening, run /compact and resend.",
                    isError: true,
                  },
                ]
            : payloads;
          const commitmentDisposition = sawCommitmentMismatch
            ? hasToolClaimMismatch
              ? "blocked"
              : "repaired"
            : "pass";
          const commitmentBlockedReason = hasToolClaimMismatch
            ? formatMissingValidationClaims(toolValidation)
            : undefined;
          const evidenceLatencyMs =
            sawCommitmentMismatch && firstCommitmentMismatchAt
              ? Date.now() - firstCommitmentMismatchAt
              : undefined;
          const toolValidationForMeta: CommitmentValidation = {
            ...toolValidation,
            commitmentDisposition,
            commitmentRepairCount,
            ...(commitmentBlockedReason ? { commitmentBlockedReason } : {}),
            ...(typeof evidenceLatencyMs === "number" ? { evidenceLatencyMs } : {}),
          };
          if (hasToolClaimMismatch) {
            const missingClaims = formatMissingValidationClaims(toolValidation);
            payloadsForReturn = [
              {
                text:
                  `Tool execution guardrail blocked this reply. Claimed same-turn action without execution: ${missingClaims}. ` +
                  "I need to retry with real execution rather than pretend the action happened.",
                isError: true,
              },
            ];
          }
          if (supportQualityEnforce && hasSupportQualityMismatch) {
            payloadsForReturn = [
              {
                text:
                  "I need to escalate this before I can give a final response. " +
                  "Please hold while I route this to a human support specialist.",
                isError: true,
              },
            ];
          }

          log.debug(
            `embedded run done: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - started} aborted=${aborted}`,
          );
          if (lastProfileId) {
            await markAuthProfileGood({
              store: authStore,
              provider,
              profileId: lastProfileId,
              agentDir: params.agentDir,
            });
            await markAuthProfileUsed({
              store: authStore,
              profileId: lastProfileId,
              agentDir: params.agentDir,
            });
          }

          // Record model feedback for performance tracking
          try {
            const memAdapter = await getMemoryAdapter();
            await memAdapter.recordModelFeedback({
              provider,
              model: modelId,
              tier: routing.tier,
              sessionType: routing.reason.includes("heartbeat")
                ? "heartbeat"
                : routing.reason.includes("contemplation")
                  ? "contemplation"
                  : routing.reason.includes("subagent")
                    ? "subagent"
                    : "main",
              complexityScore: routing.score,
              durationMs: Date.now() - started,
              success: !hasToolClaimMismatch,
              errorType: hasToolClaimMismatch
                ? "tool_claim_mismatch"
                : supportQualityEnforce && hasSupportQualityMismatch
                  ? "support_quality_mismatch"
                  : undefined,
              inputTokens: usage?.input ?? 0,
              outputTokens: usage?.output ?? 0,
              totalTokens: (usage?.input ?? 0) + (usage?.output ?? 0),
              toolCallCount: attempt.toolMetas?.length ?? 0,
              sessionKey: params.sessionKey ?? params.sessionId,
              profile: routing.profile,
            });
          } catch {
            /* non-fatal — don't break agent on feedback recording failure */
          }

          const commitmentSourceValidation =
            (commitmentDisposition === "blocked"
              ? toolValidation
              : lastCommitmentMismatchValidation) ?? toolValidation;

          emitAgentEvent({
            runId: params.runId,
            stream: "lifecycle",
            data: {
              phase: "commitment_enforcement",
              disposition: commitmentDisposition,
              repairCount: commitmentRepairCount,
              blockedReason: commitmentBlockedReason,
              evidenceLatencyMs,
              missingClaims: commitmentSourceValidation.missingClaimLabels,
              evidenceKinds: toolValidationForMeta.evidenceKinds,
              evidenceTools: toolValidationForMeta.evidenceTools,
              sessionKey: params.sessionKey ?? params.sessionId,
              provider,
              model: modelId,
            },
          });

          if (commitmentDisposition === "repaired" || commitmentDisposition === "blocked") {
            try {
              await persistCommitmentMemory({
                status:
                  commitmentDisposition === "repaired"
                    ? "repaired_same_turn"
                    : "blocked_unfulfilled",
                claimText: resolveCommitmentClaimText(commitmentSourceValidation),
                evidenceKinds: toolValidationForMeta.evidenceKinds,
                evidenceTools: toolValidationForMeta.evidenceTools,
                repairCount: commitmentRepairCount,
                ...(typeof evidenceLatencyMs === "number" ? { evidenceLatencyMs } : {}),
                ...(commitmentBlockedReason ? { blockedReason: commitmentBlockedReason } : {}),
                ...(params.sessionKey || params.sessionId
                  ? { sessionKey: params.sessionKey ?? params.sessionId }
                  : {}),
                ...(params.runId ? { runId: params.runId } : {}),
              });
            } catch (err) {
              log.warn(
                `commitment memory persistence failed for ${params.runId}: ${describeUnknownError(err)}`,
              );
            }
          }

          // Fire-and-forget self-evaluation (Ollama → Haiku fallback)
          const responseText = attempt.assistantTexts?.join("\n") ?? "";
          if (responseText.length > 20 && promptText.length > 5) {
            runSelfEvaluation({
              userPrompt: promptText,
              agentResponse: responseText,
              sessionKey: params.sessionKey ?? params.sessionId,
            }).catch(() => {
              /* non-fatal */
            });
          }

          const userFacingAssistantText = (() => {
            const messagingText = attempt.messagingToolSentTexts
              .map((text) => String(text ?? "").trim())
              .filter(Boolean)
              .join("\n")
              .trim();
            if (messagingText) {
              return messagingText;
            }
            const payloadText = payloadsForReturn
              .map((payload) => {
                if (!payload || typeof payload !== "object" || !("text" in payload)) {
                  return "";
                }
                const rawText = (payload as { text?: unknown }).text;
                return typeof rawText === "string" ? rawText.trim() : "";
              })
              .filter(Boolean)
              .join("\n")
              .trim();
            if (payloadText) {
              return payloadText;
            }
            return responseText.trim() || emergencyAssistantText || "";
          })();

          const sessionAgentId = params.config
            ? resolveSessionAgentIds({
                sessionKey: params.sessionKey,
                config: params.config,
              }).sessionAgentId
            : undefined;
          if (sessionAgentId && params.config) {
            try {
              recordConsciousnessKernelConversationTurn({
                cfg: params.config,
                agentId: sessionAgentId,
                sessionKey: params.sessionKey ?? params.sessionId,
                channel: inferSessionChannelFromKey(
                  params.sessionKey ?? params.sessionId,
                  params.messageChannel ?? params.messageProvider,
                ),
                userMessageText: basePromptText,
                assistantReplyText: userFacingAssistantText,
              });
            } catch (err) {
              log.warn(
                `kernel conversation sync failed for ${params.runId}: ${describeUnknownError(err)}`,
              );
            }
          }

          return {
            payloads: payloadsForReturn.length ? payloadsForReturn : undefined,
            meta: {
              durationMs: Date.now() - started,
              agentMeta,
              aborted,
              systemPromptReport: attempt.systemPromptReport,
              toolValidation: toolValidationForMeta,
              supportQuality: lastSupportQualityValidation,
              // Handle client tool calls (OpenResponses hosted tools)
              stopReason: attempt.clientToolCall ? "tool_calls" : undefined,
              pendingToolCalls: attempt.clientToolCall
                ? [
                    {
                      id: `call_${Date.now()}`,
                      name: attempt.clientToolCall.name,
                      arguments: JSON.stringify(attempt.clientToolCall.params),
                    },
                  ]
                : undefined,
            },
            didSendViaMessagingTool: attempt.didSendViaMessagingTool,
            messagingToolSentTexts: attempt.messagingToolSentTexts,
            messagingToolSentTargets: attempt.messagingToolSentTargets,
          };
        }
      } finally {
        process.chdir(prevCwd);
      }
    }),
  );
}
