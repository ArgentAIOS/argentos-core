import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { resolveDashboardApiToken } from "./dashboard-api.js";

/**
 * Coverage for the doc_panel "Invalid token" bugfix. Symmetric to the
 * api-server's `resolveAcceptedTokens`: env var first, then `gateway.auth.token`
 * from argent.json, then null. Token rotation via `argent update` only
 * refreshes argent.json — env var stays stale — so the config fallback is the
 * load-bearing branch on real installs.
 */

function fakeConfig(token: string | undefined): ArgentConfig {
  return {
    gateway: { auth: { token, mode: "token" } },
  } as unknown as ArgentConfig;
}

describe("resolveDashboardApiToken", () => {
  it("prefers DASHBOARD_API_TOKEN env var when set", () => {
    const token = resolveDashboardApiToken({
      env: { DASHBOARD_API_TOKEN: "env-token-wins" },
      loadConfig: () => fakeConfig("config-token-loses"),
    });
    expect(token).toBe("env-token-wins");
  });

  it("falls back to gateway.auth.token from argent.json when env var is unset", () => {
    const token = resolveDashboardApiToken({
      env: {},
      loadConfig: () => fakeConfig("config-token-rescue"),
    });
    expect(token).toBe("config-token-rescue");
  });

  it("falls back to argent.json when env var is empty string", () => {
    const token = resolveDashboardApiToken({
      env: { DASHBOARD_API_TOKEN: "" },
      loadConfig: () => fakeConfig("config-token-rescue"),
    });
    expect(token).toBe("config-token-rescue");
  });

  it("falls back to argent.json when env var is whitespace-only", () => {
    const token = resolveDashboardApiToken({
      env: { DASHBOARD_API_TOKEN: "   " },
      loadConfig: () => fakeConfig("config-token-rescue"),
    });
    expect(token).toBe("config-token-rescue");
  });

  it("returns null when neither env var nor argent.json has a token", () => {
    const token = resolveDashboardApiToken({
      env: {},
      loadConfig: () => fakeConfig(undefined),
    });
    expect(token).toBeNull();
  });

  it("returns null when argent.json has empty/whitespace token", () => {
    const token = resolveDashboardApiToken({
      env: {},
      loadConfig: () => fakeConfig("   "),
    });
    expect(token).toBeNull();
  });

  it("returns null and does not throw when loadConfig() throws (missing argent.json)", () => {
    const token = resolveDashboardApiToken({
      env: {},
      loadConfig: () => {
        throw new Error("argent.json not found");
      },
    });
    expect(token).toBeNull();
  });

  it("trims whitespace from env-var tokens", () => {
    const token = resolveDashboardApiToken({
      env: { DASHBOARD_API_TOKEN: "  spaced-env-token  " },
      loadConfig: () => fakeConfig("ignored"),
    });
    expect(token).toBe("spaced-env-token");
  });

  it("trims whitespace from config-fallback tokens", () => {
    const token = resolveDashboardApiToken({
      env: {},
      loadConfig: () => fakeConfig("  spaced-config-token  "),
    });
    expect(token).toBe("spaced-config-token");
  });

  it("re-reads config on each call (no module-level caching — see INV-4)", () => {
    let callCount = 0;
    let currentToken = "initial-token";
    const sources = {
      env: {},
      loadConfig: () => {
        callCount += 1;
        return fakeConfig(currentToken);
      },
    };

    const first = resolveDashboardApiToken(sources);
    expect(first).toBe("initial-token");
    expect(callCount).toBe(1);

    // Simulate `argent update` rotating gateway.auth.token underfoot.
    currentToken = "rotated-token";

    const second = resolveDashboardApiToken(sources);
    expect(second).toBe("rotated-token");
    expect(callCount).toBe(2);
  });
});
