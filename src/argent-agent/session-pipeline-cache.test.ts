import { describe, it, expect, beforeEach } from "vitest";
import {
  SessionPipelineCache,
  type SessionPipelineKey,
} from "./session-pipeline-cache.js";

/** A cached "pipeline" — opaque in these tests; we only assert identity. */
interface FakePipeline {
  id: string;
}

const BASE_KEY: SessionPipelineKey = {
  sessionId: "sess-1",
  agentId: "agent-1",
  settingsRevision: "settings-rev-1",
  toolRegistryHash: "tools-hash-1",
  modelKey: "model-1",
};

function pipeline(id: string): FakePipeline {
  return { id };
}

describe("SessionPipelineCache", () => {
  let cache: SessionPipelineCache<FakePipeline>;

  beforeEach(() => {
    cache = new SessionPipelineCache<FakePipeline>();
  });

  it("misses (absent) on a never-seen session", () => {
    expect(cache.lookup(BASE_KEY)).toEqual({ status: "miss", reason: "absent" });
    expect(cache.size).toBe(0);
  });

  it("hits on the second turn with an identical key (the core win)", () => {
    const built = pipeline("p1");
    cache.store(BASE_KEY, built);

    const result = cache.lookup(BASE_KEY);
    expect(result.status).toBe("hit");
    expect(result.status === "hit" && result.value).toBe(built); // same reference reused
  });

  describe("invalidation paths (acceptance criteria)", () => {
    beforeEach(() => {
      cache.store(BASE_KEY, pipeline("original"));
    });

    it("misses (stale) and evicts when settingsRevision changes", () => {
      const result = cache.lookup({ ...BASE_KEY, settingsRevision: "settings-rev-2" });
      expect(result).toEqual({ status: "miss", reason: "stale" });
      // stale entry was evicted, so even the original key now misses
      expect(cache.lookup(BASE_KEY)).toEqual({ status: "miss", reason: "absent" });
    });

    it("misses (stale) when the tool registry hash changes", () => {
      expect(cache.lookup({ ...BASE_KEY, toolRegistryHash: "tools-hash-2" })).toEqual({
        status: "miss",
        reason: "stale",
      });
    });

    it("misses (stale) when the agentId changes", () => {
      expect(cache.lookup({ ...BASE_KEY, agentId: "agent-2" })).toEqual({
        status: "miss",
        reason: "stale",
      });
    });

    it("misses (stale) when the model profile changes mid-conversation", () => {
      expect(cache.lookup({ ...BASE_KEY, modelKey: "model-2" })).toEqual({
        status: "miss",
        reason: "stale",
      });
    });

    it("drops the entry on explicit invalidate(sessionId)", () => {
      expect(cache.invalidate(BASE_KEY.sessionId)).toBe(true);
      expect(cache.lookup(BASE_KEY)).toEqual({ status: "miss", reason: "absent" });
      expect(cache.invalidate(BASE_KEY.sessionId)).toBe(false); // already gone
    });

    it("drops everything on clear()", () => {
      cache.store({ ...BASE_KEY, sessionId: "sess-2" }, pipeline("p2"));
      expect(cache.size).toBe(2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.lookup(BASE_KEY).status).toBe("miss");
    });
  });

  it("rebuild-then-store after a stale miss replaces the entry", () => {
    cache.store(BASE_KEY, pipeline("v1"));
    const changed = { ...BASE_KEY, settingsRevision: "settings-rev-2" };
    expect(cache.lookup(changed).status).toBe("miss"); // stale, evicted

    const rebuilt = pipeline("v2");
    cache.store(changed, rebuilt);
    const result = cache.lookup(changed);
    expect(result.status === "hit" && result.value).toBe(rebuilt);
    expect(cache.size).toBe(1); // one live pipeline per session, not two
  });

  describe("bounded LRU (no leak in a long-lived gateway)", () => {
    it("evicts the least-recently-used session beyond maxEntries", () => {
      const small = new SessionPipelineCache<FakePipeline>({ maxEntries: 2 });
      const keyFor = (id: string): SessionPipelineKey => ({ ...BASE_KEY, sessionId: id });

      small.store(keyFor("a"), pipeline("a"));
      small.store(keyFor("b"), pipeline("b"));
      small.store(keyFor("c"), pipeline("c")); // evicts "a" (oldest)

      expect(small.size).toBe(2);
      expect(small.has("a")).toBe(false);
      expect(small.has("b")).toBe(true);
      expect(small.has("c")).toBe(true);
    });

    it("a lookup hit refreshes recency, protecting that entry from eviction", () => {
      const small = new SessionPipelineCache<FakePipeline>({ maxEntries: 2 });
      const keyFor = (id: string): SessionPipelineKey => ({ ...BASE_KEY, sessionId: id });

      small.store(keyFor("a"), pipeline("a"));
      small.store(keyFor("b"), pipeline("b"));
      // Touch "a" so "b" is now the least-recently-used.
      expect(small.lookup(keyFor("a")).status).toBe("hit");
      small.store(keyFor("c"), pipeline("c")); // should evict "b", not "a"

      expect(small.has("a")).toBe(true);
      expect(small.has("b")).toBe(false);
      expect(small.has("c")).toBe(true);
    });

    it("falls back to the default bound when given a non-positive maxEntries", () => {
      const c = new SessionPipelineCache<FakePipeline>({ maxEntries: 0 });
      // Storing one entry must not immediately evict it.
      c.store(BASE_KEY, pipeline("p"));
      expect(c.has(BASE_KEY.sessionId)).toBe(true);
    });
  });
});
