import type { ArgentConfig } from "../../config/config.js";
import type {
  AuthProfileFailureReason,
  AuthProfileStore,
  ProfileUsageStats,
  ProviderCircuitState,
  ProviderUsageStats,
} from "./types.js";
import { normalizeProviderId } from "../model-selection.js";
import { resolveAuthProfileOrder } from "./order.js";
import { listProfilesForProvider } from "./profiles.js";
import { saveAuthProfileStore, updateAuthProfileStoreWithLock } from "./store.js";

const RATE_LIMIT_CIRCUIT_WINDOW_MS = 60_000;
const PROVIDER_RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;
const RETRY_AFTER_DRL_THRESHOLD_MS = 60_000;
const MAX_RETRY_AFTER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function resolveProfileUnusableUntil(
  stats: Pick<ProfileUsageStats, "cooldownUntil" | "disabledUntil">,
): number | null {
  const values = [stats.cooldownUntil, stats.disabledUntil]
    .filter((value): value is number => typeof value === "number")
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    return null;
  }
  return Math.max(...values);
}

/**
 * Return the soonest `unusableUntil` timestamp (ms epoch) among the given
 * profiles, or `null` when no profile has a recorded cooldown. The returned
 * timestamp may be in the past if the cooldown has already expired.
 */
export function getSoonestCooldownExpiry(
  store: AuthProfileStore,
  profileIds: string[],
): number | null {
  let soonest: number | null = null;
  for (const id of profileIds) {
    const stats = store.usageStats?.[id];
    if (!stats) {
      continue;
    }
    const until = resolveProfileUnusableUntil(stats);
    if (typeof until !== "number" || !Number.isFinite(until) || until <= 0) {
      continue;
    }
    if (soonest === null || until < soonest) {
      soonest = until;
    }
  }
  return soonest;
}

export function resolveProviderUnusableUntil(
  stats: Pick<ProviderUsageStats, "cooldownUntil" | "disabledUntil">,
): number | null {
  const values = [stats.cooldownUntil, stats.disabledUntil]
    .filter((value): value is number => typeof value === "number")
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    return null;
  }
  return Math.max(...values);
}

/**
 * Clear expired cooldowns from all profiles in the store.
 *
 * When `cooldownUntil` or `disabledUntil` has passed, the corresponding fields
 * are removed and error counters are reset so the profile gets a fresh start
 * (circuit-breaker half-open → closed). Without this, a stale `errorCount`
 * causes the *next* transient failure to immediately escalate to a much longer
 * cooldown — the root cause of profiles appearing "stuck" after rate limits.
 *
 * `cooldownUntil` and `disabledUntil` are handled independently: if a profile
 * has both and only one has expired, only that field is cleared.
 *
 * Mutates the in-memory store; disk persistence happens lazily on the next
 * store write (e.g. `markAuthProfileUsed` / `markAuthProfileFailure`).
 *
 * @returns `true` if any profile was modified.
 */
export function clearExpiredCooldowns(store: AuthProfileStore, now?: number): boolean {
  const usageStats = store.usageStats;
  const providerStats = store.providerStats;
  if (!usageStats && !providerStats) {
    return false;
  }

  const ts = now ?? Date.now();
  let mutated = false;

  if (usageStats) {
    for (const [profileId, stats] of Object.entries(usageStats)) {
      if (!stats) {
        continue;
      }

      let profileMutated = false;
      const cooldownExpired =
        typeof stats.cooldownUntil === "number" &&
        Number.isFinite(stats.cooldownUntil) &&
        stats.cooldownUntil > 0 &&
        ts >= stats.cooldownUntil;
      const disabledExpired =
        typeof stats.disabledUntil === "number" &&
        Number.isFinite(stats.disabledUntil) &&
        stats.disabledUntil > 0 &&
        ts >= stats.disabledUntil;

      if (cooldownExpired) {
        stats.cooldownUntil = undefined;
        profileMutated = true;
      }
      if (disabledExpired) {
        stats.disabledUntil = undefined;
        stats.disabledReason = undefined;
        profileMutated = true;
      }

      // Reset error counters when ALL cooldowns have expired so the profile gets
      // a fair retry window. Preserves lastFailureAt for the failureWindowMs
      // decay check in computeNextProfileUsageStats.
      if (profileMutated && !resolveProfileUnusableUntil(stats)) {
        stats.errorCount = 0;
        stats.failureCounts = undefined;
      }

      if (profileMutated) {
        usageStats[profileId] = stats;
        mutated = true;
      }
    }
  }

  if (providerStats) {
    for (const [providerId, stats] of Object.entries(providerStats)) {
      if (!stats) {
        continue;
      }
      let providerMutated = false;
      const cooldownExpired =
        typeof stats.cooldownUntil === "number" &&
        Number.isFinite(stats.cooldownUntil) &&
        stats.cooldownUntil > 0 &&
        ts >= stats.cooldownUntil;
      const disabledExpired =
        typeof stats.disabledUntil === "number" &&
        Number.isFinite(stats.disabledUntil) &&
        stats.disabledUntil > 0 &&
        ts >= stats.disabledUntil;
      if (cooldownExpired) {
        stats.cooldownUntil = undefined;
        providerMutated = true;
      }
      if (disabledExpired) {
        stats.disabledUntil = undefined;
        stats.disabledReason = undefined;
        providerMutated = true;
      }
      if (cooldownExpired && stats.circuitState === "open") {
        stats.circuitState = "half_open";
        stats.halfOpenSince = ts;
        providerMutated = true;
      }
      if (providerMutated) {
        providerStats[providerId] = stats;
        mutated = true;
      }
    }
  }

  return mutated;
}

/**
 * Check if a profile is currently in cooldown (due to rate limiting or errors).
 */
export function isProfileInCooldown(store: AuthProfileStore, profileId: string): boolean {
  const stats = store.usageStats?.[profileId];
  if (!stats) {
    return false;
  }
  const unusableUntil = resolveProfileUnusableUntil(stats);
  return unusableUntil ? Date.now() < unusableUntil : false;
}

export function resolveProviderUnusableUntilForDisplay(
  store: AuthProfileStore,
  provider: string,
): number | null {
  const stats = store.providerStats?.[normalizeProviderId(provider)];
  if (!stats) {
    return null;
  }
  return resolveProviderUnusableUntil(stats);
}

export function resolveProviderCircuitState(
  store: AuthProfileStore,
  provider: string,
): ProviderCircuitState {
  const providerKey = normalizeProviderId(provider);
  const stats = store.providerStats?.[providerKey];
  if (!stats) {
    return "closed";
  }
  const unusableUntil = resolveProviderUnusableUntil(stats);
  if (unusableUntil && Date.now() < unusableUntil) {
    return "open";
  }
  if (stats.circuitState === "half_open") {
    return "half_open";
  }
  return "closed";
}

export function isProviderInCooldown(store: AuthProfileStore, provider: string): boolean {
  const providerKey = normalizeProviderId(provider);
  const stats = store.providerStats?.[providerKey];
  if (!stats) {
    return false;
  }
  const unusableUntil = resolveProviderUnusableUntil(stats);
  if (unusableUntil) {
    return Date.now() < unusableUntil;
  }
  return stats.circuitState === "open";
}

/**
 * Mark a profile as successfully used. Resets error count and updates lastUsed.
 * Uses store lock to avoid overwriting concurrent usage updates.
 */
export async function markAuthProfileUsed(params: {
  store: AuthProfileStore;
  profileId: string;
  agentDir?: string;
}): Promise<void> {
  const { store, profileId, agentDir } = params;
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    updater: (freshStore) => {
      if (!freshStore.profiles[profileId]) {
        return false;
      }
      const now = Date.now();
      const providerKey = normalizeProviderId(freshStore.profiles[profileId].provider);
      freshStore.usageStats = freshStore.usageStats ?? {};
      freshStore.usageStats[profileId] = {
        ...freshStore.usageStats[profileId],
        lastUsed: now,
        errorCount: 0,
        cooldownUntil: undefined,
        disabledUntil: undefined,
        disabledReason: undefined,
        failureCounts: undefined,
      };
      if (freshStore.providerStats?.[providerKey]) {
        freshStore.providerStats = { ...freshStore.providerStats };
        freshStore.providerStats[providerKey] = {
          ...freshStore.providerStats[providerKey],
          circuitState: "closed",
          cooldownUntil: undefined,
          disabledUntil: undefined,
          disabledReason: undefined,
          openedAt: undefined,
          halfOpenSince: undefined,
          lastFailureAt: now,
        };
      }
      return true;
    },
  });
  if (updated) {
    store.usageStats = updated.usageStats;
    store.providerStats = updated.providerStats;
    return;
  }
  if (!store.profiles[profileId]) {
    return;
  }

  store.usageStats = store.usageStats ?? {};
  const now = Date.now();
  const providerKey = normalizeProviderId(store.profiles[profileId].provider);
  store.usageStats[profileId] = {
    ...store.usageStats[profileId],
    lastUsed: now,
    errorCount: 0,
    cooldownUntil: undefined,
    disabledUntil: undefined,
    disabledReason: undefined,
    failureCounts: undefined,
  };
  if (store.providerStats?.[providerKey]) {
    store.providerStats = { ...store.providerStats };
    store.providerStats[providerKey] = {
      ...store.providerStats[providerKey],
      circuitState: "closed",
      cooldownUntil: undefined,
      disabledUntil: undefined,
      disabledReason: undefined,
      openedAt: undefined,
      halfOpenSince: undefined,
      lastFailureAt: now,
    };
  }
  saveAuthProfileStore(store, agentDir);
}

/**
 * Calculate cooldown duration for rate-limit failures.
 * Short initial cooldown — most 429s are transient per-minute limits
 * that clear in seconds. Long cooldowns cause cascading lockouts
 * when multiple profiles share the same provider rate window.
 *
 * Progression: 5s → 10s → 20s → 40s (max)
 */
export function calculateAuthProfileCooldownMs(errorCount: number): number {
  const normalized = Math.max(1, errorCount);
  return Math.min(
    40_000, // 40 second max — rate limits are transient
    5_000 * 2 ** Math.min(normalized - 1, 3),
  );
}

/**
 * Calculate cooldown for timeout failures (network issues).
 * Timeouts are transient — bad WiFi, DNS hiccup, etc.
 * Very short cooldown so we retry quickly once connectivity returns.
 *
 * Progression: 5s → 10s → 20s → 30s (max)
 */
export function calculateTimeoutCooldownMs(errorCount: number): number {
  const normalized = Math.max(1, errorCount);
  return Math.min(
    30_000, // 30 second max
    5_000 * 2 ** Math.min(normalized - 1, 3),
  );
}

type ResolvedAuthCooldownConfig = {
  billingBackoffMs: number;
  billingMaxMs: number;
  failureWindowMs: number;
};

function resolveAuthCooldownConfig(params: {
  cfg?: ArgentConfig;
  providerId: string;
}): ResolvedAuthCooldownConfig {
  const defaults = {
    billingBackoffHours: 5,
    billingMaxHours: 24,
    failureWindowHours: 24,
  } as const;

  const resolveHours = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

  const cooldowns = params.cfg?.auth?.cooldowns;
  const billingOverride = (() => {
    const map = cooldowns?.billingBackoffHoursByProvider;
    if (!map) {
      return undefined;
    }
    for (const [key, value] of Object.entries(map)) {
      if (normalizeProviderId(key) === params.providerId) {
        return value;
      }
    }
    return undefined;
  })();

  const billingBackoffHours = resolveHours(
    billingOverride ?? cooldowns?.billingBackoffHours,
    defaults.billingBackoffHours,
  );
  const billingMaxHours = resolveHours(cooldowns?.billingMaxHours, defaults.billingMaxHours);
  const failureWindowHours = resolveHours(
    cooldowns?.failureWindowHours,
    defaults.failureWindowHours,
  );

  return {
    billingBackoffMs: billingBackoffHours * 60 * 60 * 1000,
    billingMaxMs: billingMaxHours * 60 * 60 * 1000,
    failureWindowMs: failureWindowHours * 60 * 60 * 1000,
  };
}

function calculateAuthProfileBillingDisableMsWithConfig(params: {
  errorCount: number;
  baseMs: number;
  maxMs: number;
}): number {
  const normalized = Math.max(1, params.errorCount);
  const baseMs = Math.max(60_000, params.baseMs);
  const maxMs = Math.max(baseMs, params.maxMs);
  const exponent = Math.min(normalized - 1, 10);
  const raw = baseMs * 2 ** exponent;
  return Math.min(maxMs, raw);
}

export function resolveProfileUnusableUntilForDisplay(
  store: AuthProfileStore,
  profileId: string,
): number | null {
  const stats = store.usageStats?.[profileId];
  if (!stats) {
    return null;
  }
  return resolveProfileUnusableUntil(stats);
}

function computeNextProfileUsageStats(params: {
  existing: ProfileUsageStats;
  now: number;
  reason: AuthProfileFailureReason;
  cfgResolved: ResolvedAuthCooldownConfig;
}): ProfileUsageStats {
  const windowMs = params.cfgResolved.failureWindowMs;
  const windowExpired =
    typeof params.existing.lastFailureAt === "number" &&
    params.existing.lastFailureAt > 0 &&
    params.now - params.existing.lastFailureAt > windowMs;

  const baseErrorCount = windowExpired ? 0 : (params.existing.errorCount ?? 0);
  const nextErrorCount = baseErrorCount + 1;
  const failureCounts = windowExpired ? {} : { ...params.existing.failureCounts };
  failureCounts[params.reason] = (failureCounts[params.reason] ?? 0) + 1;

  const updatedStats: ProfileUsageStats = {
    ...params.existing,
    errorCount: nextErrorCount,
    failureCounts,
    lastFailureAt: params.now,
  };

  if (params.reason === "billing") {
    const billingCount = failureCounts.billing ?? 1;
    const backoffMs = calculateAuthProfileBillingDisableMsWithConfig({
      errorCount: billingCount,
      baseMs: params.cfgResolved.billingBackoffMs,
      maxMs: params.cfgResolved.billingMaxMs,
    });
    updatedStats.disabledUntil = params.now + backoffMs;
    updatedStats.disabledReason = "billing";
  } else if (params.reason === "format") {
    // Format errors mean WE sent bad data (e.g. cross-provider tool_use IDs).
    // The profile itself is fine — retrying with a different profile will fail
    // identically. Apply a short fixed cooldown (30s) instead of exponential
    // backoff to avoid locking out all profiles for hours.
    updatedStats.cooldownUntil = params.now + 30_000;
  } else if (params.reason === "timeout") {
    // Timeouts are transient network issues (bad WiFi, DNS, etc.).
    // Very short cooldown — the network may already be back.
    const backoffMs = calculateTimeoutCooldownMs(nextErrorCount);
    updatedStats.cooldownUntil = params.now + backoffMs;
  } else {
    const backoffMs = calculateAuthProfileCooldownMs(nextErrorCount);
    updatedStats.cooldownUntil = params.now + backoffMs;
  }

  return updatedStats;
}

function normalizeRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(MAX_RETRY_AFTER_COOLDOWN_MS, Math.round(value));
}

function shouldTripProviderRateLimitCircuitBreaker(params: {
  store: AuthProfileStore;
  providerKey: string;
  now: number;
}): boolean {
  const providerProfiles = listProfilesForProvider(params.store, params.providerKey);
  if (providerProfiles.length < 2) {
    return false;
  }
  return providerProfiles.every((profileId) => {
    const stats = params.store.usageStats?.[profileId];
    if (!stats) {
      return false;
    }
    const lastFailureAt = stats.lastFailureAt ?? 0;
    if (lastFailureAt <= 0 || params.now - lastFailureAt > RATE_LIMIT_CIRCUIT_WINDOW_MS) {
      return false;
    }
    return (stats.failureCounts?.rate_limit ?? 0) > 0;
  });
}

function applyProviderRateLimitCooldown(params: {
  store: AuthProfileStore;
  providerKey: string;
  now: number;
  retryAfterMs?: number;
}): void {
  const providerStats = params.store.providerStats ?? {};
  const current = providerStats[params.providerKey] ?? {};
  const retryAfterMs = normalizeRetryAfterMs(params.retryAfterMs);

  let cooldownMs: number | undefined;
  if (retryAfterMs && retryAfterMs >= RETRY_AFTER_DRL_THRESHOLD_MS) {
    cooldownMs = retryAfterMs;
  } else if (current.circuitState === "half_open") {
    // Probe failed while half-open; reopen quickly to avoid hot-looping.
    cooldownMs = PROVIDER_RATE_LIMIT_COOLDOWN_MS;
  } else if (
    shouldTripProviderRateLimitCircuitBreaker({
      store: params.store,
      providerKey: params.providerKey,
      now: params.now,
    })
  ) {
    cooldownMs = PROVIDER_RATE_LIMIT_COOLDOWN_MS;
  }
  if (!cooldownMs) {
    return;
  }
  const nextUntil = params.now + cooldownMs;
  if ((current.cooldownUntil ?? 0) >= nextUntil) {
    return;
  }
  params.store.providerStats = { ...providerStats };
  params.store.providerStats[params.providerKey] = {
    ...current,
    circuitState: "open",
    cooldownUntil: nextUntil,
    disabledUntil: undefined,
    disabledReason: undefined,
    openedAt: params.now,
    halfOpenSince: undefined,
    lastFailureAt: params.now,
  };
}

/**
 * Mark a profile as failed for a specific reason. Billing failures are treated
 * as "disabled" (longer backoff) vs the regular cooldown window.
 */
export async function markAuthProfileFailure(params: {
  store: AuthProfileStore;
  profileId: string;
  reason: AuthProfileFailureReason;
  retryAfterMs?: number;
  cfg?: ArgentConfig;
  agentDir?: string;
}): Promise<void> {
  const { store, profileId, reason, retryAfterMs, agentDir, cfg } = params;
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    updater: (freshStore) => {
      const profile = freshStore.profiles[profileId];
      if (!profile) {
        return false;
      }
      freshStore.usageStats = freshStore.usageStats ?? {};
      const existing = freshStore.usageStats[profileId] ?? {};

      const now = Date.now();
      const providerKey = normalizeProviderId(profile.provider);
      const cfgResolved = resolveAuthCooldownConfig({
        cfg,
        providerId: providerKey,
      });

      freshStore.usageStats[profileId] = computeNextProfileUsageStats({
        existing,
        now,
        reason,
        cfgResolved,
      });
      if (reason === "rate_limit") {
        applyProviderRateLimitCooldown({
          store: freshStore,
          providerKey,
          now,
          retryAfterMs,
        });
      }

      // Clear from lastGood if this profile was the active one, and select next available
      if (freshStore.lastGood?.[providerKey] === profileId) {
        freshStore.lastGood = { ...freshStore.lastGood };
        delete freshStore.lastGood[providerKey];

        // Find next available profile (not in cooldown)
        const ordered = resolveAuthProfileOrder({
          cfg,
          store: freshStore,
          provider: providerKey,
        });
        const nextAvailable = ordered.find((pid) => !isProfileInCooldown(freshStore, pid));
        if (nextAvailable) {
          freshStore.lastGood[providerKey] = nextAvailable;
        }
      }

      return true;
    },
  });
  if (updated) {
    store.usageStats = updated.usageStats;
    store.providerStats = updated.providerStats;
    store.lastGood = updated.lastGood;
    return;
  }
  if (!store.profiles[profileId]) {
    return;
  }

  store.usageStats = store.usageStats ?? {};
  const existing = store.usageStats[profileId] ?? {};
  const now = Date.now();
  const providerKey = normalizeProviderId(store.profiles[profileId]?.provider ?? "");
  const cfgResolved = resolveAuthCooldownConfig({
    cfg,
    providerId: providerKey,
  });

  store.usageStats[profileId] = computeNextProfileUsageStats({
    existing,
    now,
    reason,
    cfgResolved,
  });
  if (reason === "rate_limit") {
    applyProviderRateLimitCooldown({
      store,
      providerKey,
      now,
      retryAfterMs,
    });
  }

  // Clear from lastGood if this profile was the active one, and select next available
  if (store.lastGood?.[providerKey] === profileId) {
    store.lastGood = { ...store.lastGood };
    delete store.lastGood[providerKey];

    // Find next available profile (not in cooldown)
    const ordered = resolveAuthProfileOrder({
      cfg,
      store,
      provider: providerKey,
    });
    const nextAvailable = ordered.find((pid) => !isProfileInCooldown(store, pid));
    if (nextAvailable) {
      store.lastGood[providerKey] = nextAvailable;
    }
  }

  saveAuthProfileStore(store, agentDir);
}

/**
 * Mark a profile as failed/rate-limited. Applies exponential backoff cooldown.
 * Cooldown times: 1min, 5min, 25min, max 1 hour.
 * Uses store lock to avoid overwriting concurrent usage updates.
 */
export async function markAuthProfileCooldown(params: {
  store: AuthProfileStore;
  profileId: string;
  agentDir?: string;
}): Promise<void> {
  await markAuthProfileFailure({
    store: params.store,
    profileId: params.profileId,
    reason: "unknown",
    agentDir: params.agentDir,
  });
}

/**
 * Clear cooldown for a profile (e.g., manual reset).
 * Uses store lock to avoid overwriting concurrent usage updates.
 */
export async function clearAuthProfileCooldown(params: {
  store: AuthProfileStore;
  profileId: string;
  agentDir?: string;
}): Promise<void> {
  const { store, profileId, agentDir } = params;
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    updater: (freshStore) => {
      if (!freshStore.usageStats?.[profileId]) {
        return false;
      }

      freshStore.usageStats[profileId] = {
        ...freshStore.usageStats[profileId],
        errorCount: 0,
        cooldownUntil: undefined,
      };
      return true;
    },
  });
  if (updated) {
    store.usageStats = updated.usageStats;
    return;
  }
  if (!store.usageStats?.[profileId]) {
    return;
  }

  store.usageStats[profileId] = {
    ...store.usageStats[profileId],
    errorCount: 0,
    cooldownUntil: undefined,
  };
  saveAuthProfileStore(store, agentDir);
}

/**
 * Repair lastGood if it points to a profile that's currently on cooldown.
 * Selects the next available profile from the rotation.
 */
export async function repairLastGoodIfOnCooldown(params: {
  store: AuthProfileStore;
  cfg?: ArgentConfig;
  agentDir?: string;
}): Promise<boolean> {
  const { store, cfg, agentDir } = params;

  if (!store.lastGood) {
    return false;
  }

  let hadChanges = false;

  for (const [provider, profileId] of Object.entries(store.lastGood)) {
    if (!profileId || typeof profileId !== "string") {
      continue;
    }

    // Check if this profile is on cooldown
    if (!isProfileInCooldown(store, profileId)) {
      continue;
    }

    // Profile is on cooldown, find next available
    const providerKey = normalizeProviderId(provider);
    const ordered = resolveAuthProfileOrder({
      cfg,
      store,
      provider: providerKey,
    });
    const nextAvailable = ordered.find((pid) => !isProfileInCooldown(store, pid));

    if (nextAvailable && nextAvailable !== profileId) {
      store.lastGood = { ...store.lastGood };
      store.lastGood[provider] = nextAvailable;
      hadChanges = true;
    } else {
      // No available profiles, clear lastGood for this provider
      store.lastGood = { ...store.lastGood };
      delete store.lastGood[provider];
      hadChanges = true;
    }
  }

  if (hadChanges) {
    saveAuthProfileStore(store, agentDir);
  }

  return hadChanges;
}
