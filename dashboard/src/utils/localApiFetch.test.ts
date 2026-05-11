import { describe, expect, it } from "vitest";
import { DASHBOARD_CONTROL_SETTINGS_KEY, resolveDashboardApiToken } from "./localApiFetch";

/**
 * Unit coverage for the post-#149 fix.
 *
 * The bug: REST calls hit /api/* with a stale URL `?token=` after
 * `argent update` rotates `gateway.auth.token`, so the api-server returns
 * 401 even though the WS path (which reads from
 * localStorage["argent.control.settings.v1"].token) connects fine.
 *
 * The fix: `resolveDashboardApiToken` now mirrors the WS source chain —
 * localStorage first (live, post-update-aware), URL `?token=` / `?api_token=`
 * as a backwards-compat fallback. This file pins down that precedence so the
 * regression cannot quietly come back.
 */
describe("resolveDashboardApiToken", () => {
  it("returns the token persisted in argent.control.settings.v1 when present", () => {
    const token = resolveDashboardApiToken({
      search: "",
      getStorageItem: (key) =>
        key === DASHBOARD_CONTROL_SETTINGS_KEY
          ? JSON.stringify({ token: "ls-token-from-control-settings" })
          : null,
    });
    expect(token).toBe("ls-token-from-control-settings");
  });

  it("falls back to URL ?token= when localStorage is empty", () => {
    const token = resolveDashboardApiToken({
      search: "?token=url-fallback-token",
      getStorageItem: () => null,
    });
    expect(token).toBe("url-fallback-token");
  });

  it("accepts the legacy ?api_token= URL parameter", () => {
    const token = resolveDashboardApiToken({
      search: "?api_token=legacy-api-token-param",
      getStorageItem: () => null,
    });
    expect(token).toBe("legacy-api-token-param");
  });

  it("returns null when neither localStorage nor URL has a token", () => {
    const token = resolveDashboardApiToken({
      search: "",
      getStorageItem: () => null,
    });
    expect(token).toBeNull();
  });

  it("prefers localStorage even when URL also carries a token (post-rotation safety)", () => {
    // After `argent update` rotates gateway.auth.token, App.tsx persists the
    // fresh token to localStorage. A user who reopens an old tab still has
    // the OLD token in the URL — REST must not regress to that stale value.
    const token = resolveDashboardApiToken({
      search: "?token=stale-url-token",
      getStorageItem: (key) =>
        key === DASHBOARD_CONTROL_SETTINGS_KEY
          ? JSON.stringify({ token: "fresh-localstorage-token" })
          : null,
    });
    expect(token).toBe("fresh-localstorage-token");
  });

  it("ignores malformed JSON in argent.control.settings.v1 and falls through to URL", () => {
    const token = resolveDashboardApiToken({
      search: "?token=url-after-bad-json",
      getStorageItem: () => "{not valid json",
    });
    expect(token).toBe("url-after-bad-json");
  });

  it("ignores a non-string token field and falls through to URL", () => {
    const token = resolveDashboardApiToken({
      search: "?token=url-after-bad-shape",
      getStorageItem: () => JSON.stringify({ token: 12345 }),
    });
    expect(token).toBe("url-after-bad-shape");
  });

  it("ignores an empty/whitespace token and falls through to URL", () => {
    const token = resolveDashboardApiToken({
      search: "?token=url-after-empty",
      getStorageItem: () => JSON.stringify({ token: "   " }),
    });
    expect(token).toBe("url-after-empty");
  });

  it("trims surrounding whitespace from the localStorage token", () => {
    const token = resolveDashboardApiToken({
      search: "",
      getStorageItem: () => JSON.stringify({ token: "  spaced-token  " }),
    });
    expect(token).toBe("spaced-token");
  });

  it("trims surrounding whitespace from the URL token", () => {
    const token = resolveDashboardApiToken({
      search: "?token=%20spaced-url-token%20",
      getStorageItem: () => null,
    });
    expect(token).toBe("spaced-url-token");
  });
});
