/**
 * Argent AI — Model Database
 *
 * Pi-compatible model definitions with capabilities, pricing, and context windows.
 * Replaces the legacy upstream generated model catalog and model helpers.
 *
 * Prices are per million tokens. Cost structure matches Pi exactly.
 *
 * @module argent-ai/models-db
 */

import type { Api, KnownProvider, Model, Usage } from "./types.js";

// ============================================================================
// MODEL DEFINITIONS
// ============================================================================

type ModelDef = Omit<Model, "headers">;

const anthropicBase = {
  api: "anthropic-messages" as const,
  provider: "anthropic" as const,
  baseUrl: "https://api.anthropic.com",
  input: ["text", "image"] as ("text" | "image")[],
};

const openaiBase = {
  api: "openai-completions" as const,
  provider: "openai" as const,
  baseUrl: "https://api.openai.com",
  input: ["text", "image"] as ("text" | "image")[],
};

const googleBase = {
  api: "google-generative-ai" as const,
  provider: "google" as const,
  baseUrl: "https://generativelanguage.googleapis.com",
  input: ["text", "image"] as ("text" | "image")[],
};

const xaiBase = {
  api: "openai-completions" as const,
  provider: "xai" as const,
  baseUrl: "https://api.x.ai/v1",
  input: ["text", "image"] as ("text" | "image")[],
};

const minimaxBase = {
  api: "openai-completions" as const,
  provider: "minimax" as const,
  baseUrl: "https://api.minimaxi.chat/v1",
  input: ["text"] as ("text" | "image")[],
};

const zaiBase = {
  api: "openai-completions" as const,
  provider: "zai" as const,
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  input: ["text"] as ("text" | "image")[],
};

const nvidiaBase = {
  api: "openai-completions" as const,
  provider: "nvidia" as const,
  baseUrl: "https://integrate.api.nvidia.com/v1",
  input: ["text"] as ("text" | "image")[],
};

/**
 * Model definitions organized by provider.
 */
export const MODELS: Record<string, Record<string, ModelDef>> = {
  anthropic: {
    "claude-opus-4-6": {
      ...anthropicBase,
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 128000,
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    },
    "claude-opus-4-5": {
      ...anthropicBase,
      id: "claude-opus-4-5",
      name: "Claude Opus 4.5 (latest)",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    },
    "claude-opus-4-5-20251101": {
      ...anthropicBase,
      id: "claude-opus-4-5-20251101",
      name: "Claude Opus 4.5",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    },
    "claude-sonnet-4-6": {
      ...anthropicBase,
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6 (latest)",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    "claude-sonnet-4-5": {
      ...anthropicBase,
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    "claude-sonnet-4-5-20250929": {
      ...anthropicBase,
      id: "claude-sonnet-4-5-20250929",
      name: "Claude Sonnet 4.5",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    "claude-sonnet-4-0": {
      ...anthropicBase,
      id: "claude-sonnet-4-0",
      name: "Claude Sonnet 4 (latest)",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    "claude-sonnet-4-20250514": {
      ...anthropicBase,
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    "claude-opus-4-1": {
      ...anthropicBase,
      id: "claude-opus-4-1",
      name: "Claude Opus 4.1 (latest)",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 32000,
      cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    },
    "claude-opus-4-1-20250805": {
      ...anthropicBase,
      id: "claude-opus-4-1-20250805",
      name: "Claude Opus 4.1",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 32000,
      cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    },
    "claude-opus-4-0": {
      ...anthropicBase,
      id: "claude-opus-4-0",
      name: "Claude Opus 4 (latest)",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 32000,
      cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    },
    "claude-opus-4-20250514": {
      ...anthropicBase,
      id: "claude-opus-4-20250514",
      name: "Claude Opus 4",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 32000,
      cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    },
    "claude-haiku-4-5": {
      ...anthropicBase,
      id: "claude-haiku-4-5",
      name: "Claude Haiku 4.5 (latest)",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    },
    "claude-haiku-4-5-20251001": {
      ...anthropicBase,
      id: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    },
    "claude-3-7-sonnet-20250219": {
      ...anthropicBase,
      id: "claude-3-7-sonnet-20250219",
      name: "Claude Sonnet 3.7",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    "claude-3-7-sonnet-latest": {
      ...anthropicBase,
      id: "claude-3-7-sonnet-latest",
      name: "Claude Sonnet 3.7 (latest)",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    "claude-3-5-haiku-20241022": {
      ...anthropicBase,
      id: "claude-3-5-haiku-20241022",
      name: "Claude Haiku 3.5",
      reasoning: false,
      contextWindow: 200000,
      maxTokens: 8192,
      cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    },
    "claude-3-5-haiku-latest": {
      ...anthropicBase,
      id: "claude-3-5-haiku-latest",
      name: "Claude Haiku 3.5 (latest)",
      reasoning: false,
      contextWindow: 200000,
      maxTokens: 8192,
      cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    },
    "claude-3-5-sonnet-20241022": {
      ...anthropicBase,
      id: "claude-3-5-sonnet-20241022",
      name: "Claude Sonnet 3.5 v2",
      reasoning: false,
      contextWindow: 200000,
      maxTokens: 8192,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    "claude-3-5-sonnet-20240620": {
      ...anthropicBase,
      id: "claude-3-5-sonnet-20240620",
      name: "Claude Sonnet 3.5",
      reasoning: false,
      contextWindow: 200000,
      maxTokens: 8192,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    "claude-3-opus-20240229": {
      ...anthropicBase,
      id: "claude-3-opus-20240229",
      name: "Claude Opus 3",
      reasoning: false,
      contextWindow: 200000,
      maxTokens: 4096,
      cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    },
    "claude-3-haiku-20240307": {
      ...anthropicBase,
      id: "claude-3-haiku-20240307",
      name: "Claude Haiku 3",
      reasoning: false,
      contextWindow: 200000,
      maxTokens: 4096,
      cost: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
    },
  },

  openai: {
    "gpt-5.3-codex": {
      ...openaiBase,
      id: "gpt-5.3-codex",
      name: "GPT-5.3 Codex",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 1.75, output: 14, cacheRead: 0.44, cacheWrite: 1.75 },
    },
    "gpt-5.3-codex-spark": {
      ...openaiBase,
      id: "gpt-5.3-codex-spark",
      name: "GPT-5.3 Codex Spark",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 1.75, output: 14, cacheRead: 0.44, cacheWrite: 1.75 },
    },
    "gpt-5.2": {
      ...openaiBase,
      id: "gpt-5.2",
      name: "GPT-5.2",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 1.75, output: 14, cacheRead: 0.44, cacheWrite: 1.75 },
    },
    "gpt-5.2-codex": {
      ...openaiBase,
      id: "gpt-5.2-codex",
      name: "GPT-5.2 Codex",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 1.75, output: 14, cacheRead: 0.44, cacheWrite: 1.75 },
    },
    "gpt-5.1": {
      ...openaiBase,
      id: "gpt-5.1",
      name: "GPT-5.1",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 },
    },
    "gpt-5.1-codex": {
      ...openaiBase,
      id: "gpt-5.1-codex",
      name: "GPT-5.1 Codex",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 },
    },
    "gpt-5.1-codex-max": {
      ...openaiBase,
      id: "gpt-5.1-codex-max",
      name: "GPT-5.1 Codex Max",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 },
    },
    "gpt-5.1-codex-mini": {
      ...openaiBase,
      id: "gpt-5.1-codex-mini",
      name: "GPT-5.1 Codex mini",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 0.25, output: 2, cacheRead: 0.06, cacheWrite: 0.25 },
    },
    "gpt-5": {
      ...openaiBase,
      id: "gpt-5",
      name: "GPT-5",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 },
    },
    "gpt-5-mini": {
      ...openaiBase,
      id: "gpt-5-mini",
      name: "GPT-5 Mini",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 0.25, output: 2, cacheRead: 0.06, cacheWrite: 0.25 },
    },
    "gpt-5-nano": {
      ...openaiBase,
      id: "gpt-5-nano",
      name: "GPT-5 Nano",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      cost: { input: 0.05, output: 0.4, cacheRead: 0.01, cacheWrite: 0.05 },
    },
    "gpt-4.1": {
      ...openaiBase,
      id: "gpt-4.1",
      name: "GPT-4.1",
      reasoning: false,
      contextWindow: 1047576,
      maxTokens: 32768,
      cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
    },
    "gpt-4.1-mini": {
      ...openaiBase,
      id: "gpt-4.1-mini",
      name: "GPT-4.1 mini",
      reasoning: false,
      contextWindow: 1047576,
      maxTokens: 32768,
      cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4 },
    },
    "gpt-4.1-nano": {
      ...openaiBase,
      id: "gpt-4.1-nano",
      name: "GPT-4.1 nano",
      reasoning: false,
      contextWindow: 1047576,
      maxTokens: 32768,
      cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
    },
    "gpt-4o": {
      ...openaiBase,
      id: "gpt-4o",
      name: "GPT-4o",
      reasoning: false,
      contextWindow: 128000,
      maxTokens: 16384,
      cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
    },
    "gpt-4o-mini": {
      ...openaiBase,
      id: "gpt-4o-mini",
      name: "GPT-4o mini",
      reasoning: false,
      contextWindow: 128000,
      maxTokens: 16384,
      cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
    },
    o3: {
      ...openaiBase,
      id: "o3",
      name: "o3",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 100000,
      cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
    },
    "o3-mini": {
      ...openaiBase,
      id: "o3-mini",
      name: "o3-mini",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 100000,
      cost: { input: 1.1, output: 4.4, cacheRead: 0.28, cacheWrite: 1.1 },
    },
    "o4-mini": {
      ...openaiBase,
      id: "o4-mini",
      name: "o4-mini",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 100000,
      cost: { input: 1.1, output: 4.4, cacheRead: 0.28, cacheWrite: 1.1 },
    },
    "codex-mini-latest": {
      ...openaiBase,
      id: "codex-mini-latest",
      name: "Codex Mini",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 100000,
      cost: { input: 1.5, output: 6, cacheRead: 0.38, cacheWrite: 1.5 },
    },
  },

  google: {
    "gemini-3-pro-preview": {
      ...googleBase,
      id: "gemini-3-pro-preview",
      name: "Gemini 3 Pro Preview",
      reasoning: true,
      contextWindow: 1000000,
      maxTokens: 64000,
      cost: { input: 2, output: 12, cacheRead: 0.5, cacheWrite: 2 },
    },
    "gemini-3-flash-preview": {
      ...googleBase,
      id: "gemini-3-flash-preview",
      name: "Gemini 3 Flash Preview",
      reasoning: true,
      contextWindow: 1048576,
      maxTokens: 65536,
      cost: { input: 0.5, output: 3, cacheRead: 0.13, cacheWrite: 0.5 },
    },
    "gemini-2.5-pro": {
      ...googleBase,
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      reasoning: true,
      contextWindow: 1048576,
      maxTokens: 65536,
      cost: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 },
    },
    "gemini-2.5-flash": {
      ...googleBase,
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      reasoning: true,
      contextWindow: 1048576,
      maxTokens: 65536,
      cost: { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0.3 },
    },
    "gemini-2.5-flash-lite": {
      ...googleBase,
      id: "gemini-2.5-flash-lite",
      name: "Gemini 2.5 Flash Lite",
      reasoning: true,
      contextWindow: 1048576,
      maxTokens: 65536,
      cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
    },
    "gemini-2.0-flash": {
      ...googleBase,
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      reasoning: false,
      contextWindow: 1048576,
      maxTokens: 8192,
      cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
    },
    "gemini-2.0-flash-lite": {
      ...googleBase,
      id: "gemini-2.0-flash-lite",
      name: "Gemini 2.0 Flash Lite",
      reasoning: false,
      contextWindow: 1048576,
      maxTokens: 8192,
      cost: { input: 0.075, output: 0.3, cacheRead: 0.019, cacheWrite: 0.075 },
    },
    "gemini-1.5-pro": {
      ...googleBase,
      id: "gemini-1.5-pro",
      name: "Gemini 1.5 Pro",
      reasoning: false,
      contextWindow: 1000000,
      maxTokens: 8192,
      cost: { input: 1.25, output: 5, cacheRead: 0.31, cacheWrite: 1.25 },
    },
    "gemini-1.5-flash": {
      ...googleBase,
      id: "gemini-1.5-flash",
      name: "Gemini 1.5 Flash",
      reasoning: false,
      contextWindow: 1000000,
      maxTokens: 8192,
      cost: { input: 0.075, output: 0.3, cacheRead: 0.019, cacheWrite: 0.075 },
    },
  },

  xai: {
    "grok-4": {
      ...xaiBase,
      id: "grok-4",
      name: "Grok 4",
      reasoning: true,
      contextWindow: 256000,
      maxTokens: 64000,
      cost: { input: 3, output: 15, cacheRead: 0.75, cacheWrite: 3 },
    },
    "grok-4-fast": {
      ...xaiBase,
      id: "grok-4-fast",
      name: "Grok 4 Fast",
      reasoning: true,
      contextWindow: 2000000,
      maxTokens: 30000,
      cost: { input: 0.2, output: 0.5, cacheRead: 0.05, cacheWrite: 0.2 },
    },
    "grok-3": {
      ...xaiBase,
      id: "grok-3",
      name: "Grok 3",
      reasoning: false,
      contextWindow: 131072,
      maxTokens: 8192,
      cost: { input: 3, output: 15, cacheRead: 0.75, cacheWrite: 3 },
    },
    "grok-3-mini": {
      ...xaiBase,
      id: "grok-3-mini",
      name: "Grok 3 Mini",
      reasoning: true,
      contextWindow: 131072,
      maxTokens: 8192,
      cost: { input: 0.3, output: 0.5, cacheRead: 0.075, cacheWrite: 0.3 },
    },
    "grok-2": {
      ...xaiBase,
      id: "grok-2",
      name: "Grok 2",
      reasoning: false,
      contextWindow: 131072,
      maxTokens: 8192,
      cost: { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 2 },
    },
    "grok-code-fast-1": {
      ...xaiBase,
      id: "grok-code-fast-1",
      name: "Grok Code Fast 1",
      reasoning: true,
      contextWindow: 256000,
      maxTokens: 10000,
      cost: { input: 0.2, output: 1.5, cacheRead: 0.05, cacheWrite: 0.2 },
    },
  },

  minimax: {
    "MiniMax-M2.7": {
      ...minimaxBase,
      id: "MiniMax-M2.7",
      name: "MiniMax-M2.7",
      reasoning: true,
      contextWindow: 204800,
      maxTokens: 131072,
      cost: { input: 0.3, output: 1.2, cacheRead: 0.075, cacheWrite: 0.3 },
    },
    "MiniMax-M2.7-highspeed": {
      ...minimaxBase,
      id: "MiniMax-M2.7-highspeed",
      name: "MiniMax-M2.7-highspeed",
      reasoning: true,
      contextWindow: 204800,
      maxTokens: 131072,
      cost: { input: 0.3, output: 1.2, cacheRead: 0.075, cacheWrite: 0.3 },
    },
    "MiniMax-M2.5": {
      ...minimaxBase,
      id: "MiniMax-M2.5",
      name: "MiniMax-M2.5",
      reasoning: true,
      contextWindow: 204800,
      maxTokens: 131072,
      cost: { input: 0.3, output: 1.2, cacheRead: 0.075, cacheWrite: 0.3 },
    },
    "MiniMax-M2.1": {
      ...minimaxBase,
      id: "MiniMax-M2.1",
      name: "MiniMax-M2.1",
      reasoning: true,
      contextWindow: 204800,
      maxTokens: 131072,
      cost: { input: 0.3, output: 1.2, cacheRead: 0.075, cacheWrite: 0.3 },
    },
    "MiniMax-M2": {
      ...minimaxBase,
      id: "MiniMax-M2",
      name: "MiniMax-M2",
      reasoning: true,
      contextWindow: 196608,
      maxTokens: 128000,
      cost: { input: 0.3, output: 1.2, cacheRead: 0.075, cacheWrite: 0.3 },
    },
  },

  zai: {
    "glm-5": {
      ...zaiBase,
      id: "glm-5",
      name: "GLM-5",
      reasoning: true,
      contextWindow: 204800,
      maxTokens: 131072,
      cost: { input: 1, output: 3.2, cacheRead: 0.25, cacheWrite: 1 },
    },
    "glm-4.7": {
      ...zaiBase,
      id: "glm-4.7",
      name: "GLM-4.7",
      reasoning: true,
      contextWindow: 204800,
      maxTokens: 131072,
      cost: { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0.6 },
    },
    "glm-4.7-flash": {
      ...zaiBase,
      id: "glm-4.7-flash",
      name: "GLM-4.7-Flash",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 131072,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "glm-4.6": {
      ...zaiBase,
      id: "glm-4.6",
      name: "GLM-4.6",
      reasoning: true,
      contextWindow: 204800,
      maxTokens: 131072,
      cost: { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0.6 },
    },
    "glm-4.5": {
      ...zaiBase,
      id: "glm-4.5",
      name: "GLM-4.5",
      reasoning: true,
      contextWindow: 131072,
      maxTokens: 98304,
      cost: { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0.6 },
    },
    "glm-4.5-flash": {
      ...zaiBase,
      id: "glm-4.5-flash",
      name: "GLM-4.5-Flash",
      reasoning: true,
      contextWindow: 131072,
      maxTokens: 98304,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "glm-4.5-air": {
      ...zaiBase,
      id: "glm-4.5-air",
      name: "GLM-4.5-Air",
      reasoning: true,
      contextWindow: 131072,
      maxTokens: 98304,
      cost: { input: 0.2, output: 1.1, cacheRead: 0.05, cacheWrite: 0.2 },
    },
  },

  nvidia: {
    "nvidia/llama-3.1-nemotron-70b-instruct": {
      ...nvidiaBase,
      id: "nvidia/llama-3.1-nemotron-70b-instruct",
      name: "Llama 3.1 Nemotron 70B",
      reasoning: false,
      contextWindow: 128000,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "nvidia/llama-3.3-70b-instruct": {
      ...nvidiaBase,
      id: "nvidia/llama-3.3-70b-instruct",
      name: "Llama 3.3 70B",
      reasoning: false,
      contextWindow: 128000,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "nvidia/mistral-nemo-minitron-8b-8k-instruct": {
      ...nvidiaBase,
      id: "nvidia/mistral-nemo-minitron-8b-8k-instruct",
      name: "Mistral NeMo Minitron 8B",
      reasoning: false,
      contextWindow: 8192,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  },
};

// ============================================================================
// LOOKUP FUNCTIONS
// ============================================================================

/**
 * Get a model definition by provider and model ID.
 *
 * @param provider - Provider name (e.g., "anthropic", "openai")
 * @param modelId - Model identifier (e.g., "claude-opus-4-6", "gpt-5.2")
 * @returns Model definition
 * @throws Error if provider or model not found
 */
export function getModel<TProvider extends string>(
  provider: TProvider,
  modelId: string,
): Model<Api> {
  const providerModels = MODELS[provider];
  if (!providerModels) {
    throw new Error(`Unknown provider: "${provider}". Known: ${Object.keys(MODELS).join(", ")}`);
  }

  const model = providerModels[modelId];
  if (!model) {
    throw new Error(
      `Unknown model "${modelId}" for provider "${provider}". ` +
        `Known: ${Object.keys(providerModels).join(", ")}`,
    );
  }

  return model as Model<Api>;
}

/**
 * Get all known provider names.
 *
 * @returns Array of provider names
 */
export function getProviders(): KnownProvider[] {
  return Object.keys(MODELS) as KnownProvider[];
}

/**
 * Get all model definitions for a provider.
 *
 * @param provider - Provider name
 * @returns Array of model definitions
 */
export function getModels<TProvider extends string>(provider: TProvider): Model<Api>[] {
  const providerModels = MODELS[provider];
  if (!providerModels) {
    return [];
  }
  return Object.values(providerModels) as Model<Api>[];
}

/**
 * Calculate cost breakdown from model pricing and token usage.
 *
 * @param model - Model with cost per million tokens
 * @param usage - Token usage from a completion
 * @returns Cost breakdown matching Usage["cost"] shape
 */
export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
  const inputCost = (usage.input * model.cost.input) / 1_000_000;
  const outputCost = (usage.output * model.cost.output) / 1_000_000;
  const cacheReadCost = (usage.cacheRead * model.cost.cacheRead) / 1_000_000;
  const cacheWriteCost = (usage.cacheWrite * model.cost.cacheWrite) / 1_000_000;

  return {
    input: inputCost,
    output: outputCost,
    cacheRead: cacheReadCost,
    cacheWrite: cacheWriteCost,
    total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}

/**
 * Check if a model supports xhigh thinking level.
 *
 * Supported by:
 * - OpenAI GPT-5.1-codex-max, GPT-5.2, GPT-5.2-codex, GPT-5.3-codex
 * - Anthropic Opus 4.6 (xhigh maps to adaptive effort "max")
 */
export function supportsXhigh<TApi extends Api>(model: Model<TApi>): boolean {
  const id = model.id.toLowerCase();

  // Anthropic Opus 4.6
  if (model.provider === "anthropic" && id.includes("opus-4-6")) {
    return true;
  }

  // OpenAI GPT-5.1-codex-max, GPT-5.2+, GPT-5.3+
  if (model.provider === "openai") {
    if (id.includes("5.1-codex-max") || id.startsWith("gpt-5.2") || id.startsWith("gpt-5.3")) {
      return true;
    }
  }

  return false;
}

/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual<TApi extends Api>(
  a: Model<TApi> | null | undefined,
  b: Model<TApi> | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  return a.id === b.id && a.provider === b.provider;
}
