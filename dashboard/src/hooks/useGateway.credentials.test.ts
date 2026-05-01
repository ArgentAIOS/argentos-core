import { describe, expect, it } from "vitest";
import { shouldForceGatewayCredentialReconnect } from "./useGateway";

describe("shouldForceGatewayCredentialReconnect", () => {
  it("returns true when connected and token changes", () => {
    expect(
      shouldForceGatewayCredentialReconnect({
        connected: true,
        suppressedAutoReconnect: false,
        currentUrl: "ws://127.0.0.1:18789",
        currentToken: "old",
        nextUrl: "ws://127.0.0.1:18789",
        nextToken: "new",
      }),
    ).toBe(true);
  });

  it("returns true when connecting and the gateway URL changes", () => {
    expect(
      shouldForceGatewayCredentialReconnect({
        connected: false,
        connecting: true,
        suppressedAutoReconnect: false,
        currentUrl: "ws://127.0.0.1:18789",
        currentToken: "phase3a-smoke",
        nextUrl: "ws://127.0.0.1:19001",
        nextToken: "phase3a-smoke",
      }),
    ).toBe(true);
  });

  it("returns true when reconnect was suppressed and credentials changed", () => {
    expect(
      shouldForceGatewayCredentialReconnect({
        connected: false,
        suppressedAutoReconnect: true,
        currentUrl: "ws://127.0.0.1:18789",
        currentToken: "old",
        nextUrl: "ws://127.0.0.1:18789",
        nextToken: "new",
      }),
    ).toBe(true);
  });

  it("returns false when credentials did not change", () => {
    expect(
      shouldForceGatewayCredentialReconnect({
        connected: true,
        suppressedAutoReconnect: false,
        currentUrl: "ws://127.0.0.1:18789",
        currentToken: "same",
        nextUrl: "ws://127.0.0.1:18789",
        nextToken: "same",
      }),
    ).toBe(false);
  });
});
