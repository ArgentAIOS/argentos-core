import type { RealtimeVoiceProvider, RealtimeVoiceProviderId } from "./provider-types.js";

export function normalizeRealtimeVoiceProviderId(
  providerId: string | undefined,
): RealtimeVoiceProviderId | undefined {
  const normalized = providerId?.trim().toLowerCase();
  return normalized || undefined;
}

export function buildRealtimeVoiceProviderMaps(providers: RealtimeVoiceProvider[]): {
  canonical: Map<string, RealtimeVoiceProvider>;
  aliases: Map<string, RealtimeVoiceProvider>;
} {
  const canonical = new Map<string, RealtimeVoiceProvider>();
  const aliases = new Map<string, RealtimeVoiceProvider>();

  for (const provider of providers) {
    const id = normalizeRealtimeVoiceProviderId(provider.id);
    if (!id || canonical.has(id)) {
      continue;
    }
    canonical.set(id, provider);
    aliases.set(id, provider);
    for (const alias of provider.aliases ?? []) {
      const normalizedAlias = normalizeRealtimeVoiceProviderId(alias);
      if (normalizedAlias && !aliases.has(normalizedAlias)) {
        aliases.set(normalizedAlias, provider);
      }
    }
  }

  return { canonical, aliases };
}

export function listRealtimeVoiceProviders(
  providers: RealtimeVoiceProvider[],
): RealtimeVoiceProvider[] {
  return [...buildRealtimeVoiceProviderMaps(providers).canonical.values()];
}

export function getRealtimeVoiceProvider(
  providerId: string | undefined,
  providers: RealtimeVoiceProvider[],
): RealtimeVoiceProvider | undefined {
  const normalized = normalizeRealtimeVoiceProviderId(providerId);
  if (!normalized) {
    return undefined;
  }
  return buildRealtimeVoiceProviderMaps(providers).aliases.get(normalized);
}

export function canonicalizeRealtimeVoiceProviderId(
  providerId: string | undefined,
  providers: RealtimeVoiceProvider[],
): RealtimeVoiceProviderId | undefined {
  const normalized = normalizeRealtimeVoiceProviderId(providerId);
  if (!normalized) {
    return undefined;
  }
  return getRealtimeVoiceProvider(normalized, providers)?.id ?? normalized;
}
