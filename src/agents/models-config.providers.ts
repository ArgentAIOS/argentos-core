import type { ArgentConfig } from "../config/config.js";
import type { ModelDefinitionConfig, ProviderRegistryEntry } from "../config/types.models.js";
import {
  DEFAULT_COPILOT_API_BASE_URL,
  resolveCopilotApiToken,
} from "../providers/github-copilot-token.js";
import { ensureAuthProfileStore, listProfilesForProvider } from "./auth-profiles.js";
import { discoverBedrockModels } from "./bedrock-discovery.js";
import {
  buildCloudflareAiGatewayModelDefinition,
  resolveCloudflareAiGatewayBaseUrl,
} from "./cloudflare-ai-gateway.js";
import { resolveAwsSdkEnvVarName, resolveEnvApiKey } from "./model-auth.js";
import { loadProviderRegistry } from "./provider-registry.js";
import { discoverVeniceModels } from "./venice-models.js";

type ModelsConfig = NonNullable<ArgentConfig["models"]>;
export type ProviderConfig = NonNullable<ModelsConfig["providers"]>[string];

// Re-export for backward compat (used by onboard-auth.config-core.ts)
export const XIAOMI_DEFAULT_MODEL_ID = "mimo-v2-flash";

async function hasEnabledServiceKey(variable: string): Promise<boolean> {
  try {
    const mod = await import("../infra/service-keys.js");
    const readServiceKeys = mod.readServiceKeys as () => {
      keys: Array<{ variable?: string; value?: string; enabled?: boolean }>;
    };
    const store = readServiceKeys();
    return store.keys.some(
      (entry) =>
        entry.variable === variable &&
        entry.enabled !== false &&
        typeof entry.value === "string" &&
        entry.value.trim().length > 0,
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ollama runtime discovery
// ---------------------------------------------------------------------------

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    family?: string;
    parameter_size?: string;
  };
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

const OLLAMA_DEFAULT_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

async function discoverOllamaModels(discoveryUrl: string): Promise<ModelDefinitionConfig[]> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return [];
  }
  try {
    const response = await fetch(discoveryUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.warn(`Failed to discover Ollama models: ${response.status}`);
      return [];
    }
    const data = (await response.json()) as OllamaTagsResponse;
    if (!data.models || data.models.length === 0) {
      console.warn("No Ollama models found on local instance");
      return [];
    }
    return data.models.map((model) => {
      const modelId = model.name;
      const isReasoning =
        modelId.toLowerCase().includes("r1") || modelId.toLowerCase().includes("reasoning");
      return {
        id: modelId,
        name: modelId,
        reasoning: isReasoning,
        input: ["text"] as Array<"text" | "image">,
        cost: OLLAMA_DEFAULT_COST,
        contextWindow: 128000,
        maxTokens: 8192,
      };
    });
  } catch (error) {
    console.warn(`Failed to discover Ollama models: ${String(error)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Auth resolution helpers
// ---------------------------------------------------------------------------

function normalizeApiKeyConfig(value: string): string {
  const trimmed = value.trim();
  const match = /^\$\{([A-Z0-9_]+)\}$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function resolveEnvApiKeyVarName(provider: string): string | undefined {
  const resolved = resolveEnvApiKey(provider);
  if (!resolved) {
    return undefined;
  }
  const match = /^(?:env: |shell env: )([A-Z0-9_]+)$/.exec(resolved.source);
  return match ? match[1] : undefined;
}

function resolveAwsSdkApiKeyVarName(): string {
  return resolveAwsSdkEnvVarName() ?? "AWS_PROFILE";
}

function resolveApiKeyFromProfiles(params: {
  provider: string;
  store: ReturnType<typeof ensureAuthProfileStore>;
}): string | undefined {
  const ids = listProfilesForProvider(params.store, params.provider);
  for (const id of ids) {
    const cred = params.store.profiles[id];
    if (!cred) {
      continue;
    }
    if (cred.type === "api_key") {
      return cred.key;
    }
    if (cred.type === "token") {
      return cred.token;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Google normalization (exported — used by media-understanding & model-selection)
// ---------------------------------------------------------------------------

export function normalizeGoogleModelId(id: string): string {
  if (id === "gemini-3-pro") {
    return "gemini-3-pro-preview";
  }
  if (id === "gemini-3-flash") {
    return "gemini-3-flash-preview";
  }
  return id;
}

function normalizeGoogleProvider(provider: ProviderConfig): ProviderConfig {
  let mutated = false;
  const models = provider.models.map((model) => {
    const nextId = normalizeGoogleModelId(model.id);
    if (nextId === model.id) {
      return model;
    }
    mutated = true;
    return { ...model, id: nextId };
  });
  return mutated ? { ...provider, models } : provider;
}

export function normalizeProviders(params: {
  providers: ModelsConfig["providers"];
  agentDir: string;
}): ModelsConfig["providers"] {
  const { providers } = params;
  if (!providers) {
    return providers;
  }
  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });
  let mutated = false;
  const next: Record<string, ProviderConfig> = {};

  for (const [key, provider] of Object.entries(providers)) {
    const normalizedKey = key.trim();
    let normalizedProvider = provider;

    // Fix common misconfig: apiKey set to "${ENV_VAR}" instead of "ENV_VAR".
    if (
      normalizedProvider.apiKey &&
      normalizeApiKeyConfig(normalizedProvider.apiKey) !== normalizedProvider.apiKey
    ) {
      mutated = true;
      normalizedProvider = {
        ...normalizedProvider,
        apiKey: normalizeApiKeyConfig(normalizedProvider.apiKey),
      };
    }

    // If a provider defines models, pi's ModelRegistry requires apiKey to be set.
    // Fill it from the environment or auth profiles when possible.
    const hasModels =
      Array.isArray(normalizedProvider.models) && normalizedProvider.models.length > 0;
    if (hasModels && !normalizedProvider.apiKey?.trim()) {
      const authMode =
        normalizedProvider.auth ?? (normalizedKey === "amazon-bedrock" ? "aws-sdk" : undefined);
      if (authMode === "aws-sdk") {
        const apiKey = resolveAwsSdkApiKeyVarName();
        mutated = true;
        normalizedProvider = { ...normalizedProvider, apiKey };
      } else {
        const fromEnv = resolveEnvApiKeyVarName(normalizedKey);
        const fromProfiles = resolveApiKeyFromProfiles({
          provider: normalizedKey,
          store: authStore,
        });
        const apiKey = fromEnv ?? fromProfiles;
        if (apiKey?.trim()) {
          mutated = true;
          normalizedProvider = { ...normalizedProvider, apiKey };
        }
      }
    }

    if (normalizedKey === "google") {
      const googleNormalized = normalizeGoogleProvider(normalizedProvider);
      if (googleNormalized !== normalizedProvider) {
        mutated = true;
      }
      normalizedProvider = googleNormalized;
    }

    next[key] = normalizedProvider;
  }

  return mutated ? next : providers;
}

// ---------------------------------------------------------------------------
// Registry → ProviderConfig conversion
// ---------------------------------------------------------------------------

function registryEntryToProviderConfig(
  entry: ProviderRegistryEntry,
  models?: ModelDefinitionConfig[],
): ProviderConfig {
  return {
    baseUrl: entry.baseUrl,
    ...(entry.api ? { api: entry.api } : {}),
    models: models ?? entry.models,
  };
}

/**
 * Resolve a single registry provider to a ProviderConfig with authentication.
 * Returns null if the provider has no valid auth credentials.
 */
async function resolveRegistryProvider(params: {
  name: string;
  entry: ProviderRegistryEntry;
  authStore: ReturnType<typeof ensureAuthProfileStore>;
}): Promise<ProviderConfig | null> {
  const { name, entry, authStore } = params;

  // --- Resolve authentication ---
  let apiKey: string | undefined;

  if (entry.authType === "oauth") {
    const profiles = listProfilesForProvider(authStore, name);
    if (profiles.length === 0) return null;
    apiKey = entry.oauthPlaceholder ?? `${name}-oauth`;
  } else if (entry.authType === "api_key" || entry.authType === "token") {
    apiKey =
      resolveEnvApiKeyVarName(name) ??
      resolveApiKeyFromProfiles({ provider: name, store: authStore });
    if (!apiKey && entry.envKeyVar && (await hasEnabledServiceKey(entry.envKeyVar))) {
      apiKey = entry.envKeyVar;
    }
    if (!apiKey) return null;
  }
  // authType "none" — no key needed, but we still need auth to be explicitly configured
  // to avoid polluting models.json with providers the user hasn't set up.
  // For "none" auth, we still check if the user has the provider in their config.
  if (entry.authType === "none") {
    return null;
  }

  // --- Resolve models (dynamic providers discover at runtime) ---
  let models = entry.models;
  if (entry.dynamic) {
    if (name === "venice") {
      const discovered = await discoverVeniceModels();
      if (discovered.length > 0) {
        models = discovered;
      }
    } else if (name === "ollama" && entry.discoveryUrl) {
      const discovered = await discoverOllamaModels(entry.discoveryUrl);
      if (discovered.length > 0) {
        models = discovered;
      }
    }
  }

  const config = registryEntryToProviderConfig(entry, models);
  if (apiKey) {
    return { ...config, apiKey };
  }
  return config;
}

// ---------------------------------------------------------------------------
// resolveImplicitProviders — reads from provider registry
// ---------------------------------------------------------------------------

export async function resolveImplicitProviders(params: {
  agentDir: string;
}): Promise<ModelsConfig["providers"]> {
  const providers: Record<string, ProviderConfig> = {};
  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });

  // Load provider definitions from registry (user-editable JSON file)
  const registry = loadProviderRegistry();

  for (const [name, entry] of Object.entries(registry.providers)) {
    const resolved = await resolveRegistryProvider({ name, entry, authStore });
    if (resolved) {
      providers[name] = resolved;
    }
  }

  // Cloudflare AI Gateway — dynamic URL from auth profile metadata, can't be
  // represented as pure registry data.
  const cloudflareProfiles = listProfilesForProvider(authStore, "cloudflare-ai-gateway");
  for (const profileId of cloudflareProfiles) {
    const cred = authStore.profiles[profileId];
    if (cred?.type !== "api_key") {
      continue;
    }
    const accountId = cred.metadata?.accountId?.trim();
    const gatewayId = cred.metadata?.gatewayId?.trim();
    if (!accountId || !gatewayId) {
      continue;
    }
    const baseUrl = resolveCloudflareAiGatewayBaseUrl({ accountId, gatewayId });
    if (!baseUrl) {
      continue;
    }
    const apiKey = resolveEnvApiKeyVarName("cloudflare-ai-gateway") ?? cred.key?.trim() ?? "";
    if (!apiKey) {
      continue;
    }
    providers["cloudflare-ai-gateway"] = {
      baseUrl,
      api: "anthropic-messages",
      apiKey,
      models: [buildCloudflareAiGatewayModelDefinition()],
    };
    break;
  }

  return providers;
}

// ---------------------------------------------------------------------------
// buildXiaomiProvider — backward compat export for onboard-auth
// ---------------------------------------------------------------------------

export function buildXiaomiProvider(): ProviderConfig {
  const registry = loadProviderRegistry();
  const entry = registry.providers.xiaomi;
  if (entry) {
    return registryEntryToProviderConfig(entry);
  }
  // Fallback if registry entry is missing
  return {
    baseUrl: "https://api.xiaomimimo.com/anthropic",
    api: "anthropic-messages",
    models: [
      {
        id: XIAOMI_DEFAULT_MODEL_ID,
        name: "Xiaomi MiMo V2 Flash",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 8192,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Copilot & Bedrock — special-case providers with custom auth flows
// ---------------------------------------------------------------------------

export async function resolveImplicitCopilotProvider(params: {
  agentDir: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ProviderConfig | null> {
  const env = params.env ?? process.env;
  const authStore = ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false });
  const hasProfile = listProfilesForProvider(authStore, "github-copilot").length > 0;
  const envToken = env.COPILOT_GITHUB_TOKEN ?? env.GH_TOKEN ?? env.GITHUB_TOKEN;
  const githubToken = (envToken ?? "").trim();

  if (!hasProfile && !githubToken) {
    return null;
  }

  let selectedGithubToken = githubToken;
  if (!selectedGithubToken && hasProfile) {
    const profileId = listProfilesForProvider(authStore, "github-copilot")[0];
    const profile = profileId ? authStore.profiles[profileId] : undefined;
    if (profile && profile.type === "token") {
      selectedGithubToken = profile.token;
    }
  }

  let baseUrl = DEFAULT_COPILOT_API_BASE_URL;
  if (selectedGithubToken) {
    try {
      const token = await resolveCopilotApiToken({
        githubToken: selectedGithubToken,
        env,
      });
      baseUrl = token.baseUrl;
    } catch {
      baseUrl = DEFAULT_COPILOT_API_BASE_URL;
    }
  }

  return {
    baseUrl,
    models: [],
  } satisfies ProviderConfig;
}

export async function resolveImplicitBedrockProvider(params: {
  agentDir: string;
  config?: ArgentConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<ProviderConfig | null> {
  const env = params.env ?? process.env;
  const discoveryConfig = params.config?.models?.bedrockDiscovery;
  const enabled = discoveryConfig?.enabled;
  const hasAwsCreds = resolveAwsSdkEnvVarName(env) !== undefined;
  if (enabled === false) {
    return null;
  }
  if (enabled !== true && !hasAwsCreds) {
    return null;
  }

  const region = discoveryConfig?.region ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-east-1";
  const models = await discoverBedrockModels({ region, config: discoveryConfig });
  if (models.length === 0) {
    return null;
  }

  return {
    baseUrl: `https://bedrock-runtime.${region}.amazonaws.com`,
    api: "bedrock-converse-stream",
    auth: "aws-sdk",
    models,
  } satisfies ProviderConfig;
}
