/**
 * Provider-aware onboarding helpers shared by the dashboard wizard and first-run gating.
 * These helpers keep runtime validation and derived defaults aligned with the graphical flow.
 */

export type HostedLlmProviderId = "anthropic" | "openai" | "minimax" | "zai";
export type LlmProviderId = HostedLlmProviderId | "local";
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

const LOCAL_MODEL_PROVIDER = "ollama";
const LOCAL_MODEL_ID = "qwen3:30b-a3b-instruct-2507-q4_K_M";
const LOCAL_MODEL_REF = `${LOCAL_MODEL_PROVIDER}/${LOCAL_MODEL_ID}`;

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
      description: "Newest GLM generation. Best default when you want the latest Z.AI hosted stack.",
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

export function getProviderFallbackModels(provider: LlmProviderId): ProviderModelChoice[] {
  return MODEL_FALLBACKS[provider];
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
  return KEYLESS_PROVIDERS.has(String(provider || "").trim().toLowerCase());
}

function collectRouterProviders(modelRouter: Record<string, unknown> | null | undefined): Set<string> {
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

  const activeProfile = String((modelRouter as { activeProfile?: string }).activeProfile || "").trim();
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
  authProfiles: AuthProfileSummary[];
  modelConfig: ModelConfigSummary | null | undefined;
}): OnboardingValidation {
  const authProviders = new Set(
    (params.authProfiles || [])
      .map((profile) => String(profile.provider || "").trim().toLowerCase())
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

  const missingProviders = [...requiredProviders].filter((provider) => !authProviders.has(provider));
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
}) {
  const provider = params.llmProvider;
  if (provider === "local") {
    return {
      model: { primary: LOCAL_MODEL_REF },
      subagentModel: LOCAL_MODEL_REF,
      modelRouter: {
        enabled: true,
        tiers: {
          local: { provider: LOCAL_MODEL_PROVIDER, model: LOCAL_MODEL_ID },
          fast: { provider: LOCAL_MODEL_PROVIDER, model: LOCAL_MODEL_ID },
          balanced: { provider: LOCAL_MODEL_PROVIDER, model: LOCAL_MODEL_ID },
          powerful: { provider: LOCAL_MODEL_PROVIDER, model: LOCAL_MODEL_ID },
        },
      },
    };
  }

  const selectedModelId = stripProviderFromModelRef(params.selectedModel) || params.selectedModel;
  return {
    model: { primary: `${provider}/${selectedModelId}` },
    subagentModel: `${provider}/${selectedModelId}`,
    modelRouter: {
      enabled: true,
      tiers: {
        local: { provider: LOCAL_MODEL_PROVIDER, model: LOCAL_MODEL_ID },
        fast: { provider, model: selectedModelId },
        balanced: { provider, model: selectedModelId },
        powerful: { provider, model: selectedModelId },
      },
      routingPolicy: {
        likelyToolUseMinTier: "balanced",
      },
    },
  };
}

export function buildModelChoicesFromApi(
  provider: LlmProviderId,
  rows: Array<{ id?: string; model?: string; alias?: string | null; verified?: boolean }> | null | undefined,
): ProviderModelChoice[] {
  if (provider === "local") {
    return MODEL_FALLBACKS.local;
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
