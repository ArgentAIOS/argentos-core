/**
 * MemU Embedding Provider
 *
 * Thin wrapper around ArgentOS's existing embedding infrastructure.
 * Routes embedding requests through the configured provider (OpenAI, Gemini, Ollama, local).
 */

import type { ArgentConfig } from "../config/config.js";
import {
  requireEmbeddingDimensions,
  shouldEnforceV3EmbeddingContract,
} from "./embedding-contract.js";
import { createEmbeddingProvider, type EmbeddingProviderResult } from "./embeddings.js";

export interface MemuEmbedder {
  /** Embed a single text query */
  embed(text: string): Promise<number[]>;
  /** Embed multiple texts in a batch */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Provider info */
  providerId: string;
  model: string;
}

let _embedder: MemuEmbedder | null = null;
let _initPromise: Promise<MemuEmbedder> | null = null;

/**
 * Get or initialize the MemU embedder.
 * Reuses the existing ArgentOS embedding provider system.
 */
export async function getMemuEmbedder(config?: ArgentConfig): Promise<MemuEmbedder> {
  if (_embedder) return _embedder;
  if (_initPromise) return _initPromise;

  _initPromise = initEmbedder(config);
  _embedder = await _initPromise;
  _initPromise = null;
  return _embedder;
}

async function initEmbedder(config?: ArgentConfig): Promise<MemuEmbedder> {
  // Resolve memory search config for embedding settings
  const memoryConfig = config?.agents?.defaults?.memorySearch;

  const providerChoice =
    (memoryConfig?.provider as "openai" | "gemini" | "ollama" | "local" | "auto") ?? "ollama";
  const model =
    (memoryConfig?.model as string) ??
    (providerChoice === "gemini"
      ? "gemini-embedding-001"
      : providerChoice === "openai"
        ? "text-embedding-3-small"
        : providerChoice === "ollama"
          ? "nomic-embed-text"
          : "");
  const fallback =
    (memoryConfig?.fallback as "openai" | "gemini" | "ollama" | "local" | "none") ?? "none";

  const result: EmbeddingProviderResult = await createEmbeddingProvider({
    config: config ?? ({} as ArgentConfig),
    provider: providerChoice,
    model,
    fallback,
    remote: memoryConfig?.remote as {
      baseUrl?: string;
      apiKey?: string;
      headers?: Record<string, string>;
    },
    local: memoryConfig?.local as {
      modelPath?: string;
      modelCacheDir?: string;
    },
  });

  const provider = result.provider;
  const enforceDimensions = shouldEnforceV3EmbeddingContract(config);
  const providerLabel = `${provider.id}/${provider.model}`;

  const embedWithContract = async (text: string): Promise<number[]> => {
    const vector = await provider.embedQuery(text);
    return enforceDimensions
      ? requireEmbeddingDimensions(vector, `MemU embed query (${providerLabel})`)
      : vector;
  };

  const embedBatchWithContract = async (texts: string[]): Promise<number[][]> => {
    const vectors = await provider.embedBatch(texts);
    if (!enforceDimensions) {
      return vectors;
    }
    return vectors.map((vector, index) =>
      requireEmbeddingDimensions(vector, `MemU embed batch (${providerLabel}) item ${index + 1}`),
    );
  };

  return {
    embed: embedWithContract,
    embedBatch: embedBatchWithContract,
    providerId: provider.id,
    model: provider.model,
  };
}

/** Reset the cached embedder (for testing) */
export function resetMemuEmbedder(): void {
  _embedder = null;
  _initPromise = null;
}
