import { describe, expect, it } from "vitest";
import type { ResponseFrame } from "../gateway/protocol/index.js";
import type { RustGatewayParityFixture } from "./rust-gateway-parity-fixtures.js";
import {
  runRustGatewayParityReplay,
  type RustGatewayParityReplayTransport,
} from "./rust-gateway-parity-runner.js";

const baseFixture = {
  surface: "health",
  params: {},
  reason: "test",
} satisfies Pick<RustGatewayParityFixture, "surface" | "params" | "reason">;

function frame(id: string, ok: boolean, payload?: unknown, message?: string): ResponseFrame {
  return ok
    ? { type: "res", id, ok: true, payload }
    : {
        type: "res",
        id,
        ok: false,
        error: { code: "INVALID_REQUEST", message: message ?? "failed" },
      };
}

describe("runRustGatewayParityReplay", () => {
  it("passes schema-compatible fixtures when response envelopes agree", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "health",
        method: "health",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async () =>
      frame("health", true, { ok: true, durationMs: 1, defaultAgentId: "main" });

    const report = await runRustGatewayParityReplay({ fixtures, transport, nowMs: () => 1 });

    expect(report.generatedAtMs).toBe(1);
    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.observedParity).toBe("schema-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain("schema/payload");
  });

  it("fails schema-compatible fixtures when known payload shapes drift", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "health",
        method: "health",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node"
        ? frame(endpoint, true, { ok: true, durationMs: 1, defaultAgentId: "main" })
        : frame(endpoint, true, { status: "ok" });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals.failed).toBe(1);
    expect(report.results[0]?.observedParity).toBe("failed");
    expect(report.results[0]?.notes.join(" ")).toContain("schema/payload");
  });

  it("passes status fixtures when read-only summary fields are present", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "status",
        method: "status",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, {
        heartbeat: { defaultAgentId: "main", agents: [] },
        sessions: { paths: [], count: 0, defaults: {}, recent: [], byAgent: [] },
        channelSummary: [],
        queuedSystemEvents: [],
      });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.observedParity).toBe("schema-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain("status payload includes");
  });

  it("passes mock-compatible fixtures but marks them as non-promotion evidence", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "channels",
        method: "channels.status",
        safety: "read-only",
        expectedParity: "mock-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, { source: endpoint });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.results[0]?.status).toBe("passed");
    expect(report.results[0]?.observedParity).toBe("mock-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain("not promotion evidence");
  });

  it("passes unsupported fixtures when rust explicitly rejects the method", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "workflows-list",
        method: "workflows.list",
        safety: "read-only",
        expectedParity: "unsupported",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node"
        ? frame(endpoint, true, { workflows: [] })
        : frame(endpoint, false, undefined, "unknown method: workflows.list");

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.results[0]?.status).toBe("passed");
    expect(report.results[0]?.observedParity).toBe("unsupported");
  });

  it("skips unsafe fixtures without calling transport", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "cron-add",
        method: "cron.add",
        safety: "unsafe",
        expectedParity: "unsafe",
      },
    ];
    let calls = 0;

    const report = await runRustGatewayParityReplay({
      fixtures,
      transport: async () => {
        calls += 1;
        return frame("never", true, {});
      },
    });

    expect(calls).toBe(0);
    expect(report.totals).toEqual({ passed: 0, failed: 0, skipped: 1 });
    expect(report.results[0]?.notes.join(" ")).toContain("blocked unsafe replay");
  });

  it("fails exact fixtures when payloads drift", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "exact-health",
        method: "health",
        safety: "read-only",
        expectedParity: "exact",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, { status: endpoint });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals.failed).toBe(1);
    expect(report.results[0]?.observedParity).toBe("failed");
    expect(report.results[0]?.notes).toContain("payload/exact: node/rust payloads differ");
  });

  it("fails invalid response frames", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "bad-frame",
        method: "health",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node" ? frame(endpoint, true, {}) : { type: "event", event: "health" };

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.results[0]?.status).toBe("failed");
    expect(report.results[0]?.notes.join(" ")).toContain("envelope/rust invalid");
  });

  it("records transport errors as fixture failures instead of aborting the report", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "timeout",
        method: "status",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) => {
      if (endpoint === "rust") {
        throw new Error("timeout waiting for websocket message");
      }
      return frame(endpoint, true, {});
    };

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 0, failed: 1, skipped: 0 });
    expect(report.results[0]?.notes).toEqual([
      "transport/rust: Error: timeout waiting for websocket message",
    ]);
  });
});
