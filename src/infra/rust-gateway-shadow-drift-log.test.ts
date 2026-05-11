import { describe, expect, it } from "vitest";
import type { RustGatewayParityReplayReport } from "./rust-gateway-parity-runner.js";
import {
  collectRustGatewayShadowDriftEvents,
  writeRustGatewayShadowDriftLog,
} from "./rust-gateway-shadow-drift-log.js";

describe("rust gateway shadow drift logging", () => {
  it("keeps clean parity results out of the drift log", () => {
    const report: RustGatewayParityReplayReport = {
      generatedAtMs: 1,
      totals: { passed: 1, failed: 0, skipped: 0 },
      results: [
        {
          fixtureId: "health",
          method: "health",
          safety: "read-only",
          expectedParity: "schema-compatible",
          observedParity: "schema-compatible",
          status: "passed",
          nodeOk: true,
          rustOk: true,
          notes: ["ok"],
        },
      ],
    };

    expect(collectRustGatewayShadowDriftEvents(report)).toEqual([]);
  });

  it("classifies failed parity as an error drift event", () => {
    const report: RustGatewayParityReplayReport = {
      generatedAtMs: 1,
      totals: { passed: 0, failed: 1, skipped: 0 },
      results: [
        {
          fixtureId: "status",
          method: "status",
          safety: "read-only",
          expectedParity: "schema-compatible",
          observedParity: "failed",
          status: "failed",
          nodeOk: true,
          rustOk: false,
          notes: ["schema/envelope: node ok=true, rust ok=false"],
        },
      ],
    };

    expect(collectRustGatewayShadowDriftEvents(report)).toEqual([
      {
        type: "rust_gateway_shadow_drift",
        generatedAtMs: 1,
        fixtureId: "status",
        method: "status",
        severity: "error",
        expectedParity: "schema-compatible",
        observedParity: "failed",
        status: "failed",
        nodeOk: true,
        rustOk: false,
        notes: ["schema/envelope: node ok=true, rust ok=false"],
      },
    ]);
  });

  it("writes jsonl drift events to the provided sink", async () => {
    const lines: string[] = [];
    const count = await writeRustGatewayShadowDriftLog({
      report: {
        generatedAtMs: 1,
        totals: { passed: 1, failed: 0, skipped: 0 },
        results: [
          {
            fixtureId: "channels",
            method: "channels.status",
            safety: "read-only",
            expectedParity: "mock-compatible",
            observedParity: "mock-compatible",
            status: "passed",
            nodeOk: true,
            rustOk: true,
            notes: ["synthetic"],
          },
        ],
      },
      sink: (line) => lines.push(line),
    });

    expect(count).toBe(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      fixtureId: "channels",
      severity: "warn",
    });
  });
});
