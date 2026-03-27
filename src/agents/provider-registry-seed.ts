/**
 * Provider Registry — Seed Data
 *
 * All hardcoded provider constants extracted into a single data file.
 * This seeds ~/.argentos/provider-registry.json on first run or version bump.
 * After seeding, the registry file is the source of truth; user edits persist.
 *
 * IMPORTANT: When adding a new provider, add it here — not in models-config.providers.ts.
 */

import type { ProviderRegistry, ProviderRegistryEntry } from "../config/types.models.js";

// Current seed version. Bump this to force re-seed on next startup.
export const SEED_VERSION = 8;

// ---------------------------------------------------------------------------
// Cost presets
// ---------------------------------------------------------------------------

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

const MINIMAX_API_COST = {
  input: 15,
  output: 60,
  cacheRead: 2,
  cacheWrite: 10,
} as const;

const MINIMAX_HER_COST = {
  input: 0.3,
  output: 1.2,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

const INCEPTION_MERCURY_COST = {
  input: 0.25,
  output: 0.75,
  cacheRead: 0.025,
  cacheWrite: 0.25,
} as const;

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

const minimax: ProviderRegistryEntry = {
  name: "MiniMax",
  // FIX: was "https://api.minimax.io/v1" with "openai-completions" which
  // caused empty responses on complex messages. MiniMax's recommended
  // endpoint is /anthropic with anthropic-messages API format.
  baseUrl: "https://api.minimax.io/anthropic",
  api: "anthropic-messages",
  authType: "api_key",
  envKeyVar: "MINIMAX_API_KEY",
  models: [
    {
      id: "MiniMax-M2.7-highspeed",
      name: "MiniMax M2.7 Highspeed",
      reasoning: false,
      input: ["text"],
      cost: MINIMAX_API_COST,
      contextWindow: 204800,
      maxTokens: 8192,
    },
    {
      id: "MiniMax-M2.7",
      name: "MiniMax M2.7",
      reasoning: false,
      input: ["text"],
      cost: MINIMAX_API_COST,
      contextWindow: 204800,
      maxTokens: 8192,
    },
    {
      id: "MiniMax-M2.5-highspeed",
      name: "MiniMax M2.5 Highspeed",
      reasoning: false,
      input: ["text"],
      cost: MINIMAX_API_COST,
      contextWindow: 204800,
      maxTokens: 8192,
    },
    {
      id: "MiniMax-M2.5",
      name: "MiniMax M2.5",
      reasoning: false,
      input: ["text"],
      cost: MINIMAX_API_COST,
      contextWindow: 204800,
      maxTokens: 8192,
    },
    {
      id: "MiniMax-M2.1",
      name: "MiniMax M2.1",
      reasoning: false,
      input: ["text"],
      cost: MINIMAX_API_COST,
      contextWindow: 204800,
      maxTokens: 8192,
    },
    {
      id: "MiniMax-M2.1-highspeed",
      name: "MiniMax M2.1 Highspeed",
      reasoning: false,
      input: ["text"],
      cost: MINIMAX_API_COST,
      contextWindow: 204800,
      maxTokens: 8192,
    },
    {
      id: "MiniMax-VL-01",
      name: "MiniMax VL 01",
      reasoning: false,
      input: ["text", "image"],
      cost: MINIMAX_API_COST,
      contextWindow: 204800,
      maxTokens: 8192,
    },
    {
      id: "M2-her",
      name: "MiniMax M2-her",
      reasoning: false,
      input: ["text"],
      cost: MINIMAX_HER_COST,
      contextWindow: 204800,
      maxTokens: 2048,
    },
  ],
};

const minimaxPortal: ProviderRegistryEntry = {
  name: "MiniMax Portal",
  baseUrl: "https://api.minimax.io/anthropic",
  api: "anthropic-messages",
  authType: "oauth",
  oauthPlaceholder: "minimax-oauth",
  models: [
    {
      id: "MiniMax-M2.1",
      name: "MiniMax M2.1",
      reasoning: false,
      input: ["text"],
      cost: MINIMAX_API_COST,
      contextWindow: 200000,
      maxTokens: 8192,
    },
  ],
};

const xiaomi: ProviderRegistryEntry = {
  name: "Xiaomi",
  baseUrl: "https://api.xiaomimimo.com/anthropic",
  api: "anthropic-messages",
  authType: "api_key",
  envKeyVar: "XIAOMI_API_KEY",
  models: [
    {
      id: "mimo-v2-flash",
      name: "Xiaomi MiMo V2 Flash",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 262144,
      maxTokens: 8192,
    },
  ],
};

const moonshot: ProviderRegistryEntry = {
  name: "Moonshot",
  baseUrl: "https://api.moonshot.ai/v1",
  api: "openai-completions",
  authType: "api_key",
  envKeyVar: "MOONSHOT_API_KEY",
  models: [
    {
      id: "kimi-k2.5",
      name: "Kimi K2.5",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 256000,
      maxTokens: 8192,
    },
  ],
};

const qwenPortal: ProviderRegistryEntry = {
  name: "Qwen Portal",
  baseUrl: "https://portal.qwen.ai/v1",
  api: "openai-completions",
  authType: "oauth",
  oauthPlaceholder: "qwen-oauth",
  models: [
    {
      id: "coder-model",
      name: "Qwen Coder",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
    {
      id: "vision-model",
      name: "Qwen Vision",
      reasoning: false,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
  ],
};

const inception: ProviderRegistryEntry = {
  name: "Inception",
  baseUrl: "https://api.inceptionlabs.ai/v1",
  api: "openai-completions",
  authType: "api_key",
  envKeyVar: "INCEPTION_API_KEY",
  models: [
    {
      id: "mercury-2",
      name: "Mercury 2",
      reasoning: true,
      input: ["text"],
      cost: INCEPTION_MERCURY_COST,
      contextWindow: 128000,
      maxTokens: 50000,
    },
  ],
};

const ollama: ProviderRegistryEntry = {
  name: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  api: "openai-completions",
  authType: "api_key",
  envKeyVar: "OLLAMA_API_KEY",
  dynamic: true,
  discoveryUrl: "http://127.0.0.1:11434/api/tags",
  models: [],
};

const lmstudio: ProviderRegistryEntry = {
  name: "LM Studio",
  baseUrl: "http://127.0.0.1:1234/v1",
  api: "openai-completions",
  authType: "none",
  dynamic: true,
  discoveryUrl: "http://127.0.0.1:1234/v1/models",
  models: [],
};

const groq: ProviderRegistryEntry = {
  name: "Groq",
  baseUrl: "https://api.groq.com/openai/v1",
  api: "openai-completions",
  authType: "api_key",
  envKeyVar: "GROQ_API_KEY",
  models: [
    {
      id: "llama-3.1-8b-instant",
      name: "Llama 3.1 8B Instant",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 131072,
    },
    {
      id: "llama-3.3-70b-versatile",
      name: "Llama 3.3 70B Versatile",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
    {
      id: "openai/gpt-oss-20b",
      name: "GPT OSS 20B",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 65536,
    },
    {
      id: "openai/gpt-oss-120b",
      name: "GPT OSS 120B",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 65536,
    },
    {
      id: "qwen/qwen3-32b",
      name: "Qwen3 32B",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 65536,
    },
    {
      id: "qwen-qwq-32b",
      name: "Qwen QwQ 32B",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
  ],
};

const synthetic: ProviderRegistryEntry = {
  name: "Synthetic (HuggingFace)",
  baseUrl: "https://api.synthetic.new/anthropic",
  api: "anthropic-messages",
  authType: "api_key",
  envKeyVar: "SYNTHETIC_API_KEY",
  models: [
    {
      id: "hf:MiniMaxAI/MiniMax-M2.1",
      name: "MiniMax M2.1",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 192000,
      maxTokens: 65536,
    },
    {
      id: "hf:moonshotai/Kimi-K2-Thinking",
      name: "Kimi K2 Thinking",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 256000,
      maxTokens: 8192,
    },
    {
      id: "hf:zai-org/GLM-4.7",
      name: "GLM-4.7",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 198000,
      maxTokens: 128000,
    },
    {
      id: "hf:deepseek-ai/DeepSeek-R1-0528",
      name: "DeepSeek R1 0528",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
    {
      id: "hf:deepseek-ai/DeepSeek-V3-0324",
      name: "DeepSeek V3 0324",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
    {
      id: "hf:deepseek-ai/DeepSeek-V3.1",
      name: "DeepSeek V3.1",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
    {
      id: "hf:deepseek-ai/DeepSeek-V3.1-Terminus",
      name: "DeepSeek V3.1 Terminus",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
    {
      id: "hf:deepseek-ai/DeepSeek-V3.2",
      name: "DeepSeek V3.2",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 159000,
      maxTokens: 8192,
    },
    {
      id: "hf:meta-llama/Llama-3.3-70B-Instruct",
      name: "Llama 3.3 70B Instruct",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
    {
      id: "hf:meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      name: "Llama 4 Maverick 17B 128E Instruct FP8",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 524000,
      maxTokens: 8192,
    },
    {
      id: "hf:moonshotai/Kimi-K2-Instruct-0905",
      name: "Kimi K2 Instruct 0905",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 256000,
      maxTokens: 8192,
    },
    {
      id: "hf:moonshotai/Kimi-K2.5",
      name: "Kimi K2.5",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 256000,
      maxTokens: 8192,
    },
    {
      id: "hf:openai/gpt-oss-120b",
      name: "GPT OSS 120B",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
    {
      id: "hf:Qwen/Qwen3-235B-A22B-Instruct-2507",
      name: "Qwen3 235B A22B Instruct 2507",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 256000,
      maxTokens: 8192,
    },
    {
      id: "hf:Qwen/Qwen3-Coder-480B-A35B-Instruct",
      name: "Qwen3 Coder 480B A35B Instruct",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 256000,
      maxTokens: 8192,
    },
    {
      id: "hf:Qwen/Qwen3-VL-235B-A22B-Instruct",
      name: "Qwen3 VL 235B A22B Instruct",
      reasoning: false,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 250000,
      maxTokens: 8192,
    },
    {
      id: "hf:zai-org/GLM-4.5",
      name: "GLM-4.5",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 128000,
    },
    {
      id: "hf:zai-org/GLM-4.6",
      name: "GLM-4.6",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 198000,
      maxTokens: 128000,
    },
    {
      id: "hf:deepseek-ai/DeepSeek-V3",
      name: "DeepSeek V3",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 128000,
      maxTokens: 8192,
    },
    {
      id: "hf:Qwen/Qwen3-235B-A22B-Thinking-2507",
      name: "Qwen3 235B A22B Thinking 2507",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 256000,
      maxTokens: 8192,
    },
  ],
};

const venice: ProviderRegistryEntry = {
  name: "Venice",
  baseUrl: "https://api.venice.ai/api/v1",
  api: "openai-completions",
  authType: "api_key",
  envKeyVar: "VENICE_API_KEY",
  dynamic: true,
  discoveryUrl: "https://api.venice.ai/api/v1/models",
  models: [
    {
      id: "llama-3.3-70b",
      name: "Llama 3.3 70B",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 8192,
    },
    {
      id: "llama-3.2-3b",
      name: "Llama 3.2 3B",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 8192,
    },
    {
      id: "hermes-3-llama-3.1-405b",
      name: "Hermes 3 Llama 3.1 405B",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 8192,
    },
    {
      id: "qwen3-235b-a22b-thinking-2507",
      name: "Qwen3 235B Thinking",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 8192,
    },
    {
      id: "qwen3-235b-a22b-instruct-2507",
      name: "Qwen3 235B Instruct",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 8192,
    },
    {
      id: "qwen3-coder-480b-a35b-instruct",
      name: "Qwen3 Coder 480B",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 262144,
      maxTokens: 8192,
    },
    {
      id: "qwen3-next-80b",
      name: "Qwen3 Next 80B",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 262144,
      maxTokens: 8192,
    },
    {
      id: "qwen3-vl-235b-a22b",
      name: "Qwen3 VL 235B (Vision)",
      reasoning: false,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 262144,
      maxTokens: 8192,
    },
    {
      id: "qwen3-4b",
      name: "Venice Small (Qwen3 4B)",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 32768,
      maxTokens: 8192,
    },
    {
      id: "deepseek-v3.2",
      name: "DeepSeek V3.2",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 163840,
      maxTokens: 8192,
    },
    {
      id: "venice-uncensored",
      name: "Venice Uncensored (Dolphin-Mistral)",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 32768,
      maxTokens: 8192,
    },
    {
      id: "mistral-31-24b",
      name: "Venice Medium (Mistral)",
      reasoning: false,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 8192,
    },
    {
      id: "google-gemma-3-27b-it",
      name: "Google Gemma 3 27B Instruct",
      reasoning: false,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 202752,
      maxTokens: 8192,
    },
    {
      id: "openai-gpt-oss-120b",
      name: "OpenAI GPT OSS 120B",
      reasoning: false,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 131072,
      maxTokens: 8192,
    },
    {
      id: "zai-org-glm-4.7",
      name: "GLM 4.7",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 202752,
      maxTokens: 8192,
    },
    {
      id: "claude-opus-45",
      name: "Claude Opus 4.5 (via Venice)",
      reasoning: true,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 202752,
      maxTokens: 8192,
    },
    {
      id: "claude-sonnet-45",
      name: "Claude Sonnet 4.5 (via Venice)",
      reasoning: true,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 202752,
      maxTokens: 8192,
    },
    {
      id: "openai-gpt-52",
      name: "GPT-5.2 (via Venice)",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 262144,
      maxTokens: 8192,
    },
    {
      id: "openai-gpt-52-codex",
      name: "GPT-5.2 Codex (via Venice)",
      reasoning: true,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 262144,
      maxTokens: 8192,
    },
    {
      id: "gemini-3-pro-preview",
      name: "Gemini 3 Pro (via Venice)",
      reasoning: true,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 202752,
      maxTokens: 8192,
    },
    {
      id: "gemini-3-flash-preview",
      name: "Gemini 3 Flash (via Venice)",
      reasoning: true,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 262144,
      maxTokens: 8192,
    },
    {
      id: "grok-41-fast",
      name: "Grok 4.1 Fast (via Venice)",
      reasoning: true,
      input: ["text", "image"],
      cost: ZERO_COST,
      contextWindow: 262144,
      maxTokens: 8192,
    },
    {
      id: "grok-code-fast-1",
      name: "Grok Code Fast 1 (via Venice)",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 262144,
      maxTokens: 8192,
    },
    {
      id: "kimi-k2-thinking",
      name: "Kimi K2 Thinking (via Venice)",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 262144,
      maxTokens: 8192,
    },
    {
      id: "minimax-m21",
      name: "MiniMax M2.1 (via Venice)",
      reasoning: true,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: 202752,
      maxTokens: 8192,
    },
  ],
};

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

export function buildSeedRegistry(): ProviderRegistry {
  return {
    version: SEED_VERSION,
    providers: {
      minimax,
      "minimax-portal": minimaxPortal,
      xiaomi,
      moonshot,
      "qwen-portal": qwenPortal,
      inception,
      ollama,
      lmstudio,
      groq,
      synthetic,
      venice,
    },
  };
}
