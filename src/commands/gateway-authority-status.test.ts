import { describe, expect, it, vi } from "vitest";
import {
  gatewayAuthorityLocalRehearsalCommand,
  gatewayAuthorityRollbackPlanCommand,
  gatewayAuthorityStatusCommand,
} from "./gateway-authority-status.js";

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
    expect(summary.sessionAuthority).toBe("node");
    expect(summary.runAuthority).toBe("node");
    expect(summary.promotionReady).toBe(false);
    expect(summary.authorityBoundaries.rustMustNotOwn).toContain("workflow execution");
    expect(summary.promotionGates.find((gate) => gate.id === "parity-report")).toMatchObject({
      status: "passing",
    });
    expect(summary.promotionGates.find((gate) => gate.id === "promotion-readiness")).toMatchObject({
      status: "blocked",
    });
    expect(logs.join("\n")).toContain("Live gateway authority: node");
    expect(logs.join("\n")).toContain("Session authority: node");
    expect(logs.join("\n")).toContain("Run authority: node");
    expect(logs.join("\n")).toContain("Rollback command: planned, not implemented");
  });

  it("prints JSON authority status", async () => {
    const logs: string[] = [];

    await gatewayAuthorityStatusCommand({ log: (line) => logs.push(line) }, { json: true });

    const parsed = JSON.parse(logs[0] ?? "{}");
    expect(parsed.liveGatewayAuthority).toBe("node");
    expect(parsed.authorityBoundaries.rustMode).toBe("shadow-only");
    expect(parsed.promotionGates.map((gate: { id: string }) => gate.id)).toContain(
      "rollback-rehearsal",
    );
    expect(parsed.rollbackCommand.implemented).toBe(false);
    expect(parsed.installedDaemonCanary.status).toBe("not-configured");
    expect(parsed.installedDaemonCanary.queried).toBe(false);
    expect(parsed.installedDaemonCanary.productionTrafficUsed).toBe(false);
    expect(parsed.installedDaemonCanary.authoritySwitchAllowed).toBe(false);
  });

  it("keeps installed daemon canary status blocked without explicit credentials", async () => {
    const logs: string[] = [];
    const requestStatus = vi.fn();

    const summary = await gatewayAuthorityStatusCommand(
      { log: (line) => logs.push(line) },
      {
        json: true,
        installedCanary: {
          url: "ws://127.0.0.1:18789",
          requestStatus,
        },
      },
    );

    expect(requestStatus).not.toHaveBeenCalled();
    expect(summary.installedDaemonCanary).toMatchObject({
      status: "blocked",
      configured: true,
      queried: false,
      productionTrafficUsed: false,
      canaryFlagEnabled: false,
      authoritySwitchAllowed: false,
    });
    expect(summary.installedDaemonCanary.blockers.join("\n")).toContain("explicit");
  });

  it("reports installed daemon canary status unavailable without enabling traffic", async () => {
    const requestStatus = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const summary = await gatewayAuthorityStatusCommand(
      { log: () => undefined },
      {
        installedCanary: {
          url: "ws://127.0.0.1:18789",
          token: "test-token",
          requestStatus,
        },
      },
    );

    expect(requestStatus).toHaveBeenCalledWith({
      url: "ws://127.0.0.1:18789",
      token: "test-token",
      password: undefined,
      timeoutMs: 3000,
    });
    expect(summary.installedDaemonCanary).toMatchObject({
      status: "unavailable",
      queried: true,
      productionTrafficUsed: false,
      authoritySwitchAllowed: false,
      error: "ECONNREFUSED",
    });
  });

  it("accepts redacted installed daemon canary status with no production traffic or authority switch", async () => {
    const requestStatus = vi.fn().mockResolvedValue({
      status: "ok",
      dashboardVisible: true,
      productionTrafficUsed: false,
      canaryFlagEnabled: false,
      policy: {
        containsSecrets: false,
      },
      authority: {
        nodeAuthority: "live",
        rustAuthority: "shadow-only",
        authoritySwitchAllowed: false,
      },
      receipts: [
        {
          surface: "chat.send",
          receiptCode: "RUST_CANARY_DENIED",
          tokenMaterialRedacted: true,
          authoritySwitchAllowed: false,
        },
      ],
    });

    const summary = await gatewayAuthorityStatusCommand(
      { log: () => undefined },
      {
        installedCanary: {
          url: "ws://127.0.0.1:18789",
          token: "test-token",
          timeoutMs: 1250,
          requestStatus,
        },
      },
    );

    expect(requestStatus).toHaveBeenCalledWith({
      url: "ws://127.0.0.1:18789",
      token: "test-token",
      password: undefined,
      timeoutMs: 1250,
    });
    expect(summary.installedDaemonCanary).toMatchObject({
      status: "ok",
      queried: true,
      productionTrafficUsed: false,
      canaryFlagEnabled: false,
      authoritySwitchAllowed: false,
      dashboardVisible: true,
      receiptCount: 1,
      redactionVerified: true,
      blockers: [],
    });
  });

  it("marks unsafe installed daemon canary payloads without relabeling readiness", async () => {
    const requestStatus = vi.fn().mockResolvedValue({
      status: "ok",
      productionTrafficUsed: true,
      canaryFlagEnabled: true,
      policy: {
        containsSecrets: false,
      },
      authority: {
        authoritySwitchAllowed: true,
      },
      receipts: [
        {
          surface: "workflows.run",
          receiptCode: "RUST_CANARY_DENIED",
          tokenMaterialRedacted: false,
        },
      ],
    });

    const summary = await gatewayAuthorityStatusCommand(
      { log: () => undefined },
      {
        installedCanary: {
          url: "ws://127.0.0.1:18789",
          token: "test-token",
          requestStatus,
        },
      },
    );

    expect(summary.installedDaemonCanary.status).toBe("unsafe");
    expect(summary.installedDaemonCanary.productionTrafficUsed).toBe(true);
    expect(summary.installedDaemonCanary.authoritySwitchAllowed).toBe(true);
    expect(summary.installedDaemonCanary.redactionVerified).toBe(false);
    expect(summary.promotionReady).toBe(false);
    expect(summary.installedDaemonCanary.blockers).toEqual(
      expect.arrayContaining([
        "productionTrafficUsed is not false",
        "authoritySwitchAllowed is not false",
        "one or more receipts are not marked redacted",
      ]),
    );
  });

  it("blocks local authority rehearsal without explicit opt-in", async () => {
    const beforeStatus = vi.fn().mockResolvedValue({
      status: "ok",
      dashboardVisible: true,
      productionTrafficUsed: false,
      canaryFlagEnabled: false,
      policy: { containsSecrets: false },
      authority: { authoritySwitchAllowed: false },
      receipts: [],
    });
    const afterStatus = vi.fn();

    const rehearsal = await gatewayAuthorityLocalRehearsalCommand(
      { log: () => undefined },
      {
        reason: "local proof",
        beforeCanary: {
          url: "ws://127.0.0.1:18789",
          token: "test-token",
          requestStatus: beforeStatus,
        },
        afterCanary: {
          url: "ws://127.0.0.1:18789",
          token: "test-token",
          requestStatus: afterStatus,
        },
      },
    );

    expect(beforeStatus).toHaveBeenCalledTimes(1);
    expect(afterStatus).not.toHaveBeenCalled();
    expect(rehearsal.status).toBe("blocked");
    expect(rehearsal.explicitOptIn).toBe(false);
    expect(rehearsal.authorityChanges).toEqual([]);
    expect(rehearsal.authoritySwitchAllowed).toBe(false);
    expect(rehearsal.blockers).toContain("explicit local-only rehearsal opt-in is required");
  });

  it("rehearses local-only canary enable and rollback evidence without authority changes", async () => {
    const beforeStatus = vi.fn().mockResolvedValue({
      status: "ok",
      dashboardVisible: true,
      productionTrafficUsed: false,
      canaryFlagEnabled: false,
      policy: { containsSecrets: false },
      authority: { authoritySwitchAllowed: false },
      receipts: [],
    });
    const afterStatus = vi.fn().mockResolvedValue({
      status: "ok",
      dashboardVisible: true,
      productionTrafficUsed: false,
      canaryFlagEnabled: true,
      policy: { containsSecrets: false },
      authority: {
        nodeAuthority: "live",
        rustAuthority: "shadow-only",
        authoritySwitchAllowed: false,
      },
      receipts: [
        {
          surface: "chat.send",
          receiptCode: "RUST_CANARY_DENIED",
          tokenMaterialRedacted: true,
          authoritySwitchAllowed: false,
        },
        {
          surface: "chat.send",
          receiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
          tokenMaterialRedacted: true,
          authoritySwitchAllowed: false,
        },
      ],
    });

    const rehearsal = await gatewayAuthorityLocalRehearsalCommand(
      { log: () => undefined },
      {
        reason: "local proof",
        confirmLocalOnly: true,
        beforeCanary: {
          url: "ws://127.0.0.1:18789",
          token: "test-token",
          requestStatus: beforeStatus,
        },
        afterCanary: {
          url: "ws://127.0.0.1:18789",
          token: "test-token",
          requestStatus: afterStatus,
        },
      },
    );

    expect(rehearsal.status).toBe("rehearsed");
    expect(rehearsal.before.canaryFlagEnabled).toBe(false);
    expect(rehearsal.after.canaryFlagEnabled).toBe(true);
    expect(rehearsal.after.productionTrafficUsed).toBe(false);
    expect(rehearsal.after.authoritySwitchAllowed).toBe(false);
    expect(rehearsal.after.redactionVerified).toBe(true);
    expect(rehearsal.after.receiptCount).toBe(2);
    expect(rehearsal.rollback.authorityChanges).toEqual([]);
    expect(rehearsal.rollback.executable).toBe(false);
    expect(rehearsal.duplicateReceiptSafety.requiredReceipts).toEqual([
      "RUST_CANARY_DENIED",
      "RUST_CANARY_DUPLICATE_PREVENTED",
    ]);
    expect(rehearsal.blockers).toEqual([]);
  });

  it("prints read-only rollback plan without authority changes", async () => {
    const logs: string[] = [];

    const plan = await gatewayAuthorityRollbackPlanCommand(
      { log: (line) => logs.push(line) },
      { reason: "canary drift", json: false },
    );

    expect(plan.mode).toBe("read-only-plan");
    expect(plan.executable).toBe(false);
    expect(plan.authorityChanges).toEqual([]);
    expect(plan.currentAuthority.liveGateway).toBe("node");
    expect(plan.currentAuthority.rustGateway).toBe("shadow-only");
    expect(plan.blockedActions).toContain("Does not edit config or authority state.");
    expect(logs.join("\n")).toContain("Gateway authority rollback plan");
    expect(logs.join("\n")).toContain("Authority changes: none");
  });

  it("prints JSON rollback plan", async () => {
    const logs: string[] = [];

    await gatewayAuthorityRollbackPlanCommand(
      { log: (line) => logs.push(line) },
      { reason: "operator rehearsal", json: true },
    );

    const parsed = JSON.parse(logs[0] ?? "{}");
    expect(parsed.mode).toBe("read-only-plan");
    expect(parsed.reason).toBe("operator rehearsal");
    expect(parsed.currentAuthority.sessions).toBe("node");
    expect(parsed.executable).toBe(false);
  });
});
