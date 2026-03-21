import { describe, expect, it } from "vitest";
import { resolveRpcDiagnosis } from "./status.gather.js";

describe("resolveRpcDiagnosis", () => {
  it("classifies auth misconfiguration", () => {
    const result = resolveRpcDiagnosis({
      authMisconfiguration: 'gateway.auth.mode is "token" but gateway.auth.token is empty.',
      serviceLoaded: true,
      runtimeStatus: "running",
      portBusy: true,
      rpcError: "unauthorized",
    });
    expect(result.diagnosis).toBe("auth-misconfiguration");
  });

  it("classifies token mismatch unauthorized", () => {
    const result = resolveRpcDiagnosis({
      authMisconfiguration: null,
      serviceLoaded: true,
      runtimeStatus: "running",
      portBusy: true,
      rpcError: "unauthorized: gateway token mismatch",
    });
    expect(result.diagnosis).toBe("token-mismatch-unauthorized");
  });

  it("classifies gateway down/crashed", () => {
    const result = resolveRpcDiagnosis({
      authMisconfiguration: null,
      serviceLoaded: true,
      runtimeStatus: "stopped",
      portBusy: false,
      rpcError: "connect failed: ECONNREFUSED",
    });
    expect(result.diagnosis).toBe("gateway-down-or-crashed");
  });
});
