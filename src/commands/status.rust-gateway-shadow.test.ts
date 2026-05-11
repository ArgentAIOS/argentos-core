import { describe, expect, it, vi } from "vitest";
import {
  getRustGatewayShadowSummary,
  RUST_GATEWAY_SHADOW_DEFAULT_BASE_URL,
} from "./status.rust-gateway-shadow.js";

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
}

describe("getRustGatewayShadowSummary", () => {
  it("returns read-only rust gateway shadow health when reachable", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seenUrl = requestUrl(input);
      return new Response(
        JSON.stringify({
          status: "ok",
          uptimeSeconds: 12,
          version: "0.1.0",
          component: "argentd",
          mode: "shadow",
          protocolVersion: 3,
          liveAuthority: "node",
          gatewayAuthority: "shadow-only",
          readiness: {
            promotionReady: false,
            reason: "shadow parity evidence incomplete",
          },
          capabilities: {
            statePersistence: "memory-only",
          },
        }),
        { status: 200 },
      );
    });

    const summary = await getRustGatewayShadowSummary({ fetchImpl });

    expect(seenUrl).toBe(`${RUST_GATEWAY_SHADOW_DEFAULT_BASE_URL}/health`);
    expect(summary).toEqual({
      reachable: true,
      status: "ok",
      version: "0.1.0",
      uptimeSeconds: 12,
      component: "argentd",
      mode: "shadow",
      protocolVersion: 3,
      liveAuthority: "node",
      gatewayAuthority: "shadow-only",
      promotionReady: false,
      readinessReason: "shadow parity evidence incomplete",
      statePersistence: "memory-only",
      baseUrl: RUST_GATEWAY_SHADOW_DEFAULT_BASE_URL,
      error: null,
    });
  });

  it("normalizes a custom base URL", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seenUrl = requestUrl(input);
      return new Response(JSON.stringify({ status: "ok", uptimeSeconds: 1 }), { status: 200 });
    });

    await getRustGatewayShadowSummary({
      baseUrl: "http://127.0.0.1:18799///",
      fetchImpl,
    });

    expect(seenUrl).toBe("http://127.0.0.1:18799/health");
  });

  it("returns an unavailable summary when the shadow daemon is not reachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const summary = await getRustGatewayShadowSummary({ fetchImpl });

    expect(summary.reachable).toBe(false);
    expect(summary.error).toContain("ECONNREFUSED");
  });

  it("treats malformed health as unavailable", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ status: "starting" }), { status: 200 }),
    );

    const summary = await getRustGatewayShadowSummary({ fetchImpl });

    expect(summary.reachable).toBe(false);
    expect(summary.error).toContain("unexpected health status");
  });
});
