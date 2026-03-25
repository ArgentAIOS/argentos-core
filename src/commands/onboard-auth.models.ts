/**
 * Onboard Auth — Model constants and builder functions.
 *
 * Shared data (costs, context windows, base URLs) is sourced from the
 * provider registry seed to avoid duplication. Onboarding-specific constants
 * (model references, LM Studio costs, CN URLs) remain here.
 */

import type { ModelDefinitionConfig } from "../config/types.js";
import { buildSeedRegistry } from "../agents/provider-registry-seed.js";

// ---------------------------------------------------------------------------
// Derive shared constants from registry seed (single source of truth)
// ---------------------------------------------------------------------------

const _seed = buildSeedRegistry();
const _minimaxSeed = _seed.providers.minimax;
const _moonshotSeed = _seed.providers.moonshot;

// MiniMax base URLs
export const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io/v1"; // LM Studio / hosted mode only
export const MINIMAX_API_BASE_URL = _minimaxSeed?.baseUrl ?? "https://api.minimax.io/anthropic";

// MiniMax model constants (from seed)
export const MINIMAX_HOSTED_MODEL_ID = "MiniMax-M2.1";
export const MINIMAX_HOSTED_MODEL_REF = `minimax/${MINIMAX_HOSTED_MODEL_ID}`;
export const DEFAULT_MINIMAX_CONTEXT_WINDOW = _minimaxSeed?.models[0]?.contextWindow ?? 200000;
export const DEFAULT_MINIMAX_MAX_TOKENS = _minimaxSeed?.models[0]?.maxTokens ?? 8192;

// Moonshot base URLs
export const MOONSHOT_BASE_URL = _moonshotSeed?.baseUrl ?? "https://api.moonshot.ai/v1";
export const MOONSHOT_CN_BASE_URL = "https://api.moonshot.cn/v1"; // China-specific, not in registry
export const MOONSHOT_DEFAULT_MODEL_ID = _moonshotSeed?.models[0]?.id ?? "kimi-k2.5";
export const MOONSHOT_DEFAULT_MODEL_REF = `moonshot/${MOONSHOT_DEFAULT_MODEL_ID}`;
export const MOONSHOT_DEFAULT_CONTEXT_WINDOW = _moonshotSeed?.models[0]?.contextWindow ?? 256000;
export const MOONSHOT_DEFAULT_MAX_TOKENS = _moonshotSeed?.models[0]?.maxTokens ?? 8192;
export const KIMI_CODING_MODEL_ID = "k2p5";
export const KIMI_CODING_MODEL_REF = `kimi-coding/${KIMI_CODING_MODEL_ID}`;

// ---------------------------------------------------------------------------
// Cost structures
// ---------------------------------------------------------------------------

// From registry seed
const _minimaxApiModel = _minimaxSeed?.models.find((m) => m.id === "MiniMax-M2.1");
export const MINIMAX_API_COST = _minimaxApiModel?.cost ?? {
  input: 15,
  output: 60,
  cacheRead: 2,
  cacheWrite: 10,
};

// Onboarding-specific (hosted/LM Studio are free)
export const MINIMAX_HOSTED_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};
export const MINIMAX_LM_STUDIO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export const MOONSHOT_DEFAULT_COST = _moonshotSeed?.models[0]?.cost ?? {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

// ---------------------------------------------------------------------------
// Builder functions
// ---------------------------------------------------------------------------

const MINIMAX_MODEL_CATALOG = {
  "MiniMax-M2.7": { name: "MiniMax M2.7", reasoning: false },
  "MiniMax-M2.7-highspeed": {
    name: "MiniMax M2.7 Highspeed",
    reasoning: false,
  },
  "MiniMax-M2.1": { name: "MiniMax M2.1", reasoning: false },
  "MiniMax-M2.1-lightning": {
    name: "MiniMax M2.1 Lightning",
    reasoning: false,
  },
} as const;

type MinimaxCatalogId = keyof typeof MINIMAX_MODEL_CATALOG;

export function buildMinimaxModelDefinition(params: {
  id: string;
  name?: string;
  reasoning?: boolean;
  cost: ModelDefinitionConfig["cost"];
  contextWindow: number;
  maxTokens: number;
}): ModelDefinitionConfig {
  const catalog = MINIMAX_MODEL_CATALOG[params.id as MinimaxCatalogId];
  return {
    id: params.id,
    name: params.name ?? catalog?.name ?? `MiniMax ${params.id}`,
    reasoning: params.reasoning ?? catalog?.reasoning ?? false,
    input: ["text"],
    cost: params.cost,
    contextWindow: params.contextWindow,
    maxTokens: params.maxTokens,
  };
}

export function buildMinimaxApiModelDefinition(modelId: string): ModelDefinitionConfig {
  return buildMinimaxModelDefinition({
    id: modelId,
    cost: MINIMAX_API_COST,
    contextWindow: DEFAULT_MINIMAX_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MINIMAX_MAX_TOKENS,
  });
}

export function buildMoonshotModelDefinition(): ModelDefinitionConfig {
  return {
    id: MOONSHOT_DEFAULT_MODEL_ID,
    name: "Kimi K2.5",
    reasoning: false,
    input: ["text"],
    cost: MOONSHOT_DEFAULT_COST,
    contextWindow: MOONSHOT_DEFAULT_CONTEXT_WINDOW,
    maxTokens: MOONSHOT_DEFAULT_MAX_TOKENS,
  };
}

export const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
export const MISTRAL_DEFAULT_MODEL_ID = "mistral-large-latest";
export const MISTRAL_DEFAULT_MODEL_REF = `mistral/${MISTRAL_DEFAULT_MODEL_ID}`;
export const MISTRAL_DEFAULT_CONTEXT_WINDOW = 128000;
export const MISTRAL_DEFAULT_MAX_TOKENS = 8192;
export const MISTRAL_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function buildMistralModelDefinition(): ModelDefinitionConfig {
  return {
    id: MISTRAL_DEFAULT_MODEL_ID,
    name: "Mistral Large",
    reasoning: false,
    input: ["text", "image"],
    cost: MISTRAL_DEFAULT_COST,
    contextWindow: MISTRAL_DEFAULT_CONTEXT_WINDOW,
    maxTokens: MISTRAL_DEFAULT_MAX_TOKENS,
  };
}
