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
      methodCoverage: {
        totalFixtureMethods: 1,
        promotionBlockers: [],
        mockOnly: [],
        unsupported: [],
        unsafeBlocked: [],
        cleanEvidence: ["health"],
        unproven: [],
        readOnlyUnproven: [],
        authorityBlocked: [],
        nextSafeFixtureCandidates: [],
      },
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
    expect(summary.canaryAndRollback).toMatchObject({
      mode: "read-only-plan",
      canaryAllowedSurfaces: ["health"],
      canaryBlockedSurfaces: [],
      rollbackCommand: "argent gateway authority rollback-node --reason <reason>",
      rollbackExecutable: false,
    });
    expect(summary.canaryAndRollback.requiredProofBeforeCanary).toContain(
      "fresh parity report has zero failures and no mock-only/unsupported warnings",
    );
    expect(summary.livePromotionGateDesign).toMatchObject({
      mode: "design-only",
      authoritySwitchAllowed: false,
    });
    expect(summary.livePromotionGateDesign.defaultOffConfigFlags).toEqual([
      expect.objectContaining({
        flag: "ARGENT_RUST_GATEWAY_CANARY",
        default: false,
      }),
      expect.objectContaining({
        flag: "ARGENT_RUST_SCHEDULER_CANARY",
        default: false,
      }),
      expect.objectContaining({
        flag: "ARGENT_RUST_WORKFLOW_CANARY",
        default: false,
      }),
      expect.objectContaining({
        flag: "ARGENT_RUST_AUTHORITY_PROMOTION",
        default: false,
      }),
    ]);
    expect(summary.livePromotionGateDesign.gates).toContainEqual(
      expect.objectContaining({
        surface: "authority-switch",
        status: "blocked",
        owner: "master-operator",
        requiredProof: expect.arrayContaining([
          "fresh parity report has zero failed, mock-compatible, or unsupported read-only fixtures",
          "explicit signed/recorded Master/operator promotion decision names affected authorities",
        ]),
      }),
    );
    expect(summary.shadowPromotionGateFixtures).toMatchObject({
      mode: "synthetic-read-only",
      liveTrafficAllowed: false,
      authoritySwitchAllowed: false,
      fixtures: [],
    });
    expect(summary.noLiveSafetyGateFixtures).toMatchObject({
      mode: "synthetic-read-only",
      liveTrafficAllowed: false,
      authoritySwitchAllowed: false,
      fixtures: [],
    });
    expect(summary.authoritySwitchChecklist).toMatchObject({
      status: "blocked",
      authoritySwitchAllowed: false,
      currentAuthority: {
        liveGateway: "node",
        rustGateway: "shadow-only",
        scheduler: "node",
        workflows: "node",
        channels: "node",
      },
      requiredBeforePromotion: expect.arrayContaining([
        "fresh parity report has zero failed, mock-compatible, or unsupported read-only fixtures",
        "chat.send, cron.add, and workflows.run canary gates have explicit Master/operator authorization",
        "token/auth role-scope parity proves rejected and expired-token behavior before live traffic",
      ]),
      requiredBeforeRollback: expect.arrayContaining([
        "Node fallback command is implemented, rehearsed, and included in the promotion packet",
      ]),
    });
    expect(summary.duplicatePrevention).toMatchObject({
      mode: "shadow-observation-only",
      status: "passed",
      coveredSurfaces: ["channel", "run", "session", "timer", "workflow"],
      missingSurfaces: [],
      conflicts: [],
    });
    expect(summary.gates).toContainEqual({
      id: "isolated-parity-report",
      status: "passed",
      reason: "isolated Node-vs-Rust replay completed without failed fixtures",
    });
    expect(summary.gates.find((gate) => gate.id === "duplicate-prevention")).toMatchObject({
      status: "passed",
    });
    expect(summary.gates.find((gate) => gate.id === "rollback-to-node")?.status).toBe("not-run");
    expect(summary.nextRequiredGates).toContain("rollback-to-node");
  });

  it("summarizes fixture method coverage by promotion evidence class", () => {
    const summary = buildRustGatewayPromotionReadinessSummary({
      generatedAtMs: 0,
      totals: { passed: 4, failed: 1, skipped: 1 },
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
          notes: [],
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
          notes: [],
        },
        {
          fixtureId: "workflow",
          method: "workflows.list",
          safety: "read-only",
          expectedParity: "unsupported",
          observedParity: "unsupported",
          status: "passed",
          nodeOk: false,
          rustOk: false,
          notes: [],
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
          notes: [],
        },
        {
          fixtureId: "broken",
          method: "sessions.list",
          safety: "read-only",
          expectedParity: "schema-compatible",
          observedParity: "failed",
          status: "failed",
          nodeOk: true,
          rustOk: false,
          notes: [],
        },
      ],
    });

    expect(summary.methodCoverage).toEqual({
      totalFixtureMethods: 5,
      promotionBlockers: ["sessions.list"],
      mockOnly: ["status"],
      unsupported: ["workflows.list"],
      unsafeBlocked: ["chat.send"],
      cleanEvidence: ["health"],
      unproven: ["chat.send", "sessions.list", "status", "workflows.list"],
      readOnlyUnproven: ["status", "workflows.list"],
      authorityBlocked: ["chat.send"],
      nextSafeFixtureCandidates: [
        {
          method: "status",
          currentEvidence: "mock-compatible",
          recommendation: "replace synthetic success with a schema-compatible read-only fixture",
        },
        {
          method: "workflows.list",
          currentEvidence: "unsupported",
          recommendation:
            "assign owner and add a schema-compatible read-only fixture or explicit de-scope",
        },
      ],
    });
    expect(summary.canaryAndRollback.canaryAllowedSurfaces).toEqual(["health"]);
    expect(summary.canaryAndRollback.canaryBlockedSurfaces).toEqual([
      "chat.send",
      "sessions.list",
      "status",
      "workflows.list",
    ]);
    expect(summary.livePromotionGateDesign.gates).toEqual([
      expect.objectContaining({
        surface: "chat.send",
        status: "blocked",
        owner: "master-operator",
        requiredProof: expect.arrayContaining([
          "explicit Master/operator authorization for Rust canary chat send traffic",
        ]),
        rollbackProof: expect.arrayContaining([
          "Node chat.send path remains available and health-checked before canary",
        ]),
        duplicatePreventionProof: expect.arrayContaining([
          "same request id cannot be accepted by both Node and Rust live send paths",
        ]),
      }),
      expect.objectContaining({
        surface: "authority-switch",
        status: "blocked",
      }),
    ]);
    expect(summary.shadowPromotionGateFixtures.fixtures).toEqual([
      expect.objectContaining({
        fixtureId: "rust-shadow-gate-chat-send",
        surface: "chat.send",
        status: "blocked",
        canaryFlag: "ARGENT_RUST_GATEWAY_CANARY",
        syntheticOnly: true,
        requiredProof: expect.arrayContaining([
          "token/auth role-scope parity covers accepted, rejected, and expired-token sends",
        ]),
        noLiveProof: expect.arrayContaining([
          "no chat.send RPC is replayed by the Rust parity runner",
        ]),
      }),
    ]);
    expect(summary.noLiveSafetyGateFixtures.fixtures).toEqual([
      expect.objectContaining({
        fixtureId: "rust-no-live-safety-chat-send",
        surface: "chat.send",
        status: "blocked",
        syntheticOnly: true,
        rollbackGate: expect.arrayContaining([
          "Node chat.send path is health-checked before any Rust canary send authorization",
        ]),
        duplicatePreventionGate: expect.arrayContaining([
          "same chat request id cannot be accepted by both Node and Rust live send paths",
        ]),
        tokenAuthGate: expect.arrayContaining([
          "expired token and revoked role behavior match before any live send traffic",
        ]),
        noLiveProof: expect.arrayContaining([
          "no chat.send RPC is replayed by the Rust parity runner",
        ]),
      }),
    ]);
  });

  it("builds synthetic blocked gate fixtures for all unsafe promotion surfaces", () => {
    const summary = buildRustGatewayPromotionReadinessSummary({
      generatedAtMs: 0,
      totals: { passed: 0, failed: 0, skipped: 3 },
      results: [
        {
          fixtureId: "chat-send",
          method: "chat.send",
          safety: "unsafe",
          expectedParity: "unsafe",
          observedParity: "skipped",
          status: "skipped",
          nodeOk: null,
          rustOk: null,
          notes: [],
        },
        {
          fixtureId: "cron-add",
          method: "cron.add",
          safety: "unsafe",
          expectedParity: "unsafe",
          observedParity: "skipped",
          status: "skipped",
          nodeOk: null,
          rustOk: null,
          notes: [],
        },
        {
          fixtureId: "workflows-run",
          method: "workflows.run",
          safety: "unsafe",
          expectedParity: "unsafe",
          observedParity: "skipped",
          status: "skipped",
          nodeOk: null,
          rustOk: null,
          notes: [],
        },
      ],
    });

    expect(summary.shadowPromotionGateFixtures).toMatchObject({
      mode: "synthetic-read-only",
      liveTrafficAllowed: false,
      authoritySwitchAllowed: false,
    });
    expect(summary.shadowPromotionGateFixtures.fixtures.map((fixture) => fixture.surface)).toEqual([
      "chat.send",
      "cron.add",
      "workflows.run",
    ]);
    expect(
      summary.shadowPromotionGateFixtures.fixtures.map((fixture) => fixture.canaryFlag),
    ).toEqual([
      "ARGENT_RUST_GATEWAY_CANARY",
      "ARGENT_RUST_SCHEDULER_CANARY",
      "ARGENT_RUST_WORKFLOW_CANARY",
    ]);
    expect(summary.authoritySwitchChecklist).toMatchObject({
      status: "blocked",
      authoritySwitchAllowed: false,
    });
    expect(summary.authoritySwitchChecklist.requiredBeforePromotion).toContain(
      "duplicate-prevention gates cover workflow, session, run, timer, and channel split-brain cases",
    );
  });

  it("builds no-live safety fixtures for rollback duplicate and token gates", () => {
    const summary = buildRustGatewayPromotionReadinessSummary({
      generatedAtMs: 0,
      totals: { passed: 0, failed: 0, skipped: 3 },
      results: [
        {
          fixtureId: "chat-send",
          method: "chat.send",
          safety: "unsafe",
          expectedParity: "unsafe",
          observedParity: "skipped",
          status: "skipped",
          nodeOk: null,
          rustOk: null,
          notes: [],
        },
        {
          fixtureId: "cron-add",
          method: "cron.add",
          safety: "unsafe",
          expectedParity: "unsafe",
          observedParity: "skipped",
          status: "skipped",
          nodeOk: null,
          rustOk: null,
          notes: [],
        },
        {
          fixtureId: "workflows-run",
          method: "workflows.run",
          safety: "unsafe",
          expectedParity: "unsafe",
          observedParity: "skipped",
          status: "skipped",
          nodeOk: null,
          rustOk: null,
          notes: [],
        },
      ],
    });

    expect(summary.noLiveSafetyGateFixtures).toMatchObject({
      mode: "synthetic-read-only",
      liveTrafficAllowed: false,
      authoritySwitchAllowed: false,
    });
    expect(summary.noLiveSafetyGateFixtures.fixtures.map((fixture) => fixture.fixtureId)).toEqual([
      "rust-no-live-safety-chat-send",
      "rust-no-live-safety-cron-add",
      "rust-no-live-safety-workflows-run",
    ]);
    expect(summary.noLiveSafetyGateFixtures.fixtures).toEqual([
      expect.objectContaining({
        surface: "chat.send",
        rollbackGate: expect.arrayContaining([
          "rollback packet includes Node fallback command and chat.send health probe",
        ]),
        duplicatePreventionGate: expect.arrayContaining([
          "audit trail records rejected duplicate authority attempts before user-visible send",
        ]),
        tokenAuthGate: expect.arrayContaining([
          "accepted send token scope matches Node role and workspace policy",
        ]),
      }),
      expect.objectContaining({
        surface: "cron.add",
        rollbackGate: expect.arrayContaining([
          "rollback packet includes cron.status and next-run health probes",
        ]),
        duplicatePreventionGate: expect.arrayContaining([
          "same schedule key cannot become live in both Node and Rust stores",
        ]),
        tokenAuthGate: expect.arrayContaining([
          "expired token and revoked scheduler role behavior match before live timer mutation",
        ]),
      }),
      expect.objectContaining({
        surface: "workflows.run",
        rollbackGate: expect.arrayContaining([
          "rollback packet includes workflow status, run detail, and terminal-state probes",
        ]),
        duplicatePreventionGate: expect.arrayContaining([
          "artifact and ledger writes reject split-brain run ownership before persistence",
        ]),
        tokenAuthGate: expect.arrayContaining([
          "rejected workflow-run token scope matches Node denial envelope",
        ]),
      }),
    ]);
    for (const fixture of summary.noLiveSafetyGateFixtures.fixtures) {
      expect(fixture.noLiveProof).toContain(
        "fixture is generated from skipped unsafe parity metadata only",
      );
    }
  });

  it("summarizes failed-auth token parity without authorizing live traffic", () => {
    const summary = buildRustGatewayPromotionReadinessSummary({
      generatedAtMs: 0,
      totals: { passed: 5, failed: 0, skipped: 0 },
      results: [
        {
          fixtureId: "connect-v3-token",
          method: "connect",
          safety: "read-only",
          expectedParity: "schema-compatible",
          observedParity: "schema-compatible",
          status: "passed",
          nodeOk: true,
          rustOk: true,
          notes: ["schema/envelope: response envelopes are compatible"],
          tokenAuthGate: {
            authCase: "valid-token",
            evidenceKind: "real-connect-token",
            expected: "accepted",
            rejectionPoint: "connect-handshake",
            redactionRequired: false,
            liveTrafficAllowed: false,
            authoritySwitchAllowed: false,
            coversMethods: ["connect", "health", "status"],
            requiredBeforeAuthoritySwitch: ["expired token parity"],
          },
        },
        {
          fixtureId: "connect-missing-token",
          method: "connect",
          safety: "read-only",
          expectedParity: "schema-compatible",
          observedParity: "schema-compatible",
          status: "passed",
          nodeOk: false,
          rustOk: false,
          notes: ["schema/error: auth failure errors are structured and redacted"],
          tokenAuthGate: {
            authCase: "missing-token",
            evidenceKind: "real-connect-token",
            expected: "rejected",
            rejectionPoint: "connect-handshake",
            redactionRequired: false,
            liveTrafficAllowed: false,
            authoritySwitchAllowed: false,
            coversMethods: ["connect", "health", "status"],
            requiredBeforeAuthoritySwitch: ["expired token parity"],
          },
        },
        {
          fixtureId: "connect-wrong-token",
          method: "connect",
          safety: "read-only",
          expectedParity: "schema-compatible",
          observedParity: "schema-compatible",
          status: "passed",
          nodeOk: false,
          rustOk: false,
          notes: ["schema/error: auth failure errors are structured and redacted"],
          tokenAuthGate: {
            authCase: "wrong-token",
            evidenceKind: "real-connect-token",
            expected: "rejected",
            rejectionPoint: "connect-handshake",
            redactionRequired: true,
            liveTrafficAllowed: false,
            authoritySwitchAllowed: false,
            coversMethods: ["connect", "health", "status"],
            requiredBeforeAuthoritySwitch: ["expired token parity"],
          },
        },
        {
          fixtureId: "connect-expired-token",
          method: "connect",
          safety: "read-only",
          expectedParity: "schema-compatible",
          observedParity: "schema-compatible",
          status: "passed",
          nodeOk: false,
          rustOk: false,
          notes: ["schema/error: auth failure errors are structured and redacted"],
          tokenAuthGate: {
            authCase: "expired-token",
            evidenceKind: "synthetic-rejection-shape",
            expected: "rejected",
            rejectionPoint: "connect-handshake",
            redactionRequired: true,
            liveTrafficAllowed: false,
            authoritySwitchAllowed: false,
            coversMethods: ["connect", "health", "status"],
            requiredBeforeAuthoritySwitch: ["live token expiry clock semantics"],
          },
        },
        {
          fixtureId: "connect-revoked-scope-token",
          method: "connect",
          safety: "read-only",
          expectedParity: "schema-compatible",
          observedParity: "schema-compatible",
          status: "passed",
          nodeOk: false,
          rustOk: false,
          notes: ["schema/error: auth failure errors are structured and redacted"],
          tokenAuthGate: {
            authCase: "revoked-scope",
            evidenceKind: "synthetic-rejection-shape",
            expected: "rejected",
            rejectionPoint: "connect-handshake",
            redactionRequired: true,
            liveTrafficAllowed: false,
            authoritySwitchAllowed: false,
            coversMethods: ["connect", "health", "status"],
            requiredBeforeAuthoritySwitch: ["live role/scope policy semantics"],
          },
        },
      ],
    });

    expect(summary.failedAuthTokenParity).toMatchObject({
      mode: "synthetic-read-only",
      liveTrafficAllowed: false,
      authoritySwitchAllowed: false,
      missingRequiredCases: [],
      remainingBeforeAuthoritySwitch: expect.arrayContaining([
        "live expired-token issuer fixture and clock-skew semantics",
        "live revoked role/scope policy fixture across gateway authority surfaces",
      ]),
    });
    expect(summary.failedAuthTokenParity.fixtures.map((fixture) => fixture.authCase)).toEqual([
      "valid-token",
      "missing-token",
      "wrong-token",
      "expired-token",
      "revoked-scope",
    ]);
    expect(summary.failedAuthTokenParity.fixtures).toEqual([
      expect.objectContaining({
        fixtureId: "connect-v3-token",
        status: "passed",
        expected: "accepted",
        noLiveProof: expect.arrayContaining([
          "accepted-token proof is limited to read-only parity methods",
        ]),
      }),
      expect.objectContaining({
        fixtureId: "connect-missing-token",
        status: "passed",
        expected: "rejected",
        redactionRequired: false,
        redactionProof: "not-required",
        noLiveProof: expect.arrayContaining([
          "fixture fails at connect handshake before any RPC method is sent",
        ]),
      }),
      expect.objectContaining({
        fixtureId: "connect-wrong-token",
        status: "passed",
        expected: "rejected",
        redactionRequired: true,
        redactionProof: "structured-error-redacted",
      }),
      expect.objectContaining({
        fixtureId: "connect-expired-token",
        evidenceKind: "synthetic-rejection-shape",
        status: "passed",
        expected: "rejected",
        redactionProof: "structured-error-redacted",
        noLiveProof: expect.arrayContaining([
          "no live token store, role policy, connector, or customer data is accessed",
        ]),
        remainingLiveProof: expect.arrayContaining([
          "real expired token fixture from authorized token issuer",
          "clock-skew and token TTL parity between Node and Rust",
        ]),
      }),
      expect.objectContaining({
        fixtureId: "connect-revoked-scope-token",
        evidenceKind: "synthetic-rejection-shape",
        status: "passed",
        expected: "rejected",
        redactionProof: "structured-error-redacted",
        remainingLiveProof: expect.arrayContaining([
          "real revoked role/scope fixture from authorized policy source",
          "role/scope denial parity across gateway, scheduler, workflow, channel, session, and run surfaces",
        ]),
      }),
    ]);
    expect(summary.gates).toContainEqual({
      id: "failed-auth-token-parity",
      status: "passed",
      reason:
        "valid, missing, wrong, expired, and revoked-scope token fixtures passed with no live RPC execution",
    });
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
