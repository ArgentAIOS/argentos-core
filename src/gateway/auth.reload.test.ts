import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import {
  connectReq,
  getFreePort,
  installGatewayTestHooks,
  startGatewayServer,
  testState,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const openWs = async (port: number) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => ws.once("open", resolve));
  return ws;
};

// Regression coverage for the "stale token after rotation" bug:
// Before this fix the gateway captured `resolvedAuth` once at startup and the
// `gateway` config-reload rule was `kind:"restart"`, so any token rotation in
// argent.json that didn't go through `gateway install --force` left the daemon
// serving its env-baked token. CLIs using the freshly rotated token would hit
// `safeEqual` mismatch in `authorizeGatewayConnect` and get `close(1008)`.
//
// The handshake path now re-reads `gateway.auth` from disk on every connect and
// re-resolves the token, so a rotation takes effect on the next connection
// without a daemon restart.
//
// The assertion is at the auth-gate boundary — the test only cares whether the
// token stage passed or rejected as "unauthorized". Anything beyond that
// (device pairing, etc.) is out of scope for this fix.
describe("gateway auth: per-handshake token re-read", () => {
  let server: Awaited<ReturnType<typeof startGatewayServer>>;
  let port: number;
  const initialToken = "init-startup-token-aaaaaaaa";
  const rotatedToken = "rotated-runtime-token-bbbbbbbb";

  beforeAll(async () => {
    // Start the daemon with the INITIAL token baked into the captured
    // `resolvedAuth` snapshot. Without Fix-1, this captured value is what the
    // handshake gate compares against forever.
    testState.gatewayAuth = { mode: "token", token: initialToken };
    port = await getFreePort();
    server = await startGatewayServer(port);
  });

  afterAll(async () => {
    await server.close();
  });

  test("rotated token in argent.json is honored on the next handshake", async () => {
    // The suite-scoped beforeEach in installGatewayTestHooks resets
    // testState.gatewayAuth to its default. Re-stage the rotated token on
    // disk so the next handshake sees the new value. Without Fix-1 the
    // gateway would still compare against `initialToken` (captured at
    // startup) and reject the new token with `close(1008)`.
    testState.gatewayAuth = { mode: "token", token: rotatedToken };

    // 1. The freshly-rotated token must pass the auth gate.
    const wsNew = await openWs(port);
    const okRes = await connectReq(wsNew, { token: rotatedToken });
    expect(String(okRes.error?.message ?? "")).not.toContain("unauthorized");
    wsNew.close();

    // 2. The previously-captured (now-stale) token must be rejected.
    const wsOld = await openWs(port);
    const failRes = await connectReq(wsOld, { token: initialToken });
    expect(failRes.ok).toBe(false);
    expect(String(failRes.error?.message ?? "")).toContain("unauthorized");
    wsOld.close();
  });
});
