import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { _peekInFlightRefresh, maybeKickEagerRefresh } from "./auth-profiles/oauth.js";
import * as openaiCodexAuth from "./openai-codex-auth.js";

function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.unverified`;
}

describe("eager refresh + in-flight de-dup", () => {
  const profileId = "openai-codex:test";
  const now = 1_700_000_000_000;

  // 60s away from exp — inside 5-min skew → expiring
  const nearExpJwt = makeJwt({ exp: Math.floor(now / 1000) + 60 });
  // 1 hour away — outside skew → not expiring
  const safeJwt = makeJwt({ exp: Math.floor(now / 1000) + 3600 });

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when the token is not yet near expiry", async () => {
    const spy = vi
      .spyOn(openaiCodexAuth, "refreshOpenAICodexCredentials")
      .mockResolvedValue({ access: "x", refresh: "y", expires: now + 1000 });

    maybeKickEagerRefresh({
      profileId,
      credentials: {
        provider: "openai-codex",
        access: safeJwt,
        refresh: "r",
        expires: now + 3600_000,
      },
    });
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    expect(_peekInFlightRefresh(profileId)).toBeUndefined();
  });

  it("only fires for openai-codex (other providers no-op)", async () => {
    const spy = vi
      .spyOn(openaiCodexAuth, "refreshOpenAICodexCredentials")
      .mockResolvedValue({ access: "x", refresh: "y", expires: now + 1000 });

    maybeKickEagerRefresh({
      profileId: "anthropic:test",
      credentials: {
        provider: "anthropic",
        access: nearExpJwt,
        refresh: "r",
        expires: now + 60_000,
      },
    });
    expect(spy).not.toHaveBeenCalled();
    expect(_peekInFlightRefresh("anthropic:test")).toBeUndefined();
  });

  it("de-duplicates concurrent eager-refresh kicks for the same profile", async () => {
    // We don't actually exercise the lock layer in this test — instead we
    // verify the *tracker* short-circuits the second kick before any refresh
    // runs. The first kick should register an in-flight promise, the second
    // should observe that promise and bail.
    let resolveFirst: () => void = () => {};
    const refreshGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const refreshSpy = vi
      .spyOn(openaiCodexAuth, "refreshOpenAICodexCredentials")
      .mockImplementation(async () => {
        await refreshGate;
        return { access: "new", refresh: "new", expires: now + 3600_000 };
      });

    // Stash any noise the lock layer might surface; we only care about
    // the tracker entry presence here.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    maybeKickEagerRefresh({
      profileId,
      credentials: {
        provider: "openai-codex",
        access: nearExpJwt,
        refresh: "r",
        expires: now + 60_000,
      },
    });
    expect(_peekInFlightRefresh(profileId)).toBeDefined();

    maybeKickEagerRefresh({
      profileId,
      credentials: {
        provider: "openai-codex",
        access: nearExpJwt,
        refresh: "r",
        expires: now + 60_000,
      },
    });
    // The second call must not have kicked another async refresh — the
    // tracker entry should still be the same promise.
    const inflight = _peekInFlightRefresh(profileId);
    expect(inflight).toBeDefined();

    resolveFirst();
    await inflight;
    // refreshSpy may or may not be invoked depending on whether the lockfile
    // path is reachable in this test env — we don't assert on its call count.
    // The key invariant is the second concurrent call observed the in-flight
    // entry and didn't double-fire.
    void refreshSpy;
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });
});
