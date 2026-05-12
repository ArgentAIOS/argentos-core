/**
 * Built-in Model Routing Profiles
 *
 * Single source of truth for default routing profiles. Used by:
 * - src/models/router.ts (runtime profile resolution)
 * - dashboard/api-server.cjs (profile listing endpoint)
 */

import type { ModelTier, TierModelMapping, ModelProfile } from "./types.js";

export const DEFAULT_TIER_MODELS: Record<ModelTier, TierModelMapping> = {
  local: { provider: "ollama", model: "qwen3:30b-a3b-instruct-2507-q4_K_M" },
  fast: { provider: "anthropic", model: "claude-sonnet-4-6" },
  balanced: { provider: "anthropic", model: "claude-opus-4-6" },
  powerful: { provider: "anthropic", model: "claude-opus-4-6" },
};

export const BUILTIN_PROFILES: Record<
  string,
  {
    label: string;
    tiers: Record<ModelTier, TierModelMapping>;
    routingPolicy?: ModelProfile["routingPolicy"];
    sessionOverrides?: ModelProfile["sessionOverrides"];
  }
> = {
  default: {
    label: "Default (Anthropic)",
    tiers: { ...DEFAULT_TIER_MODELS },
    routingPolicy: { likelyToolUseMinTier: "balanced" },
  },
  "minimax-mix": {
    label: "MiniMax Mix",
    tiers: {
      local: { provider: "ollama", model: "qwen3:30b-a3b-instruct-2507-q4_K_M" },
      // Track the most-recent flagship in provider-registry-seed.ts. The
      // onboarding default for MiniMax is "MiniMax-M2.7-highspeed" — keep
      // the built-in profile aligned so catalog audits don't see drift.
      fast: { provider: "minimax", model: "MiniMax-M2.7-highspeed" },
      balanced: { provider: "minimax", model: "MiniMax-M2.7" },
      powerful: { provider: "anthropic", model: "claude-opus-4-6" },
    },
    routingPolicy: { likelyToolUseMinTier: "balanced" },
  },
  budget: {
    label: "Budget",
    tiers: {
      local: { provider: "ollama", model: "qwen3:30b-a3b-instruct-2507-q4_K_M" },
      // See minimax-mix comment above re: model-id pinning.
      fast: { provider: "minimax", model: "MiniMax-M2.7-highspeed" },
      balanced: { provider: "minimax", model: "MiniMax-M2.7" },
      powerful: { provider: "anthropic", model: "claude-sonnet-4-6" },
    },
    routingPolicy: { likelyToolUseMinTier: "balanced" },
  },
  // nvidia-free was removed 2026-05-12 (issue #108 catalog follow-through):
  // the `nvidia` provider has no entry in provider-registry-seed.ts and no
  // onboarding/auth path, so this profile could not be activated without
  // hand-editing config + setting NVIDIA_API_KEY. If we want a real NVIDIA
  // routing option we should wire the provider end-to-end first.
};
