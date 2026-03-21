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
    sessionOverrides?: ModelProfile["sessionOverrides"];
  }
> = {
  default: {
    label: "Default (Anthropic)",
    tiers: { ...DEFAULT_TIER_MODELS },
  },
  "minimax-mix": {
    label: "MiniMax Mix",
    tiers: {
      local: { provider: "ollama", model: "qwen3:30b-a3b-instruct-2507-q4_K_M" },
      fast: { provider: "minimax", model: "MiniMax-M2.5" },
      balanced: { provider: "minimax", model: "MiniMax-M2.5" },
      powerful: { provider: "anthropic", model: "claude-opus-4-6" },
    },
  },
  budget: {
    label: "Budget",
    tiers: {
      local: { provider: "ollama", model: "qwen3:30b-a3b-instruct-2507-q4_K_M" },
      fast: { provider: "minimax", model: "MiniMax-M2.5" },
      balanced: { provider: "minimax", model: "MiniMax-M2.5" },
      powerful: { provider: "anthropic", model: "claude-sonnet-4-6" },
    },
  },
  "nvidia-free": {
    label: "NVIDIA Free",
    tiers: {
      local: { provider: "ollama", model: "qwen3:30b-a3b-instruct-2507-q4_K_M" },
      fast: { provider: "nvidia", model: "nvidia/mistral-nemo-minitron-8b-8k-instruct" },
      balanced: { provider: "nvidia", model: "nvidia/llama-3.3-70b-instruct" },
      powerful: { provider: "nvidia", model: "nvidia/llama-3.1-nemotron-70b-instruct" },
    },
  },
};
