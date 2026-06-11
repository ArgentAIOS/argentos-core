import type { PersonalSkillCandidate } from "../../memory/memu-types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("agents/personal-skills");

/**
 * Per-agent read cache for the turn-time personal-skill block (#405).
 *
 * reviewPersonalSkillCandidates is an O(N) serial chain of memory-backend
 * round trips (list 200 + per-candidate event history + per-changed
 * update/insert). Its outputs only change on day-granularity decay or on
 * explicit candidate mutations, yet it ran on every turn — measured at 81%
 * of slow-turn wall-clock on the operator's gateway (May 2026).
 *
 * Within the TTL, turns reuse the reviewed candidate list (the fill closure
 * is the review+list pair, supplied by the caller to keep this module free
 * of runtime deps — personal.ts transitively imports live-inbox/capture.ts,
 * which needs to import invalidate from here without a cycle). Mutation
 * paths call invalidatePersonalSkillReadCache so the next turn re-reviews.
 * Turn-time bookkeeping writes (lastUsedAt, procedure_selected events) do
 * NOT invalidate — they feed day-granularity decay only, and invalidating
 * on them would defeat the cache every turn.
 */
const TTL_MS = 60_000;

type CacheEntry = {
  expiresAt: number;
  value: Promise<PersonalSkillCandidate[]>;
};

const cache = new Map<string, CacheEntry>();

export function invalidatePersonalSkillReadCache(agentId?: string): void {
  if (agentId === undefined) {
    cache.clear();
    return;
  }
  cache.delete(agentId);
}

export async function getCachedPersonalSkillCandidates(params: {
  agentId: string;
  fill: () => Promise<PersonalSkillCandidate[]>;
}): Promise<PersonalSkillCandidate[]> {
  const now = Date.now();
  const existing = cache.get(params.agentId);
  if (existing && existing.expiresAt > now) {
    return existing.value;
  }
  const value = params.fill();
  cache.set(params.agentId, { expiresAt: now + TTL_MS, value });
  try {
    return await value;
  } catch (err) {
    // Never cache a failure — the next turn retries.
    if (cache.get(params.agentId)?.value === value) {
      cache.delete(params.agentId);
    }
    log.debug(`personal skill read-cache fill failed: ${String(err)}`);
    throw err;
  }
}
