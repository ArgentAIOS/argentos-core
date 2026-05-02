import type { RuntimeEnv } from "../runtime.js";
import { formatCliCommand } from "../cli/command-format.js";
import { getRustGatewayParityReportStatus } from "./status.rust-gateway-parity-report.js";
import { getRustGatewaySchedulerAuthoritySummary } from "./status.rust-gateway-scheduler-authority.js";
import { getRustGatewayShadowSummary } from "./status.rust-gateway-shadow.js";

export type GatewayAuthorityStatusOptions = {
  json?: boolean;
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

export type GatewayAuthorityStatusSummary = {
  liveGatewayAuthority: "node";
  rustGatewayAuthority: "shadow-only";
  schedulerAuthority: "node";
  workflowAuthority: "node";
  channelAuthority: "node";
  rollbackCommand: {
    implemented: false;
    planned: "argent gateway authority rollback-node --reason <reason>";
  };
  rustShadow: Awaited<ReturnType<typeof getRustGatewayShadowSummary>>;
  parityReport: Awaited<ReturnType<typeof getRustGatewayParityReportStatus>>;
  scheduler: Awaited<ReturnType<typeof getRustGatewaySchedulerAuthoritySummary>>;
  promotionReady: false;
  blockers: string[];
  nextCommands: string[];
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

export async function collectGatewayAuthorityStatus(): Promise<GatewayAuthorityStatusSummary> {
  const [rustShadow, parityReport, scheduler] = await Promise.all([
    getRustGatewayShadowSummary(),
    getRustGatewayParityReportStatus(),
    getRustGatewaySchedulerAuthoritySummary(),
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
    rollbackCommand: {
      implemented: false,
      planned: "argent gateway authority rollback-node --reason <reason>",
    },
    rustShadow,
    parityReport,
    scheduler,
    promotionReady: false,
    blockers,
    nextCommands: [
      "argent status",
      "argent gateway authority status --json",
      "argent gateway authority rollback-node --reason <reason> --json",
    ],
  };
}

export async function gatewayAuthorityStatusCommand(
  runtime: Pick<RuntimeEnv, "log">,
  options: GatewayAuthorityStatusOptions = {},
): Promise<GatewayAuthorityStatusSummary> {
  const summary = await collectGatewayAuthorityStatus();
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
  runtime.log("");
  runtime.log("Next commands:");
  for (const command of summary.nextCommands) {
    runtime.log(`- ${formatCliCommand(command)}`);
  }
  return summary;
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
