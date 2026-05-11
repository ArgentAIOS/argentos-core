import { describe, expect, it } from "vitest";
import { getRustGatewayParityReportStatus } from "./status.rust-gateway-parity-report.js";

const generatedAtMs = Date.UTC(2026, 3, 30, 12, 0, 0);

function reportJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    generatedAtMs,
    totals: { passed: 10, failed: 0, skipped: 3 },
    results: [
      {
        fixtureId: "rpc-status",
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
        fixtureId: "rpc-chat-send",
        method: "chat.send",
        safety: "unsafe",
        expectedParity: "unsafe",
        observedParity: "skipped",
        status: "skipped",
        nodeOk: null,
        rustOk: null,
        notes: ["blocked unsafe replay"],
      },
    ],
    ...overrides,
  });
}

describe("getRustGatewayParityReportStatus", () => {
  it("returns missing when the latest report is absent", async () => {
    const status = await getRustGatewayParityReportStatus({
      cwd: "/repo",
      readFile: async () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });

    expect(status.freshness).toBe("missing");
    expect(status.path).toBe(
      "/repo/.omx/state/rust-gateway-parity/latest/rust-gateway-parity-report.json",
    );
    expect(status.totals).toBeNull();
  });

  it("summarizes a fresh report and keeps mock-compatible warnings out of readiness", async () => {
    const status = await getRustGatewayParityReportStatus({
      reportPath: "/tmp/report.json",
      nowMs: () => generatedAtMs + 1_000,
      readFile: async () => reportJson(),
    });

    expect(status).toMatchObject({
      path: "/tmp/report.json",
      freshness: "fresh",
      generatedAtMs,
      ageMs: 1_000,
      totals: { passed: 10, failed: 0, skipped: 3 },
      promotionReady: false,
      blockers: 0,
      warnings: 1,
      error: null,
    });
  });

  it("marks old reports as stale", async () => {
    const status = await getRustGatewayParityReportStatus({
      reportPath: "/tmp/report.json",
      nowMs: () => generatedAtMs + 25 * 60 * 60 * 1000,
      readFile: async () => reportJson(),
    });

    expect(status.freshness).toBe("stale");
  });

  it("uses stored readiness counts when reports include them", async () => {
    const status = await getRustGatewayParityReportStatus({
      reportPath: "/tmp/report.json",
      nowMs: () => generatedAtMs + 1_000,
      readFile: async () =>
        reportJson({
          readiness: {
            ready: false,
            blockers: ["one"],
            warnings: ["two", "three"],
          },
        }),
    });

    expect(status.blockers).toBe(1);
    expect(status.warnings).toBe(2);
    expect(status.promotionReady).toBe(false);
  });

  it("treats malformed reports as invalid", async () => {
    const status = await getRustGatewayParityReportStatus({
      reportPath: "/tmp/report.json",
      readFile: async () => "{ nope",
    });

    expect(status.freshness).toBe("invalid");
    expect(status.error).toBeTruthy();
  });
});
