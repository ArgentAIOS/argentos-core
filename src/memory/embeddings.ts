import type { Llama, LlamaEmbeddingContext, LlamaModel } from "node-llama-cpp";
import fsSync from "node:fs";
import type { ArgentConfig } from "../config/config.js";
import { resolveUserPath } from "../utils.js";
import {
  createGeminiEmbeddingProvider,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  type GeminiEmbeddingClient,
} from "./embeddings-gemini.js";
import {
  createOllamaEmbeddingProvider,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  type OllamaEmbeddingClient,
} from "./embeddings-ollama.js";
import {
  createOpenAiEmbeddingProvider,
  DEFAULT_LMSTUDIO_EMBEDDING_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  type OpenAiEmbeddingClient,
} from "./embeddings-openai.js";
import { importNodeLlamaCpp } from "./node-llama.js";

function sanitizeAndNormalizeEmbedding(vec: number[]): number[] {
  const sanitized = vec.map((value) => (Number.isFinite(value) ? value : 0));
  const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
  if (magnitude < 1e-10) {
    return sanitized;
  }
  return sanitized.map((value) => value / magnitude);
}

export type { GeminiEmbeddingClient } from "./embeddings-gemini.js";
export type { OllamaEmbeddingClient } from "./embeddings-ollama.js";
export type { OpenAiEmbeddingClient } from "./embeddings-openai.js";

export type EmbeddingProvider = {
  id: string;
  model: string;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

export type EmbeddingProviderResult = {
  provider: EmbeddingProvider;
  requestedProvider: "openai" | "local" | "gemini" | "ollama" | "lmstudio" | "auto";
  fallbackFrom?: "openai" | "local" | "gemini" | "ollama" | "lmstudio";
  fallbackReason?: string;
  openAi?: OpenAiEmbeddingClient;
  gemini?: GeminiEmbeddingClient;
  ollama?: OllamaEmbeddingClient;
};

export type EmbeddingProviderOptions = {
  config: ArgentConfig;
  agentDir?: string;
  provider: "openai" | "local" | "gemini" | "ollama" | "lmstudio" | "auto";
  remote?: {
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
  model: string;
  fallback: "openai" | "gemini" | "local" | "ollama" | "lmstudio" | "none";
  local?: {
    modelPath?: string;
    modelCacheDir?: string;
  };
};

const DEFAULT_LOCAL_MODEL = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
type ConcreteEmbeddingProvider = "openai" | "local" | "gemini" | "ollama" | "lmstudio";

function canAutoSelectLocal(options: EmbeddingProviderOptions): boolean {
  const modelPath = options.local?.modelPath?.trim();
  if (!modelPath) {
    return false;
  }
  if (/^(hf:|https?:)/i.test(modelPath)) {
    return false;
  }
  const resolved = resolveUserPath(modelPath);
  try {
    return fsSync.statSync(resolved).isFile();
  } catch {
    return false;
  }
}

function looksOpenAiEmbeddingModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.startsWith("openai/") ||
    normalized.startsWith("text-embedding-3") ||
    normalized === "text-embedding-ada-002"
  );
}

function defaultModelForProvider(
  provider: ConcreteEmbeddingProvider,
  options: EmbeddingProviderOptions,
): string {
  if (provider === "openai") {
    return DEFAULT_OPENAI_EMBEDDING_MODEL;
  }
  if (provider === "gemini") {
    return DEFAULT_GEMINI_EMBEDDING_MODEL;
  }
  if (provider === "ollama") {
    return DEFAULT_OLLAMA_EMBEDDING_MODEL;
  }
  if (provider === "lmstudio") {
    return DEFAULT_LMSTUDIO_EMBEDDING_MODEL;
  }
  return options.local?.modelPath?.trim() || DEFAULT_LOCAL_MODEL;
}

function resolveModelForProvider(
  provider: ConcreteEmbeddingProvider,
  options: EmbeddingProviderOptions,
  opts?: { autoCandidate?: boolean },
): string {
  const configured = options.model.trim();
  if (!configured) {
    return defaultModelForProvider(provider, options);
  }

  // In auto mode, don't reuse OpenAI-only embedding IDs for Gemini/Ollama attempts.
  if (
    opts?.autoCandidate &&
    provider !== "openai" &&
    provider !== "lmstudio" &&
    looksOpenAiEmbeddingModel(configured)
  ) {
    return defaultModelForProvider(provider, options);
  }

  return configured;
}

function isMissingApiKeyError(err: unknown): boolean {
  const message = formatError(err);
  return message.includes("No API key found for provider");
}

async function createLocalEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<EmbeddingProvider> {
  const modelPath = options.local?.modelPath?.trim() || DEFAULT_LOCAL_MODEL;
  const modelCacheDir = options.local?.modelCacheDir?.trim();

  // Lazy-load node-llama-cpp to keep startup light unless local is enabled.
  const { getLlama, resolveModelFile, LlamaLogLevel } = await importNodeLlamaCpp();

  let llama: Llama | null = null;
  let embeddingModel: LlamaModel | null = null;
  let embeddingContext: LlamaEmbeddingContext | null = null;

  const ensureContext = async () => {
    if (!llama) {
      llama = await getLlama({ logLevel: LlamaLogLevel.error });
    }
    if (!embeddingModel) {
      const resolved = await resolveModelFile(modelPath, modelCacheDir || undefined);
      embeddingModel = await llama.loadModel({ modelPath: resolved });
    }
    if (!embeddingContext) {
      embeddingContext = await embeddingModel.createEmbeddingContext();
    }
    return embeddingContext;
  };

  return {
    id: "local",
    model: modelPath,
    embedQuery: async (text) => {
      const ctx = await ensureContext();
      const embedding = await ctx.getEmbeddingFor(text);
      return sanitizeAndNormalizeEmbedding(Array.from(embedding.vector));
    },
    embedBatch: async (texts) => {
      const ctx = await ensureContext();
      const embeddings = await Promise.all(
        texts.map(async (text) => {
          const embedding = await ctx.getEmbeddingFor(text);
          return sanitizeAndNormalizeEmbedding(Array.from(embedding.vector));
        }),
      );
      return embeddings;
    },
  };
}

export async function createEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<EmbeddingProviderResult> {
  const requestedProvider = options.provider;
  const fallback = options.fallback;

  const createProvider = async (
    id: ConcreteEmbeddingProvider,
    opts?: { autoCandidate?: boolean },
  ) => {
    const model = resolveModelForProvider(id, options, opts);
    const providerOptions: EmbeddingProviderOptions = {
      ...options,
      model,
    };

    if (id === "local") {
      const provider = await createLocalEmbeddingProvider(providerOptions);
      return { provider };
    }
    if (id === "gemini") {
      const { provider, client } = await createGeminiEmbeddingProvider(providerOptions);
      return { provider, gemini: client };
    }
    if (id === "ollama") {
      const { provider, client } = await createOllamaEmbeddingProvider(providerOptions);
      return { provider, ollama: client };
    }
    if (id === "lmstudio") {
      const { provider, client } = await createOpenAiEmbeddingProvider(providerOptions, "lmstudio");
      return { provider, openAi: client };
    }
    const { provider, client } = await createOpenAiEmbeddingProvider(providerOptions, "openai");
    return { provider, openAi: client };
  };

  const formatPrimaryError = (
    err: unknown,
    provider: "openai" | "local" | "gemini" | "ollama" | "lmstudio",
  ) => (provider === "local" ? formatLocalSetupError(err) : formatError(err));

  if (requestedProvider === "auto") {
    const missingKeyErrors: string[] = [];
    let localError: string | null = null;

    if (canAutoSelectLocal(options)) {
      try {
        const local = await createProvider("local");
        return { ...local, requestedProvider };
      } catch (err) {
        localError = formatLocalSetupError(err);
      }
    }

    for (const provider of ["openai", "gemini"] as const) {
      try {
        const result = await createProvider(provider, { autoCandidate: true });
        return { ...result, requestedProvider };
      } catch (err) {
        const message = formatPrimaryError(err, provider);
        if (isMissingApiKeyError(err)) {
          missingKeyErrors.push(message);
          continue;
        }
        throw new Error(message, { cause: err });
      }
    }

    const details = [...missingKeyErrors, localError].filter(Boolean) as string[];
    if (details.length > 0) {
      throw new Error(details.join("\n\n"));
    }
    throw new Error("No embeddings provider available.");
  }

  try {
    const primary = await createProvider(requestedProvider);
    return { ...primary, requestedProvider };
  } catch (primaryErr) {
    const reason = formatPrimaryError(primaryErr, requestedProvider);
    if (fallback && fallback !== "none" && fallback !== requestedProvider) {
      try {
        const fallbackResult = await createProvider(fallback);
        return {
          ...fallbackResult,
          requestedProvider,
          fallbackFrom: requestedProvider,
          fallbackReason: reason,
        };
      } catch (fallbackErr) {
        // oxlint-disable-next-line preserve-caught-error
        throw new Error(
          `${reason}\n\nFallback to ${fallback} failed: ${formatError(fallbackErr)}`,
          { cause: fallbackErr },
        );
      }
    }
    throw new Error(reason, { cause: primaryErr });
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function isNodeLlamaCppMissing(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const code = (err as Error & { code?: unknown }).code;
  if (code === "ERR_MODULE_NOT_FOUND") {
    return err.message.includes("node-llama-cpp");
  }
  return false;
}

function formatLocalSetupError(err: unknown): string {
  const detail = formatError(err);
  const missing = isNodeLlamaCppMissing(err);
  return [
    "Local embeddings unavailable.",
    missing
      ? "Reason: optional dependency node-llama-cpp is missing (or failed to install)."
      : detail
        ? `Reason: ${detail}`
        : undefined,
    missing && detail ? `Detail: ${detail}` : null,
    "To enable local embeddings:",
    "1) Use Node 22 LTS (recommended for installs/updates)",
    missing
      ? "2) Reinstall Argent (this should install node-llama-cpp): npm i -g argent@latest"
      : null,
    "3) If you use pnpm: pnpm approve-builds (select node-llama-cpp), then pnpm rebuild node-llama-cpp",
    'Or set agents.defaults.memorySearch.provider = "openai" (remote).',
  ]
    .filter(Boolean)
    .join("\n");
}
