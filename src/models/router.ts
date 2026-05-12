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
  TierReasoningEffort,
} from "./types.js";
import { DEFAULT_TIER_MODELS, BUILTIN_PROFILES } from "./builtin-profiles.js";
import { ModelHealthTracker, getModelHealthTracker } from "./model-health-tracker.js";

export { BUILTIN_PROFILES };
export { ModelHealthTracker, getModelHealthTracker } from "./model-health-tracker.js";

const DEFAULT_THRESHOLDS = {
  local: 0.3,
  fast: 0.5,
  balanced: 0.8,
};

const TIER_PRIORITY: Record<ModelTier, number> = {
  local: 0,
  fast: 1,
  balanced: 2,
  powerful: 3,
};

const TOOL_TRIGGER_PATTERNS = [
  /\b(save|store|record|log|write)\b.*\b(memory|that|this|it)\b/i,
  /\b(remember|don't forget|note that|keep in mind)\b/i,
  /\b(check|show|list|view)\b.*\b(task|tasks|todo|schedule)\b/i,
  /\b(send|message|dm|notify|ping)\b.*\b(discord|telegram|slack|email)\b/i,
  /\b(search|look up|find|fetch)\b.*\b(web|online|google|news)\b/i,
  /\b(add|create|start|complete|finish|block)\b.*\b(task|tasks)\b/i,
  /\b(generate|create|make)\b.*\b(image|audio|video|speech)\b/i,
  /\b(open|push|update)\b.*\b(doc|document|panel|canvas)\b/i,
];

const MEMORY_TRIGGER_PATTERNS = [
  /\b(remember|recall|what do you remember)\b/i,
  /\b(memory|memories|timeline)\b/i,
  /\b(earlier|previous|last)\s+(conversation|session|chat)\b/i,
  /\b(search|find|look up)\b.*\b(memory|memories|conversation|timeline|session)\b/i,
  /\b(when did|did we|have we)\b.*\b(talk|discuss|mention)\b/i,
];

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

/**
 * Normalize a per-tier `reasoningEffort` override.
 *
 * Mirrors `normalizeReasoningLevel()` in
 * `src/agents/pi-embedded-runner/extra-params.ts` — kept inline here so the
 * router has zero new imports outside `./types`. Returns `undefined` for
 * absent or unrecognized values (graceful no-op on misconfig).
 */
function normalizeTierReasoningEffort(raw: unknown): TierReasoningEffort | undefined {
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

  // Preserve a per-slot reasoningEffort override when present. We deliberately
  // do NOT inherit from `fallback` here — the tier-level override is opt-in
  // per slot, and falling back to a sibling slot's value would surprise users.
  const reasoningEffort = normalizeTierReasoningEffort(mapping.reasoningEffort);
  return reasoningEffort ? { provider, model, reasoningEffort } : { provider, model };
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

function isLikelyToolUsePrompt(prompt: string): boolean {
  return TOOL_TRIGGER_PATTERNS.some((pattern) => pattern.test(prompt));
}

function isLikelyMemoryUsePrompt(prompt: string): boolean {
  return MEMORY_TRIGGER_PATTERNS.some((pattern) => pattern.test(prompt));
}

/**
 * If the primary (provider, model) has flaked recently (per
 * {@link ModelHealthTracker}), promote the first healthy alternate from the
 * fallback chain into the primary slot.  Demotes the flaking primary into
 * the front of sessionFallbacks (still selectable, just lower priority).
 *
 * Wired in for #281 — proactive complement to the reactive retry-fallback
 * path PR #279 wired into `pi-embedded-runner/run.ts`.
 *
 * Never blocks a model: if every candidate is flaking, the original primary
 * is returned unchanged so routing still produces a usable answer.
 */
function maybeDeprioritizeFlakingPrimary(params: {
  primary: { provider: string; model: string };
  sessionFallbacks?: string[];
  profileFallbacks?: ProfileFallbackEntry[];
  tracker: ModelHealthTracker;
  defaultProvider: string;
}): {
  provider: string;
  model: string;
  sessionFallbacks?: string[];
  profileFallbacks?: ProfileFallbackEntry[];
  /** Set when the primary is currently flaking, regardless of whether a swap happened. */
  flakingPrimary: boolean;
  /** Set only when an alternate was promoted into the primary slot. */
  swapped: boolean;
  /** Identifier of the alternate that won (when swapped). */
  swappedFromRef?: string;
  swappedToRef?: string;
} {
  const { primary, sessionFallbacks, profileFallbacks, tracker, defaultProvider } = params;
  const flakingPrimary = tracker.isFlaking(primary.provider, primary.model);
  if (!flakingPrimary) {
    return {
      provider: primary.provider,
      model: primary.model,
      sessionFallbacks,
      profileFallbacks,
      flakingPrimary: false,
      swapped: false,
    };
  }

  const primaryRef = `${primary.provider}/${primary.model}`;

  // Walk sessionFallbacks first (string "provider/model"), then profileFallbacks.
  if (Array.isArray(sessionFallbacks) && sessionFallbacks.length > 0) {
    for (let i = 0; i < sessionFallbacks.length; i++) {
      const raw = String(sessionFallbacks[i] ?? "").trim();
      if (!raw) continue;
      const slash = raw.indexOf("/");
      const provider = slash > 0 ? raw.slice(0, slash) : defaultProvider;
      const model = slash > 0 ? raw.slice(slash + 1) : raw;
      if (!provider || !model) continue;
      if (!tracker.isFlaking(provider, model)) {
        const next = sessionFallbacks.slice();
        next.splice(i, 1);
        // Demote the flaking primary to the front of the fallback list — still
        // selectable, but no longer the first choice.
        next.unshift(primaryRef);
        return {
          provider,
          model,
          sessionFallbacks: next,
          profileFallbacks,
          flakingPrimary: true,
          swapped: true,
          swappedFromRef: primaryRef,
          swappedToRef: `${provider}/${model}`,
        };
      }
    }
  }

  if (Array.isArray(profileFallbacks) && profileFallbacks.length > 0) {
    for (let i = 0; i < profileFallbacks.length; i++) {
      const entry = profileFallbacks[i];
      if (!entry?.provider || !entry?.model) continue;
      if (!tracker.isFlaking(entry.provider, entry.model)) {
        const next = profileFallbacks.slice();
        next.splice(i, 1);
        // profileFallbacks entries carry profile metadata, so we don't push
        // the flaking primary back into that list (it doesn't belong to a
        // different profile). The pi-embedded-runner's retry-fallback path
        // (PR #279) still kicks in if the alternate also returns empty.
        return {
          provider: entry.provider,
          model: entry.model,
          sessionFallbacks,
          profileFallbacks: next,
          flakingPrimary: true,
          swapped: true,
          swappedFromRef: primaryRef,
          swappedToRef: `${entry.provider}/${entry.model}`,
        };
      }
    }
  }

  // All candidates are flaking — preserve original primary so routing remains usable.
  return {
    provider: primary.provider,
    model: primary.model,
    sessionFallbacks,
    profileFallbacks,
    flakingPrimary: true,
    swapped: false,
  };
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

function applyTierFloor(
  tier: ModelTier,
  minTier: ModelTier | undefined,
  reason: string,
  reasons: string[],
): ModelTier {
  if (!minTier) {
    return tier;
  }
  if (TIER_PRIORITY[tier] >= TIER_PRIORITY[minTier]) {
    return tier;
  }
  reasons.push(reason);
  return minTier;
}

// ============================================================================
// Router
// ============================================================================

/**
 * Route a request to the appropriate model tier.
 *
 * Returns the provider/model to use, plus metadata about the decision.
 * If routing is disabled, returns { routed: false } with the original
 * provider/model. Explicit Deep Think requests still route to the active
 * profile's powerful tier even when the session has a preselected model.
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
  /**
   * Optional ModelHealthTracker override.  When omitted, the process-local
   * singleton is used so observations from `pi-embedded-runner/run.ts` flow
   * through here automatically.  Tests inject a fresh instance.
   */
  healthTracker?: ModelHealthTracker;
}): RoutingDecision {
  const { signals, config, defaultProvider, defaultModel } = params;
  const healthTracker = params.healthTracker ?? getModelHealthTracker();

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
    const swap = maybeDeprioritizeFlakingPrimary({
      primary: { provider: mapping.provider, model: mapping.model },
      sessionFallbacks,
      profileFallbacks,
      tracker: healthTracker,
      defaultProvider: mapping.provider,
    });
    const reasonParts: string[] = ["forceMaxTier (deep think)"];
    if (swap.swapped) {
      reasonParts.push(`recent-empty deprioritized ${swap.swappedFromRef} → ${swap.swappedToRef}`);
    } else if (swap.flakingPrimary) {
      reasonParts.push("recent-empty flaking (no healthy alternate)");
    }
    if (config.verbose) {
      console.log(
        `[model-router] forceMaxTier → powerful (${swap.provider}/${swap.model})${swap.swapped ? ` [deprioritized ${swap.swappedFromRef}]` : ""}`,
      );
    }
    return {
      provider: swap.provider,
      model: swap.model,
      ...(swap.sessionFallbacks ? { fallbacks: swap.sessionFallbacks } : {}),
      ...(swap.profileFallbacks ? { profileFallbacks: swap.profileFallbacks } : {}),
      tier: "powerful",
      score: 1,
      reason: reasonParts.join(", "),
      routed: true,
      profile: profileName,
      ...(mapping.reasoningEffort ? { reasoningEffort: mapping.reasoningEffort } : {}),
    };
  }

  // If user explicitly specified a model/provider, respect the override after
  // forceMaxTier has had a chance to promote the run to the profile's top tier.
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
    const swap = maybeDeprioritizeFlakingPrimary({
      primary: { provider: mapping.provider, model: mapping.model },
      profileFallbacks,
      tracker: healthTracker,
      defaultProvider: mapping.provider,
    });
    const reasonParts: string[] = [`tool override: ${signals.toolName}`];
    if (swap.swapped) {
      reasonParts.push(`recent-empty deprioritized ${swap.swappedFromRef} → ${swap.swappedToRef}`);
    } else if (swap.flakingPrimary) {
      reasonParts.push("recent-empty flaking (no healthy alternate)");
    }
    if (config.verbose) {
      console.log(
        `[model-router] toolOverride: ${signals.toolName} → ${forcedTier} (${swap.provider}/${swap.model})${swap.swapped ? ` [deprioritized ${swap.swappedFromRef}]` : ""}`,
      );
    }
    return {
      provider: swap.provider,
      model: swap.model,
      ...(swap.profileFallbacks ? { profileFallbacks: swap.profileFallbacks } : {}),
      tier: forcedTier,
      score: 1,
      reason: reasonParts.join(", "),
      routed: true,
      profile: profileName,
      ...(mapping.reasoningEffort ? { reasoningEffort: mapping.reasoningEffort } : {}),
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

  if (signals.sessionType === "main") {
    tier = applyTierFloor(
      tier,
      isLikelyMemoryUsePrompt(signals.prompt)
        ? activeProfile?.routingPolicy?.likelyMemoryUseMinTier
        : undefined,
      "memory-likely floor",
      reasons,
    );
    tier = applyTierFloor(
      tier,
      isLikelyToolUsePrompt(signals.prompt)
        ? activeProfile?.routingPolicy?.likelyToolUseMinTier
        : undefined,
      "tool-likely floor",
      reasons,
    );
  }

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

  // De-prioritize the resolved primary when it has flaked recently (#281).
  // Promotes the first healthy fallback into the primary slot; the original
  // primary is demoted (still selectable, just lower priority).  Never blocks.
  const swap = maybeDeprioritizeFlakingPrimary({
    primary: { provider: mapping.provider, model: mapping.model },
    sessionFallbacks,
    profileFallbacks,
    tracker: healthTracker,
    defaultProvider: mapping.provider,
  });
  if (swap.swapped) {
    reasons.push(`recent-empty deprioritized ${swap.swappedFromRef} → ${swap.swappedToRef}`);
  } else if (swap.flakingPrimary) {
    reasons.push("recent-empty flaking (no healthy alternate)");
  }

  if (config.verbose) {
    console.log(
      `[model-router] ${profileName ? `profile=${profileName} ` : ""}score=${score.toFixed(2)} tier=${tier} → ${swap.provider}/${swap.model}${swap.swapped ? ` [deprioritized ${swap.swappedFromRef}]` : ""} (${reasons.join(", ")})`,
    );
  }

  return {
    provider: swap.provider,
    model: swap.model,
    ...(swap.sessionFallbacks ? { fallbacks: swap.sessionFallbacks } : {}),
    ...(swap.profileFallbacks ? { profileFallbacks: swap.profileFallbacks } : {}),
    tier,
    score,
    reason: reasons.join(", "),
    routed: true,
    profile: profileName,
    ...(mapping.reasoningEffort ? { reasoningEffort: mapping.reasoningEffort } : {}),
  };
}
