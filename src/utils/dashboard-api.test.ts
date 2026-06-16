import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { resolveDashboardApiToken } from "./dashboard-api.js";

/**
 * Coverage for the doc_panel "Invalid token" bugfix. The gateway prefers
 * `gateway.auth.token` from argent.json (resolved live, always in the
 * api-server's accepted set), then falls back to the DASHBOARD_API_TOKEN env
 * var, then null. The env var is sourced from the LaunchAgent plist / service-
 * env and can drift stale across redeploys (observed 2026-06-16: a stale plist
 * token 401'd every DocPanel save), so config is the load-bearing branch.
 */

function fakeConfig(token: string | undefined): ArgentConfig {
  return {
    gateway: { auth: { token, mode: "token" } },
  } as unknown as ArgentConfig;
}

describe("resolveDashboardApiToken", () => {
  it("prefers gateway.auth.token over the env var (api-server always accepts the config token)", () => {
    const token = resolveDashboardApiToken({
      env: { DASHBOARD_API_TOKEN: "stale-plist-env-token" },
      loadConfig: () => fakeConfig("config-token-wins"),
    });
    expect(token).toBe("config-token-wins");
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

  it("trims whitespace from env-var tokens (env fallback path, no config token)", () => {
    const token = resolveDashboardApiToken({
      env: { DASHBOARD_API_TOKEN: "  spaced-env-token  " },
      loadConfig: () => fakeConfig(undefined),
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
