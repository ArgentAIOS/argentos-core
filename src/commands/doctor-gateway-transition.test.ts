import { describe, expect, it } from "vitest";
import type { GatewayServiceRuntime } from "../daemon/service-runtime.js";
import type { PortUsage } from "../infra/ports-types.js";
import {
  describeGatewayTransitionState,
  detectGatewayTransitionState,
} from "./doctor-gateway-transition.js";

const PORT = 18789;

function busyPort(): PortUsage {
  return {
    port: PORT,
    status: "busy",
    listeners: [{ pid: 9999, commandLine: "node argent gateway" }],
    hints: [],
  };
}

function freePort(): PortUsage {
  return {
    port: PORT,
    status: "free",
    listeners: [],
    hints: [],
  };
}

describe("detectGatewayTransitionState", () => {
  it('returns "listening" when supervisor reports running and port is busy', () => {
    const runtime: GatewayServiceRuntime = { status: "running", pid: 52080, state: "active" };
    expect(detectGatewayTransitionState({ runtime, portUsage: busyPort() })).toBe("listening");
  });

  it('returns "starting" when supervisor reports running but port is free (mid-restart)', () => {
    // This is the exact #155 scenario: launchctl reports the new PID is alive
    // but the gateway hasn't bound the socket yet, so the doctor health probe
    // fails. We MUST NOT report this as "Gateway not running".
    const runtime: GatewayServiceRuntime = { status: "running", pid: 52080, state: "active" };
    expect(detectGatewayTransitionState({ runtime, portUsage: freePort() })).toBe("starting");
  });

  it('returns "stale-port" when supervisor reports stopped but port is still bound', () => {
    const runtime: GatewayServiceRuntime = { status: "stopped" };
    expect(detectGatewayTransitionState({ runtime, portUsage: busyPort() })).toBe("stale-port");
  });

  it('returns "stopped" when supervisor reports stopped and port is free', () => {
    const runtime: GatewayServiceRuntime = { status: "stopped" };
    expect(detectGatewayTransitionState({ runtime, portUsage: freePort() })).toBe("stopped");
  });

  it('returns "missing" when the supervisor unit is missing', () => {
    const runtime: GatewayServiceRuntime = { status: "unknown", missingUnit: true };
    expect(detectGatewayTransitionState({ runtime, portUsage: freePort() })).toBe("missing");
  });

  it('returns "unknown" when both signals are indeterminate', () => {
    const runtime: GatewayServiceRuntime = { status: "unknown" };
    const port: PortUsage = { port: PORT, status: "unknown", listeners: [], hints: [] };
    expect(detectGatewayTransitionState({ runtime, portUsage: port })).toBe("unknown");
  });

  it("returns sensible defaults when inputs are undefined", () => {
    expect(detectGatewayTransitionState({ runtime: undefined, portUsage: undefined })).toBe(
      "unknown",
    );
  });
});

describe("describeGatewayTransitionState", () => {
  it("returns a transitioning message for starting state", () => {
    expect(describeGatewayTransitionState("starting")).toMatch(/transition/i);
  });

  it("returns a transitioning message for stale-port state", () => {
    expect(describeGatewayTransitionState("stale-port")).toMatch(/transition/i);
  });

  it("returns the legacy stopped message for stopped state", () => {
    expect(describeGatewayTransitionState("stopped")).toBe("Gateway not running.");
  });

  it("returns null for steady-state listening (nothing to surface)", () => {
    expect(describeGatewayTransitionState("listening")).toBeNull();
  });

  it("returns null for unknown state (caller falls back to existing messaging)", () => {
    expect(describeGatewayTransitionState("unknown")).toBeNull();
  });
});
