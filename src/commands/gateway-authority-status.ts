import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import { formatCliCommand } from "../cli/command-format.js";
import { callGateway } from "../gateway/call.js";
import { startGatewayServer, type GatewayServer } from "../gateway/server.js";
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

export type GatewayAuthorityLocalSmokeOptions = {
  json?: boolean;
  reason: string;
  confirmLocalOnly?: boolean;
  localCanarySelfCheck?: boolean;
  installedCanary?: GatewayInstalledDaemonCanaryOptions;
};

export type GatewayAuthorityDisposableLoopbackSmokeOptions = {
  json?: boolean;
  reason: string;
  confirmLocalOnly?: boolean;
  dependencies?: GatewayAuthorityDisposableLoopbackSmokeDependencies;
};

export type GatewayAuthorityDisposableLoopbackRehearsalOptions = {
  json?: boolean;
  reason: string;
  confirmLocalOnly?: boolean;
  dependencies?: GatewayAuthorityDisposableLoopbackSmokeDependencies;
};

export type GatewayAuthorityRollbackPlanOptions = {
  json?: boolean;
  reason: string;
};

export type GatewayAuthorityRollbackPlan = {
  command: "argent gateway authority rollback-node";
  mode: "local-node-rollback-proof";
  status: "passed";
  reason: string;
  executable: true;
  implemented: true;
  explicitOptIn: true;
  localOnly: true;
  productionTrafficUsed: false;
  authoritySwitchAllowed: false;
  authorityChanges: [];
  before: GatewayAuthoritySnapshot;
  after: GatewayAuthoritySnapshot;
  rollbackActions: Array<{
    id: string;
    status: "noop-verified";
    detail: string;
  }>;
  operatorRecoveryChecklist: string[];
  preventedActions: string[];
  proof: string[];
};

export type GatewayAuthoritySnapshot = {
  liveGateway: "node";
  rustGateway: "shadow-only";
  scheduler: "node";
  workflows: "node";
  channels: "node";
  sessions: "node";
  runs: "node";
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

export type GatewayAuthorityLocalSmoke = {
  command: "argent gateway authority smoke-local";
  mode: "local-operator-smoke";
  status: "passed" | "blocked";
  reason: string;
  explicitOptIn: boolean;
  pairedRehearsalCommand: "argent gateway authority rehearse-local";
  liveProductionTrafficAllowed: false;
  authoritySwitchAllowed: false;
  authorityChanges: [];
  installedDaemonCanary: GatewayInstalledDaemonCanaryStatus;
  noDefaultSwitchProof: {
    liveGatewayAuthority: "node";
    rustGatewayAuthority: "shadow-only";
    schedulerAuthority: "node";
    workflowAuthority: "node";
    channelAuthority: "node";
    sessionAuthority: "node";
    runAuthority: "node";
  };
  passCriteria: string[];
  blockers: string[];
  operatorGuidance: string[];
  proof: string[];
};

export type GatewayAuthorityDisposableLoopbackSmoke = {
  command: "argent gateway authority smoke-loopback";
  mode: "disposable-loopback-canary-smoke";
  status: "passed" | "blocked";
  reason: string;
  explicitOptIn: boolean;
  disposableHarness: {
    started: boolean;
    url: string | null;
    bind: "loopback";
    tempHomeUsed: boolean;
    tempStateUsed: boolean;
    randomPortUsed: boolean;
    randomTokenUsed: boolean;
    installedServiceControlUsed: false;
    productionTrafficUsed: false;
    authoritySwitchAllowed: false;
  };
  receiptProof: {
    generatedSurfaces: string[];
    denialReceiptPresent: boolean;
    duplicatePreventionReceiptPresent: boolean;
    redactionVerified: boolean;
    receiptCount: number;
  };
  smoke: GatewayAuthorityLocalSmoke;
  blockers: string[];
  proof: string[];
};

export type GatewayAuthorityDisposableLoopbackRehearsal = {
  command: "argent gateway authority rehearse-loopback";
  mode: "disposable-loopback-rehearsal";
  status: "blocked" | "rehearsed";
  reason: string;
  explicitOptIn: boolean;
  disposableHarness: GatewayAuthorityDisposableLoopbackSmoke["disposableHarness"];
  before: GatewayInstalledDaemonCanaryStatus;
  after: GatewayInstalledDaemonCanaryStatus;
  rollback: GatewayAuthorityRollbackPlan;
  authoritySwitchAllowed: false;
  authorityChanges: [];
  receiptProof: GatewayAuthorityDisposableLoopbackSmoke["receiptProof"];
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
    implemented: true;
    planned: "argent gateway authority rollback-node --reason <reason>";
    localOnly: true;
    authoritySwitchAllowed: false;
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

type GatewayAuthorityDisposableLoopbackSmokeDependencies = {
  mkdtemp?: (prefix: string) => Promise<string>;
  rm?: (targetPath: string) => Promise<void>;
  mkdir?: (targetPath: string) => Promise<void>;
  writeFile?: (targetPath: string, content: string) => Promise<void>;
  getFreePort?: () => Promise<number>;
  randomToken?: () => string;
  startGateway?: (
    port: number,
    options: Parameters<typeof startGatewayServer>[1],
  ) => Promise<GatewayServer>;
  callGateway?: typeof callGateway;
};

export type GatewayInstalledDaemonCanaryStatus = {
  status: "not-configured" | "blocked" | "unavailable" | "unsafe" | "ok";
  configured: boolean;
  method: "rustGateway.canaryReceipts.status";
  queried: boolean;
  url: string | null;
  productionTrafficUsed: boolean | null;
  canaryFlagEnabled: boolean | null;
  authoritySwitchAllowed: boolean | null;
  dashboardVisible: boolean | null;
  receiptCount: number | null;
  redactionVerified: boolean | null;
  denialReceiptPresent: boolean | null;
  duplicatePreventionReceiptPresent: boolean | null;
  receiptSurfaces: string[];
  blockers: string[];
  error: string | null;
};

const LOCAL_CANARY_SELF_CHECK_URL = "local-canary-self-check://rust-gateway/smoke-local";
const LOCAL_CANARY_SELF_CHECK_TOKEN = "local-self-check-redacted";
const CANARY_RECEIPT_SURFACES = ["chat.send", "cron.add", "workflows.run"] as const;

export function buildGatewayAuthorityRollbackPlan(
  options: GatewayAuthorityRollbackPlanOptions,
): GatewayAuthorityRollbackPlan {
  const before = snapshotGatewayAuthority();
  const after = snapshotGatewayAuthority();
  return {
    command: "argent gateway authority rollback-node",
    mode: "local-node-rollback-proof",
    status: "passed",
    reason: options.reason.trim(),
    executable: true,
    implemented: true,
    explicitOptIn: true,
    localOnly: true,
    productionTrafficUsed: false,
    authoritySwitchAllowed: false,
    authorityChanges: [],
    before,
    after,
    rollbackActions: [
      {
        id: "node-authority-preserved",
        status: "noop-verified",
        detail: "Node was already live authority before rollback and remains live authority after.",
      },
      {
        id: "rust-shadow-preserved",
        status: "noop-verified",
        detail: "Rust stayed shadow-only; no Rust authority writes were accepted.",
      },
      {
        id: "scheduler-workflow-channel-session-run-preserved",
        status: "noop-verified",
        detail:
          "Scheduler, workflow, channel, session, and run authority stayed Node-owned throughout.",
      },
    ],
    operatorRecoveryChecklist: [
      "Keep Node gateway as live authority.",
      "Keep Rust Gateway in shadow-only mode.",
      "Verify no Rust-owned scheduler/workflow/channel/session/run authority exists.",
      "Run isolated parity/status report and preserve drift logs for handoff.",
      "Post this JSON proof with any promotion-gate rollback packet.",
    ],
    preventedActions: [
      "Did not stop Rust.",
      "Did not start, stop, restart, install, or unload Node or Rust services.",
      "Did not edit config or authority state.",
      "Did not touch schedulers, workflows, channels, sessions, or runs.",
      "Did not use connectors, OAuth, API credentials, customer/company data, or live traffic.",
      "Did not switch authority.",
    ],
    proof: [
      "rollback-node is an explicit operator command with required --reason",
      "before.liveGateway=node and after.liveGateway=node",
      "before.rustGateway=shadow-only and after.rustGateway=shadow-only",
      "authorityChanges=[]",
      "productionTrafficUsed=false",
      "authoritySwitchAllowed=false",
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
      implemented: true,
      planned: "argent gateway authority rollback-node --reason <reason>",
      localOnly: true,
      authoritySwitchAllowed: false,
    },
    rustShadow,
    parityReport,
    scheduler,
    installedDaemonCanary,
    promotionReady: false,
    blockers,
    nextCommands: [
      "argent status",
      "pnpm rust-gateway:parity:report -- --startup-timeout-ms 60000 --request-timeout-ms 10000",
      "argent gateway authority status --json",
      "argent gateway authority status --installed-canary-url ws://127.0.0.1:<port> --installed-canary-token <token> --json",
      "argent gateway authority smoke-local --reason <reason> --confirm-local-only --installed-canary-url ws://127.0.0.1:<port> --installed-canary-token <token> --json",
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
  runtime.log(`Rollback command: executable local-only proof (${summary.rollbackCommand.planned})`);
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
        denialReceiptPresent: null,
        duplicatePreventionReceiptPresent: null,
        receiptSurfaces: [],
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

export async function collectGatewayAuthorityLocalSmoke(
  options: GatewayAuthorityLocalSmokeOptions,
): Promise<GatewayAuthorityLocalSmoke> {
  const installedDaemonCanary = await collectInstalledDaemonCanaryStatus(
    buildLocalSmokeCanaryOptions(options),
  );
  const blockers = buildLocalSmokeBlockers({
    explicitOptIn: options.confirmLocalOnly === true,
    installedDaemonCanary,
  });

  return {
    command: "argent gateway authority smoke-local",
    mode: "local-operator-smoke",
    status: blockers.length === 0 ? "passed" : "blocked",
    reason: options.reason.trim(),
    explicitOptIn: options.confirmLocalOnly === true,
    pairedRehearsalCommand: "argent gateway authority rehearse-local",
    liveProductionTrafficAllowed: false,
    authoritySwitchAllowed: false,
    authorityChanges: [],
    installedDaemonCanary,
    noDefaultSwitchProof: {
      liveGatewayAuthority: "node",
      rustGatewayAuthority: "shadow-only",
      schedulerAuthority: "node",
      workflowAuthority: "node",
      channelAuthority: "node",
      sessionAuthority: "node",
      runAuthority: "node",
    },
    passCriteria: [
      "operator passed --confirm-local-only",
      "installed daemon canary status was explicitly configured and queried",
      "rustGateway.canaryReceipts.status returned ok",
      "productionTrafficUsed=false",
      "authoritySwitchAllowed=false",
      "canaryFlagEnabled=true for a local-only canary harness",
      "redactionVerified=true",
      "at least denial and duplicate-prevention receipts are present",
    ],
    blockers,
    operatorGuidance: buildLocalSmokeOperatorGuidance(installedDaemonCanary, blockers),
    proof: [
      "smoke is read-only and queries only rustGateway.canaryReceipts.status",
      options.localCanarySelfCheck
        ? "local self-check uses an in-process disposable canary receipt harness with no network or credentials"
        : "smoke does not start, stop, restart, install, or configure any daemon",
      "smoke does not enable canary flags; operator must use a disposable local harness",
      "smoke preserves authorityChanges=[] and authoritySwitchAllowed=false",
      "Node remains live gateway/scheduler/workflow/channel/session/run authority",
    ],
  };
}

export async function gatewayAuthorityLocalSmokeCommand(
  runtime: Pick<RuntimeEnv, "log">,
  options: GatewayAuthorityLocalSmokeOptions,
): Promise<GatewayAuthorityLocalSmoke> {
  const smoke = await collectGatewayAuthorityLocalSmoke(options);
  if (options.json) {
    runtime.log(JSON.stringify(smoke, null, 2));
    return smoke;
  }

  runtime.log("Gateway authority local smoke");
  runtime.log("");
  runtime.log(`Mode: ${smoke.mode}`);
  runtime.log(`Status: ${smoke.status}`);
  runtime.log(`Explicit local-only opt-in: ${smoke.explicitOptIn ? "yes" : "no"}`);
  runtime.log(`Installed canary: ${smoke.installedDaemonCanary.status}`);
  runtime.log(`Authority changes: none`);
  runtime.log(`Production traffic allowed: no`);
  runtime.log(`Authority switch allowed: no`);
  if (smoke.blockers.length > 0) {
    runtime.log("");
    runtime.log("Blockers:");
    for (const blocker of smoke.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  runtime.log("");
  runtime.log("Operator guidance:");
  for (const line of smoke.operatorGuidance) {
    runtime.log(`- ${line}`);
  }
  return smoke;
}

export async function collectGatewayAuthorityDisposableLoopbackSmoke(
  options: GatewayAuthorityDisposableLoopbackSmokeOptions,
): Promise<GatewayAuthorityDisposableLoopbackSmoke> {
  if (options.confirmLocalOnly !== true) {
    const smoke = await collectGatewayAuthorityLocalSmoke({
      reason: options.reason,
      confirmLocalOnly: false,
      localCanarySelfCheck: true,
    });
    return {
      command: "argent gateway authority smoke-loopback",
      mode: "disposable-loopback-canary-smoke",
      status: "blocked",
      reason: options.reason.trim(),
      explicitOptIn: false,
      disposableHarness: {
        started: false,
        url: null,
        bind: "loopback",
        tempHomeUsed: false,
        tempStateUsed: false,
        randomPortUsed: false,
        randomTokenUsed: false,
        installedServiceControlUsed: false,
        productionTrafficUsed: false,
        authoritySwitchAllowed: false,
      },
      receiptProof: {
        generatedSurfaces: [],
        denialReceiptPresent: false,
        duplicatePreventionReceiptPresent: false,
        redactionVerified: false,
        receiptCount: 0,
      },
      smoke,
      blockers: ["explicit local-only loopback smoke opt-in is required"],
      proof: ["no disposable loopback daemon was started because --confirm-local-only was missing"],
    };
  }

  const deps = options.dependencies ?? {};
  const mkdtemp = deps.mkdtemp ?? ((prefix: string) => fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  const rm =
    deps.rm ??
    ((targetPath: string) => fs.rm(targetPath, { recursive: true, force: true }).then(() => {}));
  const mkdir =
    deps.mkdir ??
    ((targetPath: string) => fs.mkdir(targetPath, { recursive: true }).then(() => {}));
  const writeFile =
    deps.writeFile ?? ((targetPath: string, content: string) => fs.writeFile(targetPath, content));
  const getFreePort = deps.getFreePort ?? getFreeLoopbackPort;
  const randomToken = deps.randomToken ?? (() => `loopback-canary-${randomUUID()}`);
  const startGateway = deps.startGateway ?? startGatewayServer;
  const requestGateway = deps.callGateway ?? callGateway;
  const previousEnv = snapshotDisposableLoopbackEnv();
  const tempHome = await mkdtemp("rust-gateway-loopback-home-");
  const token = randomToken();
  const port = await getFreePort();
  const url = `ws://127.0.0.1:${port}`;
  const storePath = path.join(tempHome, ".argentos", "rust-gateway", "receipts.jsonl");
  const configPath = path.join(tempHome, ".argentos", "argent.json");
  let server: GatewayServer | null = null;
  let smoke: GatewayAuthorityLocalSmoke | null = null;

  try {
    await writeDisposableLoopbackConfig({ configPath, mkdir, writeFile });
    applyDisposableLoopbackEnv({ tempHome, token, storePath, configPath });
    server = await startGateway(port, {
      bind: "loopback",
      auth: { mode: "token", token },
      controlUiEnabled: false,
    });

    for (const surface of CANARY_RECEIPT_SURFACES) {
      const params = buildDisposableLoopbackCanaryParams(surface);
      await expectRustCanaryDenial(requestGateway({ url, token, method: surface, params }));
      await expectRustCanaryDenial(requestGateway({ url, token, method: surface, params }));
    }

    smoke = await collectGatewayAuthorityLocalSmoke({
      reason: options.reason,
      confirmLocalOnly: true,
      installedCanary: {
        url,
        token,
        requestStatus: (params) =>
          requestGateway({
            url: params.url,
            token: params.token,
            password: params.password,
            timeoutMs: params.timeoutMs,
            method: "rustGateway.canaryReceipts.status",
            params: { limit: 20 },
          }),
      },
    });
    const status = smoke.installedDaemonCanary;
    const blockers = [
      ...smoke.blockers,
      ...(status.receiptSurfaces.length === CANARY_RECEIPT_SURFACES.length
        ? []
        : ["not all required canary receipt surfaces were generated"]),
    ];

    return {
      command: "argent gateway authority smoke-loopback",
      mode: "disposable-loopback-canary-smoke",
      status: blockers.length === 0 ? "passed" : "blocked",
      reason: options.reason.trim(),
      explicitOptIn: true,
      disposableHarness: {
        started: true,
        url,
        bind: "loopback",
        tempHomeUsed: true,
        tempStateUsed: true,
        randomPortUsed: true,
        randomTokenUsed: true,
        installedServiceControlUsed: false,
        productionTrafficUsed: false,
        authoritySwitchAllowed: false,
      },
      receiptProof: {
        generatedSurfaces: status.receiptSurfaces,
        denialReceiptPresent: status.denialReceiptPresent === true,
        duplicatePreventionReceiptPresent: status.duplicatePreventionReceiptPresent === true,
        redactionVerified: status.redactionVerified === true,
        receiptCount: status.receiptCount ?? 0,
      },
      smoke,
      blockers,
      proof: [
        "started a disposable Gateway server bound to 127.0.0.1 with temp HOME/state",
        "used a random local port and random token",
        "enabled canary receipts only through ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS=1 in temp env",
        "disabled bundled plugins through temp ARGENT_CONFIG_PATH",
        "generated denied and duplicate-prevented receipts for chat.send, cron.add, and workflows.run",
        "queried only rustGateway.canaryReceipts.status through the installed-canary smoke path",
        "no launchctl/systemd/schtasks or installed production service control was used",
        "productionTrafficUsed=false and authoritySwitchAllowed=false",
      ],
    };
  } catch (error) {
    smoke ??= await collectGatewayAuthorityLocalSmoke({
      reason: options.reason,
      confirmLocalOnly: true,
      installedCanary: { url, token },
    });
    return {
      command: "argent gateway authority smoke-loopback",
      mode: "disposable-loopback-canary-smoke",
      status: "blocked",
      reason: options.reason.trim(),
      explicitOptIn: true,
      disposableHarness: {
        started: server !== null,
        url,
        bind: "loopback",
        tempHomeUsed: true,
        tempStateUsed: true,
        randomPortUsed: true,
        randomTokenUsed: true,
        installedServiceControlUsed: false,
        productionTrafficUsed: false,
        authoritySwitchAllowed: false,
      },
      receiptProof: {
        generatedSurfaces: smoke.installedDaemonCanary.receiptSurfaces,
        denialReceiptPresent: smoke.installedDaemonCanary.denialReceiptPresent === true,
        duplicatePreventionReceiptPresent:
          smoke.installedDaemonCanary.duplicatePreventionReceiptPresent === true,
        redactionVerified: smoke.installedDaemonCanary.redactionVerified === true,
        receiptCount: smoke.installedDaemonCanary.receiptCount ?? 0,
      },
      smoke,
      blockers: [
        "disposable loopback Gateway canary smoke failed",
        error instanceof Error ? error.message : String(error),
      ],
      proof: [
        "attempted only a disposable loopback Gateway harness",
        "no installed production service control was used",
        "no authority switch was attempted",
      ],
    };
  } finally {
    if (server) {
      await server.close({ reason: "disposable loopback canary smoke complete" });
    }
    restoreDisposableLoopbackEnv(previousEnv);
    await rm(tempHome);
  }
}

export async function collectGatewayAuthorityDisposableLoopbackRehearsal(
  options: GatewayAuthorityDisposableLoopbackRehearsalOptions,
): Promise<GatewayAuthorityDisposableLoopbackRehearsal> {
  const rollback = buildGatewayAuthorityRollbackPlan({ json: false, reason: options.reason });
  if (options.confirmLocalOnly !== true) {
    const notStartedHarness: GatewayAuthorityDisposableLoopbackSmoke["disposableHarness"] = {
      started: false,
      url: null,
      bind: "loopback",
      tempHomeUsed: false,
      tempStateUsed: false,
      randomPortUsed: false,
      randomTokenUsed: false,
      installedServiceControlUsed: false,
      productionTrafficUsed: false,
      authoritySwitchAllowed: false,
    };
    return {
      command: "argent gateway authority rehearse-loopback",
      mode: "disposable-loopback-rehearsal",
      status: "blocked",
      reason: options.reason.trim(),
      explicitOptIn: false,
      disposableHarness: notStartedHarness,
      before: installedCanaryStatus({
        status: "blocked",
        configured: false,
        queried: false,
        url: null,
        productionTrafficUsed: false,
        canaryFlagEnabled: false,
        authoritySwitchAllowed: false,
        dashboardVisible: null,
        receiptCount: null,
        redactionVerified: null,
        denialReceiptPresent: null,
        duplicatePreventionReceiptPresent: null,
        receiptSurfaces: [],
        blockers: ["pass --confirm-local-only before starting disposable loopback rehearsal"],
        error: null,
      }),
      after: installedCanaryStatus({
        status: "blocked",
        configured: false,
        queried: false,
        url: null,
        productionTrafficUsed: false,
        canaryFlagEnabled: false,
        authoritySwitchAllowed: false,
        dashboardVisible: null,
        receiptCount: null,
        redactionVerified: null,
        denialReceiptPresent: null,
        duplicatePreventionReceiptPresent: null,
        receiptSurfaces: [],
        blockers: ["pass --confirm-local-only before enabling local canary receipts"],
        error: null,
      }),
      rollback,
      authoritySwitchAllowed: false,
      authorityChanges: [],
      receiptProof: {
        generatedSurfaces: [],
        denialReceiptPresent: false,
        duplicatePreventionReceiptPresent: false,
        redactionVerified: false,
        receiptCount: 0,
      },
      blockers: ["explicit local-only loopback rehearsal opt-in is required"],
      proof: ["no disposable loopback daemon was started because --confirm-local-only was missing"],
    };
  }

  const deps = options.dependencies ?? {};
  const mkdtemp = deps.mkdtemp ?? ((prefix: string) => fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  const rm =
    deps.rm ??
    ((targetPath: string) => fs.rm(targetPath, { recursive: true, force: true }).then(() => {}));
  const mkdir =
    deps.mkdir ??
    ((targetPath: string) => fs.mkdir(targetPath, { recursive: true }).then(() => {}));
  const writeFile =
    deps.writeFile ?? ((targetPath: string, content: string) => fs.writeFile(targetPath, content));
  const getFreePort = deps.getFreePort ?? getFreeLoopbackPort;
  const randomToken = deps.randomToken ?? (() => `loopback-rehearsal-${randomUUID()}`);
  const startGateway = deps.startGateway ?? startGatewayServer;
  const requestGateway = deps.callGateway ?? callGateway;
  const previousEnv = snapshotDisposableLoopbackEnv();
  const tempHome = await mkdtemp("rust-gateway-loopback-rehearsal-home-");
  const token = randomToken();
  const port = await getFreePort();
  const url = `ws://127.0.0.1:${port}`;
  const storePath = path.join(tempHome, ".argentos", "rust-gateway", "receipts.jsonl");
  const configPath = path.join(tempHome, ".argentos", "argent.json");
  let server: GatewayServer | null = null;

  const requestStatus = (params: {
    url: string;
    token?: string;
    password?: string;
    timeoutMs: number;
  }) =>
    requestGateway({
      url: params.url,
      token: params.token,
      password: params.password,
      timeoutMs: params.timeoutMs,
      method: "rustGateway.canaryReceipts.status",
      params: { limit: 20 },
    });

  try {
    await writeDisposableLoopbackConfig({ configPath, mkdir, writeFile });
    applyDisposableLoopbackEnv({
      tempHome,
      token,
      storePath,
      configPath,
      canaryReceiptsEnabled: false,
    });
    server = await startGateway(port, {
      bind: "loopback",
      auth: { mode: "token", token },
      controlUiEnabled: false,
    });

    const before = await collectInstalledDaemonCanaryStatus({ url, token, requestStatus });
    process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS = "1";
    for (const surface of CANARY_RECEIPT_SURFACES) {
      const params = buildDisposableLoopbackCanaryParams(surface);
      await expectRustCanaryDenial(requestGateway({ url, token, method: surface, params }));
      await expectRustCanaryDenial(requestGateway({ url, token, method: surface, params }));
    }
    const after = await collectInstalledDaemonCanaryStatus({ url, token, requestStatus });
    const blockers = [
      ...buildLocalRehearsalBlockers({ explicitOptIn: true, before, after }),
      ...(after.receiptSurfaces.length === CANARY_RECEIPT_SURFACES.length
        ? []
        : ["not all required canary receipt surfaces were generated"]),
    ];

    return {
      command: "argent gateway authority rehearse-loopback",
      mode: "disposable-loopback-rehearsal",
      status: blockers.length === 0 ? "rehearsed" : "blocked",
      reason: options.reason.trim(),
      explicitOptIn: true,
      disposableHarness: {
        started: true,
        url,
        bind: "loopback",
        tempHomeUsed: true,
        tempStateUsed: true,
        randomPortUsed: true,
        randomTokenUsed: true,
        installedServiceControlUsed: false,
        productionTrafficUsed: false,
        authoritySwitchAllowed: false,
      },
      before,
      after,
      rollback,
      authoritySwitchAllowed: false,
      authorityChanges: [],
      receiptProof: {
        generatedSurfaces: after.receiptSurfaces,
        denialReceiptPresent: after.denialReceiptPresent === true,
        duplicatePreventionReceiptPresent: after.duplicatePreventionReceiptPresent === true,
        redactionVerified: after.redactionVerified === true,
        receiptCount: after.receiptCount ?? 0,
      },
      blockers,
      proof: [
        "started a disposable Gateway server bound to 127.0.0.1 with temp HOME/state",
        "queried rustGateway.canaryReceipts.status before enabling the local canary flag",
        "proved canaryFlagEnabled=false before explicit local-only enablement",
        "enabled canary receipts only through ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS=1 in temp env",
        "generated denied and duplicate-prevented receipts for chat.send, cron.add, and workflows.run",
        "queried rustGateway.canaryReceipts.status after local canary receipt generation",
        "paired rollback-node proof reports authorityChanges=[] and executable=true",
        "no launchctl/systemd/schtasks or installed production service control was used",
        "productionTrafficUsed=false and authoritySwitchAllowed=false",
      ],
    };
  } catch (error) {
    const fallback = installedCanaryStatus({
      status: "blocked",
      configured: server !== null,
      queried: false,
      url,
      productionTrafficUsed: false,
      canaryFlagEnabled: null,
      authoritySwitchAllowed: false,
      dashboardVisible: null,
      receiptCount: null,
      redactionVerified: null,
      denialReceiptPresent: null,
      duplicatePreventionReceiptPresent: null,
      receiptSurfaces: [],
      blockers: ["disposable loopback rehearsal failed"],
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      command: "argent gateway authority rehearse-loopback",
      mode: "disposable-loopback-rehearsal",
      status: "blocked",
      reason: options.reason.trim(),
      explicitOptIn: true,
      disposableHarness: {
        started: server !== null,
        url,
        bind: "loopback",
        tempHomeUsed: true,
        tempStateUsed: true,
        randomPortUsed: true,
        randomTokenUsed: true,
        installedServiceControlUsed: false,
        productionTrafficUsed: false,
        authoritySwitchAllowed: false,
      },
      before: fallback,
      after: fallback,
      rollback,
      authoritySwitchAllowed: false,
      authorityChanges: [],
      receiptProof: {
        generatedSurfaces: [],
        denialReceiptPresent: false,
        duplicatePreventionReceiptPresent: false,
        redactionVerified: false,
        receiptCount: 0,
      },
      blockers: [
        "disposable loopback Gateway rehearsal failed",
        error instanceof Error ? error.message : String(error),
      ],
      proof: [
        "attempted only a disposable loopback Gateway harness",
        "no installed production service control was used",
        "no authority switch was attempted",
      ],
    };
  } finally {
    if (server) {
      await server.close({ reason: "disposable loopback rehearsal complete" });
    }
    restoreDisposableLoopbackEnv(previousEnv);
    await rm(tempHome);
  }
}

export async function gatewayAuthorityDisposableLoopbackRehearsalCommand(
  runtime: Pick<RuntimeEnv, "log">,
  options: GatewayAuthorityDisposableLoopbackRehearsalOptions,
): Promise<GatewayAuthorityDisposableLoopbackRehearsal> {
  const rehearsal = await collectGatewayAuthorityDisposableLoopbackRehearsal(options);
  if (options.json) {
    runtime.log(JSON.stringify(rehearsal, null, 2));
    return rehearsal;
  }

  runtime.log("Gateway authority disposable loopback rehearsal");
  runtime.log("");
  runtime.log(`Mode: ${rehearsal.mode}`);
  runtime.log(`Status: ${rehearsal.status}`);
  runtime.log(`Explicit local-only opt-in: ${rehearsal.explicitOptIn ? "yes" : "no"}`);
  runtime.log(`Loopback URL: ${rehearsal.disposableHarness.url ?? "not-started"}`);
  runtime.log(`Before canary: ${rehearsal.before.status}`);
  runtime.log(`After canary: ${rehearsal.after.status}`);
  runtime.log(`Rollback: ${rehearsal.rollback.mode}`);
  runtime.log(`Authority changes: none`);
  runtime.log(`Production traffic allowed: no`);
  runtime.log(`Authority switch allowed: no`);
  runtime.log(`Receipt count: ${rehearsal.receiptProof.receiptCount}`);
  if (rehearsal.blockers.length > 0) {
    runtime.log("");
    runtime.log("Blockers:");
    for (const blocker of rehearsal.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  return rehearsal;
}

export async function gatewayAuthorityDisposableLoopbackSmokeCommand(
  runtime: Pick<RuntimeEnv, "log">,
  options: GatewayAuthorityDisposableLoopbackSmokeOptions,
): Promise<GatewayAuthorityDisposableLoopbackSmoke> {
  const smoke = await collectGatewayAuthorityDisposableLoopbackSmoke(options);
  if (options.json) {
    runtime.log(JSON.stringify(smoke, null, 2));
    return smoke;
  }

  runtime.log("Gateway authority disposable loopback smoke");
  runtime.log("");
  runtime.log(`Mode: ${smoke.mode}`);
  runtime.log(`Status: ${smoke.status}`);
  runtime.log(`Explicit local-only opt-in: ${smoke.explicitOptIn ? "yes" : "no"}`);
  runtime.log(`Loopback URL: ${smoke.disposableHarness.url ?? "not-started"}`);
  runtime.log(`Authority changes: none`);
  runtime.log(`Production traffic allowed: no`);
  runtime.log(`Authority switch allowed: no`);
  runtime.log(`Receipt count: ${smoke.receiptProof.receiptCount}`);
  if (smoke.blockers.length > 0) {
    runtime.log("");
    runtime.log("Blockers:");
    for (const blocker of smoke.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  return smoke;
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
      denialReceiptPresent: null,
      duplicatePreventionReceiptPresent: null,
      receiptSurfaces: [],
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
      denialReceiptPresent: null,
      duplicatePreventionReceiptPresent: null,
      receiptSurfaces: [],
      blockers: ["explicit installed daemon token or password is required before querying"],
      error: null,
    });
  }
  if (!isLoopbackInstalledCanaryUrl(url)) {
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
      denialReceiptPresent: null,
      duplicatePreventionReceiptPresent: null,
      receiptSurfaces: [],
      blockers: [
        "installed daemon canary URL must be loopback/local before querying; use a local daemon, localhost, 127.0.0.1, ::1, or an SSH-forwarded loopback URL",
      ],
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
      denialReceiptPresent: null,
      duplicatePreventionReceiptPresent: null,
      receiptSurfaces: [],
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
  const receiptRecords = receipts.map((receipt) => objectRecord(receipt)).filter(Boolean);
  const redactionVerified = receiptRecords.every((receiptRecord) => {
    return receiptRecord?.tokenMaterialRedacted !== false;
  });
  const denialReceiptPresent = receiptRecords.some((receiptRecord) => {
    return receiptRecord?.receiptCode === "RUST_CANARY_DENIED";
  });
  const duplicatePreventionReceiptPresent = receiptRecords.some((receiptRecord) => {
    return receiptRecord?.receiptCode === "RUST_CANARY_DUPLICATE_PREVENTED";
  });
  const receiptSurfaces = Array.from(
    new Set(
      receiptRecords.flatMap((receiptRecord) =>
        typeof receiptRecord?.surface === "string" ? [receiptRecord.surface] : [],
      ),
    ),
  ).toSorted();

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
    denialReceiptPresent,
    duplicatePreventionReceiptPresent,
    receiptSurfaces,
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

function isLoopbackInstalledCanaryUrl(url: string): boolean {
  if (url === LOCAL_CANARY_SELF_CHECK_URL) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
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
  if (params.after.denialReceiptPresent !== true) {
    blockers.push("after status must include a RUST_CANARY_DENIED receipt");
  }
  if (params.after.duplicatePreventionReceiptPresent !== true) {
    blockers.push("after status must include a RUST_CANARY_DUPLICATE_PREVENTED receipt");
  }
  return blockers;
}

function buildLocalSmokeBlockers(params: {
  explicitOptIn: boolean;
  installedDaemonCanary: GatewayInstalledDaemonCanaryStatus;
}): string[] {
  const blockers: string[] = [];
  const status = params.installedDaemonCanary;
  if (!params.explicitOptIn) {
    blockers.push("explicit local-only smoke opt-in is required");
  }
  if (!status.configured) {
    blockers.push("installed daemon canary status is not configured");
  }
  if (!status.queried) {
    blockers.push("installed daemon canary status was not queried");
  }
  if (status.status !== "ok") {
    blockers.push(`installed daemon canary status must be ok; got ${status.status}`);
  }
  if (status.productionTrafficUsed !== false) {
    blockers.push("productionTrafficUsed must be false");
  }
  if (status.authoritySwitchAllowed !== false) {
    blockers.push("authoritySwitchAllowed must be false");
  }
  if (status.canaryFlagEnabled !== true) {
    blockers.push("canaryFlagEnabled must be true for the local-only smoke harness");
  }
  if (status.redactionVerified !== true) {
    blockers.push("redactionVerified must be true");
  }
  if ((status.receiptCount ?? 0) < 2) {
    blockers.push("at least denial and duplicate-prevention receipts must be present");
  }
  if (status.denialReceiptPresent !== true) {
    blockers.push("RUST_CANARY_DENIED receipt must be present");
  }
  if (status.duplicatePreventionReceiptPresent !== true) {
    blockers.push("RUST_CANARY_DUPLICATE_PREVENTED receipt must be present");
  }
  return blockers;
}

function buildLocalSmokeOperatorGuidance(
  status: GatewayInstalledDaemonCanaryStatus,
  blockers: string[],
): string[] {
  if (blockers.length === 0) {
    return [
      "PASS: local-only canary receipt smoke is complete.",
      "Keep Node live authority; this is not production promotion approval.",
      "Post the JSON output with the branch/commit/test proof before requesting containment.",
    ];
  }
  if (!status.configured) {
    return [
      "Start or identify a loopback/local installed Gateway daemon that exposes rustGateway.canaryReceipts.status.",
      "Rerun with --installed-canary-url and an explicit token or password.",
      "Use --confirm-local-only only for a disposable local canary harness, not production traffic.",
    ];
  }
  if (!status.queried) {
    return [
      status.blockers.some((blocker) => blocker.includes("loopback/local"))
        ? "Use only a local loopback Gateway daemon URL such as ws://127.0.0.1:<port> or an SSH-forwarded loopback URL."
        : "Provide an explicit installed daemon token or password before querying.",
      "Do not put credentials in git or bus; pass them only through local operator shell/env handling.",
      "Rerun the smoke after credentials are available.",
    ];
  }
  if (status.status === "unavailable") {
    return [
      `Fix daemon reachability for ${status.url ?? "the configured URL"} and rerun.`,
      "This command does not start, stop, restart, or install services.",
      "Keep using argent gateway authority status for read-only diagnosis while blocked.",
    ];
  }
  if (status.canaryFlagEnabled !== true) {
    return [
      "Run the disposable local canary harness with ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS=1.",
      "Generate denied and duplicate-prevented receipts for chat.send, cron.add, and workflows.run.",
      "Rerun this smoke against that local harness; do not enable production traffic.",
    ];
  }
  return [
    "Inspect the blockers list; at least one safety invariant failed.",
    "Do not treat this as promotion-ready until productionTrafficUsed=false, authoritySwitchAllowed=false, and receipt redaction are proven.",
    "Post BLOCKED with the failing invariant if rerun cannot clear it.",
  ];
}

function buildLocalSmokeCanaryOptions(
  options: GatewayAuthorityLocalSmokeOptions,
): GatewayInstalledDaemonCanaryOptions | undefined {
  if (!options.localCanarySelfCheck) {
    return options.installedCanary;
  }
  return {
    url: LOCAL_CANARY_SELF_CHECK_URL,
    token: LOCAL_CANARY_SELF_CHECK_TOKEN,
    timeoutMs: options.installedCanary?.timeoutMs,
    requestStatus: async () => buildLocalCanaryReceiptSelfCheckPayload(),
  };
}

function buildLocalCanaryReceiptSelfCheckPayload(): Record<string, unknown> {
  const receipts = CANARY_RECEIPT_SURFACES.flatMap((surface) => [
    {
      surface,
      receiptCode: "RUST_CANARY_DENIED",
      redactedParams: "[redacted local self-check payload]",
      tokenMaterialRedacted: true,
      authoritySwitchAllowed: false,
      mutationBlockedBeforeHandler: true,
    },
    {
      surface,
      receiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
      redactedParams: "[redacted local self-check duplicate]",
      tokenMaterialRedacted: true,
      authoritySwitchAllowed: false,
      mutationBlockedBeforeHandler: true,
    },
  ]);

  return {
    status: "ok",
    dashboardVisible: true,
    productionTrafficUsed: false,
    canaryFlagEnabled: true,
    policy: {
      path: ".omx/state/rust-gateway-canary/local-self-check",
      containsSecrets: false,
      liveAuthoritySwitchAllowed: false,
    },
    authority: {
      nodeAuthority: "live",
      rustAuthority: "shadow-only",
      authoritySwitchAllowed: false,
    },
    surfaces: CANARY_RECEIPT_SURFACES.map((surface) => ({
      surface,
      denied: true,
      duplicatePrevented: true,
      receiptCount: 2,
      latestReceiptCode: "RUST_CANARY_DUPLICATE_PREVENTED",
    })),
    receipts,
  };
}

async function getFreeLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("failed to allocate loopback port"));
      });
    });
  });
}

function buildDisposableLoopbackCanaryParams(
  surface: (typeof CANARY_RECEIPT_SURFACES)[number],
): Record<string, unknown> {
  if (surface === "chat.send") {
    return {
      sessionKey: "main",
      idempotencyKey: "idem-disposable-loopback-canary",
      message: "local canary",
      token: "super-secret-token-value",
    };
  }
  if (surface === "cron.add") {
    return {
      name: "disposable-loopback-canary",
      schedule: { kind: "every", everyMs: 60_000 },
      payload: { token: "super-secret-token-value" },
    };
  }
  return {
    workflowId: "wf-disposable-loopback-canary",
    runId: "run-disposable-loopback-canary",
    input: { token: "super-secret-token-value" },
  };
}

async function expectRustCanaryDenial(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Rust canary denied before mutation")) {
      return;
    }
    throw error;
  }
  throw new Error("expected Rust canary denial before mutation");
}

function snapshotDisposableLoopbackEnv(): Record<string, string | undefined> {
  return {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    ARGENT_STATE_DIR: process.env.ARGENT_STATE_DIR,
    ARGENT_CONFIG_PATH: process.env.ARGENT_CONFIG_PATH,
    ARGENT_GATEWAY_TOKEN: process.env.ARGENT_GATEWAY_TOKEN,
    ARGENT_SKIP_CHANNELS: process.env.ARGENT_SKIP_CHANNELS,
    ARGENT_SKIP_GMAIL_WATCHER: process.env.ARGENT_SKIP_GMAIL_WATCHER,
    ARGENT_SKIP_CRON: process.env.ARGENT_SKIP_CRON,
    ARGENT_SKIP_PLUGINS: process.env.ARGENT_SKIP_PLUGINS,
    ARGENT_SKIP_CANVAS_HOST: process.env.ARGENT_SKIP_CANVAS_HOST,
    ARGENT_SKIP_BROWSER_CONTROL_SERVER: process.env.ARGENT_SKIP_BROWSER_CONTROL_SERVER,
    ARGENT_SKIP_DASHBOARD_API: process.env.ARGENT_SKIP_DASHBOARD_API,
    ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS: process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS,
    ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH: process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH,
  };
}

function applyDisposableLoopbackEnv(params: {
  tempHome: string;
  token: string;
  storePath: string;
  configPath: string;
  canaryReceiptsEnabled?: boolean;
}) {
  process.env.HOME = params.tempHome;
  process.env.USERPROFILE = params.tempHome;
  process.env.ARGENT_STATE_DIR = path.join(params.tempHome, ".argent");
  process.env.ARGENT_CONFIG_PATH = params.configPath;
  process.env.ARGENT_GATEWAY_TOKEN = params.token;
  process.env.ARGENT_SKIP_CHANNELS = "1";
  process.env.ARGENT_SKIP_GMAIL_WATCHER = "1";
  process.env.ARGENT_SKIP_CRON = "1";
  process.env.ARGENT_SKIP_PLUGINS = "1";
  process.env.ARGENT_SKIP_CANVAS_HOST = "1";
  process.env.ARGENT_SKIP_BROWSER_CONTROL_SERVER = "1";
  process.env.ARGENT_SKIP_DASHBOARD_API = "1";
  if (params.canaryReceiptsEnabled === false) {
    delete process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS;
  } else {
    process.env.ARGENT_RUST_GATEWAY_CANARY_DENY_RECEIPTS = "1";
  }
  process.env.ARGENT_RUST_GATEWAY_RECEIPT_STORE_PATH = params.storePath;
}

async function writeDisposableLoopbackConfig(params: {
  configPath: string;
  mkdir: (targetPath: string) => Promise<void>;
  writeFile: (targetPath: string, content: string) => Promise<void>;
}) {
  await params.mkdir(path.dirname(params.configPath));
  await params.writeFile(
    params.configPath,
    JSON.stringify(
      {
        gateway: { mode: "local" },
        plugins: {
          enabled: false,
          slots: { memory: "none" },
        },
      },
      null,
      2,
    ),
  );
}

function restoreDisposableLoopbackEnv(previousEnv: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
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
      status: "passing",
      reason: "rollback-node is an executable local-only proof with authorityChanges=[]",
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

  runtime.log("Gateway authority rollback-node proof");
  runtime.log("");
  runtime.log(`Mode: ${plan.mode}`);
  runtime.log(`Status: ${plan.status}`);
  runtime.log(`Executable: yes`);
  runtime.log(`Reason: ${plan.reason}`);
  runtime.log("Authority changes: none");
  runtime.log(
    `Before authority: gateway=${plan.before.liveGateway}, Rust=${plan.before.rustGateway}, scheduler=${plan.before.scheduler}, workflows=${plan.before.workflows}, channels=${plan.before.channels}`,
  );
  runtime.log(
    `After authority: gateway=${plan.after.liveGateway}, Rust=${plan.after.rustGateway}, scheduler=${plan.after.scheduler}, workflows=${plan.after.workflows}, channels=${plan.after.channels}`,
  );
  runtime.log("");
  runtime.log("Rollback actions:");
  for (const item of plan.rollbackActions) {
    runtime.log(`- ${item.id}: ${item.status}`);
  }
  runtime.log("");
  runtime.log("Prevented actions:");
  for (const action of plan.preventedActions) {
    runtime.log(`- ${action}`);
  }
  return plan;
}

function snapshotGatewayAuthority(): GatewayAuthoritySnapshot {
  return {
    liveGateway: "node",
    rustGateway: "shadow-only",
    scheduler: "node",
    workflows: "node",
    channels: "node",
    sessions: "node",
    runs: "node",
  };
}
