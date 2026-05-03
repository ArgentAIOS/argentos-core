import { describe, expect, it, vi } from "vitest";
import {
  collectGatewayAuthorityDisposableLoopbackRehearsal,
  collectGatewayAuthorityDisposableLoopbackSmoke,
  gatewayAuthorityLocalSmokeCommand,
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
    expect(parsed.nextCommands).toContain(
      "pnpm rust-gateway:parity:report -- --startup-timeout-ms 60000 --request-timeout-ms 10000",
    );
    expect(parsed.nextCommands).toContain(
      "argent gateway authority smoke-local --reason <reason> --confirm-local-only --installed-canary-url ws://127.0.0.1:<port> --installed-canary-token <token> --json",
    );
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

  it("blocks non-loopback installed daemon canary URLs before querying", async () => {
    const requestStatus = vi.fn();

    const summary = await gatewayAuthorityStatusCommand(
      { log: () => undefined },
      {
        installedCanary: {
          url: "wss://gateway.example.com",
          token: "test-token",
          requestStatus,
        },
      },
    );

    expect(requestStatus).not.toHaveBeenCalled();
    expect(summary.installedDaemonCanary).toMatchObject({
      status: "blocked",
      configured: true,
      queried: false,
      url: "wss://gateway.example.com",
      productionTrafficUsed: false,
      canaryFlagEnabled: false,
      authoritySwitchAllowed: false,
    });
    expect(summary.installedDaemonCanary.blockers.join("\n")).toContain("loopback/local");
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

  it("blocks local smoke by default with exact operator guidance", async () => {
    const logs: string[] = [];
    const requestStatus = vi.fn();

    const smoke = await gatewayAuthorityLocalSmokeCommand(
      { log: (line) => logs.push(line) },
      {
        reason: "dev.20 local smoke",
        installedCanary: {
          requestStatus,
        },
      },
    );

    expect(requestStatus).not.toHaveBeenCalled();
    expect(smoke.status).toBe("blocked");
    expect(smoke.authorityChanges).toEqual([]);
    expect(smoke.authoritySwitchAllowed).toBe(false);
    expect(smoke.liveProductionTrafficAllowed).toBe(false);
    expect(smoke.installedDaemonCanary).toMatchObject({
      status: "not-configured",
      configured: false,
      queried: false,
      productionTrafficUsed: false,
      authoritySwitchAllowed: false,
    });
    expect(smoke.blockers).toContain("explicit local-only smoke opt-in is required");
    expect(smoke.blockers).toContain("installed daemon canary status is not configured");
    expect(smoke.operatorGuidance.join("\n")).toContain("--installed-canary-url");
    expect(logs.join("\n")).toContain("Gateway authority local smoke");
    expect(logs.join("\n")).toContain("Status: blocked");
    expect(logs.join("\n")).toContain("Authority changes: none");
  });

  it("passes local smoke only when canary receipts prove no authority switch", async () => {
    const requestStatus = vi.fn().mockResolvedValue({
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

    const smoke = await gatewayAuthorityLocalSmokeCommand(
      { log: () => undefined },
      {
        reason: "dev.20 local smoke",
        confirmLocalOnly: true,
        json: true,
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
    expect(smoke.status).toBe("passed");
    expect(smoke.explicitOptIn).toBe(true);
    expect(smoke.noDefaultSwitchProof).toMatchObject({
      liveGatewayAuthority: "node",
      rustGatewayAuthority: "shadow-only",
      schedulerAuthority: "node",
      workflowAuthority: "node",
      channelAuthority: "node",
      sessionAuthority: "node",
      runAuthority: "node",
    });
    expect(smoke.installedDaemonCanary).toMatchObject({
      status: "ok",
      queried: true,
      productionTrafficUsed: false,
      canaryFlagEnabled: true,
      authoritySwitchAllowed: false,
      receiptCount: 2,
      redactionVerified: true,
      denialReceiptPresent: true,
      duplicatePreventionReceiptPresent: true,
    });
    expect(smoke.blockers).toEqual([]);
    expect(smoke.operatorGuidance.join("\n")).toContain("PASS");
    expect(smoke.proof).toContain(
      "smoke does not start, stop, restart, install, or configure any daemon",
    );
  });

  it("passes local smoke with the built-in local canary self-check without daemon credentials", async () => {
    const smoke = await gatewayAuthorityLocalSmokeCommand(
      { log: () => undefined },
      {
        reason: "dev.23 local canary self-check",
        confirmLocalOnly: true,
        localCanarySelfCheck: true,
        json: true,
      },
    );

    expect(smoke.status).toBe("passed");
    expect(smoke.installedDaemonCanary).toMatchObject({
      status: "ok",
      configured: true,
      queried: true,
      url: "local-canary-self-check://rust-gateway/smoke-local",
      productionTrafficUsed: false,
      canaryFlagEnabled: true,
      authoritySwitchAllowed: false,
      receiptCount: 6,
      redactionVerified: true,
      denialReceiptPresent: true,
      duplicatePreventionReceiptPresent: true,
      receiptSurfaces: ["chat.send", "cron.add", "workflows.run"],
    });
    expect(smoke.blockers).toEqual([]);
    expect(smoke.proof.join("\n")).toContain("in-process disposable canary receipt harness");
  });

  it("blocks disposable loopback smoke without explicit local-only opt-in", async () => {
    const smoke = await collectGatewayAuthorityDisposableLoopbackSmoke({
      reason: "missing opt-in",
      confirmLocalOnly: false,
    });

    expect(smoke.status).toBe("blocked");
    expect(smoke.disposableHarness.started).toBe(false);
    expect(smoke.disposableHarness.installedServiceControlUsed).toBe(false);
    expect(smoke.blockers).toContain("explicit local-only loopback smoke opt-in is required");
  });

  it("blocks disposable loopback rehearsal without explicit local-only opt-in", async () => {
    const rehearsal = await collectGatewayAuthorityDisposableLoopbackRehearsal({
      reason: "missing opt-in",
      confirmLocalOnly: false,
    });

    expect(rehearsal.status).toBe("blocked");
    expect(rehearsal.disposableHarness.started).toBe(false);
    expect(rehearsal.rollback.authorityChanges).toEqual([]);
    expect(rehearsal.authoritySwitchAllowed).toBe(false);
    expect(rehearsal.blockers).toContain(
      "explicit local-only loopback rehearsal opt-in is required",
    );
  });

  it("proves disposable loopback smoke with temp state and redacted receipts", async () => {
    const close = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const startEnv: Record<string, string | undefined> = {};
    const calls: Array<{ method: string; params?: unknown }> = [];
    const callGateway = vi.fn(async (request: { method: string; params?: unknown }) => {
      calls.push(request);
      if (request.method === "rustGateway.canaryReceipts.status") {
        return {
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
            ...["chat.send", "cron.add", "workflows.run"].map((surface) => ({
              surface,
              receiptCode: "RUST_CANARY_DENIED",
              tokenMaterialRedacted: true,
              authoritySwitchAllowed: false,
              mutationBlockedBeforeHandler: true,
            })),
            ...["chat.send", "cron.add", "workflows.run"].map((surface) => ({
              surface,
              receiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
              tokenMaterialRedacted: true,
              authoritySwitchAllowed: false,
              mutationBlockedBeforeHandler: true,
            })),
          ],
        };
      }
      throw new Error("Rust canary denied before mutation");
    });

    const smoke = await collectGatewayAuthorityDisposableLoopbackSmoke({
      reason: "disposable loopback proof",
      confirmLocalOnly: true,
      dependencies: {
        mkdtemp: async () => "/tmp/rust-gateway-loopback-test",
        rm: vi.fn(async () => undefined),
        mkdir,
        writeFile,
        getFreePort: async () => 19876,
        randomToken: () => "random-loopback-token",
        startGateway: vi.fn(async () => {
          startEnv.ARGENT_SKIP_PLUGINS = process.env.ARGENT_SKIP_PLUGINS;
          startEnv.ARGENT_CONFIG_PATH = process.env.ARGENT_CONFIG_PATH;
          return { close } as never;
        }),
        callGateway: callGateway as never,
      },
    });

    expect(smoke.status).toBe("passed");
    expect(mkdir).toHaveBeenCalledWith("/tmp/rust-gateway-loopback-test/.argentos");
    expect(writeFile.mock.calls[0]?.[0]).toBe(
      "/tmp/rust-gateway-loopback-test/.argentos/argent.json",
    );
    expect(writeFile.mock.calls[0]?.[1]).toContain('"enabled": false');
    expect(startEnv.ARGENT_SKIP_PLUGINS).toBe("1");
    expect(startEnv.ARGENT_CONFIG_PATH).toBe(
      "/tmp/rust-gateway-loopback-test/.argentos/argent.json",
    );
    expect(smoke.disposableHarness).toMatchObject({
      started: true,
      url: "ws://127.0.0.1:19876",
      tempHomeUsed: true,
      tempStateUsed: true,
      randomPortUsed: true,
      randomTokenUsed: true,
      installedServiceControlUsed: false,
      productionTrafficUsed: false,
      authoritySwitchAllowed: false,
    });
    expect(smoke.receiptProof).toMatchObject({
      generatedSurfaces: ["chat.send", "cron.add", "workflows.run"],
      denialReceiptPresent: true,
      duplicatePreventionReceiptPresent: true,
      redactionVerified: true,
      receiptCount: 6,
    });
    expect(calls.filter((call) => call.method === "chat.send")).toHaveLength(2);
    expect(calls.filter((call) => call.method === "cron.add")).toHaveLength(2);
    expect(calls.filter((call) => call.method === "workflows.run")).toHaveLength(2);
    expect(close).toHaveBeenCalledWith({
      reason: "disposable loopback canary smoke complete",
    });
  });

  it("rehearses disposable loopback before/after canary with rollback proof", async () => {
    const close = vi.fn(async () => undefined);
    const callGateway = vi.fn(async (request: { method: string; params?: unknown }) => {
      if (request.method === "rustGateway.canaryReceipts.status") {
        const canaryEnabled = process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS === "1";
        const receipts = canaryEnabled
          ? [
              ...["chat.send", "cron.add", "workflows.run"].map((surface) => ({
                surface,
                receiptCode: "RUST_CANARY_DENIED",
                tokenMaterialRedacted: true,
                authoritySwitchAllowed: false,
                mutationBlockedBeforeHandler: true,
              })),
              ...["chat.send", "cron.add", "workflows.run"].map((surface) => ({
                surface,
                receiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
                tokenMaterialRedacted: true,
                authoritySwitchAllowed: false,
                mutationBlockedBeforeHandler: true,
              })),
            ]
          : [];
        return {
          status: "ok",
          dashboardVisible: true,
          productionTrafficUsed: false,
          canaryFlagEnabled: canaryEnabled,
          policy: { containsSecrets: false },
          authority: {
            nodeAuthority: "live",
            rustAuthority: "shadow-only",
            authoritySwitchAllowed: false,
          },
          receipts,
        };
      }
      throw new Error("Rust canary denied before mutation");
    });

    const rehearsal = await collectGatewayAuthorityDisposableLoopbackRehearsal({
      reason: "local rollback proof",
      confirmLocalOnly: true,
      dependencies: {
        mkdtemp: async () => "/tmp/rust-gateway-loopback-rehearsal-test",
        rm: vi.fn(async () => undefined),
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async () => undefined),
        getFreePort: async () => 19877,
        randomToken: () => "random-loopback-rehearsal-token",
        startGateway: vi.fn(async () => ({ close }) as never),
        callGateway: callGateway as never,
      },
    });

    expect(rehearsal.status).toBe("rehearsed");
    expect(rehearsal.before).toMatchObject({
      status: "ok",
      canaryFlagEnabled: false,
      productionTrafficUsed: false,
      authoritySwitchAllowed: false,
    });
    expect(rehearsal.after).toMatchObject({
      status: "ok",
      canaryFlagEnabled: true,
      productionTrafficUsed: false,
      authoritySwitchAllowed: false,
      receiptCount: 6,
      redactionVerified: true,
      denialReceiptPresent: true,
      duplicatePreventionReceiptPresent: true,
    });
    expect(rehearsal.rollback).toMatchObject({
      mode: "read-only-plan",
      executable: false,
      authorityChanges: [],
    });
    expect(rehearsal.receiptProof.generatedSurfaces).toEqual([
      "chat.send",
      "cron.add",
      "workflows.run",
    ]);
    expect(rehearsal.authorityChanges).toEqual([]);
    expect(rehearsal.authoritySwitchAllowed).toBe(false);
    expect(rehearsal.blockers).toEqual([]);
    expect(close).toHaveBeenCalledWith({
      reason: "disposable loopback rehearsal complete",
    });
  });

  it("blocks local smoke against non-loopback daemon URLs before querying", async () => {
    const requestStatus = vi.fn();

    const smoke = await gatewayAuthorityLocalSmokeCommand(
      { log: () => undefined },
      {
        reason: "installed loopback boundary",
        confirmLocalOnly: true,
        installedCanary: {
          url: "wss://gateway.example.com",
          token: "test-token",
          requestStatus,
        },
      },
    );

    expect(requestStatus).not.toHaveBeenCalled();
    expect(smoke.status).toBe("blocked");
    expect(smoke.installedDaemonCanary).toMatchObject({
      status: "blocked",
      configured: true,
      queried: false,
      productionTrafficUsed: false,
      authoritySwitchAllowed: false,
    });
    expect(smoke.blockers).toContain("installed daemon canary status was not queried");
    expect(smoke.operatorGuidance.join("\n")).toContain("loopback");
  });

  it("blocks local smoke when duplicate-prevention receipt proof is missing", async () => {
    const requestStatus = vi.fn().mockResolvedValue({
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
          surface: "cron.add",
          receiptCode: "RUST_CANARY_DENIED",
          tokenMaterialRedacted: true,
          authoritySwitchAllowed: false,
        },
      ],
    });

    const smoke = await gatewayAuthorityLocalSmokeCommand(
      { log: () => undefined },
      {
        reason: "dev.23 local smoke",
        confirmLocalOnly: true,
        installedCanary: {
          url: "ws://127.0.0.1:18789",
          token: "test-token",
          requestStatus,
        },
      },
    );

    expect(smoke.status).toBe("blocked");
    expect(smoke.installedDaemonCanary.status).toBe("ok");
    expect(smoke.blockers).toContain("RUST_CANARY_DUPLICATE_PREVENTED receipt must be present");
  });

  it("blocks local smoke when canary status implies production traffic or authority switch", async () => {
    const requestStatus = vi.fn().mockResolvedValue({
      status: "ok",
      dashboardVisible: true,
      productionTrafficUsed: true,
      canaryFlagEnabled: true,
      policy: { containsSecrets: false },
      authority: { authoritySwitchAllowed: true },
      receipts: [
        {
          surface: "chat.send",
          receiptCode: "RUST_CANARY_DENIED",
          tokenMaterialRedacted: true,
        },
        {
          surface: "chat.send",
          receiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
          tokenMaterialRedacted: true,
        },
      ],
    });

    const smoke = await gatewayAuthorityLocalSmokeCommand(
      { log: () => undefined },
      {
        reason: "dev.20 local smoke",
        confirmLocalOnly: true,
        installedCanary: {
          url: "ws://127.0.0.1:18789",
          token: "test-token",
          requestStatus,
        },
      },
    );

    expect(smoke.status).toBe("blocked");
    expect(smoke.installedDaemonCanary.status).toBe("unsafe");
    expect(smoke.blockers).toEqual(
      expect.arrayContaining([
        "installed daemon canary status must be ok; got unsafe",
        "productionTrafficUsed must be false",
        "authoritySwitchAllowed must be false",
      ]),
    );
    expect(smoke.authoritySwitchAllowed).toBe(false);
    expect(smoke.authorityChanges).toEqual([]);
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
