/**
 * Session-pipeline cache (perf #406).
 *
 * Every agent turn in `attempt.ts` rebuilds the full session pipeline —
 * `ArgentSessionManager.open()`, `ArgentSettingsManager.create()`, and
 * `createArgentAgentSession()` with the full ~113-tool registry — costing
 * ~5.5s of pre-I/O wall-clock per turn (`tony-stark` `async_io_started`).
 * Within a single ongoing conversation none of that changes between turns,
 * so it can be cached and reused.
 *
 * This module is the *correctness core* of that fix: a per-session cache whose
 * entries are only reused when the conversation, agent, settings, tools, and
 * model all still match. Wiring it into the hot path (attempt.ts) is a separate
 * slice that builds on this — keeping the delicate invalidation logic isolated
 * and fully unit-testable, per the issue's acceptance criteria.
 *
 * A cached entry is reused only on an exact key match. The key carries every
 * input that can change what the pipeline should contain:
 *  - `sessionId`        — different conversation → different pipeline
 *  - `agentId`          — different agent → different pipeline
 *  - `settingsRevision` — settings changed → rebuild
 *  - `toolRegistryHash` — tool list changed (operator enabled a toolkit) → rebuild
 *  - `modelKey`         — model profile changed mid-conversation → rebuild
 *
 * A *stale* lookup (the `sessionId` matches an entry but any other component
 * differs) evicts the old entry and reports a miss, so the caller rebuilds and
 * re-caches. The cache is bounded (LRU) so a long-lived gateway handling many
 * sessions does not leak.
 */

/** The full identity a cached pipeline is valid for. */
export interface SessionPipelineKey {
  /** Conversation/session identifier — one live pipeline per session. */
  sessionId: string;
  /** Owning agent. */
  agentId: string;
  /** Opaque token that changes whenever effective settings change. */
  settingsRevision: string;
  /** Hash of the active tool registry (names + relevant config). */
  toolRegistryHash: string;
  /** Opaque token that changes whenever the model profile changes. */
  modelKey: string;
}

export interface SessionPipelineCacheOptions {
  /**
   * Max distinct sessions kept warm at once. Entries beyond this are evicted
   * least-recently-used. Defaults to {@link DEFAULT_MAX_ENTRIES}.
   */
  maxEntries?: number;
}

/** Result of a {@link SessionPipelineCache.lookup}. */
export type SessionPipelineLookup<T> =
  | { status: "hit"; value: T }
  | { status: "miss"; reason: "absent" | "stale" };

export const DEFAULT_MAX_ENTRIES = 64;

interface Entry<T> {
  key: SessionPipelineKey;
  value: T;
}

/** True when every key component except `sessionId` matches. */
function reusableFor(cached: SessionPipelineKey, requested: SessionPipelineKey): boolean {
  return (
    cached.agentId === requested.agentId &&
    cached.settingsRevision === requested.settingsRevision &&
    cached.toolRegistryHash === requested.toolRegistryHash &&
    cached.modelKey === requested.modelKey
  );
}

/**
 * Bounded, per-session cache of built agent pipelines. Generic over the cached
 * value so it stays decoupled from the heavy runtime types — the hot-path
 * caller instantiates `SessionPipelineCache<BuiltPipeline>`.
 */
export class SessionPipelineCache<T> {
  /** Insertion order doubles as LRU order (oldest first). */
  private readonly entries = new Map<string, Entry<T>>();
  private readonly maxEntries: number;

  constructor(options?: SessionPipelineCacheOptions) {
    const max = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxEntries = max > 0 ? max : DEFAULT_MAX_ENTRIES;
  }

  /**
   * Return a hit only when an entry exists for `key.sessionId` AND every other
   * component still matches. A stale entry (session matches, something else
   * changed) is evicted and reported as a miss. A hit marks the entry
   * most-recently-used.
   */
  lookup(key: SessionPipelineKey): SessionPipelineLookup<T> {
    const existing = this.entries.get(key.sessionId);
    if (!existing) {
      return { status: "miss", reason: "absent" };
    }
    if (!reusableFor(existing.key, key)) {
      this.entries.delete(key.sessionId);
      return { status: "miss", reason: "stale" };
    }
    // LRU bump: re-insert so this session becomes most-recently-used.
    this.entries.delete(key.sessionId);
    this.entries.set(key.sessionId, existing);
    return { status: "hit", value: existing.value };
  }

  /** Store (or replace) the pipeline for this key's session. */
  store(key: SessionPipelineKey, value: T): void {
    this.entries.delete(key.sessionId);
    this.entries.set(key.sessionId, { key, value });
    this.evictIfNeeded();
  }

  /**
   * Explicitly drop a session's pipeline (e.g. session reset/clear or model
   * switch handled by the caller). Returns true if an entry was removed.
   */
  invalidate(sessionId: string): boolean {
    return this.entries.delete(sessionId);
  }

  /** Drop every cached pipeline (e.g. global settings or tool reload). */
  clear(): void {
    this.entries.clear();
  }

  /** Number of sessions currently cached. */
  get size(): number {
    return this.entries.size;
  }

  /** Whether a pipeline is cached for this session (regardless of staleness). */
  has(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
