import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProfileStore } from "./types.js";
import { resolveApiKeyForProvider } from "../model-auth.js";
import {
  ensureAuthProfileStore,
  loadAuthProfileStore,
  pruneDanglingOrderEntries,
  saveAuthProfileStore,
} from "./store.js";

/**
 * GH #193: when auth-profiles.json gets into a "gutted" state — `order`
 * referencing profile IDs that don't exist in `profiles` — credential
 * resolution silently falls through to the cached JWT (which is then
 * rejected) and the user sees "No API key found for provider X" even
 * though they just completed an OAuth login.
 *
 * These tests pin the self-healing behavior added in the fix:
 *   (a) loader prunes dangling order entries and persists the cleaned shape,
 *   (b) save normalizes order to only existing profiles,
 *   (c) resolveApiKeyForProvider surfaces an actionable error pointing at
 *       the dangling profile rather than a generic "no key" message.
 */
describe("auth-profiles gutted-order self-healing (GH #193)", () => {
  const previousStateDir = process.env.ARGENT_STATE_DIR;
  const previousAgentDir = process.env.ARGENT_AGENT_DIR;
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  let tmpDir: string;
  let agentDir: string;
  let authPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-gutted-test-"));
    agentDir = path.join(tmpDir, "agents", "main", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    authPath = path.join(agentDir, "auth-profiles.json");

    process.env.ARGENT_STATE_DIR = tmpDir;
    process.env.ARGENT_AGENT_DIR = agentDir;
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (previousStateDir === undefined) {
      delete process.env.ARGENT_STATE_DIR;
    } else {
      process.env.ARGENT_STATE_DIR = previousStateDir;
    }
    if (previousAgentDir === undefined) {
      delete process.env.ARGENT_AGENT_DIR;
    } else {
      process.env.ARGENT_AGENT_DIR = previousAgentDir;
    }
    if (previousPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loader skips dangling order entries and persists the cleaned store", async () => {
    // Write a gutted store: order references a profile that is not in
    // profiles. This is the exact shape reported in GH #193.
    const gutted = {
      version: 1,
      profiles: {},
      order: { "openai-codex": ["openai-codex:default"] },
    };
    await fs.writeFile(authPath, JSON.stringify(gutted));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const loaded = loadAuthProfileStore();

    // In-memory shape no longer carries the dangling entry.
    expect(loaded.order).toBeUndefined();

    // On-disk shape was rewritten to drop the dangling entry too —
    // otherwise every subsequent load would re-warn forever.
    const onDisk = JSON.parse(await fs.readFile(authPath, "utf8")) as AuthProfileStore;
    expect(onDisk.order).toBeUndefined();

    warnSpy.mockRestore();
  });

  it("save normalizes order to only existing profiles", async () => {
    // Start with a valid profile + a dangling reference. saveAuthProfileStore
    // must drop the dangling ref before writing.
    const future = Date.now() + 60 * 60 * 1000;
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai-codex:cli": {
          type: "oauth",
          provider: "openai-codex",
          access: "tok",
          refresh: "ref",
          expires: future,
        },
      },
      order: {
        "openai-codex": ["openai-codex:default", "openai-codex:cli"],
      },
    };

    saveAuthProfileStore(store);

    const onDisk = JSON.parse(await fs.readFile(authPath, "utf8")) as AuthProfileStore;
    expect(onDisk.order).toEqual({ "openai-codex": ["openai-codex:cli"] });
    // Caller's reference is also normalized (intentional — keeps an
    // in-process re-read from showing the gutted shape).
    expect(store.order).toEqual({ "openai-codex": ["openai-codex:cli"] });
  });

  it("surfaces an actionable error when order references a missing profile", async () => {
    // Write a store where the only candidate for openai-codex is dangling.
    const gutted = {
      version: 1,
      profiles: {},
      order: { "openai-codex": ["openai-codex:default"] },
    };
    await fs.writeFile(authPath, JSON.stringify(gutted));

    // Bypass the self-healing loader by passing the gutted shape directly so
    // we exercise the resolveApiKeyForProvider error path explicitly.
    const store: AuthProfileStore = {
      version: 1,
      profiles: {},
      order: { "openai-codex": ["openai-codex:default"] },
    };

    await expect(
      resolveApiKeyForProvider({
        provider: "openai-codex",
        store,
        agentDir,
      }),
    ).rejects.toThrow(/openai-codex:default.*missing from profiles/);
  });

  it("pruneDanglingOrderEntries leaves a healthy store untouched", () => {
    const future = Date.now() + 60 * 60 * 1000;
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai-codex:cli": {
          type: "oauth",
          provider: "openai-codex",
          access: "tok",
          refresh: "ref",
          expires: future,
        },
      },
      order: { "openai-codex": ["openai-codex:cli"] },
    };

    const mutated = pruneDanglingOrderEntries(store);
    expect(mutated).toBe(false);
    expect(store.order).toEqual({ "openai-codex": ["openai-codex:cli"] });
  });

  it("ensureAuthProfileStore self-heals on first load for a real agentDir", async () => {
    const gutted = {
      version: 1,
      profiles: {},
      order: { "openai-codex": ["openai-codex:default"] },
    };
    await fs.writeFile(authPath, JSON.stringify(gutted));

    const loaded = ensureAuthProfileStore(agentDir);
    expect(loaded.order).toBeUndefined();

    const onDisk = JSON.parse(await fs.readFile(authPath, "utf8")) as AuthProfileStore;
    expect(onDisk.order).toBeUndefined();
  });
});
