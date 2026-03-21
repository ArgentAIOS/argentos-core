import type { SimpleStreamOptions } from "../../agent-core/ai.js";
import type { StreamFn } from "../../agent-core/core.js";
import type { ArgentConfig } from "../../config/config.js";
import { streamSimple } from "../../agent-core/ai.js";
import { resolveAgentCoreRuntimeMode } from "../../agent-core/runtime-policy.js";
import { log } from "./logger.js";

const OPENROUTER_APP_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://argentos.ai",
  "X-Title": "ArgentOS",
};

function resolveUnderlyingStreamFn(
  baseStreamFn: StreamFn | undefined,
  operation: string,
): StreamFn {
  if (baseStreamFn) {
    return baseStreamFn;
  }
  const mode = resolveAgentCoreRuntimeMode(process.env);
  if (mode === "argent_strict") {
    throw new Error(
      `[agent/embedded] Missing base streamFn during ${operation}; Pi fallback blocked in argent_strict mode.`,
    );
  }
  return streamSimple;
}

/**
 * Resolve provider-specific extra params from model config.
 * Used to pass through stream params like temperature/maxTokens.
 *
 * @internal Exported for testing only
 */
export function resolveExtraParams(params: {
  cfg: ArgentConfig | undefined;
  provider: string;
  modelId: string;
}): Record<string, unknown> | undefined {
  const modelKey = `${params.provider}/${params.modelId}`;
  const modelConfig = params.cfg?.agents?.defaults?.models?.[modelKey];
  return modelConfig?.params ? { ...modelConfig.params } : undefined;
}

type CacheRetention = "none" | "short" | "long";
type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh";
type AdaptiveEffort = "low" | "medium" | "high" | "max";

/**
 * Resolve cacheRetention from extraParams, supporting both new `cacheRetention`
 * and legacy `cacheControlTtl` values for backwards compatibility.
 *
 * Mapping: "5m" → "short", "1h" → "long"
 *
 * Only applies to Anthropic provider (OpenRouter uses openai-completions API
 * with hardcoded cache_control, not the cacheRetention stream option).
 */
function resolveCacheRetention(
  extraParams: Record<string, unknown> | undefined,
  provider: string,
): CacheRetention | undefined {
  if (provider !== "anthropic") {
    return undefined;
  }

  // Prefer new cacheRetention if present
  const newVal = extraParams?.cacheRetention;
  if (newVal === "none" || newVal === "short" || newVal === "long") {
    return newVal;
  }

  // Fall back to legacy cacheControlTtl with mapping
  const legacy = extraParams?.cacheControlTtl;
  if (legacy === "5m") {
    return "short";
  }
  if (legacy === "1h") {
    return "long";
  }
  return undefined;
}

function normalizeReasoningLevel(raw: unknown): ReasoningLevel | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeAdaptiveEffort(raw: unknown): AdaptiveEffort | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case "low":
    case "medium":
    case "high":
    case "max":
      return normalized;
    default:
      return undefined;
  }
}

function applyThinkingModeParams(params: {
  streamParams: Record<string, unknown>;
  extraParams: Record<string, unknown>;
  provider: string;
}): void {
  const { streamParams, extraParams } = params;
  const provider = params.provider.trim().toLowerCase();
  const explicitReasoning = normalizeReasoningLevel(extraParams.reasoning);
  if (explicitReasoning) {
    streamParams.reasoning = explicitReasoning;
  }

  const thinkingModeRaw = extraParams.thinking;
  if (typeof thinkingModeRaw === "string") {
    const thinkingMode = thinkingModeRaw.trim().toLowerCase();
    if (thinkingMode === "off") {
      delete streamParams.reasoning;
      streamParams.thinkingEnabled = false;
    } else if (thinkingMode === "on") {
      streamParams.reasoning = explicitReasoning ?? "high";
      streamParams.thinkingEnabled = true;
    } else if (thinkingMode === "adaptive") {
      streamParams.reasoning = explicitReasoning ?? "medium";
      streamParams.thinkingEnabled = true;
      if (provider === "anthropic" && streamParams.effort === undefined) {
        streamParams.effort = "medium";
      }
    } else {
      const level = normalizeReasoningLevel(thinkingMode);
      if (level) {
        streamParams.reasoning = level;
      }
    }
  } else if (thinkingModeRaw && typeof thinkingModeRaw === "object") {
    // Google providers accept an object-style thinking payload.
    streamParams.thinking = thinkingModeRaw;
  }

  const effort = normalizeAdaptiveEffort(extraParams.effort);
  if (effort) {
    streamParams.effort = effort;
  }
  const reasoningEffort = normalizeReasoningLevel(extraParams.reasoningEffort);
  if (reasoningEffort) {
    streamParams.reasoningEffort = reasoningEffort;
  }
  if (typeof extraParams.thinkingEnabled === "boolean") {
    streamParams.thinkingEnabled = extraParams.thinkingEnabled;
  }
  if (typeof extraParams.thinkingBudgetTokens === "number") {
    streamParams.thinkingBudgetTokens = extraParams.thinkingBudgetTokens;
  }
  if (extraParams.thinkingBudgets && typeof extraParams.thinkingBudgets === "object") {
    streamParams.thinkingBudgets = extraParams.thinkingBudgets;
  }
  if (typeof extraParams.interleavedThinking === "boolean") {
    streamParams.interleavedThinking = extraParams.interleavedThinking;
  }
}

function createStreamFnWithExtraParams(
  baseStreamFn: StreamFn | undefined,
  extraParams: Record<string, unknown> | undefined,
  provider: string,
): StreamFn | undefined {
  if (!extraParams || Object.keys(extraParams).length === 0) {
    return undefined;
  }

  const streamParams: Record<string, unknown> = {};
  if (typeof extraParams.temperature === "number") {
    streamParams.temperature = extraParams.temperature;
  }
  if (typeof extraParams.maxTokens === "number") {
    streamParams.maxTokens = extraParams.maxTokens;
  }
  if (extraParams.toolChoice !== undefined) {
    streamParams.toolChoice = extraParams.toolChoice;
  }
  const cacheRetention = resolveCacheRetention(extraParams, provider);
  if (cacheRetention) {
    streamParams.cacheRetention = cacheRetention;
  }
  applyThinkingModeParams({
    streamParams,
    extraParams,
    provider,
  });

  if (Object.keys(streamParams).length === 0) {
    return undefined;
  }

  log.debug(`creating streamFn wrapper with params: ${JSON.stringify(streamParams)}`);

  const underlying = resolveUnderlyingStreamFn(baseStreamFn, "extra-params wrapper");
  const wrappedStreamFn: StreamFn = (model, context, options) =>
    underlying(model, context, {
      ...(streamParams as Partial<SimpleStreamOptions>),
      ...options,
    });

  return wrappedStreamFn;
}

/**
 * Create a streamFn wrapper that adds OpenRouter app attribution headers.
 * These headers allow ArgentOS to appear on OpenRouter's leaderboard.
 */
function createOpenRouterHeadersWrapper(baseStreamFn: StreamFn | undefined): StreamFn {
  const underlying = resolveUnderlyingStreamFn(baseStreamFn, "openrouter headers wrapper");
  return (model, context, options) =>
    underlying(model, context, {
      ...options,
      headers: {
        ...OPENROUTER_APP_HEADERS,
        ...options?.headers,
      },
    });
}

/**
 * Apply extra params (like temperature) to an agent's streamFn.
 * Also adds OpenRouter app attribution headers when using the OpenRouter provider.
 *
 * @internal Exported for testing
 */
export function applyExtraParamsToAgent(
  agent: { streamFn?: StreamFn },
  cfg: ArgentConfig | undefined,
  provider: string,
  modelId: string,
  extraParamsOverride?: Record<string, unknown>,
): void {
  const extraParams = resolveExtraParams({
    cfg,
    provider,
    modelId,
  });
  const override =
    extraParamsOverride && Object.keys(extraParamsOverride).length > 0
      ? Object.fromEntries(
          Object.entries(extraParamsOverride).filter(([, value]) => value !== undefined),
        )
      : undefined;
  const merged = Object.assign({}, extraParams, override);
  const wrappedStreamFn = createStreamFnWithExtraParams(agent.streamFn, merged, provider);

  if (wrappedStreamFn) {
    log.debug(`applying extraParams to agent streamFn for ${provider}/${modelId}`);
    agent.streamFn = wrappedStreamFn;
  }

  if (provider === "openrouter") {
    log.debug(`applying OpenRouter app attribution headers for ${provider}/${modelId}`);
    agent.streamFn = createOpenRouterHeadersWrapper(agent.streamFn);
  }
}
