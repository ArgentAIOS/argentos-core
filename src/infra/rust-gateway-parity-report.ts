import type {
  RustGatewayParityReplayReport,
  RustGatewayParityReplayResult,
} from "./rust-gateway-parity-runner.js";

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
    gates: buildPromotionGateStatuses(report, readiness, groups),
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
      status: "not-run",
      reason: "no duplicate timer/channel/run prevention test has been implemented",
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
