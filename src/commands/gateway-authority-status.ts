import type { RuntimeEnv } from "../runtime.js";
import { formatCliCommand } from "../cli/command-format.js";
import { callGateway } from "../gateway/call.js";
import { getRustGatewayParityReportStatus } from "./status.rust-gateway-parity-report.js";
import { getRustGatewaySchedulerAuthoritySummary } from "./status.rust-gateway-scheduler-authority.js";
import { getRustGatewayShadowSummary } from "./status.rust-gateway-shadow.js";

export type GatewayAuthorityStatusOptions = {
  json?: boolean;
  installedCanary?: GatewayInstalledDaemonCanaryOptions;
};

export type GatewayAuthorityLocalRehearsalOptions = {
  json?: boolean;
  reason: string;
  confirmLocalOnly?: boolean;
  installedCanary?: GatewayInstalledDaemonCanaryOptions;
  beforeCanary?: GatewayInstalledDaemonCanaryOptions;
  afterCanary?: GatewayInstalledDaemonCanaryOptions;
};

export type GatewayAuthorityRollbackPlanOptions = {
  json?: boolean;
  reason: string;
};

export type GatewayAuthorityRollbackPlan = {
  command: "argent gateway authority rollback-node";
  mode: "read-only-plan";
  reason: string;
  executable: false;
  implemented: false;
  authorityChanges: [];
  currentAuthority: {
    liveGateway: "node";
    rustGateway: "shadow-only";
    scheduler: "node";
    workflows: "node";
    channels: "node";
    sessions: "node";
    runs: "node";
  };
  requiredBeforeExecutableRollback: string[];
  operatorRecoveryChecklist: string[];
  blockedActions: string[];
};

export type GatewayAuthorityLocalRehearsal = {
  command: "argent gateway authority rehearse-local";
  mode: "local-only-test-path";
  status: "blocked" | "rehearsed";
  reason: string;
  explicitOptIn: boolean;
  liveProductionTrafficAllowed: false;
  authoritySwitchAllowed: false;
  authorityChanges: [];
  before: GatewayInstalledDaemonCanaryStatus;
  after: GatewayInstalledDaemonCanaryStatus;
  rollback: GatewayAuthorityRollbackPlan;
  enablePath: {
    executableHere: false;
    requiredOperatorAction: string;
    defaultFlagState: false;
    localOnlyFlag: "ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS=1";
  };
  duplicateReceiptSafety: {
    unchanged: true;
    requiredReceipts: Array<"RUST_CANARY_DENIED" | "RUST_CANARY_DUPLICATE_PREVENTED">;
    surfaces: Array<"chat.send" | "cron.add" | "workflows.run">;
  };
  blockers: string[];
  proof: string[];
};

export type GatewayAuthorityStatusSummary = {
  liveGatewayAuthority: "node";
  rustGatewayAuthority: "shadow-only";
  schedulerAuthority: "node";
  workflowAuthority: "node";
  channelAuthority: "node";
  sessionAuthority: "node";
  runAuthority: "node";
  authorityBoundaries: {
    liveAuthority: "node";
    rustMode: "shadow-only";
    rustMayObserve: string[];
    rustMustNotOwn: string[];
  };
  promotionGates: Array<{
    id: string;
    status: "blocked" | "not-run" | "passing";
    reason: string;
  }>;
  rollbackCommand: {
    implemented: false;
    planned: "argent gateway authority rollback-node --reason <reason>";
  };
  rustShadow: Awaited<ReturnType<typeof getRustGatewayShadowSummary>>;
  parityReport: Awaited<ReturnType<typeof getRustGatewayParityReportStatus>>;
  scheduler: Awaited<ReturnType<typeof getRustGatewaySchedulerAuthoritySummary>>;
  installedDaemonCanary: GatewayInstalledDaemonCanaryStatus;
  promotionReady: false;
  blockers: string[];
  nextCommands: string[];
};

export type GatewayInstalledDaemonCanaryOptions = {
  url?: string;
  token?: string;
  password?: string;
  timeoutMs?: number;
  requestStatus?: (options: {
    url: string;
    token?: string;
    password?: string;
    timeoutMs: number;
  }) => Promise<unknown>;
};

export type GatewayInstalledDaemonCanaryStatus = {
  status: "not-configured" | "blocked" | "unavailable" | "unsafe" | "ok";
  configured: boolean;
  method: "rustGateway.canaryReceipts.status";
  queried: boolean;
  url: string | null;
  productionTrafficUsed: false | boolean | null;
  canaryFlagEnabled: boolean | null;
  authoritySwitchAllowed: false | boolean | null;
  dashboardVisible: boolean | null;
  receiptCount: number | null;
  redactionVerified: boolean | null;
  blockers: string[];
  error: string | null;
};

export function buildGatewayAuthorityRollbackPlan(
  options: GatewayAuthorityRollbackPlanOptions,
): GatewayAuthorityRollbackPlan {
  return {
    command: "argent gateway authority rollback-node",
    mode: "read-only-plan",
    reason: options.reason.trim(),
    executable: false,
    implemented: false,
    authorityChanges: [],
    currentAuthority: {
      liveGateway: "node",
      rustGateway: "shadow-only",
      scheduler: "node",
      workflows: "node",
      channels: "node",
      sessions: "node",
      runs: "node",
    },
    requiredBeforeExecutableRollback: [
      "Rust canary mode promotion design has been approved.",
      "Node fallback service start/health probe is automated and rehearsed.",
      "Gateway authority state is persisted with an auditable previous-authority record.",
      "Duplicate timers, channel sends, workflow runs, sessions, and agent runs are prevented.",
      "Operator rollback verification proves Node accepts health, connect, status, sessions.list, cron.status, and channels.status after fallback.",
    ],
    operatorRecoveryChecklist: [
      "Keep or restart Node gateway as live authority.",
      "Stop accepting Rust authority writes before any Node fallback probe.",
      "Verify no Rust-owned scheduler/workflow/channel/session/run authority exists.",
      "Run isolated parity/status report and preserve drift logs for handoff.",
      "Post a Threadmaster rollback packet before any future executable rollback lands.",
    ],
    blockedActions: [
      "Does not stop Rust.",
      "Does not start Node.",
      "Does not edit config or authority state.",
      "Does not touch schedulers, workflows, channels, sessions, or runs.",
      "Does not use connectors, OAuth, API credentials, or live traffic.",
    ],
  };
}

export async function collectGatewayAuthorityStatus(
  options: GatewayAuthorityStatusOptions = {},
): Promise<GatewayAuthorityStatusSummary> {
  const [rustShadow, parityReport, scheduler, installedDaemonCanary] = await Promise.all([
    getRustGatewayShadowSummary(),
    getRustGatewayParityReportStatus(),
    getRustGatewaySchedulerAuthoritySummary(),
    collectInstalledDaemonCanaryStatus(options.installedCanary),
  ]);
  const blockers = [
    "Rust gateway is shadow-only.",
    "Rollback/fallback command is planned but not implemented.",
    "Scheduler, workflows, and channels remain Node-owned.",
  ];
  if (parityReport.freshness !== "fresh") {
    blockers.push(`latest parity report is ${parityReport.freshness}`);
  }
  if (parityReport.promotionReady !== true) {
    blockers.push("latest parity report is not promotion-ready");
  }

  return {
    liveGatewayAuthority: "node",
    rustGatewayAuthority: "shadow-only",
    schedulerAuthority: "node",
    workflowAuthority: "node",
    channelAuthority: "node",
    sessionAuthority: "node",
    runAuthority: "node",
    authorityBoundaries: {
      liveAuthority: "node",
      rustMode: "shadow-only",
      rustMayObserve: [
        "safe parity fixtures",
        "read-only health/status/connect protocol surfaces",
        "shadow drift and readiness reports",
      ],
      rustMustNotOwn: [
        "gateway traffic authority",
        "scheduler timers",
        "workflow execution",
        "channel sends",
        "session mutation",
        "agent run dispatch",
        "connector execution",
      ],
    },
    promotionGates: buildGatewayAuthorityPromotionGates({
      parityReport,
      scheduler,
      rustShadow,
    }),
    rollbackCommand: {
      implemented: false,
      planned: "argent gateway authority rollback-node --reason <reason>",
    },
    rustShadow,
    parityReport,
    scheduler,
    installedDaemonCanary,
    promotionReady: false,
    blockers,
    nextCommands: [
      "argent status",
      "argent gateway authority status --json",
      "argent gateway authority status --installed-canary-url ws://127.0.0.1:<port> --installed-canary-token <token> --json",
      "argent gateway authority rollback-node --reason <reason> --json",
    ],
  };
}

export async function gatewayAuthorityStatusCommand(
  runtime: Pick<RuntimeEnv, "log">,
  options: GatewayAuthorityStatusOptions = {},
): Promise<GatewayAuthorityStatusSummary> {
  const summary = await collectGatewayAuthorityStatus(options);
  if (options.json) {
    runtime.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  runtime.log("Gateway authority status");
  runtime.log("");
  runtime.log(`Live gateway authority: ${summary.liveGatewayAuthority}`);
  runtime.log(`Rust gateway authority: ${summary.rustGatewayAuthority}`);
  runtime.log(`Scheduler authority: ${summary.schedulerAuthority}`);
  runtime.log(`Workflow authority: ${summary.workflowAuthority}`);
  runtime.log(`Channel authority: ${summary.channelAuthority}`);
  runtime.log(`Session authority: ${summary.sessionAuthority}`);
  runtime.log(`Run authority: ${summary.runAuthority}`);
  runtime.log(`Promotion ready: no`);
  runtime.log(`Rollback command: planned, not implemented (${summary.rollbackCommand.planned})`);
  runtime.log(
    `Parity report: ${summary.parityReport.freshness} · promotionReady=${String(
      summary.parityReport.promotionReady,
    )} · ${summary.parityReport.path}`,
  );
  runtime.log(
    `Scheduler: ${summary.scheduler.schedulerAuthority} live · Rust ${summary.scheduler.rustSchedulerAuthority} · ${summary.scheduler.enabledCronJobs}/${summary.scheduler.cronJobs} cron jobs enabled`,
  );
  runtime.log(
    `Installed daemon canary: ${summary.installedDaemonCanary.status} · queried=${String(
      summary.installedDaemonCanary.queried,
    )} · productionTrafficUsed=${String(
      summary.installedDaemonCanary.productionTrafficUsed,
    )} · authoritySwitchAllowed=${String(summary.installedDaemonCanary.authoritySwitchAllowed)}`,
  );
  runtime.log("");
  runtime.log("Next commands:");
  for (const command of summary.nextCommands) {
    runtime.log(`- ${formatCliCommand(command)}`);
  }
  return summary;
}

export async function collectGatewayAuthorityLocalRehearsal(
  options: GatewayAuthorityLocalRehearsalOptions,
): Promise<GatewayAuthorityLocalRehearsal> {
  const baseCanary = options.installedCanary;
  const before = await collectInstalledDaemonCanaryStatus(options.beforeCanary ?? baseCanary);
  const after = options.confirmLocalOnly
    ? await collectInstalledDaemonCanaryStatus(options.afterCanary ?? baseCanary)
    : installedCanaryStatus({
        status: "blocked",
        configured: before.configured,
        queried: false,
        url: before.url,
        productionTrafficUsed: false,
        canaryFlagEnabled: false,
        authoritySwitchAllowed: false,
        dashboardVisible: null,
        receiptCount: null,
        redactionVerified: null,
        blockers: ["pass --confirm-local-only before checking after-canary rehearsal status"],
        error: null,
      });
  const rollback = buildGatewayAuthorityRollbackPlan({ json: false, reason: options.reason });
  const blockers = buildLocalRehearsalBlockers({
    explicitOptIn: options.confirmLocalOnly === true,
    before,
    after,
  });

  return {
    command: "argent gateway authority rehearse-local",
    mode: "local-only-test-path",
    status: blockers.length === 0 ? "rehearsed" : "blocked",
    reason: options.reason.trim(),
    explicitOptIn: options.confirmLocalOnly === true,
    liveProductionTrafficAllowed: false,
    authoritySwitchAllowed: false,
    authorityChanges: [],
    before,
    after,
    rollback,
    enablePath: {
      executableHere: false,
      requiredOperatorAction:
        "Start a disposable local gateway test harness with ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS=1, then query rustGateway.canaryReceipts.status again.",
      defaultFlagState: false,
      localOnlyFlag: "ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS=1",
    },
    duplicateReceiptSafety: {
      unchanged: true,
      requiredReceipts: ["RUST_CANARY_DENIED", "RUST_CANARY_DUPLICATE_PREVENTED"],
      surfaces: ["chat.send", "cron.add", "workflows.run"],
    },
    blockers,
    proof: [
      "before and after checks use only rustGateway.canaryReceipts.status",
      "rollback is a read-only plan with authorityChanges=[]",
      "productionTrafficUsed must remain false",
      "authoritySwitchAllowed must remain false",
      "receipt redaction must remain verified",
    ],
  };
}

export async function gatewayAuthorityLocalRehearsalCommand(
  runtime: Pick<RuntimeEnv, "log">,
  options: GatewayAuthorityLocalRehearsalOptions,
): Promise<GatewayAuthorityLocalRehearsal> {
  const rehearsal = await collectGatewayAuthorityLocalRehearsal(options);
  if (options.json) {
    runtime.log(JSON.stringify(rehearsal, null, 2));
    return rehearsal;
  }

  runtime.log("Gateway authority local rehearsal");
  runtime.log("");
  runtime.log(`Mode: ${rehearsal.mode}`);
  runtime.log(`Status: ${rehearsal.status}`);
  runtime.log(`Explicit opt-in: ${rehearsal.explicitOptIn ? "yes" : "no"}`);
  runtime.log(`Authority changes: none`);
  runtime.log(`Before canary: ${rehearsal.before.status}`);
  runtime.log(`After canary: ${rehearsal.after.status}`);
  runtime.log(`Rollback: ${rehearsal.rollback.mode}`);
  if (rehearsal.blockers.length > 0) {
    runtime.log("");
    runtime.log("Blockers:");
    for (const blocker of rehearsal.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  return rehearsal;
}

async function collectInstalledDaemonCanaryStatus(
  options: GatewayInstalledDaemonCanaryOptions | undefined,
): Promise<GatewayInstalledDaemonCanaryStatus> {
  const url = typeof options?.url === "string" && options.url.trim() ? options.url.trim() : null;
  const token =
    typeof options?.token === "string" && options.token.trim() ? options.token.trim() : undefined;
  const password =
    typeof options?.password === "string" && options.password.trim()
      ? options.password.trim()
      : undefined;
  const timeoutMs =
    typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? Math.min(Math.max(Math.trunc(options.timeoutMs), 250), 30_000)
      : 3000;
  if (!url) {
    return installedCanaryStatus({
      status: "not-configured",
      configured: false,
      queried: false,
      url: null,
      productionTrafficUsed: false,
      canaryFlagEnabled: false,
      authoritySwitchAllowed: false,
      dashboardVisible: null,
      receiptCount: null,
      redactionVerified: null,
      blockers: [
        "installed daemon canary status is default-off; pass --installed-canary-url and explicit credentials to query",
      ],
      error: null,
    });
  }
  if (!token && !password) {
    return installedCanaryStatus({
      status: "blocked",
      configured: true,
      queried: false,
      url,
      productionTrafficUsed: false,
      canaryFlagEnabled: false,
      authoritySwitchAllowed: false,
      dashboardVisible: null,
      receiptCount: null,
      redactionVerified: null,
      blockers: ["explicit installed daemon token or password is required before querying"],
      error: null,
    });
  }

  const requestStatus =
    options?.requestStatus ??
    ((params) =>
      callGateway({
        url: params.url,
        token: params.token,
        password: params.password,
        timeoutMs: params.timeoutMs,
        method: "rustGateway.canaryReceipts.status",
        params: { limit: 20 },
      }));
  try {
    const payload = await requestStatus({ url, token, password, timeoutMs });
    return normalizeInstalledDaemonCanaryPayload(url, payload);
  } catch (error) {
    return installedCanaryStatus({
      status: "unavailable",
      configured: true,
      queried: true,
      url,
      productionTrafficUsed: false,
      canaryFlagEnabled: null,
      authoritySwitchAllowed: false,
      dashboardVisible: null,
      receiptCount: null,
      redactionVerified: null,
      blockers: ["installed daemon canary status query failed"],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeInstalledDaemonCanaryPayload(
  url: string,
  payload: unknown,
): GatewayInstalledDaemonCanaryStatus {
  const record = objectRecord(payload);
  const authority = objectRecord(record?.authority);
  const policy = objectRecord(record?.policy);
  const receipts = Array.isArray(record?.receipts) ? record.receipts : [];
  const blockers: string[] = [];
  const productionTrafficUsed =
    typeof record?.productionTrafficUsed === "boolean" ? record.productionTrafficUsed : null;
  const canaryFlagEnabled =
    typeof record?.canaryFlagEnabled === "boolean" ? record.canaryFlagEnabled : null;
  const authoritySwitchAllowed =
    typeof authority?.authoritySwitchAllowed === "boolean"
      ? authority.authoritySwitchAllowed
      : null;
  const dashboardVisible =
    typeof record?.dashboardVisible === "boolean" ? record.dashboardVisible : null;
  const policyContainsSecrets =
    typeof policy?.containsSecrets === "boolean" ? policy.containsSecrets : null;
  const redactionVerified = receipts.every((receipt) => {
    const receiptRecord = objectRecord(receipt);
    return receiptRecord?.tokenMaterialRedacted !== false;
  });

  if (!record || record.status !== "ok") {
    blockers.push("status payload is missing or not ok");
  }
  if (productionTrafficUsed !== false) {
    blockers.push("productionTrafficUsed is not false");
  }
  if (authoritySwitchAllowed !== false) {
    blockers.push("authoritySwitchAllowed is not false");
  }
  if (policyContainsSecrets !== false) {
    blockers.push("receipt policy does not prove containsSecrets=false");
  }
  if (!redactionVerified) {
    blockers.push("one or more receipts are not marked redacted");
  }

  return installedCanaryStatus({
    status: blockers.length === 0 ? "ok" : "unsafe",
    configured: true,
    queried: true,
    url,
    productionTrafficUsed,
    canaryFlagEnabled,
    authoritySwitchAllowed,
    dashboardVisible,
    receiptCount: receipts.length,
    redactionVerified,
    blockers,
    error: null,
  });
}

function installedCanaryStatus(
  status: Omit<GatewayInstalledDaemonCanaryStatus, "method">,
): GatewayInstalledDaemonCanaryStatus {
  return {
    method: "rustGateway.canaryReceipts.status",
    ...status,
  };
}

function buildLocalRehearsalBlockers(params: {
  explicitOptIn: boolean;
  before: GatewayInstalledDaemonCanaryStatus;
  after: GatewayInstalledDaemonCanaryStatus;
}): string[] {
  const blockers: string[] = [];
  if (!params.explicitOptIn) {
    blockers.push("explicit local-only rehearsal opt-in is required");
  }
  if (params.before.status !== "ok" || !params.before.queried) {
    blockers.push(
      `before status must be a queried ok installed-canary snapshot; got ${params.before.status}`,
    );
  }
  if (params.before.canaryFlagEnabled !== false) {
    blockers.push("before status must prove canaryFlagEnabled=false by default");
  }
  if (params.before.productionTrafficUsed !== false) {
    blockers.push("before status must prove productionTrafficUsed=false");
  }
  if (params.before.authoritySwitchAllowed !== false) {
    blockers.push("before status must prove authoritySwitchAllowed=false");
  }
  if (params.after.status !== "ok") {
    blockers.push(`after status must be ok; got ${params.after.status}`);
  }
  if (params.after.productionTrafficUsed !== false) {
    blockers.push("after status must prove productionTrafficUsed=false");
  }
  if (params.after.authoritySwitchAllowed !== false) {
    blockers.push("after status must prove authoritySwitchAllowed=false");
  }
  if (params.after.canaryFlagEnabled !== true) {
    blockers.push("after status must prove the local canary flag was explicitly enabled");
  }
  if (params.after.redactionVerified !== true) {
    blockers.push("after status must prove canary receipts are redacted");
  }
  if ((params.after.receiptCount ?? 0) < 2) {
    blockers.push("after status must include denial and duplicate-prevention receipts");
  }
  return blockers;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildGatewayAuthorityPromotionGates(params: {
  rustShadow: GatewayAuthorityStatusSummary["rustShadow"];
  parityReport: GatewayAuthorityStatusSummary["parityReport"];
  scheduler: GatewayAuthorityStatusSummary["scheduler"];
}): GatewayAuthorityStatusSummary["promotionGates"] {
  return [
    {
      id: "rust-shadow-health",
      status:
        params.rustShadow.reachable && params.rustShadow.status === "ok" ? "passing" : "blocked",
      reason: params.rustShadow.reachable
        ? `Rust shadow health status is ${params.rustShadow.status ?? "unknown"}`
        : "Rust shadow health is not reachable",
    },
    {
      id: "parity-report",
      status:
        params.parityReport.freshness === "fresh" && params.parityReport.totals?.failed === 0
          ? "passing"
          : "blocked",
      reason:
        params.parityReport.freshness === "fresh"
          ? `latest parity report has ${params.parityReport.totals?.failed ?? "unknown"} failures`
          : `latest parity report is ${params.parityReport.freshness}`,
    },
    {
      id: "promotion-readiness",
      status: params.parityReport.promotionReady === true ? "passing" : "blocked",
      reason: params.parityReport.promotionReady
        ? "parity report says promotion is ready"
        : "parity report still has warnings or blockers",
    },
    {
      id: "scheduler-authority",
      status:
        params.scheduler.schedulerAuthority === "node" &&
        params.scheduler.rustSchedulerAuthority === "shadow-only"
          ? "passing"
          : "blocked",
      reason: "Node remains live scheduler authority; Rust scheduler remains shadow-only",
    },
    {
      id: "rollback-rehearsal",
      status: "not-run",
      reason: "rollback/fallback command is planned but not implemented or rehearsed",
    },
    {
      id: "duplicate-prevention",
      status: "not-run",
      reason:
        "duplicate timers, workflow runs, channel sends, sessions, and agent runs are not yet proven prevented",
    },
  ];
}

export async function gatewayAuthorityRollbackPlanCommand(
  runtime: Pick<RuntimeEnv, "log">,
  options: GatewayAuthorityRollbackPlanOptions,
): Promise<GatewayAuthorityRollbackPlan> {
  const plan = buildGatewayAuthorityRollbackPlan(options);
  if (options.json) {
    runtime.log(JSON.stringify(plan, null, 2));
    return plan;
  }

  runtime.log("Gateway authority rollback plan");
  runtime.log("");
  runtime.log(`Mode: ${plan.mode}`);
  runtime.log(`Executable: no`);
  runtime.log(`Reason: ${plan.reason}`);
  runtime.log("Authority changes: none");
  runtime.log(
    `Current authority: gateway=${plan.currentAuthority.liveGateway}, Rust=${plan.currentAuthority.rustGateway}, scheduler=${plan.currentAuthority.scheduler}, workflows=${plan.currentAuthority.workflows}, channels=${plan.currentAuthority.channels}`,
  );
  runtime.log("");
  runtime.log("Required before executable rollback:");
  for (const item of plan.requiredBeforeExecutableRollback) {
    runtime.log(`- ${item}`);
  }
  runtime.log("");
  runtime.log("Blocked actions:");
  for (const action of plan.blockedActions) {
    runtime.log(`- ${action}`);
  }
  return plan;
}
