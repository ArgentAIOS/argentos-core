import { describe, expect, it } from "vitest";
import type { AuthProfileStore } from "./auth-profiles/types.js";
import {
  clearExpiredCooldowns,
  getSoonestCooldownExpiry,
  isProfileInCooldown,
  resolveProviderCircuitState,
} from "./auth-profiles/usage.js";

function makeStore(usageStats: AuthProfileStore["usageStats"]): AuthProfileStore {
  return {
    profiles: {
      "anthropic:a": { type: "api_key", provider: "anthropic", key: "sk-a" },
      "anthropic:b": { type: "api_key", provider: "anthropic", key: "sk-b" },
      "anthropic:c": { type: "api_key", provider: "anthropic", key: "sk-c" },
    },
    usageStats,
  };
}

describe("clearExpiredCooldowns", () => {
  it("clears expired cooldownUntil and resets error count", () => {
    const now = Date.now();
    const store = makeStore({
      "anthropic:a": {
        errorCount: 3,
        cooldownUntil: now - 1000, // expired
        lastFailureAt: now - 60_000,
      },
    });

    const result = clearExpiredCooldowns(store, now);
    expect(result).toBe(true);
    expect(store.usageStats!["anthropic:a"]!.cooldownUntil).toBeUndefined();
    expect(store.usageStats!["anthropic:a"]!.errorCount).toBe(0);
    expect(isProfileInCooldown(store, "anthropic:a")).toBe(false);
  });

  it("preserves active cooldowns", () => {
    const now = Date.now();
    const store = makeStore({
      "anthropic:a": {
        errorCount: 2,
        cooldownUntil: now + 30_000, // still active
        lastFailureAt: now - 5000,
      },
    });

    const result = clearExpiredCooldowns(store, now);
    expect(result).toBe(false);
    expect(store.usageStats!["anthropic:a"]!.cooldownUntil).toBe(now + 30_000);
    expect(store.usageStats!["anthropic:a"]!.errorCount).toBe(2);
    expect(isProfileInCooldown(store, "anthropic:a")).toBe(true);
  });

  it("clears expired disabledUntil independently", () => {
    const now = Date.now();
    const store = makeStore({
      "anthropic:a": {
        errorCount: 5,
        cooldownUntil: now + 60_000, // still active
        disabledUntil: now - 1000, // expired
        disabledReason: "billing",
        lastFailureAt: now - 60_000,
      },
    });

    const result = clearExpiredCooldowns(store, now);
    expect(result).toBe(true);
    // disabledUntil cleared, cooldownUntil preserved
    expect(store.usageStats!["anthropic:a"]!.disabledUntil).toBeUndefined();
    expect(store.usageStats!["anthropic:a"]!.disabledReason).toBeUndefined();
    expect(store.usageStats!["anthropic:a"]!.cooldownUntil).toBe(now + 60_000);
    // Error count NOT reset because cooldownUntil is still active
    expect(store.usageStats!["anthropic:a"]!.errorCount).toBe(5);
  });

  it("resets error count only when ALL cooldowns expired", () => {
    const now = Date.now();
    const store = makeStore({
      "anthropic:a": {
        errorCount: 4,
        cooldownUntil: now - 1000, // expired
        disabledUntil: now - 500, // expired
        disabledReason: "billing",
        failureCounts: { rate_limit: 3, billing: 1 },
        lastFailureAt: now - 60_000,
      },
    });

    clearExpiredCooldowns(store, now);
    expect(store.usageStats!["anthropic:a"]!.errorCount).toBe(0);
    expect(store.usageStats!["anthropic:a"]!.failureCounts).toBeUndefined();
    // lastFailureAt preserved for the decay window check
    expect(store.usageStats!["anthropic:a"]!.lastFailureAt).toBe(now - 60_000);
  });

  it("handles multiple profiles in one sweep", () => {
    const now = Date.now();
    const store = makeStore({
      "anthropic:a": {
        errorCount: 3,
        cooldownUntil: now - 1000, // expired
      },
      "anthropic:b": {
        errorCount: 2,
        cooldownUntil: now + 30_000, // active
      },
      "anthropic:c": {
        errorCount: 1,
        cooldownUntil: now - 500, // expired
      },
    });

    const result = clearExpiredCooldowns(store, now);
    expect(result).toBe(true);
    expect(store.usageStats!["anthropic:a"]!.errorCount).toBe(0);
    expect(store.usageStats!["anthropic:b"]!.errorCount).toBe(2);
    expect(store.usageStats!["anthropic:c"]!.errorCount).toBe(0);
  });

  it("returns false when no usageStats exist", () => {
    const store = makeStore(undefined);
    expect(clearExpiredCooldowns(store)).toBe(false);
  });

  it("clears expired provider-level cooldowns", () => {
    const now = Date.now();
    const store = makeStore({});
    store.providerStats = {
      anthropic: {
        circuitState: "open",
        cooldownUntil: now - 1000,
      },
    };

    const result = clearExpiredCooldowns(store, now);
    expect(result).toBe(true);
    expect(store.providerStats?.anthropic?.cooldownUntil).toBeUndefined();
    expect(store.providerStats?.anthropic?.circuitState).toBe("half_open");
  });

  it("resolves provider circuit state transitions", () => {
    const now = Date.now();
    const store = makeStore({});
    store.providerStats = {
      anthropic: {
        circuitState: "open",
        cooldownUntil: now + 5_000,
      },
    };

    expect(resolveProviderCircuitState(store, "anthropic")).toBe("open");
    clearExpiredCooldowns(store, now + 10_000);
    expect(resolveProviderCircuitState(store, "anthropic")).toBe("half_open");
  });
});

describe("getSoonestCooldownExpiry", () => {
  it("returns the soonest expiry across profiles", () => {
    const now = Date.now();
    const store = makeStore({
      "anthropic:a": { cooldownUntil: now + 60_000 },
      "anthropic:b": { cooldownUntil: now + 15_000 },
      "anthropic:c": { cooldownUntil: now + 30_000 },
    });

    const soonest = getSoonestCooldownExpiry(store, ["anthropic:a", "anthropic:b", "anthropic:c"]);
    expect(soonest).toBe(now + 15_000);
  });

  it("returns null when no profiles have cooldowns", () => {
    const store = makeStore({});
    expect(getSoonestCooldownExpiry(store, ["anthropic:a", "anthropic:b"])).toBeNull();
  });

  it("considers disabledUntil as well", () => {
    const now = Date.now();
    const store = makeStore({
      "anthropic:a": { disabledUntil: now + 5_000 },
      "anthropic:b": { cooldownUntil: now + 20_000 },
    });

    const soonest = getSoonestCooldownExpiry(store, ["anthropic:a", "anthropic:b"]);
    expect(soonest).toBe(now + 5_000);
  });
});
