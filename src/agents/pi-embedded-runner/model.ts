import type { Api, Model } from "../../agent-core/ai.js";
import type { ArgentConfig } from "../../config/config.js";
import type { ModelDefinitionConfig } from "../../config/types.js";
import { MODELS as ARGENT_MODELS } from "../../argent-ai/models-db.js";
import { resolveArgentAgentDir } from "../agent-paths.js";
import { DEFAULT_CONTEXT_TOKENS } from "../defaults.js";
import { normalizeModelCompat } from "../model-compat.js";
import { normalizeProviderId } from "../model-selection.js";
import {
  discoverAuthStorage,
  discoverModels,
  type AuthStorage,
  type ModelRegistry,
} from "../pi-model-discovery.js";

type InlineModelEntry = ModelDefinitionConfig & { provider: string; baseUrl?: string };
type InlineProviderConfig = {
  baseUrl?: string;
  api?: ModelDefinitionConfig["api"];
  models?: ModelDefinitionConfig[];
};

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_LMSTUDIO_BASE_URL = "http://127.0.0.1:1234/v1";

export function buildInlineProviderModels(
  providers: Record<string, InlineProviderConfig>,
): InlineModelEntry[] {
  return Object.entries(providers).flatMap(([providerId, entry]) => {
    const trimmed = providerId.trim();
    if (!trimmed) {
      return [];
    }
    return (entry?.models ?? []).map((model) => ({
      ...model,
      provider: trimmed,
      baseUrl: entry?.baseUrl,
      api: model.api ?? entry?.api,
    }));
  });
}

export function buildModelAliasLines(cfg?: ArgentConfig) {
  const models = cfg?.agents?.defaults?.models ?? {};
  const entries: Array<{ alias: string; model: string }> = [];
  for (const [keyRaw, entryRaw] of Object.entries(models)) {
    const model = String(keyRaw ?? "").trim();
    if (!model) {
      continue;
    }
    const alias = String((entryRaw as { alias?: string } | undefined)?.alias ?? "").trim();
    if (!alias) {
      continue;
    }
    entries.push({ alias, model });
  }
  return entries
    .toSorted((a, b) => a.alias.localeCompare(b.alias))
    .map((entry) => `- ${entry.alias}: ${entry.model}`);
}

function hasProviderRef(value: unknown, provider: "ollama" | "lmstudio"): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith(`${provider}/`);
}

function resolveDynamicProviderBaseUrl(
  provider: "ollama" | "lmstudio",
  cfg?: ArgentConfig,
): string {
  const configured = cfg?.models?.providers?.[provider]?.baseUrl?.trim();
  if (configured) {
    return configured;
  }
  if (provider === "lmstudio") {
    const memorySearch = cfg?.agents?.defaults?.memorySearch;
    const usesLmstudioMemoryRuntime =
      memorySearch?.provider === "lmstudio" ||
      memorySearch?.fallback === "lmstudio" ||
      hasProviderRef(memorySearch?.model, "lmstudio");
    const remoteBaseUrl = memorySearch?.remote?.baseUrl?.trim();
    if (usesLmstudioMemoryRuntime && remoteBaseUrl) {
      return remoteBaseUrl;
    }
  }
  return provider === "ollama" ? DEFAULT_OLLAMA_BASE_URL : DEFAULT_LMSTUDIO_BASE_URL;
}

export function resolveModel(
  provider: string,
  modelId: string,
  agentDir?: string,
  cfg?: ArgentConfig,
): {
  model?: Model<Api>;
  error?: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
} {
  const resolvedAgentDir = agentDir ?? resolveArgentAgentDir();
  const authStorage = discoverAuthStorage(resolvedAgentDir);
  const modelRegistry = discoverModels(authStorage, resolvedAgentDir);
  const model = modelRegistry.find(provider, modelId) as Model<Api> | null;
  if (!model) {
    // Fallback 1: Check Argent's own models database (handles new models
    // before Pi's registry is updated — Pi is on OSS vacation until 2/23).
    const normalizedProvider = normalizeProviderId(provider);
    const argentProvider = ARGENT_MODELS[normalizedProvider];
    if (argentProvider) {
      const argentModel = argentProvider[modelId];
      if (argentModel) {
        return {
          model: normalizeModelCompat(argentModel as Model<Api>),
          authStorage,
          modelRegistry,
        };
      }
    }

    // Fallback 2: Inline models from config providers.
    const providers = cfg?.models?.providers ?? {};
    const inlineModels = buildInlineProviderModels(providers);
    const inlineMatch = inlineModels.find(
      (entry) => normalizeProviderId(entry.provider) === normalizedProvider && entry.id === modelId,
    );
    if (inlineMatch) {
      const normalized = normalizeModelCompat(inlineMatch as Model<Api>);
      return {
        model: normalized,
        authStorage,
        modelRegistry,
      };
    }
    // Local OpenAI-compatible runtimes may be selected without a provider model catalog.
    // Create a dynamic model entry when runtime config points at them directly.
    if (normalizedProvider === "ollama" || normalizedProvider === "lmstudio") {
      const dynamicProvider = normalizedProvider;
      const localModel: Model<Api> = normalizeModelCompat({
        id: modelId,
        name: modelId,
        api: "openai-completions",
        provider: dynamicProvider,
        baseUrl: resolveDynamicProviderBaseUrl(dynamicProvider, cfg),
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8192,
      } as Model<Api>);
      return { model: localModel, authStorage, modelRegistry };
    }
    const providerCfg = providers[provider];
    if (providerCfg || modelId.startsWith("mock-")) {
      const fallbackModel: Model<Api> = normalizeModelCompat({
        id: modelId,
        name: modelId,
        api: providerCfg?.api ?? "openai-responses",
        provider,
        baseUrl: providerCfg?.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: providerCfg?.models?.[0]?.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
        maxTokens: providerCfg?.models?.[0]?.maxTokens ?? DEFAULT_CONTEXT_TOKENS,
      } as Model<Api>);
      return { model: fallbackModel, authStorage, modelRegistry };
    }
    return {
      error: `Unknown model: ${provider}/${modelId}`,
      authStorage,
      modelRegistry,
    };
  }
  return { model: normalizeModelCompat(model), authStorage, modelRegistry };
}
