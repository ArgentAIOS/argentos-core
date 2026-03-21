import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureAuthProfileStore,
  markAuthProfileFailure,
  markAuthProfileUsed,
} from "./auth-profiles.js";

describe("markAuthProfileFailure", () => {
  it("disables billing failures for ~5 hours by default", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "anthropic:default": {
              type: "api_key",
              provider: "anthropic",
              key: "sk-default",
            },
          },
        }),
      );

      const store = ensureAuthProfileStore(agentDir);
      const startedAt = Date.now();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "billing",
        agentDir,
      });

      const disabledUntil = store.usageStats?.["anthropic:default"]?.disabledUntil;
      expect(typeof disabledUntil).toBe("number");
      const remainingMs = (disabledUntil as number) - startedAt;
      expect(remainingMs).toBeGreaterThan(4.5 * 60 * 60 * 1000);
      expect(remainingMs).toBeLessThan(5.5 * 60 * 60 * 1000);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
  it("honors per-provider billing backoff overrides", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "anthropic:default": {
              type: "api_key",
              provider: "anthropic",
              key: "sk-default",
            },
          },
        }),
      );

      const store = ensureAuthProfileStore(agentDir);
      const startedAt = Date.now();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "billing",
        agentDir,
        cfg: {
          auth: {
            cooldowns: {
              billingBackoffHoursByProvider: { Anthropic: 1 },
              billingMaxHours: 2,
            },
          },
        } as never,
      });

      const disabledUntil = store.usageStats?.["anthropic:default"]?.disabledUntil;
      expect(typeof disabledUntil).toBe("number");
      const remainingMs = (disabledUntil as number) - startedAt;
      expect(remainingMs).toBeGreaterThan(0.8 * 60 * 60 * 1000);
      expect(remainingMs).toBeLessThan(1.2 * 60 * 60 * 1000);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
  it("resets backoff counters outside the failure window", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      const now = Date.now();
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "anthropic:default": {
              type: "api_key",
              provider: "anthropic",
              key: "sk-default",
            },
          },
          usageStats: {
            "anthropic:default": {
              errorCount: 9,
              failureCounts: { billing: 3 },
              lastFailureAt: now - 48 * 60 * 60 * 1000,
            },
          },
        }),
      );

      const store = ensureAuthProfileStore(agentDir);
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "billing",
        agentDir,
        cfg: {
          auth: { cooldowns: { failureWindowHours: 24 } },
        } as never,
      });

      expect(store.usageStats?.["anthropic:default"]?.errorCount).toBe(1);
      expect(store.usageStats?.["anthropic:default"]?.failureCounts?.billing).toBe(1);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("applies provider cooldown from long Retry-After", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "anthropic:a": {
              type: "api_key",
              provider: "anthropic",
              key: "sk-a",
            },
          },
        }),
      );
      const store = ensureAuthProfileStore(agentDir);
      const startedAt = Date.now();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:a",
        reason: "rate_limit",
        retryAfterMs: 2 * 60 * 1000,
        agentDir,
      });
      const providerCooldownUntil = store.providerStats?.anthropic?.cooldownUntil;
      expect(typeof providerCooldownUntil).toBe("number");
      const remaining = (providerCooldownUntil as number) - startedAt;
      expect(remaining).toBeGreaterThan(110_000);
      expect(remaining).toBeLessThan(130_000);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("trips provider circuit breaker when all provider profiles rate-limit quickly", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "anthropic:a": { type: "api_key", provider: "anthropic", key: "sk-a" },
            "anthropic:b": { type: "api_key", provider: "anthropic", key: "sk-b" },
          },
        }),
      );
      const store = ensureAuthProfileStore(agentDir);
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:a",
        reason: "rate_limit",
        agentDir,
      });
      expect(store.providerStats?.anthropic?.cooldownUntil).toBeUndefined();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:b",
        reason: "rate_limit",
        agentDir,
      });
      const providerCooldownUntil = store.providerStats?.anthropic?.cooldownUntil;
      expect(typeof providerCooldownUntil).toBe("number");
      expect((providerCooldownUntil as number) - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("treats 60s Retry-After as provider cooldown", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "anthropic:a": { type: "api_key", provider: "anthropic", key: "sk-a" },
          },
        }),
      );
      const store = ensureAuthProfileStore(agentDir);
      const startedAt = Date.now();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:a",
        reason: "rate_limit",
        retryAfterMs: 60_000,
        agentDir,
      });
      const providerCooldownUntil = store.providerStats?.anthropic?.cooldownUntil;
      expect(typeof providerCooldownUntil).toBe("number");
      const remaining = (providerCooldownUntil as number) - startedAt;
      expect(remaining).toBeGreaterThan(50_000);
      expect(remaining).toBeLessThan(70_000);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("closes provider circuit after successful use", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "anthropic:a": { type: "api_key", provider: "anthropic", key: "sk-a" },
          },
          providerStats: {
            anthropic: {
              circuitState: "half_open",
              halfOpenSince: Date.now() - 5_000,
            },
          },
        }),
      );
      const store = ensureAuthProfileStore(agentDir);
      await markAuthProfileUsed({
        store,
        profileId: "anthropic:a",
        agentDir,
      });
      expect(store.providerStats?.anthropic?.circuitState).toBe("closed");
      expect(store.providerStats?.anthropic?.halfOpenSince).toBeUndefined();
      expect(store.providerStats?.anthropic?.cooldownUntil).toBeUndefined();
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("reopens provider circuit when half-open probe fails", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "anthropic:a": { type: "api_key", provider: "anthropic", key: "sk-a" },
          },
          providerStats: {
            anthropic: {
              circuitState: "half_open",
              halfOpenSince: Date.now() - 5_000,
            },
          },
        }),
      );
      const store = ensureAuthProfileStore(agentDir);
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:a",
        reason: "rate_limit",
        agentDir,
      });
      expect(store.providerStats?.anthropic?.circuitState).toBe("open");
      expect(typeof store.providerStats?.anthropic?.cooldownUntil).toBe("number");
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
