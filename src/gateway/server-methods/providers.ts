import type { GatewayRequestHandlers } from "./types.js";
import { loadAuthProfileStore } from "../../agents/auth-profiles/store.js";
import { loadProviderRegistry } from "../../agents/provider-registry.js";
import { loadConfig } from "../../config/config.js";

export const providersHandlers: GatewayRequestHandlers = {
  /**
   * providers.status — Active provider health summary.
   * Returns auth profiles grouped by provider with connection status,
   * plus the currently active model-router profile and its tier providers.
   */
  "providers.status": ({ respond }) => {
    try {
      const cfg = loadConfig();
      const authStore = loadAuthProfileStore();
      const profiles = authStore.profiles ?? {};
      const providerStats = authStore.providerStats ?? {};
      const profileStats = authStore.usageStats ?? {};

      // Group auth profiles by provider
      const providerMap = new Map<
        string,
        { id: string; profileCount: number; status: string; profiles: string[] }
      >();
      for (const [key, profile] of Object.entries(profiles)) {
        const providerId = (profile.provider || key.split(":")[0]).toLowerCase();
        if (!providerMap.has(providerId)) {
          providerMap.set(providerId, {
            id: providerId,
            profileCount: 0,
            status: "connected",
            profiles: [],
          });
        }
        const entry = providerMap.get(providerId)!;
        entry.profileCount++;
        entry.profiles.push(key);

        // Check if profile is in cooldown or disabled
        const pStats = profileStats[key];
        if (pStats?.disabledUntil && pStats.disabledUntil > Date.now()) {
          // If ALL profiles for this provider are disabled, mark provider as degraded
          // For now, just track it
        }
      }

      // Check provider-level circuit state
      for (const [providerId, stats] of Object.entries(providerStats)) {
        const normalized = providerId.toLowerCase();
        const entry = providerMap.get(normalized);
        if (entry && stats.circuitState === "open") {
          entry.status = "degraded";
        }
      }

      // Determine which providers are actively used by model router
      const agentDefaults = (cfg.agents as Record<string, unknown>)?.defaults as
        | Record<string, unknown>
        | undefined;
      const modelRouter = (agentDefaults?.modelRouter ?? {}) as Record<string, unknown>;
      const activeProfileName = modelRouter.activeProfile as string | undefined;
      const routerProfiles = (modelRouter.profiles ?? {}) as Record<string, unknown>;
      const activeProfile = activeProfileName ? routerProfiles[activeProfileName] : null;
      const activeProviders = new Set<string>();
      if (activeProfile && typeof activeProfile === "object") {
        const tiers = (activeProfile as Record<string, unknown>).tiers as
          | Record<string, unknown>
          | undefined;
        if (tiers) {
          for (const tier of Object.values(tiers)) {
            if (tier && typeof tier === "object") {
              const provider = (tier as Record<string, unknown>).provider;
              if (typeof provider === "string") {
                activeProviders.add(provider.toLowerCase());
              }
            }
          }
        }
      }

      const providers = Array.from(providerMap.values()).map((p) => ({
        id: p.id,
        profileCount: p.profileCount,
        profiles: p.profiles,
        status: p.status,
        active: activeProviders.has(p.id),
      }));

      respond(true, { providers, activeProfile: activeProfileName ?? null }, undefined);
    } catch (err) {
      respond(true, { providers: [], activeProfile: null }, undefined);
    }
  },

  /**
   * providers.registry — Full provider registry (models, endpoints, capabilities).
   * Returns the merged provider registry from ~/.argentos/provider-registry.json.
   */
  "providers.registry": ({ respond }) => {
    try {
      const registry = loadProviderRegistry();
      respond(true, { registry }, undefined);
    } catch (err) {
      respond(false, undefined, {
        code: -32603,
        message: err instanceof Error ? err.message : "failed to load registry",
      });
    }
  },
};
