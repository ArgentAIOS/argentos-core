import type {
  RealtimeVoiceProvider,
  RealtimeVoiceProviderConfig,
  RealtimeVoiceProviderId,
} from "./provider-types.js";
import { getRealtimeVoiceProvider, listRealtimeVoiceProviders } from "./provider-registry.js";

export type ResolvedRealtimeVoiceProvider = {
  provider: RealtimeVoiceProvider;
  providerConfig: RealtimeVoiceProviderConfig;
};

export type ResolveConfiguredRealtimeVoiceProviderParams = {
  cfg?: unknown;
  configuredProviderId?: string;
  providerConfigs?: Record<string, RealtimeVoiceProviderConfig | undefined>;
  providers: RealtimeVoiceProvider[];
  defaultProviderId?: string;
  defaultModel?: string;
  noRegisteredProviderMessage?: string;
};

function withDefaultModel(
  providerConfig: RealtimeVoiceProviderConfig,
  defaultModel: string | undefined,
): RealtimeVoiceProviderConfig {
  if (!defaultModel || providerConfig.model !== undefined) {
    return providerConfig;
  }
  return { ...providerConfig, model: defaultModel };
}

function resolveRequestedProviderId(params: {
  configuredProviderId?: string;
  defaultProviderId?: string;
  providers: RealtimeVoiceProvider[];
}): RealtimeVoiceProviderId | undefined {
  if (params.configuredProviderId) {
    return params.configuredProviderId;
  }
  if (params.defaultProviderId) {
    return params.defaultProviderId;
  }
  return listRealtimeVoiceProviders(params.providers)[0]?.id;
}

export function resolveConfiguredRealtimeVoiceProvider(
  params: ResolveConfiguredRealtimeVoiceProviderParams,
): ResolvedRealtimeVoiceProvider {
  const providers = listRealtimeVoiceProviders(params.providers);
  if (providers.length === 0) {
    throw new Error(params.noRegisteredProviderMessage ?? "No realtime voice provider registered");
  }

  const requestedProviderId = resolveRequestedProviderId({
    configuredProviderId: params.configuredProviderId,
    defaultProviderId: params.defaultProviderId,
    providers,
  });
  const provider = getRealtimeVoiceProvider(requestedProviderId, providers);
  if (!provider) {
    throw new Error(`Realtime voice provider "${requestedProviderId}" is not registered`);
  }

  const rawConfig = withDefaultModel(
    params.providerConfigs?.[provider.id] ??
      params.providerConfigs?.[requestedProviderId ?? ""] ??
      {},
    params.defaultModel,
  );
  const providerConfig = provider.resolveConfig?.({ cfg: params.cfg, rawConfig }) ?? rawConfig;
  const configured = provider.isConfigured?.({ cfg: params.cfg, providerConfig }) ?? true;
  if (!configured) {
    throw new Error(`Realtime voice provider "${provider.id}" is not configured`);
  }

  return { provider, providerConfig };
}
