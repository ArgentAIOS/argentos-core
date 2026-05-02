import { describe, expect, it } from "vitest";
import type { RustGatewayParityReplayReport } from "./rust-gateway-parity-runner.js";
import {
  buildRustGatewayPromotionReadinessSummary,
  evaluateRustGatewayPromotionReadiness,
  groupRustGatewayParityResults,
  renderRustGatewayParityReplayMarkdown,
} from "./rust-gateway-parity-report.js";

const passingReport: RustGatewayParityReplayReport = {
  generatedAtMs: Date.UTC(2026, 3, 30, 12, 0, 0),
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
      notes: ["schema/envelope: response envelopes are compatible"],
    },
  ],
};

describe("evaluateRustGatewayPromotionReadiness", () => {
  it("marks a fully compatible report ready", () => {
    expect(evaluateRustGatewayPromotionReadiness(passingReport)).toEqual({
      ready: true,
      blockers: [],
      warnings: [],
    });
  });

  it("blocks failed and unexpectedly skipped fixtures", () => {
    const report: RustGatewayParityReplayReport = {
      generatedAtMs: 0,
      totals: { passed: 0, failed: 1, skipped: 1 },
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
        {
          fixtureId: "sessions",
          method: "sessions.list",
          safety: "read-only",
          expectedParity: "schema-compatible",
          observedParity: "skipped",
          status: "skipped",
          nodeOk: null,
          rustOk: null,
          notes: ["not wired"],
        },
      ],
    };

    const readiness = evaluateRustGatewayPromotionReadiness(report);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual([
      "status: status failed parity replay",
      "sessions: sessions.list was skipped unexpectedly",
    ]);
  });

  it("warns when results are mock-compatible or unsupported", () => {
    const report: RustGatewayParityReplayReport = {
      generatedAtMs: 0,
      totals: { passed: 2, failed: 0, skipped: 0 },
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
        {
          fixtureId: "unknown",
          method: "unknown.method",
          safety: "read-only",
          expectedParity: "unsupported",
          observedParity: "unsupported",
          status: "passed",
          nodeOk: false,
          rustOk: false,
          notes: ["unsupported"],
        },
      ],
    };

    const readiness = evaluateRustGatewayPromotionReadiness(report);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.warnings).toEqual([
      "channels: mock-compatible result is not promotion evidence",
      "unknown: unsupported surface still needs an explicit owner",
    ]);
  });
});

describe("buildRustGatewayPromotionReadinessSummary", () => {
  it("renders a compact machine-readable readiness summary", () => {
    const summary = buildRustGatewayPromotionReadinessSummary(passingReport);

    expect(summary).toMatchObject({
      generatedAtMs: passingReport.generatedAtMs,
      promotionReady: true,
      totals: { passed: 1, failed: 0, skipped: 0 },
      counts: {
        promotionBlockers: 0,
        mockOnly: 0,
        unsupported: 0,
        unsafeBlocked: 0,
        cleanEvidence: 1,
        blockers: 0,
        warnings: 0,
      },
      authority: {
        liveGateway: "node",
        rustGateway: "shadow-only",
        scheduler: "node",
        workflows: "node",
        channels: "node",
      },
    });
    expect(summary.fixtureIds.cleanEvidence).toEqual(["health"]);
    expect(summary.gates).toContainEqual({
      id: "isolated-parity-report",
      status: "passed",
      reason: "isolated Node-vs-Rust replay completed without failed fixtures",
    });
    expect(summary.gates.find((gate) => gate.id === "rollback-to-node")?.status).toBe("not-run");
    expect(summary.nextRequiredGates).toContain("rollback-to-node");
  });
});

describe("renderRustGatewayParityReplayMarkdown", () => {
  it("groups promotion blockers, mock-only results, unsupported surfaces, unsafe skips, and clean evidence", () => {
    const report: RustGatewayParityReplayReport = {
      generatedAtMs: Date.UTC(2026, 3, 30, 12, 0, 0),
      totals: { passed: 3, failed: 1, skipped: 1 },
      results: [
        {
          fixtureId: "connect",
          method: "connect",
          safety: "read-only",
          expectedParity: "schema-compatible",
          observedParity: "schema-compatible",
          status: "passed",
          nodeOk: true,
          rustOk: true,
          notes: ["schema/envelope: response envelopes are compatible"],
        },
        {
          fixtureId: "status",
          method: "status",
          safety: "read-only",
          expectedParity: "mock-compatible",
          observedParity: "mock-compatible",
          status: "passed",
          nodeOk: true,
          rustOk: true,
          notes: ["shape only"],
        },
        {
          fixtureId: "workflows-list",
          method: "workflows.list",
          safety: "read-only",
          expectedParity: "unsupported",
          observedParity: "unsupported",
          status: "passed",
          nodeOk: false,
          rustOk: false,
          notes: ["unsupported"],
        },
        {
          fixtureId: "chat-send",
          method: "chat.send",
          safety: "unsafe",
          expectedParity: "unsafe",
          observedParity: "skipped",
          status: "skipped",
          nodeOk: null,
          rustOk: null,
          notes: ["blocked unsafe replay"],
        },
        {
          fixtureId: "health",
          method: "health",
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

    const groups = groupRustGatewayParityResults(report);
    expect(groups.promotionBlockers.map((result) => result.fixtureId)).toEqual(["health"]);
    expect(groups.mockOnly.map((result) => result.fixtureId)).toEqual(["status"]);
    expect(groups.unsupported.map((result) => result.fixtureId)).toEqual(["workflows-list"]);
    expect(groups.unsafeBlocked.map((result) => result.fixtureId)).toEqual(["chat-send"]);
    expect(groups.cleanEvidence.map((result) => result.fixtureId)).toEqual(["connect"]);
  });

  it("renders a compact operator-facing report", () => {
    const markdown = renderRustGatewayParityReplayMarkdown(passingReport);

    expect(markdown).toContain("# Rust Gateway Parity Replay Report");
    expect(markdown).toContain("Totals: 1 passed, 0 failed, 0 skipped");
    expect(markdown).toContain("Promotion readiness: ready");
    expect(markdown).toContain("## Promotion Blockers");
    expect(markdown).toContain("## Mock-Compatible Non-Evidence");
    expect(markdown).toContain("## Unsupported Surfaces");
    expect(markdown).toContain("## Unsafe Blocked Fixtures");
    expect(markdown).toContain("## Clean Parity Evidence");
    expect(markdown).toContain("| health | health | read-only | schema-compatible |");
  });
});
