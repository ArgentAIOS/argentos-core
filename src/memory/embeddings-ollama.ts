import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";
import { resolveApiKeyForProvider } from "../agents/model-auth.js";

export type OllamaEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
};

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";

function normalizeOllamaModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_OLLAMA_EMBEDDING_MODEL;
  }
  if (trimmed.startsWith("ollama/")) {
    return trimmed.slice("ollama/".length);
  }
  return trimmed;
}

export async function createOllamaEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: OllamaEmbeddingClient }> {
  const client = await resolveOllamaEmbeddingClient(options);
  const url = `${client.baseUrl.replace(/\/$/, "")}/embeddings`;

  const embed = async (input: string[]): Promise<number[][]> => {
    if (input.length === 0) {
      return [];
    }

    const res = await fetch(url, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({ model: client.model, input }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ollama embeddings failed: ${res.status} ${text}`);
    }

    const payload = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const data = payload.data ?? [];
    return data.map((entry) => entry.embedding ?? []);
  };

  return {
    provider: {
      id: "ollama",
      model: client.model,
      embedQuery: async (text) => {
        const [vec] = await embed([text]);
        return vec ?? [];
      },
      embedBatch: embed,
    },
    client,
  };
}

export async function resolveOllamaEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<OllamaEmbeddingClient> {
  const remote = options.remote;
  const remoteApiKey = remote?.apiKey?.trim();
  const remoteBaseUrl = remote?.baseUrl?.trim();
  const providerConfig = options.config.models?.providers?.ollama;

  // Ollama often runs without auth; only resolve a key if present in config/profiles/env.
  let resolvedApiKey: string | undefined;
  if (remoteApiKey) {
    resolvedApiKey = remoteApiKey;
  } else if (providerConfig?.apiKey?.trim()) {
    resolvedApiKey = providerConfig.apiKey.trim();
  } else {
    try {
      resolvedApiKey = (
        await resolveApiKeyForProvider({
          provider: "ollama",
          cfg: options.config,
          agentDir: options.agentDir,
        })
      ).apiKey;
    } catch {
      resolvedApiKey = undefined;
    }
  }

  const baseUrl = remoteBaseUrl || providerConfig?.baseUrl?.trim() || DEFAULT_OLLAMA_BASE_URL;
  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...headerOverrides,
  };
  if (resolvedApiKey?.trim()) {
    headers.Authorization = `Bearer ${resolvedApiKey.trim()}`;
  }
  const model = normalizeOllamaModel(options.model);
  return { baseUrl, headers, model };
}
