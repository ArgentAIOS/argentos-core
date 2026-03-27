/**
 * Model Router Types
 *
 * Defines the tier-based routing system that maps task complexity
 * to the cheapest capable model.
 */

export type ModelTier = "local" | "fast" | "balanced" | "powerful";

export type TierModelMapping = {
  provider: string;
  model: string;
};

export type SessionModelOverride = TierModelMapping & {
  /**
   * Optional model fallback chain for this session override.
   * Entries use provider/model format.
   */
  fallbacks?: string[];
};

export type ModelProfileRoutingPolicy = {
  /**
   * Minimum tier to use when the prompt is likely to require a tool call.
   * Omit to disable this floor for the profile.
   */
  likelyToolUseMinTier?: ModelTier;
  /**
   * Minimum tier to use when the prompt is likely to require memory/timeline retrieval.
   * Omit to disable this floor for the profile.
   */
  likelyMemoryUseMinTier?: ModelTier;
};

export type ModelProfile = {
  label?: string;
  tiers: Partial<Record<ModelTier, TierModelMapping>>;
  /** Next profile to try when this profile's provider is unavailable (rate-limited). */
  fallbackProfile?: string;
  /** Optional routing heuristics for this profile. */
  routingPolicy?: ModelProfileRoutingPolicy;
  /**
   * Session-specific model overrides for this profile.
   * Useful for forcing contemplation/SIS to a dedicated model chain.
   */
  sessionOverrides?: {
    contemplation?: SessionModelOverride;
  };
};

export type ModelRouterConfig = {
  /** Enable model routing (default: false). */
  enabled?: boolean;
  /** Active profile name — resolves from `profiles` map. */
  activeProfile?: string;
  /** Named model profiles (presets for tier mappings). */
  profiles?: Record<string, ModelProfile>;
  /** Tier-to-model mappings (legacy / inline fallback). */
  tiers?: Partial<Record<ModelTier, TierModelMapping>>;
  /** Score thresholds for tier boundaries (0-1 scale). */
  thresholds?: {
    /** Below this → local (default: 0.3). */
    local?: number;
    /** Below this → fast (default: 0.5). */
    fast?: number;
    /** Below this → balanced (default: 0.8). */
    balanced?: number;
    /** Above balanced → powerful. */
  };
  /** Log routing decisions (default: false). */
  verbose?: boolean;
  /** Force a minimum tier for specific tools (e.g., { "apps": "powerful" }). */
  toolOverrides?: Record<string, ModelTier>;
};

export type ComplexitySignals = {
  /** The user prompt text. */
  prompt: string;
  /** Whether extended thinking was requested. */
  thinkingLevel?: string;
  /** Whether this session has prior conversation history. */
  hasHistory?: boolean;
  /** The channel the message came from. */
  channel?: string;
  /** Whether image input is attached. */
  hasImages?: boolean;
  /** Tools available in this session. */
  toolCount?: number;
  /** Session type (main, heartbeat, subagent, contemplation). */
  sessionType?: "main" | "heartbeat" | "subagent" | "contemplation";
  /** Active tool being invoked (for tool-level overrides). */
  toolName?: string;
  /** Force the most powerful tier (e.g., dashboard deep-think toggle). */
  forceMaxTier?: boolean;
};

export type ProfileFallbackEntry = {
  profile: string;
  provider: string;
  model: string;
  tier: ModelTier;
};

export type RoutingDecision = {
  provider: string;
  model: string;
  /** Optional explicit fallback chain for this routed session. */
  fallbacks?: string[];
  /** Ordered cross-provider fallback profiles to try if the primary provider is unavailable. */
  profileFallbacks?: ProfileFallbackEntry[];
  tier: ModelTier;
  score: number;
  reason: string;
  /** Whether routing was applied (false if user override or disabled). */
  routed: boolean;
  /** Active profile name, if one was resolved. */
  profile?: string;
};
