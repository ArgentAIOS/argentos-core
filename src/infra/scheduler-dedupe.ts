/**
 * Scheduler Dedupe — Idempotency guards for contemplation cycles.
 *
 * Prevents duplicate cycle execution through:
 * - Deterministic cycle fingerprinting
 * - TTL-based idempotency cache
 * - Single-flight locks
 * - Episode ID dedup for SIS payloads
 *
 * Issue #25: Scheduler Dedupe Guardrails
 */

import { createDedupeCache, type DedupeCache } from "./dedupe.js";

// ============================================================================
// Types
// ============================================================================

export type DedupeReasonCode =
  | "duplicate_fingerprint" // Same fingerprint seen within TTL window
  | "episode_id_duplicate" // Episode already processed
  | "lock_collision"; // Another cycle holds the lock

export interface CycleFingerprint {
  agentId: string;
  windowMinute: number; // Truncated to minute for same-minute dedupe
  cycleType: "contemplation" | "heartbeat";
}

export interface DedupeResult {
  accepted: boolean;
  reason?: DedupeReasonCode;
  fingerprint?: string;
}

export interface SchedulerDedupeMetrics {
  enqueueAttempts: number;
  enqueueRejects: number;
  lockCollisions: number;
  payloadDedupeExclusions: number;
}

// ============================================================================
// Fingerprint Generation
// ============================================================================

/**
 * Generate a deterministic fingerprint for a cycle.
 * Uses agentId + truncated timestamp window for idempotency.
 */
export function generateCycleFingerprint(
  agentId: string,
  cycleType: "contemplation" | "heartbeat" = "contemplation",
  now?: number,
): CycleFingerprint {
  const timestamp = now ?? Date.now();
  // Truncate to minute for same-minute dedupe
  const windowMinute = Math.floor(timestamp / 60_000);
  return { agentId, windowMinute, cycleType };
}

/**
 * Serialize fingerprint to string for cache key.
 */
export function serializeFingerprint(fp: CycleFingerprint): string {
  return `${fp.cycleType}:${fp.agentId}:${fp.windowMinute}`;
}

// ============================================================================
// Scheduler Dedupe Core
// ============================================================================

export interface SchedulerDedupeConfig {
  /** TTL for fingerprint cache (default: 60 seconds) */
  fingerprintTtlMs?: number;
  /** Max entries in fingerprint cache */
  maxFingerprintCache?: number;
  /** TTL for episode ID cache (default: 1 hour) */
  episodeIdTtlMs?: number;
  /** Max episode IDs to track */
  maxEpisodeIds?: number;
}

export interface SchedulerDedupe {
  /**
   * Check if a cycle should run. Returns result with reason if rejected.
   */
  checkCycle: (agentId: string, cycleType?: "contemplation" | "heartbeat") => DedupeResult;

  /**
   * Try to acquire single-flight lock for a fingerprint.
   * Returns false if lock already held.
   */
  tryLock: (fingerprint: string) => boolean;

  /**
   * Release the single-flight lock.
   */
  releaseLock: (fingerprint: string) => void;

  /**
   * Check and add episode ID to prevent SIS payload duplicates.
   * Returns false if already seen.
   */
  checkEpisodeId: (episodeId: string) => boolean;

  /**
   * Get current metrics.
   */
  getMetrics: () => SchedulerDedupeMetrics;

  /**
   * Reset metrics and caches (for testing).
   */
  reset: () => void;
}

/**
 * Create a scheduler deduplication instance.
 */
export function createSchedulerDedupe(config: SchedulerDedupeConfig = {}): SchedulerDedupe {
  const fingerprintTtlMs = config.fingerprintTtlMs ?? 60_000; // 60 seconds
  const maxFingerprintCache = config.maxFingerprintCache ?? 100;
  const episodeIdTtlMs = config.episodeIdTtlMs ?? 3600_000; // 1 hour
  const maxEpisodeIds = config.maxEpisodeIds ?? 1000;

  // Fingerprint cache for cycle idempotency
  const fingerprintCache: DedupeCache = createDedupeCache({
    ttlMs: fingerprintTtlMs,
    maxSize: maxFingerprintCache,
  });

  // Episode ID cache for SIS payload dedupe
  const episodeIdCache: DedupeCache = createDedupeCache({
    ttlMs: episodeIdTtlMs,
    maxSize: maxEpisodeIds,
  });

  // Single-flight locks (in-memory)
  const locks = new Set<string>();

  // Observability counters
  const metrics: SchedulerDedupeMetrics = {
    enqueueAttempts: 0,
    enqueueRejects: 0,
    lockCollisions: 0,
    payloadDedupeExclusions: 0,
  };

  return {
    checkCycle: (agentId, cycleType = "contemplation") => {
      metrics.enqueueAttempts++;

      const fp = generateCycleFingerprint(agentId, cycleType);
      const fingerprint = serializeFingerprint(fp);

      // Pre-enqueue dedupe check
      if (fingerprintCache.check(fingerprint)) {
        metrics.enqueueRejects++;
        return {
          accepted: false,
          reason: "duplicate_fingerprint",
          fingerprint,
        };
      }

      // Mark as seen (idempotency)
      fingerprintCache.check(fingerprint);

      return { accepted: true, fingerprint };
    },

    tryLock: (fingerprint) => {
      if (locks.has(fingerprint)) {
        metrics.lockCollisions++;
        return false;
      }
      locks.add(fingerprint);
      return true;
    },

    releaseLock: (fingerprint) => {
      locks.delete(fingerprint);
    },

    checkEpisodeId: (episodeId) => {
      if (!episodeId) return true; // Allow empty

      if (episodeIdCache.check(episodeId)) {
        metrics.payloadDedupeExclusions++;
        return false; // Already seen, exclude
      }

      return true; // New, include
    },

    getMetrics: () => ({ ...metrics }),

    reset: () => {
      fingerprintCache.clear();
      episodeIdCache.clear();
      locks.clear();
      metrics.enqueueAttempts = 0;
      metrics.enqueueRejects = 0;
      metrics.lockCollisions = 0;
      metrics.payloadDedupeExclusions = 0;
    },
  };
}

// ============================================================================
// Default Instance
// ============================================================================

let defaultInstance: SchedulerDedupe | null = null;

/**
 * Get the default scheduler dedupe instance.
 */
export function getSchedulerDedupe(): SchedulerDedupe {
  if (!defaultInstance) {
    defaultInstance = createSchedulerDedupe();
  }
  return defaultInstance;
}

/**
 * Reset the default instance (for testing).
 */
export function resetSchedulerDedupe(): void {
  defaultInstance = null;
}
