/**
 * Model Router
 *
 * Routes agent requests to the cheapest capable model based on
 * complexity scoring. Tiers:
 *
 *   LOCAL    (score < 0.3)  — Qwen3 30B-A3B via Ollama (free)
 *   FAST     (0.3 - 0.5)   — Claude Sonnet ($)
 *   BALANCED (0.5 - 0.8)   — Claude Opus ($$)
 *   POWERFUL (> 0.8)        — Claude Opus ($$$)
 */

import type {
  ComplexitySignals,
  ModelRouterConfig,
  ModelProfile,
  ModelTier,
  ProfileFallbackEntry,
  RoutingDecision,
  SessionModelOverride,
  TierModelMapping,
} from "./types.js";
import { DEFAULT_TIER_MODELS, BUILTIN_PROFILES } from "./builtin-profiles.js";

export { BUILTIN_PROFILES };

const DEFAULT_THRESHOLDS = {
  local: 0.3,
  fast: 0.5,
  balanced: 0.8,
};

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") {
    return "zai";
  }
  if (normalized === "opencode-zen") {
    return "opencode";
  }
  return normalized;
}

function inferProviderFromModel(model: string): string | null {
  const lower = model.trim().toLowerCase();
  if (!lower) {
    return null;
  }
  if (lower.startsWith("minimax")) return "minimax";
  if (lower.startsWith("claude")) return "anthropic";
  if (lower.startsWith("gpt-") || lower.startsWith("o3") || lower.startsWith("o4")) return "openai";
  if (lower.startsWith("gemini")) return "google";
  if (lower.startsWith("glm")) return "zai";
  if (lower.startsWith("grok")) return "xai";
  if (lower.startsWith("nvidia/")) return "nvidia";
  if (lower.includes("llama") && lower.includes("qwen")) return "ollama";
  return null;
}

function normalizeTierMapping(
  mapping: TierModelMapping,
  fallback: TierModelMapping,
): TierModelMapping {
  let provider = String(mapping.provider ?? "").trim();
  let model = String(mapping.model ?? "").trim();

  // Support accidental "provider/model" values pasted into either field.
  if (provider.includes("/")) {
    const slash = provider.indexOf("/");
    const parsedProvider = provider.slice(0, slash).trim();
    const parsedModel = provider.slice(slash + 1).trim();
    if (
      parsedProvider &&
      parsedModel &&
      (!model || model === provider || model === parsedProvider)
    ) {
      provider = parsedProvider;
      model = parsedModel;
    }
  }
  if (model.includes("/") && (!provider || provider === model)) {
    const slash = model.indexOf("/");
    const parsedProvider = model.slice(0, slash).trim();
    const parsedModel = model.slice(slash + 1).trim();
    if (parsedProvider && parsedModel) {
      provider = parsedProvider;
      model = parsedModel;
    }
  }

  // Common malformed shape from manual profile edits:
  // provider == model == model-id (e.g., "MiniMax-M2.1").
  if (provider && model && provider.toLowerCase() === model.toLowerCase()) {
    const inferred = inferProviderFromModel(model);
    if (inferred) {
      provider = inferred;
    }
  }

  provider = normalizeProvider(provider || fallback.provider);
  model = model || fallback.model;

  if (!provider) provider = fallback.provider;
  if (!model) model = fallback.model;

  return { provider, model };
}

function resolveTierModels(params: {
  profileTiers?: Partial<Record<ModelTier, TierModelMapping>>;
  configTiers?: Partial<Record<ModelTier, TierModelMapping>>;
}): Record<ModelTier, TierModelMapping> {
  const merged = {
    ...DEFAULT_TIER_MODELS,
    ...(params.profileTiers || params.configTiers),
  };
  return {
    local: normalizeTierMapping(merged.local, DEFAULT_TIER_MODELS.local),
    fast: normalizeTierMapping(merged.fast, DEFAULT_TIER_MODELS.fast),
    balanced: normalizeTierMapping(merged.balanced, DEFAULT_TIER_MODELS.balanced),
    powerful: normalizeTierMapping(merged.powerful, DEFAULT_TIER_MODELS.powerful),
  };
}

function normalizeFallbackRefs(
  refs: string[] | undefined,
  fallbackProvider: string,
): string[] | undefined {
  if (!Array.isArray(refs)) {
    return undefined;
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of refs) {
    const raw = String(entry ?? "").trim();
    if (!raw) continue;
    let provider = fallbackProvider;
    let model = raw;
    const slash = raw.indexOf("/");
    if (slash > 0 && slash < raw.length - 1) {
      provider = raw.slice(0, slash).trim();
      model = raw.slice(slash + 1).trim();
    }
    provider = normalizeProvider(provider);
    if (!provider || !model) continue;
    const key = `${provider}/${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized.length > 0 ? normalized : [];
}

/**
 * Walk the fallbackProfile chain from a starting profile and build
 * an ordered array of fallback entries for the given tier.
 * Detects cycles and stops when no further fallbacks are defined.
 */
function buildProfileFallbacks(params: {
  startProfile?: ModelProfile;
  startProfileName?: string;
  config?: ModelRouterConfig;
  tier: ModelTier;
}): ProfileFallbackEntry[] | undefined {
  const { startProfile, startProfileName, config, tier } = params;
  if (!startProfile?.fallbackProfile || !config?.profiles) {
    return undefined;
  }
  const fallbacks: ProfileFallbackEntry[] = [];
  const visited = new Set<string>([startProfileName ?? ""]);
  let nextName: string | undefined = startProfile.fallbackProfile;

  while (nextName && !visited.has(nextName)) {
    visited.add(nextName);
    const nextProfile: ModelProfile | undefined =
      config.profiles?.[nextName] ?? BUILTIN_PROFILES[nextName];
    if (!nextProfile) break;

    const nextTierModels = resolveTierModels({ profileTiers: nextProfile.tiers });
    const mapping = nextTierModels[tier];
    fallbacks.push({
      profile: nextName,
      provider: mapping.provider,
      model: mapping.model,
      tier,
    });
    nextName = nextProfile.fallbackProfile;
  }
  return fallbacks.length > 0 ? fallbacks : undefined;
}

// ============================================================================
// Complexity Scoring
// ============================================================================

/**
 * Score the complexity of a request on a 0-1 scale.
 *
 * Factors considered:
 * - Prompt length and structure
 * - Thinking level requested
 * - Image input (requires vision models)
 * - Session type (heartbeat = simple, main = variable)
 * - Tool density hints
 * - Code/technical content patterns
 */
export function scoreComplexity(signals: ComplexitySignals): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;
  const prompt = signals.prompt;
  const len = prompt.length;

  // ---- Prompt length ----
  if (len < 80) {
    score += 0.05;
    reasons.push("short prompt");
  } else if (len < 300) {
    score += 0.15;
    reasons.push("medium prompt");
  } else if (len < 1000) {
    score += 0.3;
    reasons.push("long prompt");
  } else {
    score += 0.45;
    reasons.push("very long prompt");
  }

  // ---- Thinking level ----
  // The thinking level is a user preference for *how* the model reasons,
  // not a signal of task complexity.  A user who always sets xhigh still
  // sends simple "hey" messages that belong on the balanced tier.
  // Only boost when the level genuinely implies harder reasoning.
  const think = signals.thinkingLevel?.toLowerCase();
  if (think === "xhigh" || think === "high") {
    score += 0.15;
    reasons.push(`thinking:${think}`);
  } else if (think === "medium") {
    score += 0.1;
    reasons.push("thinking:medium");
  } else if (think === "low" || think === "minimal") {
    score += 0.05;
    reasons.push("thinking:low");
  }

  // ---- Image input (requires vision-capable model) ----
  if (signals.hasImages) {
    score += 0.3;
    reasons.push("has images");
  }

  // ---- Session type & tool-hint signal ----
  if (signals.sessionType === "heartbeat") {
    // Heartbeats run nudges, research tasks, and tool calls — they need a
    // model that can actually execute tools reliably.  Apply a FAST floor
    // (same as user-facing) so heartbeats never land on local-only models
    // that produce shallow lip-service output.
    const HB_FAST_FLOOR = 0.3;
    if (score < HB_FAST_FLOOR) {
      score = HB_FAST_FLOOR;
      reasons.push("heartbeat floor (tools + nudges)");
    } else {
      reasons.push("heartbeat");
    }
  } else if (signals.sessionType === "contemplation") {
    // Contemplation needs depth — self-directed thinking, introspection,
    // pattern recognition. Cheap models take the easy rest exit.
    score = Math.max(score, 0.85);
    reasons.push("contemplation (boosted to powerful)");
  } else if (signals.sessionType === "subagent") {
    score += 0.1;
    reasons.push("subagent");
  } else if (signals.sessionType === "main") {
    // User-facing sessions have tools and injected context.
    // Local models can't handle either — enforce Haiku floor.
    const FAST_FLOOR = 0.3;
    if (score < FAST_FLOOR) {
      score = FAST_FLOOR;
      reasons.push("user-facing floor (tools + context)");
    }

    // Haiku occasionally simulates tool calls as text on short prompts
    // instead of making real tool_use blocks. Boost to Sonnet when the
    // prompt is likely to trigger tool use.
    const toolTriggerPatterns = [
      /\b(save|store|record|log|write)\b.*\b(memory|that|this|it)\b/i,
      /\b(remember|don't forget|note that|keep in mind)\b/i,
      /\b(check|show|list|view)\b.*\b(task|tasks|todo|schedule)\b/i,
      /\b(send|message|dm|notify|ping)\b.*\b(discord|telegram|slack|email)\b/i,
      /\b(search|look up|find|fetch)\b.*\b(web|online|google|news)\b/i,
      /\b(add|create|start|complete|finish|block)\b.*\b(task|tasks)\b/i,
      /\b(generate|create|make)\b.*\b(image|audio|video|speech)\b/i,
      /\b(open|push|update)\b.*\b(doc|document|panel|canvas)\b/i,
    ];
    const BALANCED_FLOOR = 0.5;
    if (score < BALANCED_FLOOR) {
      for (const pattern of toolTriggerPatterns) {
        if (pattern.test(prompt)) {
          score = BALANCED_FLOOR;
          reasons.push("tool-likely prompt (boosted to balanced)");
          break;
        }
      }
    }
  }

  // ---- Code/technical patterns ----
  const codePatterns = [
    /```[\s\S]*?```/, // Code blocks
    /\b(function|class|import|export|const|let|var|def|async|await)\b/,
    /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i,
    /\b(docker|kubernetes|terraform|ansible|nginx)\b/i,
  ];
  let codeMatches = 0;
  for (const pattern of codePatterns) {
    if (pattern.test(prompt)) codeMatches++;
  }
  if (codeMatches >= 3) {
    score += 0.2;
    reasons.push("heavy code/technical content");
  } else if (codeMatches >= 1) {
    score += 0.1;
    reasons.push("some code/technical content");
  }

  // ---- Reasoning/analysis patterns ----
  const reasoningPatterns = [
    /\b(analyze|compare|evaluate|design|architect|refactor|optimize|debug)\b/i,
    /\b(trade-?offs?|pros?\s+and\s+cons?|advantages?\s+and\s+disadvantages?)\b/i,
    /\b(step[- ]by[- ]step|explain\s+how|walk\s+me\s+through)\b/i,
    /\b(implement|build|create|write)\b.*\b(system|pipeline|framework|service)\b/i,
  ];
  let reasoningMatches = 0;
  for (const pattern of reasoningPatterns) {
    if (pattern.test(prompt)) reasoningMatches++;
  }
  if (reasoningMatches >= 2) {
    score += 0.15;
    reasons.push("reasoning/analysis required");
  } else if (reasoningMatches >= 1) {
    score += 0.05;
    reasons.push("some reasoning needed");
  }

  // ---- Simple query patterns (reduce score) ----
  const simplePatterns = [
    /^(hi|hello|hey|thanks|ok|yes|no|sure)\b/i,
    /^(what time|what date|what day|how are you)/i,
    /^(remind me|set a timer|set an alarm)/i,
    /^(what is|who is|where is|when is)\b.{0,50}$/i,
  ];
  for (const pattern of simplePatterns) {
    if (pattern.test(prompt)) {
      score -= 0.15;
      reasons.push("simple query");
      break;
    }
  }

  // ---- Memory patterns (need smarter model to use injected context + tools) ----
  // Keep these tight — broad words like "before", "working on" match casual chat.
  // This is a tiebreaker (+0.10), not a tier jump.
  const recallPatterns = [
    /\b(recall|previous session|earlier conversation|last session)\b/i,
    /\b(summarize|summary|recap|overview)\b.*\b(what|my|our|recent)\b/i,
    /\b(search|find|look up)\b.*\b(memory|memories|conversation|session)\b/i,
    /\b(save|store|record|log)\b.*\b(memory|that|this)\b/i,
    /\b(don't forget|note that|keep in mind)\b/i,
  ];
  for (const pattern of recallPatterns) {
    if (pattern.test(prompt)) {
      score += 0.1;
      reasons.push("memory/recall query");
      break;
    }
  }

  // ---- Multi-step task patterns ----
  // Require explicit sequencing language — "then", "next", "also" alone are too broad.
  const multiStepPatterns = [
    /\b(after that|and then|once that's done|step \d)\b/i,
    /\b\d+\.\s+/, // Numbered list
  ];
  let multiStepMatches = 0;
  for (const pattern of multiStepPatterns) {
    if (pattern.test(prompt)) multiStepMatches++;
  }
  if (multiStepMatches >= 2) {
    score += 0.1;
    reasons.push("multi-step task");
  }

  // ---- Conversation depth ----
  if (signals.hasHistory) {
    score += 0.05;
    reasons.push("has history");
  }

  // Clamp to 0-1
  score = Math.max(0, Math.min(1, score));

  return { score, reasons };
}

// ============================================================================
// Tier Resolution
// ============================================================================

function resolveTier(
  score: number,
  thresholds: { local: number; fast: number; balanced: number },
): ModelTier {
  if (score < thresholds.local) return "local";
  if (score < thresholds.fast) return "fast";
  if (score < thresholds.balanced) return "balanced";
  return "powerful";
}

// ============================================================================
// Router
// ============================================================================

/**
 * Route a request to the appropriate model tier.
 *
 * Returns the provider/model to use, plus metadata about the decision.
 * If routing is disabled or the user explicitly specified a model,
 * returns { routed: false } with the original provider/model.
 */
export function routeModel(params: {
  signals: ComplexitySignals;
  config?: ModelRouterConfig;
  /** User explicitly requested this provider (skip routing). */
  requestedProvider?: string;
  /** User explicitly requested this model (skip routing). */
  requestedModel?: string;
  /** Default provider when not routing. */
  defaultProvider: string;
  /** Default model when not routing. */
  defaultModel: string;
}): RoutingDecision {
  const { signals, config, defaultProvider, defaultModel } = params;

  // If routing is disabled, pass through
  if (!config?.enabled) {
    return {
      provider: defaultProvider,
      model: defaultModel,
      tier: "powerful",
      score: 1,
      reason: "routing disabled",
      routed: false,
    };
  }

  // If user explicitly specified a model/provider, respect the override
  if (params.requestedProvider || params.requestedModel) {
    return {
      provider: params.requestedProvider || defaultProvider,
      model: params.requestedModel || defaultModel,
      tier: "powerful",
      score: 1,
      reason: "user override",
      routed: false,
    };
  }

  // Resolve active profile
  let profileName: string | undefined;
  let activeProfile: ModelProfile | undefined;

  if (config.activeProfile) {
    // Check user-defined profiles first, then built-in profiles
    const userProfile = config.profiles?.[config.activeProfile];
    const builtinProfile = BUILTIN_PROFILES[config.activeProfile];
    if (userProfile) {
      profileName = config.activeProfile;
      activeProfile = userProfile;
    } else if (builtinProfile) {
      profileName = config.activeProfile;
      activeProfile = builtinProfile;
    }
  }

  // Check forceMaxTier (e.g., dashboard deep-think toggle)
  const tierModels = resolveTierModels({
    profileTiers: activeProfile?.tiers,
    configTiers: config.tiers,
  });

  const contemplationOverride = activeProfile?.sessionOverrides?.contemplation;
  let contemplationMapping: SessionModelOverride | undefined;
  if (signals.sessionType === "contemplation" && contemplationOverride) {
    contemplationMapping = {
      ...normalizeTierMapping(contemplationOverride, tierModels.powerful),
      fallbacks: normalizeFallbackRefs(
        contemplationOverride.fallbacks,
        tierModels.powerful.provider,
      ),
    };
  }
  const sessionFallbacks = contemplationMapping?.fallbacks;
  if (signals.forceMaxTier) {
    const mapping = contemplationMapping ?? tierModels.powerful;
    const profileFallbacks = buildProfileFallbacks({
      startProfile: activeProfile,
      startProfileName: profileName,
      config,
      tier: "powerful",
    });
    if (config.verbose) {
      console.log(`[model-router] forceMaxTier → powerful (${mapping.provider}/${mapping.model})`);
    }
    return {
      provider: mapping.provider,
      model: mapping.model,
      ...(sessionFallbacks ? { fallbacks: sessionFallbacks } : {}),
      ...(profileFallbacks ? { profileFallbacks } : {}),
      tier: "powerful",
      score: 1,
      reason: "forceMaxTier (deep think)",
      routed: true,
      profile: profileName,
    };
  }

  // Check tool-level overrides before complexity scoring
  if (signals.toolName && config.toolOverrides?.[signals.toolName]) {
    const forcedTier = config.toolOverrides[signals.toolName];
    const mapping = tierModels[forcedTier];
    const profileFallbacks = buildProfileFallbacks({
      startProfile: activeProfile,
      startProfileName: profileName,
      config,
      tier: forcedTier,
    });
    if (config.verbose) {
      console.log(
        `[model-router] toolOverride: ${signals.toolName} → ${forcedTier} (${mapping.provider}/${mapping.model})`,
      );
    }
    return {
      provider: mapping.provider,
      model: mapping.model,
      ...(profileFallbacks ? { profileFallbacks } : {}),
      tier: forcedTier,
      score: 1,
      reason: `tool override: ${signals.toolName}`,
      routed: true,
      profile: profileName,
    };
  }

  // Score the complexity
  const { score, reasons } = scoreComplexity(signals);

  // Resolve thresholds
  const thresholds = {
    local: config.thresholds?.local ?? DEFAULT_THRESHOLDS.local,
    fast: config.thresholds?.fast ?? DEFAULT_THRESHOLDS.fast,
    balanced: config.thresholds?.balanced ?? DEFAULT_THRESHOLDS.balanced,
  };

  // Map score to tier
  let tier = resolveTier(score, thresholds);

  // Images require a vision-capable model. Local and fast tiers often lack
  // vision support, so force at least balanced when images are present.
  if (signals.hasImages && (tier === "local" || tier === "fast")) {
    if (config.verbose) {
      console.log(`[model-router] image input: promoting ${tier} → balanced (vision required)`);
    }
    reasons.push("image→balanced");
    tier = "balanced";
  }

  // Resolve tier to provider/model
  const mapping = contemplationMapping ?? tierModels[tier];
  const profileFallbacks = buildProfileFallbacks({
    startProfile: activeProfile,
    startProfileName: profileName,
    config,
    tier,
  });

  if (config.verbose) {
    console.log(
      `[model-router] ${profileName ? `profile=${profileName} ` : ""}score=${score.toFixed(2)} tier=${tier} → ${mapping.provider}/${mapping.model} (${reasons.join(", ")})`,
    );
  }

  return {
    provider: mapping.provider,
    model: mapping.model,
    ...(sessionFallbacks ? { fallbacks: sessionFallbacks } : {}),
    ...(profileFallbacks ? { profileFallbacks } : {}),
    tier,
    score,
    reason: reasons.join(", "),
    routed: true,
    profile: profileName,
  };
}
