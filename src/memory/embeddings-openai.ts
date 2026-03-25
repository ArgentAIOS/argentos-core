import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";
import { requireApiKey, resolveApiKeyForProvider } from "../agents/model-auth.js";
import { resolveOpenAiEmbeddingDimensions } from "./embedding-contract.js";

export type OpenAiEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
};

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_LMSTUDIO_EMBEDDING_MODEL = "text-embedding-nomic-embed-text-v1.5";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_LMSTUDIO_BASE_URL = "http://127.0.0.1:1234/v1";

export function normalizeOpenAiCompatibleModel(
  model: string,
  providerId: "openai" | "lmstudio",
): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return providerId === "lmstudio"
      ? DEFAULT_LMSTUDIO_EMBEDDING_MODEL
      : DEFAULT_OPENAI_EMBEDDING_MODEL;
  }
  if (providerId === "lmstudio" && trimmed.startsWith("lmstudio/")) {
    return trimmed.slice("lmstudio/".length);
  }
  if (trimmed.startsWith("openai/")) {
    return trimmed.slice("openai/".length);
  }
  return trimmed;
}

export async function createOpenAiEmbeddingProvider(
  options: EmbeddingProviderOptions,
  providerId: "openai" | "lmstudio" = "openai",
): Promise<{ provider: EmbeddingProvider; client: OpenAiEmbeddingClient }> {
  const client = await resolveOpenAiEmbeddingClient(options, providerId);
  const url = `${client.baseUrl.replace(/\/$/, "")}/embeddings`;
  const dimensions = resolveOpenAiEmbeddingDimensions(client.model, options.config);

  const embed = async (input: string[]): Promise<number[][]> => {
    if (input.length === 0) {
      return [];
    }
    const requestPayload: { model: string; input: string[]; dimensions?: number } = {
      model: client.model,
      input,
    };
    if (typeof dimensions === "number") {
      requestPayload.dimensions = dimensions;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify(requestPayload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`openai embeddings failed: ${res.status} ${text}`);
    }
    const payload = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const data = payload.data ?? [];
    return data.map((entry) => entry.embedding ?? []);
  };

  return {
    provider: {
      id: providerId,
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

export async function resolveOpenAiEmbeddingClient(
  options: EmbeddingProviderOptions,
  providerId: "openai" | "lmstudio" = "openai",
): Promise<OpenAiEmbeddingClient> {
  const remote = options.remote;
  const remoteApiKey = remote?.apiKey?.trim();
  const remoteBaseUrl = remote?.baseUrl?.trim();
  const providerConfig = options.config.models?.providers?.[providerId];

  const apiKey =
    remoteApiKey ||
    (providerId === "lmstudio"
      ? providerConfig?.apiKey?.trim() || process.env.LMSTUDIO_API_KEY?.trim() || "lmstudio"
      : requireApiKey(
          await resolveApiKeyForProvider({
            provider: "openai",
            cfg: options.config,
            agentDir: options.agentDir,
          }),
          "openai",
        ));

  const baseUrl =
    remoteBaseUrl ||
    providerConfig?.baseUrl?.trim() ||
    (providerId === "lmstudio" ? DEFAULT_LMSTUDIO_BASE_URL : DEFAULT_OPENAI_BASE_URL);
  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...headerOverrides,
  };
  const model = normalizeOpenAiCompatibleModel(options.model, providerId);
  return { baseUrl, headers, model };
}
