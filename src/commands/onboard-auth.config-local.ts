import type { ArgentConfig } from "../config/config.js";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const LM_STUDIO_DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1";
export const LM_STUDIO_DEFAULT_MODEL_ID = "qwen/qwen3.5-35b-a3b";
export const LM_STUDIO_DEFAULT_MODEL_REF = `lmstudio/${LM_STUDIO_DEFAULT_MODEL_ID}`;
export const LM_STUDIO_DEFAULT_EMBEDDING_MODEL_ID = "text-embedding-nomic-embed-text-v1.5";

export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
export const OLLAMA_DEFAULT_MODEL_ID = "qwen3:30b-a3b-instruct-2507-q4_K_M";
export const OLLAMA_DEFAULT_MODEL_REF = `ollama/${OLLAMA_DEFAULT_MODEL_ID}`;
export const OLLAMA_DEFAULT_EMBEDDING_MODEL_ID = "nomic-embed-text";

function withKernelLocalModel(cfg: ArgentConfig, modelRef: string): ArgentConfig {
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        kernel: {
          ...cfg.agents?.defaults?.kernel,
          localModel: modelRef,
        },
      },
    },
  };
}

function withLocalMemorySearchConfig(
  cfg: ArgentConfig,
  params: {
    provider: "lmstudio" | "ollama";
    model: string;
    baseUrl: string;
    apiKey: string;
  },
): ArgentConfig {
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        memorySearch: {
          ...cfg.agents?.defaults?.memorySearch,
          provider: params.provider,
          model: params.model,
          fallback: "none",
          remote: {
            ...cfg.agents?.defaults?.memorySearch?.remote,
            baseUrl: params.baseUrl,
            apiKey: params.apiKey,
            batch: {
              ...cfg.agents?.defaults?.memorySearch?.remote?.batch,
              enabled: false,
            },
          },
        },
      },
    },
  };
}

export function applyLmStudioProviderConfig(cfg: ArgentConfig): ArgentConfig {
  const models = { ...cfg.agents?.defaults?.models };
  models[LM_STUDIO_DEFAULT_MODEL_REF] = {
    ...models[LM_STUDIO_DEFAULT_MODEL_REF],
    alias: models[LM_STUDIO_DEFAULT_MODEL_REF]?.alias ?? "Qwen 3.5 35B A3B",
  };

  const providers = { ...cfg.models?.providers };
  providers.lmstudio = {
    ...providers.lmstudio,
    baseUrl: LM_STUDIO_DEFAULT_BASE_URL,
    apiKey: "lmstudio",
    api: "openai-responses",
    models: [
      {
        id: LM_STUDIO_DEFAULT_MODEL_ID,
        name: "Qwen 3.5 35B A3B",
        reasoning: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 196608,
        maxTokens: 8192,
      },
      {
        id: LM_STUDIO_DEFAULT_EMBEDDING_MODEL_ID,
        name: "Nomic Embed Text v1.5",
        reasoning: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 8192,
        maxTokens: 8192,
      },
    ],
  };

  return withLocalMemorySearchConfig(
    withKernelLocalModel(
      {
        ...cfg,
        agents: {
          ...cfg.agents,
          defaults: {
            ...cfg.agents?.defaults,
            models,
          },
        },
        models: {
          mode: cfg.models?.mode ?? "merge",
          providers,
        },
      },
      LM_STUDIO_DEFAULT_MODEL_REF,
    ),
    {
      provider: "lmstudio",
      model: LM_STUDIO_DEFAULT_EMBEDDING_MODEL_ID,
      baseUrl: LM_STUDIO_DEFAULT_BASE_URL,
      apiKey: "lmstudio",
    },
  );
}

export function applyLmStudioConfig(cfg: ArgentConfig): ArgentConfig {
  const next = applyLmStudioProviderConfig(cfg);
  return {
    ...next,
    agents: {
      ...next.agents,
      defaults: {
        ...next.agents?.defaults,
        model: {
          ...(next.agents?.defaults?.model &&
          "fallbacks" in (next.agents.defaults.model as Record<string, unknown>)
            ? {
                fallbacks: (next.agents.defaults.model as { fallbacks?: string[] }).fallbacks,
              }
            : undefined),
          primary: LM_STUDIO_DEFAULT_MODEL_REF,
        },
      },
    },
  };
}

function isReasoningOllamaModel(modelId: string): boolean {
  const value = modelId.toLowerCase();
  return value.includes("r1") || value.includes("reasoning");
}

function prettyOllamaModelName(modelId: string): string {
  if (modelId === OLLAMA_DEFAULT_MODEL_ID) {
    return "Qwen 3 30B A3B";
  }
  return modelId;
}

export function applyOllamaProviderConfig(
  cfg: ArgentConfig,
  params?: { modelId?: string },
): ArgentConfig {
  const modelId = params?.modelId?.trim() || OLLAMA_DEFAULT_MODEL_ID;
  const modelRef = `ollama/${modelId}`;

  const models = { ...cfg.agents?.defaults?.models };
  models[modelRef] = {
    ...models[modelRef],
    alias: models[modelRef]?.alias ?? prettyOllamaModelName(modelId),
  };

  const providers = { ...cfg.models?.providers };
  providers.ollama = {
    ...providers.ollama,
    baseUrl: OLLAMA_DEFAULT_BASE_URL,
    apiKey: "ollama-local",
    api: "openai-completions",
    models: [
      {
        id: modelId,
        name: prettyOllamaModelName(modelId),
        reasoning: isReasoningOllamaModel(modelId),
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 131072,
        maxTokens: 8192,
      },
      {
        id: OLLAMA_DEFAULT_EMBEDDING_MODEL_ID,
        name: "Nomic Embed Text",
        reasoning: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 8192,
        maxTokens: 8192,
      },
    ],
  };

  return withLocalMemorySearchConfig(
    withKernelLocalModel(
      {
        ...cfg,
        agents: {
          ...cfg.agents,
          defaults: {
            ...cfg.agents?.defaults,
            models,
          },
        },
        models: {
          mode: cfg.models?.mode ?? "merge",
          providers,
        },
      },
      modelRef,
    ),
    {
      provider: "ollama",
      model: OLLAMA_DEFAULT_EMBEDDING_MODEL_ID,
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
      apiKey: "ollama-local",
    },
  );
}

export function applyOllamaConfig(cfg: ArgentConfig, params?: { modelId?: string }): ArgentConfig {
  const modelId = params?.modelId?.trim() || OLLAMA_DEFAULT_MODEL_ID;
  const modelRef = `ollama/${modelId}`;
  const next = applyOllamaProviderConfig(cfg, { modelId });
  return {
    ...next,
    agents: {
      ...next.agents,
      defaults: {
        ...next.agents?.defaults,
        model: {
          ...(next.agents?.defaults?.model &&
          "fallbacks" in (next.agents.defaults.model as Record<string, unknown>)
            ? {
                fallbacks: (next.agents.defaults.model as { fallbacks?: string[] }).fallbacks,
              }
            : undefined),
          primary: modelRef,
        },
      },
    },
  };
}
