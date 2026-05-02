import { describe, expect, it, vi } from "vitest";
import { gatewayAuthorityStatusCommand } from "./gateway-authority-status.js";

vi.mock("./status.rust-gateway-shadow.js", () => ({
  getRustGatewayShadowSummary: vi.fn().mockResolvedValue({
    reachable: true,
    status: "ok",
    version: "0.1.0",
    uptimeSeconds: 10,
    component: "argentd",
    mode: "shadow",
    protocolVersion: 3,
    liveAuthority: "node",
    gatewayAuthority: "shadow-only",
    promotionReady: false,
    readinessReason: "shadow parity evidence incomplete",
    statePersistence: "memory-only",
    baseUrl: "http://127.0.0.1:18799",
    error: null,
  }),
}));

vi.mock("./status.rust-gateway-parity-report.js", () => ({
  getRustGatewayParityReportStatus: vi.fn().mockResolvedValue({
    path: "/tmp/rust-gateway-parity-report.json",
    freshness: "fresh",
    generatedAtMs: 1,
    ageMs: 100,
    totals: { passed: 15, failed: 0, skipped: 3 },
    promotionReady: false,
    blockers: 0,
    warnings: 11,
    error: null,
  }),
}));

vi.mock("./status.rust-gateway-scheduler-authority.js", () => ({
  getRustGatewaySchedulerAuthoritySummary: vi.fn().mockResolvedValue({
    schedulerAuthority: "node",
    rustSchedulerAuthority: "shadow-only",
    authorityRecord: "missing",
    cronEnabled: true,
    cronStorePath: "/tmp/cron/jobs.json",
    cronJobs: 2,
    enabledCronJobs: 1,
    workflowRunCronJobs: 1,
    nextWakeAtMs: null,
    notes: ["Node remains live scheduler authority."],
  }),
}));

describe("gatewayAuthorityStatusCommand", () => {
  it("prints read-only human authority status", async () => {
    const logs: string[] = [];

    const summary = await gatewayAuthorityStatusCommand({ log: (line) => logs.push(line) });

    expect(summary.liveGatewayAuthority).toBe("node");
    expect(summary.rustGatewayAuthority).toBe("shadow-only");
    expect(summary.promotionReady).toBe(false);
    expect(logs.join("\n")).toContain("Live gateway authority: node");
    expect(logs.join("\n")).toContain("Rollback command: planned, not implemented");
  });

  it("prints JSON authority status", async () => {
    const logs: string[] = [];

    await gatewayAuthorityStatusCommand({ log: (line) => logs.push(line) }, { json: true });

    const parsed = JSON.parse(logs[0] ?? "{}");
    expect(parsed.liveGatewayAuthority).toBe("node");
    expect(parsed.rollbackCommand.implemented).toBe(false);
  });
});
