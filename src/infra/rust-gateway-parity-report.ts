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
    duplicatePrevention,
    gates: buildPromotionGateStatuses(report, readiness, groups, duplicatePrevention),
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
): RustGatewayPromotionReadinessSummary["gates"] {
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
  ];
}

export function renderRustGatewayParityReplayMarkdown(
  report: RustGatewayParityReplayReport,
): string {
  const readiness = evaluateRustGatewayPromotionReadiness(report);
  const groups = groupRustGatewayParityResults(report);
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
