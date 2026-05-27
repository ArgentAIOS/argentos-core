import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionEntry, SessionSkillSnapshot } from "./types.js";
import { hashSkillsSnapshot, readSkillsSnapshotByHash } from "./skills-snapshot-store.js";
import {
  clearSessionStoreCacheForTest,
  loadSessionStore,
  saveSessionStore,
  updateSessionStoreEntry,
} from "./store.js";

function makeTempStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "argent-store-test-"));
}

function makeSnapshot(prompt: string): SessionSkillSnapshot {
  return {
    prompt,
    skills: [{ name: "alpha" }, { name: "beta" }],
    resolvedSkills: [],
    version: 1,
  };
}

function makeEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: "sess-test",
    updatedAt: Date.now(),
    ...overrides,
  } as SessionEntry;
}

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = makeTempStoreDir();
  storePath = path.join(tmpDir, "sessions.json");
  clearSessionStoreCacheForTest();
  // Make sure the prune-days env var doesn't leak between tests.
  delete process.env.ARGENT_SESSION_WORKFLOW_PRUNE_DAYS;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearSessionStoreCacheForTest();
});

describe("#410 skillsSnapshot dedup", () => {
  it("strips inline skillsSnapshot from disk and writes it to the sidecar", async () => {
    const snapshot = makeSnapshot("system prompt content");
    const hash = hashSkillsSnapshot(snapshot);
    await saveSessionStore(storePath, {
      "agent:test:main": makeEntry({ skillsSnapshot: snapshot }),
    });

    const onDisk = JSON.parse(fs.readFileSync(storePath, "utf8")) as Record<string, SessionEntry>;
    expect(onDisk["agent:test:main"].skillsSnapshot).toBeUndefined();
    expect(onDisk["agent:test:main"].skillsSnapshotHash).toBe(hash);

    expect(readSkillsSnapshotByHash(storePath, hash)?.prompt).toBe("system prompt content");
  });

  it("hydrates skillsSnapshot from the sidecar on load", async () => {
    const snapshot = makeSnapshot("hydrate me");
    await saveSessionStore(storePath, {
      "agent:test:main": makeEntry({ skillsSnapshot: snapshot }),
    });
    clearSessionStoreCacheForTest();

    const loaded = loadSessionStore(storePath, { skipCache: true });
    expect(loaded["agent:test:main"].skillsSnapshot?.prompt).toBe("hydrate me");
  });

  it("dedups identical snapshots across multiple sessions to a single sidecar entry", async () => {
    const snapshot = makeSnapshot("shared");
    await saveSessionStore(storePath, {
      "agent:test:main": makeEntry({ skillsSnapshot: snapshot }),
      "agent:test:contemplation": makeEntry({ skillsSnapshot: { ...snapshot } }),
      "agent:test:heartbeat": makeEntry({ skillsSnapshot: { ...snapshot } }),
    });

    const sidecarPath = path.join(tmpDir, "skills-snapshots.json");
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    expect(Object.keys(sidecar)).toHaveLength(1);
  });

  it("keeps in-memory skillsSnapshot populated for the value returned by updateSessionStoreEntry", async () => {
    await saveSessionStore(storePath, {
      "agent:test:main": makeEntry({ skillsSnapshot: makeSnapshot("orig") }),
    });

    const result = await updateSessionStoreEntry({
      storePath,
      sessionKey: "agent:test:main",
      update: async () => ({ contextTokens: 42 }),
    });
    expect(result?.skillsSnapshot?.prompt).toBe("orig");
    expect(result?.contextTokens).toBe(42);
  });

  it("re-dedups when an updated entry carries a new skillsSnapshot value", async () => {
    await saveSessionStore(storePath, {
      "agent:test:main": makeEntry({ skillsSnapshot: makeSnapshot("v1") }),
    });
    const v2 = makeSnapshot("v2");
    const v2Hash = hashSkillsSnapshot(v2);

    await updateSessionStoreEntry({
      storePath,
      sessionKey: "agent:test:main",
      update: async () => ({ skillsSnapshot: v2 }),
    });

    const onDisk = JSON.parse(fs.readFileSync(storePath, "utf8")) as Record<string, SessionEntry>;
    expect(onDisk["agent:test:main"].skillsSnapshotHash).toBe(v2Hash);
    expect(readSkillsSnapshotByHash(storePath, v2Hash)?.prompt).toBe("v2");
  });

  it("can read entries that were persisted with hash-only (no inline skillsSnapshot)", async () => {
    // Simulate a future-format file where we never saw an inline snapshot.
    const snapshot = makeSnapshot("only on disk via sidecar");
    const hash = hashSkillsSnapshot(snapshot);
    // Write the sidecar directly
    fs.writeFileSync(
      path.join(tmpDir, "skills-snapshots.json"),
      JSON.stringify({ [hash]: snapshot }),
    );
    // Write a sessions.json that references the hash but has no inline blob
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        "agent:test:main": {
          sessionId: "sess-test",
          updatedAt: Date.now(),
          skillsSnapshotHash: hash,
        },
      }),
    );

    const loaded = loadSessionStore(storePath, { skipCache: true });
    expect(loaded["agent:test:main"].skillsSnapshot?.prompt).toBe("only on disk via sidecar");
    expect(loaded["agent:test:main"].skillsSnapshotHash).toBe(hash);
  });

  it("collapses snapshots that differ only by key insertion order to the same hash", () => {
    const a = { prompt: "x", skills: [{ name: "s" }], version: 1 } as SessionSkillSnapshot;
    const b = { version: 1, skills: [{ name: "s" }], prompt: "x" } as SessionSkillSnapshot;
    expect(hashSkillsSnapshot(a)).toBe(hashSkillsSnapshot(b));
  });
});

describe("#410 stale workflow auto-prune", () => {
  it("prunes workflow entries older than the configured threshold", async () => {
    process.env.ARGENT_SESSION_WORKFLOW_PRUNE_DAYS = "7";
    const now = Date.now();
    const old = now - 10 * 24 * 60 * 60 * 1000;
    const fresh = now - 1 * 24 * 60 * 60 * 1000;

    await saveSessionStore(storePath, {
      "agent:test:workflow:111": makeEntry({ updatedAt: old }),
      "agent:test:workflow:222": makeEntry({ updatedAt: fresh }),
      "agent:test:main": makeEntry({ updatedAt: old }), // main is NOT pruned even when old
      "agent:test:cron:abc": makeEntry({ updatedAt: old }), // cron is NOT pruned
    });

    const onDisk = JSON.parse(fs.readFileSync(storePath, "utf8")) as Record<string, SessionEntry>;
    expect(Object.keys(onDisk).sort()).toEqual(
      ["agent:test:cron:abc", "agent:test:main", "agent:test:workflow:222"].sort(),
    );
  });

  it("uses default 30 days when env var is unset", async () => {
    const now = Date.now();
    const elevenDays = now - 11 * 24 * 60 * 60 * 1000;
    const fortyDays = now - 40 * 24 * 60 * 60 * 1000;

    await saveSessionStore(storePath, {
      "agent:test:workflow:young": makeEntry({ updatedAt: elevenDays }),
      "agent:test:workflow:old": makeEntry({ updatedAt: fortyDays }),
    });

    const onDisk = JSON.parse(fs.readFileSync(storePath, "utf8")) as Record<string, SessionEntry>;
    expect(onDisk["agent:test:workflow:young"]).toBeDefined();
    expect(onDisk["agent:test:workflow:old"]).toBeUndefined();
  });

  it("ignores entries with no updatedAt rather than pruning them", async () => {
    await saveSessionStore(storePath, {
      "agent:test:workflow:no-ts": makeEntry({ updatedAt: undefined as unknown as number }),
    });
    const onDisk = JSON.parse(fs.readFileSync(storePath, "utf8")) as Record<string, SessionEntry>;
    expect(onDisk["agent:test:workflow:no-ts"]).toBeDefined();
  });
});
