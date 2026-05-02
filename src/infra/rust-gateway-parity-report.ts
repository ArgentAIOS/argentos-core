import type { RustGatewayTokenAuthCase } from "./rust-gateway-parity-fixtures.js";
import type {
  RustGatewayParityReplayReport,
  RustGatewayParityReplayResult,
} from "./rust-gateway-parity-runner.js";
import {
  analyzeRustGatewayShadowDuplicateObservations,
  RUST_GATEWAY_SHADOW_DUPLICATE_PROOF_FIXTURE,
  type RustGatewayShadowDuplicateProof,
} from "./rust-gateway-shadow-duplicates.js";

export type RustGatewayPromotionReadiness = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
};

export type RustGatewayParityReportGroups = {
  promotionBlockers: RustGatewayParityReplayResult[];
  mockOnly: RustGatewayParityReplayResult[];
  unsupported: RustGatewayParityReplayResult[];
  unsafeBlocked: RustGatewayParityReplayResult[];
  cleanEvidence: RustGatewayParityReplayResult[];
};

export type RustGatewayPromotionReadinessSummary = {
  generatedAtMs: number;
  promotionReady: boolean;
  totals: RustGatewayParityReplayReport["totals"];
  methodCoverage: {
    totalFixtureMethods: number;
    promotionBlockers: string[];
    mockOnly: string[];
    unsupported: string[];
    unsafeBlocked: string[];
    cleanEvidence: string[];
    unproven: string[];
    readOnlyUnproven: string[];
    authorityBlocked: string[];
    nextSafeFixtureCandidates: Array<{
      method: string;
      currentEvidence: "mock-compatible" | "unsupported";
      recommendation: string;
    }>;
  };
  counts: {
    promotionBlockers: number;
    mockOnly: number;
    unsupported: number;
    unsafeBlocked: number;
    cleanEvidence: number;
    blockers: number;
    warnings: number;
  };
  fixtureIds: {
    promotionBlockers: string[];
    mockOnly: string[];
    unsupported: string[];
    unsafeBlocked: string[];
    cleanEvidence: string[];
  };
  authority: {
    liveGateway: "node";
    rustGateway: "shadow-only";
    scheduler: "node";
    workflows: "node";
    channels: "node";
  };
  canaryAndRollback: {
    mode: "read-only-plan";
    canaryAllowedSurfaces: string[];
    canaryBlockedSurfaces: string[];
    rollbackCommand: "argent gateway authority rollback-node --reason <reason>";
    rollbackExecutable: false;
    requiredProofBeforeCanary: string[];
    requiredProofBeforeRollbackCommand: string[];
  };
  livePromotionGateDesign: {
    mode: "design-only";
    authoritySwitchAllowed: false;
    defaultOffConfigFlags: Array<{
      flag: string;
      default: false;
      purpose: string;
    }>;
    gates: Array<{
      surface: "chat.send" | "cron.add" | "workflows.run" | "authority-switch";
      status: "blocked";
      owner: "master-operator";
      requiredProof: string[];
      rollbackProof: string[];
      duplicatePreventionProof: string[];
    }>;
  };
  shadowPromotionGateFixtures: {
    mode: "synthetic-read-only";
    liveTrafficAllowed: false;
    authoritySwitchAllowed: false;
    fixtures: Array<{
      fixtureId: string;
      surface: "chat.send" | "cron.add" | "workflows.run";
      status: "blocked";
      canaryFlag: string;
      syntheticOnly: true;
      requiredProof: string[];
      noLiveProof: string[];
    }>;
  };
  noLiveSafetyGateFixtures: {
    mode: "synthetic-read-only";
    liveTrafficAllowed: false;
    authoritySwitchAllowed: false;
    fixtures: Array<{
      fixtureId: string;
      surface: "chat.send" | "cron.add" | "workflows.run";
      status: "blocked";
      syntheticOnly: true;
      rollbackGate: string[];
      duplicatePreventionGate: string[];
      tokenAuthGate: string[];
      noLiveProof: string[];
    }>;
  };
  failedAuthTokenParity: {
    mode: "synthetic-read-only";
    liveTrafficAllowed: false;
    authoritySwitchAllowed: false;
    fixtures: Array<{
      fixtureId: string;
      authCase: RustGatewayTokenAuthCase;
      evidenceKind: "real-connect-token" | "synthetic-rejection-shape";
      status: "passed" | "blocked";
      expected: "accepted" | "rejected";
      rejectionPoint: "connect-handshake";
      redactionRequired: boolean;
      redactionProof: "not-required" | "structured-error-redacted" | "missing";
      nodeOk: boolean | null;
      rustOk: boolean | null;
      coversMethods: string[];
      noLiveProof: string[];
      remainingLiveProof: string[];
    }>;
    missingRequiredCases: RustGatewayTokenAuthCase[];
    remainingBeforeAuthoritySwitch: string[];
  };
  authPolicyAndCanaryScopeMatrix: {
    mode: "design-only";
    liveTrafficAllowed: false;
    authoritySwitchAllowed: false;
    realIssuerExpiredToken: {
      status: "blocked";
      owner: "master-operator";
      requiredProof: string[];
      noLiveProof: string[];
    };
    clockSkewAndTtl: {
      status: "blocked";
      owner: "master-operator";
      requiredProof: string[];
      noLiveProof: string[];
    };
    revokedRoleScopePolicy: {
      status: "blocked";
      owner: "master-operator";
      requiredProof: string[];
      surfaces: Array<"gateway" | "scheduler" | "workflow" | "channel" | "session" | "run">;
      noLiveProof: string[];
    };
    canaryTokenScopes: Array<{
      surface: "chat.send" | "cron.add" | "workflows.run";
      status: "blocked";
      owner: "master-operator";
      canaryFlag: string;
      requiredScope: string;
      allowedMethods: string[];
      deniedMethods: string[];
      requiredProof: string[];
      rollbackProof: string[];
      noLiveProof: string[];
    }>;
    remainingBeforeAuthoritySwitch: string[];
  };
  authoritySwitchChecklist: {
    status: "blocked";
    authoritySwitchAllowed: false;
    requiredBeforePromotion: string[];
    requiredBeforeRollback: string[];
    currentAuthority: {
      liveGateway: "node";
      rustGateway: "shadow-only";
      scheduler: "node";
      workflows: "node";
      channels: "node";
    };
  };
  duplicatePrevention: RustGatewayShadowDuplicateProof;
  gates: Array<{
    id: string;
    status: "passed" | "blocked" | "not-run";
    reason: string;
  }>;
  nextRequiredGates: string[];
  blockers: string[];
  warnings: string[];
};

export function evaluateRustGatewayPromotionReadiness(
  report: RustGatewayParityReplayReport,
): RustGatewayPromotionReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const result of report.results) {
    if (result.status === "failed") {
      blockers.push(`${result.fixtureId}: ${result.method} failed parity replay`);
    }
    if (result.status === "skipped" && result.safety !== "unsafe") {
      blockers.push(`${result.fixtureId}: ${result.method} was skipped unexpectedly`);
    }
    if (result.observedParity === "mock-compatible") {
      warnings.push(`${result.fixtureId}: mock-compatible result is not promotion evidence`);
    }
    if (result.expectedParity === "unsupported") {
      warnings.push(`${result.fixtureId}: unsupported surface still needs an explicit owner`);
    }
  }

  if (report.results.length === 0) {
    blockers.push("no parity fixtures ran");
  }

  return {
    ready: blockers.length === 0 && warnings.length === 0,
    blockers,
    warnings,
  };
}

export function groupRustGatewayParityResults(
  report: RustGatewayParityReplayReport,
): RustGatewayParityReportGroups {
  const groups: RustGatewayParityReportGroups = {
    promotionBlockers: [],
    mockOnly: [],
    unsupported: [],
    unsafeBlocked: [],
    cleanEvidence: [],
  };

  for (const result of report.results) {
    if (result.status === "failed" || (result.status === "skipped" && result.safety !== "unsafe")) {
      groups.promotionBlockers.push(result);
      continue;
    }
    if (result.safety === "unsafe" || result.expectedParity === "unsafe") {
      groups.unsafeBlocked.push(result);
      continue;
    }
    if (result.expectedParity === "unsupported" || result.observedParity === "unsupported") {
      groups.unsupported.push(result);
      continue;
    }
    if (result.observedParity === "mock-compatible") {
      groups.mockOnly.push(result);
      continue;
    }
    groups.cleanEvidence.push(result);
  }

  return groups;
}

export function buildRustGatewayPromotionReadinessSummary(
  report: RustGatewayParityReplayReport,
): RustGatewayPromotionReadinessSummary {
  const readiness = evaluateRustGatewayPromotionReadiness(report);
  const groups = groupRustGatewayParityResults(report);
  const methodCoverage = buildMethodCoverage(groups);
  const duplicatePrevention = analyzeRustGatewayShadowDuplicateObservations(
    RUST_GATEWAY_SHADOW_DUPLICATE_PROOF_FIXTURE,
  );
  const failedAuthTokenParity = buildFailedAuthTokenParity(report);
  return {
    generatedAtMs: report.generatedAtMs,
    promotionReady: readiness.ready,
    totals: report.totals,
    methodCoverage,
    counts: {
      promotionBlockers: groups.promotionBlockers.length,
      mockOnly: groups.mockOnly.length,
      unsupported: groups.unsupported.length,
      unsafeBlocked: groups.unsafeBlocked.length,
      cleanEvidence: groups.cleanEvidence.length,
      blockers: readiness.blockers.length,
      warnings: readiness.warnings.length,
    },
    fixtureIds: {
      promotionBlockers: groups.promotionBlockers.map((result) => result.fixtureId),
      mockOnly: groups.mockOnly.map((result) => result.fixtureId),
      unsupported: groups.unsupported.map((result) => result.fixtureId),
      unsafeBlocked: groups.unsafeBlocked.map((result) => result.fixtureId),
      cleanEvidence: groups.cleanEvidence.map((result) => result.fixtureId),
    },
    authority: {
      liveGateway: "node",
      rustGateway: "shadow-only",
      scheduler: "node",
      workflows: "node",
      channels: "node",
    },
    canaryAndRollback: buildCanaryAndRollbackPlan(groups),
    livePromotionGateDesign: buildLivePromotionGateDesign(groups),
    shadowPromotionGateFixtures: buildShadowPromotionGateFixtures(groups),
    noLiveSafetyGateFixtures: buildNoLiveSafetyGateFixtures(groups),
    failedAuthTokenParity,
    authPolicyAndCanaryScopeMatrix: buildAuthPolicyAndCanaryScopeMatrix(groups),
    authoritySwitchChecklist: buildAuthoritySwitchChecklist(),
    duplicatePrevention,
    gates: buildPromotionGateStatuses(
      report,
      readiness,
      groups,
      duplicatePrevention,
      failedAuthTokenParity,
    ),
    nextRequiredGates: [
      "auth-role-scope-parity",
      "dashboard-smoke",
      "swift-app-smoke",
      "workflow-run-smoke",
      "schedule-reminder-smoke",
      "restart-recovery",
      "rollback-to-node",
      "duplicate-timer-channel-run-prevention",
    ],
    blockers: readiness.blockers,
    warnings: readiness.warnings,
  };
}

function buildAuthPolicyAndCanaryScopeMatrix(
  groups: RustGatewayParityReportGroups,
): RustGatewayPromotionReadinessSummary["authPolicyAndCanaryScopeMatrix"] {
  const unsafeMethods = new Set(groups.unsafeBlocked.map((result) => result.method));
  return {
    mode: "design-only",
    liveTrafficAllowed: false,
    authoritySwitchAllowed: false,
    realIssuerExpiredToken: {
      status: "blocked",
      owner: "master-operator",
      requiredProof: [
        "authorized token issuer can mint an expired canary token without exposing secrets in git or bus",
        "Node and Rust reject the issuer-signed expired token at connect handshake",
        "error envelopes preserve redaction and do not leak token material",
      ],
      noLiveProof: [
        "current evidence remains synthetic-read-only and never reads a live token store",
        "no OAuth/API credentials or customer/company data are accessed",
        "Node remains live authority and Rust remains shadow-only",
      ],
    },
    clockSkewAndTtl: {
      status: "blocked",
      owner: "master-operator",
      requiredProof: [
        "Node and Rust use the same accepted clock-skew window for not-before and expires-at claims",
        "TTL boundary tests cover just-valid, just-expired, and skew-exceeded tokens",
        "canary packet records the issuer clock source and rollback behavior for rejected tokens",
      ],
      noLiveProof: [
        "current report only defines the proof contract; it does not change token validation runtime",
        "no live canary traffic is routed to Rust",
        "authority switch remains disabled by default-off config",
      ],
    },
    revokedRoleScopePolicy: {
      status: "blocked",
      owner: "master-operator",
      surfaces: ["gateway", "scheduler", "workflow", "channel", "session", "run"],
      requiredProof: [
        "authorized policy source can issue a revoked role/scope canary token without secrets in git or bus",
        "Node and Rust deny revoked role/scope tokens with matching envelopes on every authority surface",
        "denied requests stop before RPC mutation, connector execution, scheduler mutation, or workflow run dispatch",
      ],
      noLiveProof: [
        "current revoked-scope evidence is synthetic and stops at connect handshake",
        "no connector execution, live scheduler mutation, workflow dispatch, or channel send occurs",
        "Node remains the only live gateway/scheduler/workflow/channel/session/run authority",
      ],
    },
    canaryTokenScopes: [
      {
        surface: "chat.send",
        status: "blocked",
        owner: "master-operator",
        canaryFlag: "ARGENT_RUST_GATEWAY_CANARY",
        requiredScope: "rust.gateway.canary.chat.send",
        allowedMethods: ["chat.send"],
        deniedMethods: ["cron.add", "cron.run", "workflows.run", "channels.send"],
        requiredProof: [
          "operator-approved canary token is scoped to isolated chat.send target only",
          "same request id cannot be accepted by both Node and Rust live send paths",
          "denied scheduler/workflow/channel methods return Node-compatible rejection envelopes",
        ],
        rollbackProof: [
          "disable ARGENT_RUST_GATEWAY_CANARY and verify Node chat.send health before retry",
          "audit log records the canary token id, authority, and rollback marker without token material",
        ],
        noLiveProof: [
          "matrix entry is generated only when chat.send is unsafe-blocked",
          "the parity runner does not replay chat.send",
          "no user-visible send occurs without Master/operator authorization",
        ],
      },
      {
        surface: "cron.add",
        status: "blocked",
        owner: "master-operator",
        canaryFlag: "ARGENT_RUST_SCHEDULER_CANARY",
        requiredScope: "rust.scheduler.canary.cron.add",
        allowedMethods: ["cron.add", "cron.status"],
        deniedMethods: ["chat.send", "workflows.run", "channels.send"],
        requiredProof: [
          "operator-approved canary token is limited to isolated scheduler canary state",
          "canary schedule key cannot become live in both Node and Rust stores",
          "denied chat/workflow/channel methods return Node-compatible rejection envelopes",
        ],
        rollbackProof: [
          "disable ARGENT_RUST_SCHEDULER_CANARY and verify cron.status and next-run ownership",
          "drain or delete canary timer without firing duplicate reminders",
        ],
        noLiveProof: [
          "matrix entry is generated only when cron.add is unsafe-blocked",
          "the parity runner does not replay cron.add",
          "Node remains live scheduler authority until explicit promotion",
        ],
      },
      {
        surface: "workflows.run",
        status: "blocked",
        owner: "master-operator",
        canaryFlag: "ARGENT_RUST_WORKFLOW_CANARY",
        requiredScope: "rust.workflow.canary.workflows.run",
        allowedMethods: ["workflows.run", "workflows.list"],
        deniedMethods: ["chat.send", "cron.add", "channels.send"],
        requiredProof: [
          "operator-approved canary token is limited to fixture-safe workflow package or no-op sinks",
          "same workflow run id cannot be claimed by both Node and Rust",
          "denied chat/scheduler/channel methods return Node-compatible rejection envelopes",
        ],
        rollbackProof: [
          "disable ARGENT_RUST_WORKFLOW_CANARY and verify workflow status, run detail, and terminal-state probes",
          "pause and drain Rust canary queue without orphaning live Node-owned runs",
        ],
        noLiveProof: [
          "matrix entry is generated only when workflows.run is unsafe-blocked",
          "the parity runner does not replay workflows.run",
          "no connector execution or customer/company data access is allowed",
        ],
      },
    ].filter((entry) => unsafeMethods.has(entry.surface)),
    remainingBeforeAuthoritySwitch: [
      "real issuer expired-token proof",
      "clock-skew and TTL boundary parity",
      "revoked role/scope policy parity across authority surfaces",
      "operator-approved canary token scope matrix with denied-method probes",
      "rollback and duplicate-prevention proof for every canary scope",
    ],
  };
}

function buildFailedAuthTokenParity(
  report: RustGatewayParityReplayReport,
): RustGatewayPromotionReadinessSummary["failedAuthTokenParity"] {
  const fixtures = report.results
    .filter((result) => result.tokenAuthGate)
    .map((result) => ({
      fixtureId: result.fixtureId,
      authCase: result.tokenAuthGate?.authCase as RustGatewayTokenAuthCase,
      evidenceKind: result.tokenAuthGate?.evidenceKind ?? "real-connect-token",
      status: result.status === "passed" ? ("passed" as const) : ("blocked" as const),
      expected: result.tokenAuthGate?.expected ?? "rejected",
      rejectionPoint: "connect-handshake" as const,
      redactionRequired: result.tokenAuthGate?.redactionRequired ?? false,
      redactionProof: result.tokenAuthGate?.redactionRequired
        ? result.notes.some((note) => /structured and redacted/i.test(note))
          ? ("structured-error-redacted" as const)
          : ("missing" as const)
        : ("not-required" as const),
      nodeOk: result.nodeOk,
      rustOk: result.rustOk,
      coversMethods: result.tokenAuthGate?.coversMethods ?? [],
      noLiveProof:
        result.tokenAuthGate?.evidenceKind === "synthetic-rejection-shape"
          ? [
              "fixture uses a synthetic token string against isolated local parity services",
              "fixture fails at connect handshake before any RPC method is sent",
              "no live token store, role policy, connector, or customer data is accessed",
              "Node remains live authority and Rust remains shadow-only",
            ]
          : result.tokenAuthGate?.expected === "rejected"
            ? [
                "fixture fails at connect handshake before any RPC method is sent",
                "token material is not written to the report or readiness summary",
                "Node remains live authority and Rust remains shadow-only",
              ]
            : [
                "fixture uses the isolated parity service token only",
                "accepted-token proof is limited to read-only parity methods",
                "Node remains live authority and Rust remains shadow-only",
              ],
      remainingLiveProof:
        result.tokenAuthGate?.authCase === "expired-token"
          ? [
              "real expired token fixture from authorized token issuer",
              "clock-skew and token TTL parity between Node and Rust",
              "rollback proof for rejected expired-token canary requests",
            ]
          : result.tokenAuthGate?.authCase === "revoked-scope"
            ? [
                "real revoked role/scope fixture from authorized policy source",
                "role/scope denial parity across gateway, scheduler, workflow, channel, session, and run surfaces",
                "rollback proof for rejected revoked-scope canary requests",
              ]
            : [],
    }));
  const passedCases = new Set(
    fixtures.filter((fixture) => fixture.status === "passed").map((fixture) => fixture.authCase),
  );
  const missingRequiredCases: RustGatewayTokenAuthCase[] = [
    "valid-token",
    "missing-token",
    "wrong-token",
    "expired-token",
    "revoked-scope",
  ].filter(
    (authCase) => !passedCases.has(authCase as RustGatewayTokenAuthCase),
  ) as RustGatewayTokenAuthCase[];

  return {
    mode: "synthetic-read-only",
    liveTrafficAllowed: false,
    authoritySwitchAllowed: false,
    fixtures,
    missingRequiredCases,
    remainingBeforeAuthoritySwitch: [
      "live expired-token issuer fixture and clock-skew semantics",
      "live revoked role/scope policy fixture across gateway authority surfaces",
      "operator-approved canary token scope matrix before live Rust traffic",
      "rollback proof that rejected Rust tokens fall back to Node without duplicate work",
    ],
  };
}

function buildNoLiveSafetyGateFixtures(
  groups: RustGatewayParityReportGroups,
): RustGatewayPromotionReadinessSummary["noLiveSafetyGateFixtures"] {
  const unsafeMethods = new Set(groups.unsafeBlocked.map((result) => result.method));
  return {
    mode: "synthetic-read-only",
    liveTrafficAllowed: false,
    authoritySwitchAllowed: false,
    fixtures: [
      {
        fixtureId: "rust-no-live-safety-chat-send",
        surface: "chat.send",
        status: "blocked",
        syntheticOnly: true,
        rollbackGate: [
          "Node chat.send path is health-checked before any Rust canary send authorization",
          "Rust canary flag disablement preserves pending Node-owned run state",
          "rollback packet includes Node fallback command and chat.send health probe",
        ],
        duplicatePreventionGate: [
          "same chat request id cannot be accepted by both Node and Rust live send paths",
          "abort and retry probes prove one live agent run owner per canary request",
          "audit trail records rejected duplicate authority attempts before user-visible send",
        ],
        tokenAuthGate: [
          "accepted send token scope matches Node role and workspace policy",
          "rejected send token scope matches Node denial envelope",
          "expired token and revoked role behavior match before any live send traffic",
        ],
        noLiveProof: [
          "fixture is generated from skipped unsafe parity metadata only",
          "no chat.send RPC is replayed by the Rust parity runner",
          "Node remains live chat authority until explicit promotion",
        ],
      },
      {
        fixtureId: "rust-no-live-safety-cron-add",
        surface: "cron.add",
        status: "blocked",
        syntheticOnly: true,
        rollbackGate: [
          "Node scheduler fallback command is rehearsed before Rust scheduler canary",
          "Rust canary timers can be disabled or drained without firing duplicate reminders",
          "rollback packet includes cron.status and next-run health probes",
        ],
        duplicatePreventionGate: [
          "same schedule key cannot become live in both Node and Rust stores",
          "next-run claiming proves only one authority fires a reminder for a canary timer",
          "cron.add/update/remove/run probes preserve a single timer owner through rollback",
        ],
        tokenAuthGate: [
          "accepted scheduler token scope matches Node cron.add authorization",
          "rejected scheduler token scope matches Node denial envelope",
          "expired token and revoked scheduler role behavior match before live timer mutation",
        ],
        noLiveProof: [
          "fixture is generated from skipped unsafe parity metadata only",
          "no cron.add RPC is replayed by the Rust parity runner",
          "Node remains live scheduler authority until explicit promotion",
        ],
      },
      {
        fixtureId: "rust-no-live-safety-workflows-run",
        surface: "workflows.run",
        status: "blocked",
        syntheticOnly: true,
        rollbackGate: [
          "Node workflow runner fallback path is rehearsed before Rust workflow canary",
          "Rust canary workflow queue can be paused and drained without orphaning live runs",
          "rollback packet includes workflow status, run detail, and terminal-state probes",
        ],
        duplicatePreventionGate: [
          "same workflow run id cannot be claimed by both Node and Rust",
          "retry and review paths prove one live run owner through terminal state",
          "artifact and ledger writes reject split-brain run ownership before persistence",
        ],
        tokenAuthGate: [
          "accepted workflow-run token scope matches Node workflow execution authorization",
          "rejected workflow-run token scope matches Node denial envelope",
          "expired token and revoked workflow role behavior match before live run execution",
        ],
        noLiveProof: [
          "fixture is generated from skipped unsafe parity metadata only",
          "no workflows.run RPC is replayed by the Rust parity runner",
          "Node remains live workflow authority until explicit promotion",
        ],
      },
    ].filter((fixture) => unsafeMethods.has(fixture.surface)),
  };
}

function buildLivePromotionGateDesign(
  groups: RustGatewayParityReportGroups,
): RustGatewayPromotionReadinessSummary["livePromotionGateDesign"] {
  const unsafeMethods = new Set(groups.unsafeBlocked.map((result) => result.method));
  const liveSurfaceGates: RustGatewayPromotionReadinessSummary["livePromotionGateDesign"]["gates"] =
    [
      {
        surface: "chat.send",
        status: "blocked",
        owner: "master-operator",
        requiredProof: [
          "explicit Master/operator authorization for Rust canary chat send traffic",
          "isolated canary session target that cannot reach production users by default",
          "Node and Rust response envelopes agree for accepted, rejected, and aborted sends",
          "audit log records source authority and rollback marker for every canary send",
        ],
        rollbackProof: [
          "Node chat.send path remains available and health-checked before canary",
          "Rust canary flag can be disabled without losing pending Node-run state",
        ],
        duplicatePreventionProof: [
          "same request id cannot be accepted by both Node and Rust live send paths",
          "abort/retry semantics prove one live agent run owner per canary request",
        ],
      },
      {
        surface: "cron.add",
        status: "blocked",
        owner: "master-operator",
        requiredProof: [
          "explicit Master/operator authorization for isolated Rust scheduler canary",
          "scheduler authority state records Node-live and Rust-canary ownership separately",
          "canary timer store is isolated from Node production timers unless promotion is approved",
          "cron.add, cron.update, cron.remove, and cron.run canary probes are reversible",
        ],
        rollbackProof: [
          "Node scheduler restart/fallback command is rehearsed before Rust scheduler canary",
          "Rust canary timers can be drained or disabled without firing duplicate reminders",
        ],
        duplicatePreventionProof: [
          "same schedule key cannot exist as live in both Node and Rust stores",
          "next-run claiming proves only one authority fires a reminder for a canary timer",
        ],
      },
      {
        surface: "workflows.run",
        status: "blocked",
        owner: "master-operator",
        requiredProof: [
          "explicit Master/operator authorization for isolated Rust workflow-run canary",
          "workflow canary package uses fixture-safe connectors or no-op side-effect sinks",
          "workflow run state records Node-live and Rust-canary authorities distinctly",
          "workflow execution, retry, review, and trace envelopes match the Node contract",
        ],
        rollbackProof: [
          "Node workflow runner fallback path is rehearsed before Rust workflow canary",
          "Rust canary workflow queue can be paused and drained without orphaning live runs",
        ],
        duplicatePreventionProof: [
          "same workflow run id cannot be claimed by both Node and Rust",
          "retry/review paths prove one live run owner through terminal state",
        ],
      },
    ].filter((gate) => unsafeMethods.has(gate.surface));

  liveSurfaceGates.push({
    surface: "authority-switch",
    status: "blocked",
    owner: "master-operator",
    requiredProof: [
      "fresh parity report has zero failed, mock-compatible, or unsupported read-only fixtures",
      "dashboard and Swift smoke tests pass against Rust canary endpoints",
      "explicit signed/recorded Master/operator promotion decision names affected authorities",
      "config/state persistence records previous Node authority and proposed Rust authority",
    ],
    rollbackProof: [
      "Node fallback command is implemented, rehearsed, and included in the READY packet",
      "rollback probes health, connect, status, sessions.list, cron.status, and channels.status",
      "promotion packet proves no data loss, no duplicate work, and no stuck Rust writes",
    ],
    duplicatePreventionProof: [
      "workflow, session, run, timer, and channel duplicate-prevention gates all pass",
      "authority persistence rejects split-brain Node-live and Rust-live ownership",
    ],
  });

  return {
    mode: "design-only",
    authoritySwitchAllowed: false,
    defaultOffConfigFlags: [
      {
        flag: "ARGENT_RUST_GATEWAY_CANARY",
        default: false,
        purpose: "allows Rust canary routing only after explicit Master/operator approval",
      },
      {
        flag: "ARGENT_RUST_SCHEDULER_CANARY",
        default: false,
        purpose: "keeps Rust scheduler mutation surfaces disabled outside isolated canary proof",
      },
      {
        flag: "ARGENT_RUST_WORKFLOW_CANARY",
        default: false,
        purpose: "keeps Rust workflow execution disabled outside isolated canary proof",
      },
      {
        flag: "ARGENT_RUST_AUTHORITY_PROMOTION",
        default: false,
        purpose: "prevents Rust live authority switch unless the promotion packet is approved",
      },
    ],
    gates: liveSurfaceGates,
  };
}

function buildShadowPromotionGateFixtures(
  groups: RustGatewayParityReportGroups,
): RustGatewayPromotionReadinessSummary["shadowPromotionGateFixtures"] {
  const unsafeMethods = new Set(groups.unsafeBlocked.map((result) => result.method));
  return {
    mode: "synthetic-read-only",
    liveTrafficAllowed: false,
    authoritySwitchAllowed: false,
    fixtures: [
      {
        fixtureId: "rust-shadow-gate-chat-send",
        surface: "chat.send",
        status: "blocked",
        canaryFlag: "ARGENT_RUST_GATEWAY_CANARY",
        syntheticOnly: true,
        requiredProof: [
          "explicit Master/operator authorization names chat.send canary scope",
          "token/auth role-scope parity covers accepted, rejected, and expired-token sends",
          "Node and Rust envelopes match for accepted, rejected, and aborted canary sends",
          "duplicate request id is rejected by one authority before any user-visible send",
        ],
        noLiveProof: [
          "fixture is generated from skipped unsafe parity metadata only",
          "no chat.send RPC is replayed by the Rust parity runner",
          "Node remains live chat authority until canary approval",
        ],
      },
      {
        fixtureId: "rust-shadow-gate-cron-add",
        surface: "cron.add",
        status: "blocked",
        canaryFlag: "ARGENT_RUST_SCHEDULER_CANARY",
        syntheticOnly: true,
        requiredProof: [
          "explicit Master/operator authorization names scheduler canary scope",
          "canary timer store is isolated from Node production timer state",
          "cron.add, cron.update, cron.remove, and cron.run rollback probes are reversible",
          "duplicate schedule key cannot become live in both Node and Rust stores",
        ],
        noLiveProof: [
          "fixture is generated from skipped unsafe parity metadata only",
          "no cron.add RPC is replayed by the Rust parity runner",
          "Node remains live scheduler authority until canary approval",
        ],
      },
      {
        fixtureId: "rust-shadow-gate-workflows-run",
        surface: "workflows.run",
        status: "blocked",
        canaryFlag: "ARGENT_RUST_WORKFLOW_CANARY",
        syntheticOnly: true,
        requiredProof: [
          "explicit Master/operator authorization names workflow-run canary scope",
          "canary workflow package uses fixture-safe connectors or no-op side-effect sinks",
          "workflow run state records Node-live and Rust-canary authorities distinctly",
          "retry/review/terminal-state probes prove one live run owner",
        ],
        noLiveProof: [
          "fixture is generated from skipped unsafe parity metadata only",
          "no workflows.run RPC is replayed by the Rust parity runner",
          "Node remains live workflow authority until canary approval",
        ],
      },
    ].filter((fixture) => unsafeMethods.has(fixture.surface)),
  };
}

function buildAuthoritySwitchChecklist(): RustGatewayPromotionReadinessSummary["authoritySwitchChecklist"] {
  return {
    status: "blocked",
    authoritySwitchAllowed: false,
    currentAuthority: {
      liveGateway: "node",
      rustGateway: "shadow-only",
      scheduler: "node",
      workflows: "node",
      channels: "node",
    },
    requiredBeforePromotion: [
      "fresh parity report has zero failed, mock-compatible, or unsupported read-only fixtures",
      "chat.send, cron.add, and workflows.run canary gates have explicit Master/operator authorization",
      "token/auth role-scope parity proves rejected and expired-token behavior before live traffic",
      "dashboard and Swift/client smoke tests pass against Rust canary endpoints",
      "authority persistence records previous Node authority and proposed Rust authority",
      "duplicate-prevention gates cover workflow, session, run, timer, and channel split-brain cases",
    ],
    requiredBeforeRollback: [
      "Node fallback command is implemented, rehearsed, and included in the promotion packet",
      "rollback probes health, connect, status, sessions.list, cron.status, and channels.status",
      "Rust authority writes are stopped before Node fallback probe",
      "rollback packet proves no data loss, no duplicate work, and no stuck Rust writes",
    ],
  };
}

function buildCanaryAndRollbackPlan(
  groups: RustGatewayParityReportGroups,
): RustGatewayPromotionReadinessSummary["canaryAndRollback"] {
  return {
    mode: "read-only-plan",
    canaryAllowedSurfaces: uniqueSortedStrings(groups.cleanEvidence.map((result) => result.method)),
    canaryBlockedSurfaces: uniqueSortedStrings([
      ...groups.mockOnly.map((result) => result.method),
      ...groups.unsupported.map((result) => result.method),
      ...groups.unsafeBlocked.map((result) => result.method),
      ...groups.promotionBlockers.map((result) => result.method),
    ]),
    rollbackCommand: "argent gateway authority rollback-node --reason <reason>",
    rollbackExecutable: false,
    requiredProofBeforeCanary: [
      "fresh parity report has zero failures and no mock-only/unsupported warnings",
      "dashboard and Swift smoke tests pass against Rust canary endpoints",
      "workflow, scheduler, channel, session, and run authority remain Node-owned or isolated",
      "duplicate timers, channel sends, workflow runs, sessions, and agent runs are prevented",
      "operator rollback packet identifies exact Node fallback command and health probes",
    ],
    requiredProofBeforeRollbackCommand: [
      "Node gateway fallback start/restart path is automated and rehearsed",
      "authority state persistence records current and previous live authorities",
      "rollback verification probes health, connect, status, sessions.list, cron.status, and channels.status",
      "Rust authority writes are stopped before Node fallback probe",
      "Threadmaster merge packet includes no silent data loss and no duplicate work proof",
    ],
  };
}

function buildMethodCoverage(
  groups: RustGatewayParityReportGroups,
): RustGatewayPromotionReadinessSummary["methodCoverage"] {
  const promotionBlockers = uniqueSortedMethods(groups.promotionBlockers);
  const mockOnly = uniqueSortedMethods(groups.mockOnly);
  const unsupported = uniqueSortedMethods(groups.unsupported);
  const unsafeBlocked = uniqueSortedMethods(groups.unsafeBlocked);
  const cleanEvidence = uniqueSortedMethods(groups.cleanEvidence);
  const readOnlyUnproven = uniqueSortedStrings([...mockOnly, ...unsupported]);
  const authorityBlocked = unsafeBlocked;
  const unproven = uniqueSortedStrings([
    ...promotionBlockers,
    ...readOnlyUnproven,
    ...authorityBlocked,
  ]);

  return {
    totalFixtureMethods: uniqueSortedStrings([
      ...promotionBlockers,
      ...mockOnly,
      ...unsupported,
      ...unsafeBlocked,
      ...cleanEvidence,
    ]).length,
    promotionBlockers,
    mockOnly,
    unsupported,
    unsafeBlocked,
    cleanEvidence,
    unproven,
    readOnlyUnproven,
    authorityBlocked,
    nextSafeFixtureCandidates: [
      ...mockOnly.map((method) => ({
        method,
        currentEvidence: "mock-compatible" as const,
        recommendation: "replace synthetic success with a schema-compatible read-only fixture",
      })),
      ...unsupported.map((method) => ({
        method,
        currentEvidence: "unsupported" as const,
        recommendation:
          "assign owner and add a schema-compatible read-only fixture or explicit de-scope",
      })),
    ],
  };
}

function uniqueSortedMethods(results: RustGatewayParityReplayResult[]): string[] {
  return uniqueSortedStrings(results.map((result) => result.method));
}

function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}

function buildPromotionGateStatuses(
  report: RustGatewayParityReplayReport,
  readiness: RustGatewayPromotionReadiness,
  groups: RustGatewayParityReportGroups,
  duplicatePrevention: RustGatewayShadowDuplicateProof,
  failedAuthTokenParity: RustGatewayPromotionReadinessSummary["failedAuthTokenParity"],
): RustGatewayPromotionReadinessSummary["gates"] {
  const failedAuthPassed =
    failedAuthTokenParity.missingRequiredCases.length === 0 &&
    failedAuthTokenParity.fixtures.every((fixture) => fixture.status === "passed");
  return [
    {
      id: "isolated-parity-report",
      status: report.results.length > 0 && report.totals.failed === 0 ? "passed" : "blocked",
      reason:
        report.results.length > 0 && report.totals.failed === 0
          ? "isolated Node-vs-Rust replay completed without failed fixtures"
          : "parity replay has failed fixtures or did not run",
    },
    {
      id: "promotion-cleanliness",
      status: readiness.ready ? "passed" : "blocked",
      reason: readiness.ready
        ? "no blockers or warnings in parity readiness"
        : "mock-compatible, unsupported, or blocked fixtures remain",
    },
    {
      id: "clean-protocol-evidence",
      status: groups.cleanEvidence.length > 0 ? "passed" : "blocked",
      reason:
        groups.cleanEvidence.length > 0
          ? `${groups.cleanEvidence.length} fixtures have schema/exact evidence`
          : "no clean parity evidence fixtures",
    },
    {
      id: "dashboard-smoke",
      status: "not-run",
      reason: "dashboard smoke against Rust canary has not been implemented",
    },
    {
      id: "swift-app-smoke",
      status: "not-run",
      reason: "Swift/client smoke against Rust canary has not been implemented",
    },
    {
      id: "workflow-run-smoke",
      status: groups.unsafeBlocked.some((result) => result.method === "workflows.run")
        ? "blocked"
        : "not-run",
      reason: "workflow execution remains unsafe-blocked until isolated canary and rollback gates",
    },
    {
      id: "schedule-reminder-smoke",
      status: groups.unsafeBlocked.some((result) => result.method === "cron.add")
        ? "blocked"
        : "not-run",
      reason: "timer mutation remains unsafe-blocked until duplicate-prevention gates",
    },
    {
      id: "rollback-to-node",
      status: "not-run",
      reason: "rollback command is designed but not implemented or rehearsed",
    },
    {
      id: "restart-recovery",
      status: "not-run",
      reason: "Rust restart/recovery promotion test has not been implemented",
    },
    {
      id: "duplicate-prevention",
      status: duplicatePrevention.status,
      reason:
        duplicatePrevention.status === "passed"
          ? "synthetic shadow observation proof covers workflow, session, run, timer, and channel duplicates without Rust authority"
          : "shadow duplicate-prevention proof is missing coverage or found duplicate conflicts",
    },
    {
      id: "failed-auth-token-parity",
      status: failedAuthPassed ? "passed" : "blocked",
      reason: failedAuthPassed
        ? "valid, missing, wrong, expired, and revoked-scope token fixtures passed with no live RPC execution"
        : `missing or blocked token auth cases: ${failedAuthTokenParity.missingRequiredCases.join(",") || "none"}`,
    },
  ];
}

export function renderRustGatewayParityReplayMarkdown(
  report: RustGatewayParityReplayReport,
): string {
  const readiness = evaluateRustGatewayPromotionReadiness(report);
  const groups = groupRustGatewayParityResults(report);
  const failedAuthTokenParity = buildFailedAuthTokenParity(report);
  const lines = [
    "# Rust Gateway Parity Replay Report",
    "",
    `Generated: ${new Date(report.generatedAtMs).toISOString()}`,
    `Totals: ${report.totals.passed} passed, ${report.totals.failed} failed, ${report.totals.skipped} skipped`,
    `Promotion readiness: ${readiness.ready ? "ready" : "not ready"}`,
    "",
  ];

  if (readiness.blockers.length > 0) {
    lines.push("## Blockers", "", ...readiness.blockers.map((blocker) => `- ${blocker}`), "");
  }
  if (readiness.warnings.length > 0) {
    lines.push("## Warnings", "", ...readiness.warnings.map((warning) => `- ${warning}`), "");
  }

  lines.push("## Promotion Blockers", "");
  lines.push(...renderGroupList(groups.promotionBlockers, "None."));
  lines.push("");

  lines.push("## Mock-Compatible Non-Evidence", "");
  lines.push(...renderGroupList(groups.mockOnly, "None."));
  lines.push("");

  lines.push("## Unsupported Surfaces", "");
  lines.push(...renderGroupList(groups.unsupported, "None."));
  lines.push("");

  lines.push("## Unsafe Blocked Fixtures", "");
  lines.push(...renderGroupList(groups.unsafeBlocked, "None."));
  lines.push("");

  lines.push("## Clean Parity Evidence", "");
  lines.push(...renderGroupList(groups.cleanEvidence, "None."));
  lines.push("");

  lines.push("## Failed-Auth Token Parity", "");
  if (failedAuthTokenParity.fixtures.length === 0) {
    lines.push("No failed-auth token fixtures present.");
  } else {
    lines.push(
      ...failedAuthTokenParity.fixtures.map(
        (fixture) =>
          `- ${fixture.fixtureId} (${fixture.authCase}): ${fixture.status}; covers ${fixture.coversMethods.length} read-only methods; liveTrafficAllowed=false; authoritySwitchAllowed=false`,
      ),
    );
  }
  if (failedAuthTokenParity.remainingBeforeAuthoritySwitch.length > 0) {
    lines.push(
      "",
      "Remaining before authority switch:",
      ...failedAuthTokenParity.remainingBeforeAuthoritySwitch.map((gate) => `- ${gate}`),
    );
  }
  lines.push("");

  lines.push(
    "## Results",
    "",
    "| Fixture | Method | Safety | Expected | Observed | Status | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.results.map(renderResultRow),
    "",
  );

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderGroupList(results: RustGatewayParityReplayResult[], empty: string): string[] {
  if (results.length === 0) {
    return [empty];
  }
  return results.map((result) => {
    const notes = result.notes.length > 0 ? ` — ${result.notes.join("; ")}` : "";
    return `- ${result.fixtureId} (${result.method}): ${result.observedParity}/${result.status}${notes}`;
  });
}

function renderResultRow(result: RustGatewayParityReplayResult): string {
  return [
    result.fixtureId,
    result.method,
    result.safety,
    result.expectedParity,
    result.observedParity,
    result.status,
    result.notes.join("; "),
  ]
    .map(escapeMarkdownTableCell)
    .join(" | ")
    .replace(/^/, "| ")
    .replace(/$/, " |");
}

function escapeMarkdownTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
