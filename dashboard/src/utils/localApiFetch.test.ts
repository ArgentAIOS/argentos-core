import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_CONTROL_SETTINGS_KEY,
  __resetDashboardAuthListenersForTesting,
  addDashboardAuthLostListener,
  addDashboardAuthRecoveredListener,
  fetchLocalApi,
  resolveDashboardApiToken,
  resolveDashboardApiTokenDetailed,
} from "./localApiFetch";

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

/**
 * Coverage for issue #400: distinguish "tried but failed" failures from
 * "user never had a token" so the dashboard can surface a recoverable
 * auth-lost banner instead of silently rendering empty settings panels.
 */
describe("resolveDashboardApiTokenDetailed", () => {
  it("returns reason='ok' when localStorage yields a valid token", () => {
    const result = resolveDashboardApiTokenDetailed({
      search: "",
      getStorageItem: () => JSON.stringify({ token: "valid-token" }),
    });
    expect(result).toEqual({ token: "valid-token", reason: "ok" });
  });

  it("returns reason='ok' when the URL fallback supplies the token", () => {
    const result = resolveDashboardApiTokenDetailed({
      search: "?token=url-token",
      getStorageItem: () => null,
    });
    expect(result).toEqual({ token: "url-token", reason: "ok" });
  });

  it("returns reason='absent' when neither localStorage nor URL has a token", () => {
    const result = resolveDashboardApiTokenDetailed({
      search: "",
      getStorageItem: () => null,
    });
    expect(result).toEqual({ token: null, reason: "absent" });
  });

  it("returns reason='storage-error' when localStorage.getItem throws (quota exceeded)", () => {
    const result = resolveDashboardApiTokenDetailed({
      search: "",
      getStorageItem: () => {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      },
    });
    expect(result).toEqual({ token: null, reason: "storage-error" });
  });

  it("returns reason='parse-error' when localStorage entry is unparsable JSON", () => {
    const result = resolveDashboardApiTokenDetailed({
      search: "",
      getStorageItem: () => "{not valid json",
    });
    expect(result).toEqual({ token: null, reason: "parse-error" });
  });

  it("returns reason='malformed' when token field is missing/non-string/empty", () => {
    const missingField = resolveDashboardApiTokenDetailed({
      search: "",
      getStorageItem: () => JSON.stringify({ otherField: "x" }),
    });
    expect(missingField).toEqual({ token: null, reason: "malformed" });

    const nonString = resolveDashboardApiTokenDetailed({
      search: "",
      getStorageItem: () => JSON.stringify({ token: 12345 }),
    });
    expect(nonString).toEqual({ token: null, reason: "malformed" });

    const whitespaceOnly = resolveDashboardApiTokenDetailed({
      search: "",
      getStorageItem: () => JSON.stringify({ token: "   " }),
    });
    expect(whitespaceOnly).toEqual({ token: null, reason: "malformed" });
  });

  it("returns reason='ok' when storage throws but URL fallback succeeds", () => {
    // Quota-exceeded should not block a user who still has a tokenized URL
    // — they get a working token; future enhancement could surface a soft
    // "storage is broken, this session is fragile" warning separately.
    const result = resolveDashboardApiTokenDetailed({
      search: "?token=url-rescue",
      getStorageItem: () => {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      },
    });
    expect(result).toEqual({ token: "url-rescue", reason: "ok" });
  });
});

/**
 * Coverage for the auth-lost / auth-recovered event surface that drives the
 * AuthLostBanner in App.tsx. Mocks `fetch` so we can assert that
 * `fetchLocalApi` fires events at the right moments.
 */
describe("fetchLocalApi auth event surface", () => {
  afterEach(() => {
    __resetDashboardAuthListenersForTesting();
    vi.restoreAllMocks();
  });

  function setupStubFetch(response: { status?: number; ok?: boolean }): void {
    const status = response.status ?? 200;
    const ok = response.ok ?? (status >= 200 && status < 300);
    const stub: typeof fetch = vi.fn(async () => {
      return {
        status,
        ok,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => "",
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", stub);
    // localApiFetch reads import.meta.env?.DEV; in vitest this is truthy so
    // alternate-loopback fallback stays disabled — fetch will be called exactly
    // once per fetchLocalApi() invocation in the happy / 401 paths.
  }

  function setupStubLocalStorage(token: string | null): void {
    const storage = new Map<string, string>();
    if (token !== null) {
      storage.set(DASHBOARD_CONTROL_SETTINGS_KEY, JSON.stringify({ token }));
    }
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
      key: () => null,
      length: 0,
    } as Storage);
  }

  it("fires auth-lost with reason='rejected' when the server returns 401 despite a token being attached", async () => {
    setupStubLocalStorage("rotated-but-stale-token");
    setupStubFetch({ status: 401 });
    const lostEvents: Array<{ reason: string; path: string }> = [];
    addDashboardAuthLostListener((event) => {
      lostEvents.push({ reason: event.reason, path: event.path });
    });
    await fetchLocalApi("/api/settings/models");
    expect(lostEvents).toHaveLength(1);
    expect(lostEvents[0]).toEqual({ reason: "rejected", path: "/api/settings/models" });
  });

  it("fires auth-lost with reason='absent' when no token is available and the server 401s", async () => {
    setupStubLocalStorage(null);
    setupStubFetch({ status: 401 });
    const lostEvents: Array<{ reason: string; path: string }> = [];
    addDashboardAuthLostListener((event) => {
      lostEvents.push({ reason: event.reason, path: event.path });
    });
    await fetchLocalApi("/api/settings/auth-profiles");
    expect(lostEvents).toHaveLength(1);
    expect(lostEvents[0]).toEqual({ reason: "absent", path: "/api/settings/auth-profiles" });
  });

  it("fires auth-recovered when a 2xx response comes back with a token attached", async () => {
    setupStubLocalStorage("valid-token");
    setupStubFetch({ status: 200, ok: true });
    let recoveredCount = 0;
    addDashboardAuthRecoveredListener(() => {
      recoveredCount += 1;
    });
    await fetchLocalApi("/api/settings/models");
    expect(recoveredCount).toBe(1);
  });

  it("does not fire either event for non-auth-related success (no token attached, 200 OK)", async () => {
    setupStubLocalStorage(null);
    setupStubFetch({ status: 200, ok: true });
    let lostCount = 0;
    let recoveredCount = 0;
    addDashboardAuthLostListener(() => {
      lostCount += 1;
    });
    addDashboardAuthRecoveredListener(() => {
      recoveredCount += 1;
    });
    await fetchLocalApi("/api/public/info");
    // No token was attached, so a 200 doesn't tell us anything about auth recovery.
    expect(recoveredCount).toBe(0);
    expect(lostCount).toBe(0);
  });

  it("allows a listener to unsubscribe via the returned dispose function", async () => {
    setupStubLocalStorage(null);
    setupStubFetch({ status: 401 });
    let fired = 0;
    const dispose = addDashboardAuthLostListener(() => {
      fired += 1;
    });
    await fetchLocalApi("/api/settings/models");
    expect(fired).toBe(1);
    dispose();
    await fetchLocalApi("/api/settings/models");
    expect(fired).toBe(1); // not incremented after unsubscribe
  });
});
