/**
 * Provider-aware onboarding helpers shared by the dashboard wizard and first-run gating.
 * These helpers keep runtime validation and derived defaults aligned with the graphical flow.
 */

export type HostedLlmProviderId = "anthropic" | "openai" | "minimax" | "zai";
export type LlmProviderId = HostedLlmProviderId | "local";
export type LocalRuntimeProviderId = "ollama" | "lmstudio";
export type VoiceProviderId = "edge" | "openai" | "elevenlabs";
export type SearchProviderId = "brave" | "perplexity";

export type AuthProfileSummary = {
  key: string;
  provider: string;
  type?: string | null;
};

export type ModelConfigSummary = {
  model?: unknown;
  subagentModel?: string | null;
  modelRouter?: Record<string, unknown> | null;
};

export type OnboardingValidation = {
  valid: boolean;
  requiresHostedAuth: boolean;
  currentLlmProvider: string | null;
  missingProviders: string[];
  reasons: string[];
};

export type ProviderCard = {
  id: LlmProviderId;
  label: string;
  accent: string;
  recommended: string;
  description: string;
  keyUrl: string;
};

export type VoiceProviderCard = {
  id: VoiceProviderId;
  label: string;
  description: string;
};

export type SearchProviderCard = {
  id: SearchProviderId;
  label: string;
  description: string;
};

export type ProviderModelChoice = {
  id: string;
  name: string;
  badge?: string;
  description: string;
};

type RouterTierSelection = {
  fast: string;
  balanced: string;
  powerful: string;
};

const LOCAL_MODEL_PROVIDER = "ollama";
const LOCAL_MODEL_ID = "qwen3:30b-a3b-instruct-2507-q4_K_M";
const LOCAL_MODEL_REF = `${LOCAL_MODEL_PROVIDER}/${LOCAL_MODEL_ID}`;
const LMSTUDIO_LOCAL_MODEL_ID = "qwen/qwen3.5-35b-a3b";
const LMSTUDIO_LOCAL_MODEL_REF = `lmstudio/${LMSTUDIO_LOCAL_MODEL_ID}`;

const KEYLESS_PROVIDERS = new Set(["ollama", "lmstudio", "edge"]);
const ANTHROPIC_HARD_DEFAULT = "anthropic";

export const LLM_PROVIDER_CARDS: ProviderCard[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    accent: "amber",
    recommended: "Best Claude experience",
    description:
      "Claude models with strong coding and reasoning. Best if you already use Anthropic or Claude Max.",
    keyUrl: "https://console.anthropic.com/",
  },
  {
    id: "openai",
    label: "OpenAI",
    accent: "emerald",
    recommended: "Balanced hosted default",
    description:
      "GPT models plus built-in TTS pairing. Great low-friction path if you already have an OpenAI API account.",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "minimax",
    label: "MiniMax",
    accent: "violet",
    recommended: "Great value + media stack",
    description:
      "Fast, affordable hosted models with broad media capabilities. Good when you want one provider for a lot of AI surface area.",
    keyUrl: "https://platform.minimaxi.com/",
  },
  {
    id: "zai",
    label: "Z.AI / GLM",
    accent: "cyan",
    recommended: "Strong GLM family",
    description:
      "GLM hosted models from Z.AI. Best if you specifically want the GLM family or already use bigmodel.cn.",
    keyUrl: "https://open.bigmodel.cn/",
  },
  {
    id: "local",
    label: "Local only",
    accent: "slate",
    recommended: "No hosted keys",
    description:
      "Use local models only. Best if you are intentionally staying offline or already run Ollama/LM Studio locally.",
    keyUrl: "https://ollama.com/",
  },
];

export const VOICE_PROVIDER_CARDS: VoiceProviderCard[] = [
  {
    id: "edge",
    label: "Edge voices",
    description:
      "Works out of the box on desktop with no API key. Best default for graphical users who just want speech enabled.",
  },
  {
    id: "openai",
    label: "OpenAI TTS",
    description:
      "Use OpenAI's built-in voices when you already rely on OpenAI for your hosted stack.",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    description: "Premium voice quality and expressive speech. Best if voice quality matters most.",
  },
];

export const SEARCH_PROVIDER_CARDS: SearchProviderCard[] = [
  {
    id: "brave",
    label: "Brave Search",
    description:
      "Simple web results with a dedicated search provider. Good default if you want straightforward search tool behavior.",
  },
  {
    id: "perplexity",
    label: "Perplexity / Sonar",
    description:
      "Search with synthesized answers and citations. Best when you want richer research-style responses.",
  },
];

const MODEL_FALLBACKS: Record<LlmProviderId, ProviderModelChoice[]> = {
  anthropic: [
    {
      id: "anthropic/claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      badge: "Recommended",
      description: "Best balance of speed, quality, and cost for daily chat and coding.",
    },
    {
      id: "anthropic/claude-opus-4-6",
      name: "Claude Opus 4.6",
      badge: "Most Capable",
      description: "Use when you want the strongest hosted reasoning and coding path.",
    },
    {
      id: "anthropic/claude-haiku-4-5",
      name: "Claude Haiku 4.5",
      badge: "Fastest",
      description: "Fast and inexpensive for lighter workloads.",
    },
  ],
  openai: [
    {
      id: "openai/gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      badge: "Recommended",
      description:
        "Fast, capable, and a strong graphical default when you want one hosted provider for chat plus TTS.",
    },
    {
      id: "openai/gpt-5.2",
      name: "GPT-5.2",
      badge: "Balanced",
      description: "Strong general-purpose model for everyday chat, research, and coding.",
    },
    {
      id: "openai/gpt-5.4",
      name: "GPT-5.4",
      badge: "Most Capable",
      description: "Use when you want the strongest OpenAI-hosted reasoning path.",
    },
  ],
  minimax: [
    {
      id: "minimax/MiniMax-M2.5",
      name: "MiniMax M2.5",
      badge: "Recommended",
      description: "Latest MiniMax flagship. Great balance of speed and quality.",
    },
    {
      id: "minimax/MiniMax-M2.1",
      name: "MiniMax M2.1",
      badge: "Balanced",
      description: "Strong general-purpose model with good coding behavior.",
    },
    {
      id: "minimax/MiniMax-M2",
      name: "MiniMax M2",
      badge: "Efficient",
      description: "Lower-cost option for lighter interactive workloads.",
    },
  ],
  zai: [
    {
      id: "zai/glm-5",
      name: "GLM-5",
      badge: "Recommended",
      description:
        "Newest GLM generation. Best default when you want the latest Z.AI hosted stack.",
    },
    {
      id: "zai/glm-4.7",
      name: "GLM-4.7",
      badge: "Balanced",
      description: "Strong, stable GLM generation for general reasoning and coding.",
    },
    {
      id: "zai/glm-4.6",
      name: "GLM-4.6",
      badge: "Fast",
      description: "Good lower-latency fallback for lighter tasks.",
    },
  ],
  local: [
    {
      id: LOCAL_MODEL_REF,
      name: "Qwen 3 30B (local)",
      badge: "Local",
      description: "Default local-only chat model through Ollama.",
    },
  ],
};

const LOCAL_RUNTIME_FALLBACKS: Record<LocalRuntimeProviderId, ProviderModelChoice[]> = {
  ollama: MODEL_FALLBACKS.local,
  lmstudio: [
    {
      id: LMSTUDIO_LOCAL_MODEL_REF,
      name: "Qwen 3.5 35B (LM Studio)",
      badge: "Local",
      description: "Default local-only chat model through LM Studio.",
    },
  ],
};

const ROUTER_TIER_PREFERENCES: Record<HostedLlmProviderId, { fast: string[]; powerful: string[] }> =
  {
    anthropic: {
      fast: ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6"],
      powerful: ["anthropic/claude-opus-4-6", "anthropic/claude-sonnet-4-6"],
    },
    openai: {
      fast: ["openai/gpt-5.4-mini", "openai/gpt-5.2", "openai/gpt-5.4"],
      powerful: ["openai/gpt-5.4", "openai/gpt-5.2", "openai/gpt-5.4-mini"],
    },
    minimax: {
      fast: ["minimax/MiniMax-M2", "minimax/MiniMax-M2.1", "minimax/MiniMax-M2.5"],
      powerful: ["minimax/MiniMax-M2.5", "minimax/MiniMax-M2.1", "minimax/MiniMax-M2"],
    },
    zai: {
      fast: ["zai/glm-4.6", "zai/glm-4.7", "zai/glm-5", "zai/glm-5.1"],
      powerful: ["zai/glm-5.1", "zai/glm-5", "zai/glm-4.7", "zai/glm-4.6"],
    },
  };

export function getProviderFallbackModels(
  provider: LlmProviderId,
  localRuntime: LocalRuntimeProviderId = "ollama",
): ProviderModelChoice[] {
  if (provider === "local") {
    return LOCAL_RUNTIME_FALLBACKS[localRuntime] ?? LOCAL_RUNTIME_FALLBACKS.ollama;
  }
  return MODEL_FALLBACKS[provider] ?? [];
}

export function chooseInitialModelForProvider(
  provider: LlmProviderId,
  currentModel: string | null | undefined,
  options: ProviderModelChoice[] | null | undefined,
  localRuntime: LocalRuntimeProviderId = "ollama",
): string {
  const normalizedOptions = Array.isArray(options) ? options : [];
  const normalizedCurrent = String(currentModel || "").trim();
  if (normalizedCurrent) {
    const currentProvider = inferProviderFromModelRef(normalizedCurrent);
    if (
      (provider === "local" ? currentProvider === localRuntime : currentProvider === provider) &&
      normalizedOptions.some((entry) => entry.id === normalizedCurrent)
    ) {
      return normalizedCurrent;
    }
  }
  return normalizedOptions[0]?.id || "";
}

export function inferProviderFromModelRef(ref: string | null | undefined): string | null {
  const normalized = String(ref || "").trim();
  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0 || slashIndex === normalized.length - 1) {
    return null;
  }
  return normalized.slice(0, slashIndex).trim().toLowerCase() || null;
}

export function stripProviderFromModelRef(ref: string | null | undefined): string | null {
  const normalized = String(ref || "").trim();
  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0 || slashIndex === normalized.length - 1) {
    return null;
  }
  return normalized.slice(slashIndex + 1).trim() || null;
}

function isLocalProvider(provider: string | null | undefined): boolean {
  return KEYLESS_PROVIDERS.has(
    String(provider || "")
      .trim()
      .toLowerCase(),
  );
}

function collectRouterProviders(
  modelRouter: Record<string, unknown> | null | undefined,
): Set<string> {
  const providers = new Set<string>();
  const collectTiers = (tiers: unknown) => {
    if (!tiers || typeof tiers !== "object") {
      return;
    }
    for (const tier of Object.values(tiers as Record<string, unknown>)) {
      if (!tier || typeof tier !== "object") {
        continue;
      }
      const provider = String((tier as { provider?: string }).provider || "")
        .trim()
        .toLowerCase();
      if (provider) {
        providers.add(provider);
      }
    }
  };

  if (!modelRouter || typeof modelRouter !== "object") {
    providers.add(ANTHROPIC_HARD_DEFAULT);
    return providers;
  }

  collectTiers((modelRouter as { tiers?: unknown }).tiers);

  const activeProfile = String(
    (modelRouter as { activeProfile?: string }).activeProfile || "",
  ).trim();
  const profiles = (modelRouter as { profiles?: Record<string, unknown> }).profiles;
  if (profiles && typeof profiles === "object") {
    if (activeProfile && profiles[activeProfile] && typeof profiles[activeProfile] === "object") {
      collectTiers((profiles[activeProfile] as { tiers?: unknown }).tiers);
    } else {
      for (const profile of Object.values(profiles)) {
        if (!profile || typeof profile !== "object") {
          continue;
        }
        collectTiers((profile as { tiers?: unknown }).tiers);
      }
    }
  }

  if (providers.size === 0) {
    providers.add(ANTHROPIC_HARD_DEFAULT);
  }

  return providers;
}

export function evaluateOnboardingStatus(params: {
  authProfiles: AuthProfileSummary[] | null | undefined;
  modelConfig: ModelConfigSummary | null | undefined;
}): OnboardingValidation {
  const authProfiles = Array.isArray(params.authProfiles) ? params.authProfiles : [];
  const authProviders = new Set(
    authProfiles
      .map((profile) =>
        String(profile.provider || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );

  const modelEntry = params.modelConfig?.model;
  const primaryModel =
    typeof modelEntry === "string"
      ? modelEntry
      : modelEntry && typeof modelEntry === "object"
        ? String((modelEntry as { primary?: string }).primary || "")
        : "";
  const primaryProvider = inferProviderFromModelRef(primaryModel);
  const subagentProvider = inferProviderFromModelRef(params.modelConfig?.subagentModel || null);
  const requiredProviders = new Set<string>();

  if (primaryProvider && !isLocalProvider(primaryProvider)) {
    requiredProviders.add(primaryProvider);
  }
  if (subagentProvider && !isLocalProvider(subagentProvider)) {
    requiredProviders.add(subagentProvider);
  }
  for (const provider of collectRouterProviders(params.modelConfig?.modelRouter || null)) {
    if (!isLocalProvider(provider)) {
      requiredProviders.add(provider);
    }
  }

  const missingProviders = [...requiredProviders].filter(
    (provider) => !authProviders.has(provider),
  );
  const reasons: string[] = [];

  if (!primaryProvider) {
    reasons.push("No default chat model is configured yet.");
  }
  if (missingProviders.length > 0) {
    reasons.push(
      `Missing credentials for ${missingProviders.join(", ")} even though chat or routing defaults still target those providers.`,
    );
  }
  if (primaryProvider && !isLocalProvider(primaryProvider) && authProviders.size === 0) {
    reasons.push("No hosted LLM credentials are configured yet.");
  }

  return {
    valid: reasons.length === 0,
    requiresHostedAuth: Boolean(primaryProvider) && !isLocalProvider(primaryProvider),
    currentLlmProvider: primaryProvider,
    missingProviders,
    reasons,
  };
}

export function deriveProviderAwareModelConfig(params: {
  llmProvider: LlmProviderId;
  selectedModel: string;
  availableModels?: ProviderModelChoice[];
  localRuntime?: LocalRuntimeProviderId;
}) {
  const provider = params.llmProvider;
  const localRuntime = params.localRuntime ?? "ollama";
  if (provider === "local") {
    const fallbackRef =
      getProviderFallbackModels("local", localRuntime)[0]?.id ||
      (localRuntime === "lmstudio" ? LMSTUDIO_LOCAL_MODEL_REF : LOCAL_MODEL_REF);
    const parsedLocalProvider = inferProviderFromModelRef(fallbackRef) || localRuntime;
    const parsedLocalModel = stripProviderFromModelRef(fallbackRef) || fallbackRef;
    return {
      model: { primary: fallbackRef },
      subagentModel: fallbackRef,
      modelRouter: {
        enabled: true,
        tiers: {
          local: { provider: parsedLocalProvider, model: parsedLocalModel },
          fast: { provider: parsedLocalProvider, model: parsedLocalModel },
          balanced: { provider: parsedLocalProvider, model: parsedLocalModel },
          powerful: { provider: parsedLocalProvider, model: parsedLocalModel },
        },
      },
    };
  }

  const selectedModelId = stripProviderFromModelRef(params.selectedModel) || params.selectedModel;
  const tiers = deriveHostedRouterTierSelection({
    provider,
    selectedModel: params.selectedModel,
    availableModels: params.availableModels,
  });
  return {
    model: { primary: `${provider}/${selectedModelId}` },
    subagentModel: `${provider}/${selectedModelId}`,
    modelRouter: {
      enabled: true,
      tiers: {
        local: { provider: LOCAL_MODEL_PROVIDER, model: LOCAL_MODEL_ID },
        fast: { provider, model: tiers.fast },
        balanced: { provider, model: tiers.balanced },
        powerful: { provider, model: tiers.powerful },
      },
      routingPolicy: {
        likelyToolUseMinTier: "balanced",
      },
    },
  };
}

export function buildModelChoicesFromApi(
  provider: LlmProviderId,
  rows:
    | Array<{ id?: string; model?: string; alias?: string | null; verified?: boolean }>
    | null
    | undefined,
  localRuntime: LocalRuntimeProviderId = "ollama",
): ProviderModelChoice[] {
  if (provider === "local") {
    const fallback = getProviderFallbackModels("local", localRuntime);
    const mergedLocal = (rows || [])
      .map((row) => {
        const rawId = String(row?.id || "").trim();
        if (!rawId) return null;
        return {
          id: rawId,
          name: String(row?.alias || row?.model || rawId).trim() || rawId,
          badge: row?.verified ? "Verified" : "Local",
          description: `Available ${localRuntime === "lmstudio" ? "LM Studio" : "Ollama"} model.`,
        } satisfies ProviderModelChoice;
      })
      .filter((entry): entry is ProviderModelChoice => entry !== null);
    return mergedLocal.length > 0 ? mergedLocal : fallback;
  }

  const fallback = MODEL_FALLBACKS[provider] ?? [];
  const preferredOrder = new Map(fallback.map((entry, index) => [entry.id, { entry, index }]));
  const seen = new Set<string>();
  const merged: ProviderModelChoice[] = [];

  for (const row of rows || []) {
    const rawId = String(row?.id || "").trim();
    if (!rawId) {
      continue;
    }
    const name = String(row?.alias || row?.model || rawId).trim() || rawId;
    const fallbackMeta = preferredOrder.get(rawId);
    merged.push({
      id: rawId,
      name,
      badge: fallbackMeta?.entry.badge ?? (row?.verified ? "Verified" : undefined),
      description:
        fallbackMeta?.entry.description ??
        (row?.verified
          ? "Verified live or configured for this provider in your current runtime."
          : `Available ${provider} model.`),
    });
    seen.add(rawId);
  }

  for (const entry of fallback) {
    if (!seen.has(entry.id)) {
      merged.push(entry);
    }
  }

  merged.sort((a, b) => {
    const orderA = preferredOrder.get(a.id)?.index ?? Number.MAX_SAFE_INTEGER;
    const orderB = preferredOrder.get(b.id)?.index ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.name.localeCompare(b.name);
  });

  return merged.length > 0 ? merged : fallback;
}

function parseProviderModelRef(ref: string | null | undefined): {
  provider: string;
  model: string;
} {
  const normalized = String(ref || "").trim();
  const provider = inferProviderFromModelRef(normalized) || "";
  const model = stripProviderFromModelRef(normalized) || normalized;
  return { provider, model };
}

function deriveEmbeddingLaneSelection(params: {
  llmProvider: LlmProviderId;
  localRuntime: LocalRuntimeProviderId;
  backgroundLocalRuntime?: LocalRuntimeProviderId | null;
}): { provider: string; model: string; fallback: string } {
  if (params.backgroundLocalRuntime === "lmstudio") {
    return {
      provider: "lmstudio",
      model: "text-embedding-nomic-embed-text-v1.5",
      fallback: "none",
    };
  }

  if (params.backgroundLocalRuntime === "ollama") {
    return {
      provider: "ollama",
      model: "nomic-embed-text",
      fallback: "none",
    };
  }

  if (params.llmProvider === "local") {
    if (params.localRuntime === "lmstudio") {
      return {
        provider: "lmstudio",
        model: "text-embedding-nomic-embed-text-v1.5",
        fallback: "none",
      };
    }
    return {
      provider: "ollama",
      model: "nomic-embed-text",
      fallback: "none",
    };
  }

  if (params.llmProvider === "openai") {
    return {
      provider: "openai",
      model: "text-embedding-nomic-embed-text-v1.5",
      fallback: "none",
    };
  }

  if (params.llmProvider === "zai") {
    return {
      provider: "zai",
      model: "embedding-3",
      fallback: "none",
    };
  }

  if (params.llmProvider === "minimax") {
    return {
      provider: "minimax",
      model: "text-embedding",
      fallback: "none",
    };
  }

  return {
    provider: "openai",
    model: "text-embedding-nomic-embed-text-v1.5",
    fallback: "none",
  };
}

export function deriveProviderAwareAgentSettingsPatch(params: {
  llmProvider: LlmProviderId;
  selectedModel: string;
  availableModels?: ProviderModelChoice[];
  localRuntime?: LocalRuntimeProviderId;
  backgroundLocalRuntime?: LocalRuntimeProviderId | null;
}) {
  const localRuntime = params.localRuntime ?? "ollama";
  const derived = deriveProviderAwareModelConfig({
    llmProvider: params.llmProvider,
    selectedModel: params.selectedModel,
    availableModels: params.availableModels,
    localRuntime,
  });
  const primaryRef = String((derived.model as { primary?: string } | null)?.primary || "");
  const balanced = parseProviderModelRef(primaryRef);
  const routerTiers =
    (derived.modelRouter as { tiers?: Record<string, { provider?: string; model?: string }> })
      ?.tiers || {};
  const fast = {
    provider: String(routerTiers.fast?.provider || balanced.provider).trim(),
    model: String(routerTiers.fast?.model || balanced.model).trim(),
  };
  const powerful = {
    provider: String(routerTiers.powerful?.provider || balanced.provider).trim(),
    model: String(routerTiers.powerful?.model || balanced.model).trim(),
  };
  const backgroundRuntime = params.backgroundLocalRuntime ?? null;
  const localBackgroundRef =
    backgroundRuntime === "lmstudio"
      ? LMSTUDIO_LOCAL_MODEL_REF
      : backgroundRuntime === "ollama"
        ? LOCAL_MODEL_REF
        : "";
  const localBackgroundProvider =
    (backgroundRuntime && inferProviderFromModelRef(localBackgroundRef)) || "";
  const localBackgroundModel =
    (backgroundRuntime && stripProviderFromModelRef(localBackgroundRef)) || "";
  const kernelLane =
    backgroundRuntime && localBackgroundProvider && localBackgroundModel
      ? { provider: localBackgroundProvider, model: localBackgroundModel }
      : { provider: fast.provider, model: fast.model };
  const structuredLane =
    backgroundRuntime && localBackgroundProvider && localBackgroundModel
      ? { provider: localBackgroundProvider, model: localBackgroundModel }
      : { provider: balanced.provider, model: balanced.model };
  const efficientLane =
    backgroundRuntime && localBackgroundProvider && localBackgroundModel
      ? { provider: localBackgroundProvider, model: localBackgroundModel }
      : { provider: fast.provider, model: fast.model };
  const embedding = deriveEmbeddingLaneSelection({
    llmProvider: params.llmProvider,
    localRuntime,
    backgroundLocalRuntime: backgroundRuntime,
  });

  return {
    backgroundModels: {
      kernel: {
        provider: kernelLane.provider,
        model: kernelLane.model,
      },
      contemplation: {
        provider: structuredLane.provider,
        model: structuredLane.model,
      },
      sis: {
        provider: structuredLane.provider,
        model: structuredLane.model,
      },
      heartbeat: {
        provider: efficientLane.provider,
        model: efficientLane.model,
      },
      executionWorker: {
        provider: efficientLane.provider,
        model: efficientLane.model,
      },
      embeddings: {
        provider: embedding.provider,
        model: `${embedding.provider}/${embedding.model}`,
        fallback: embedding.fallback,
      },
    },
    memory: {
      memu: {
        llm: {
          provider: structuredLane.provider,
          model: structuredLane.model,
          thinkLevel: "off",
          timeoutMs: 15000,
        },
      },
    },
  };
}

function deriveHostedRouterTierSelection(params: {
  provider: HostedLlmProviderId;
  selectedModel: string;
  availableModels?: ProviderModelChoice[];
}): RouterTierSelection {
  const selectedId = String(params.selectedModel || "").trim();
  const selectedModel = stripProviderFromModelRef(selectedId) || selectedId;
  const availableModels = Array.isArray(params.availableModels) ? params.availableModels : [];
  const availableIds = new Set(
    (availableModels.length > 0 ? availableModels : MODEL_FALLBACKS[params.provider]).map(
      (entry) => entry.id,
    ),
  );
  const preferences = ROUTER_TIER_PREFERENCES[params.provider];

  const pick = (candidates: string[], fallbackId: string) => {
    for (const candidate of candidates) {
      if (availableIds.has(candidate)) {
        return stripProviderFromModelRef(candidate) || fallbackId;
      }
    }
    return fallbackId;
  };

  return {
    fast: pick(preferences.fast, selectedModel),
    balanced: selectedModel,
    powerful: pick(preferences.powerful, selectedModel),
  };
}
