import type { RuntimeEnv } from "../runtime.js";
import { formatCliCommand } from "../cli/command-format.js";
import { getRustGatewayParityReportStatus } from "./status.rust-gateway-parity-report.js";
import { getRustGatewaySchedulerAuthoritySummary } from "./status.rust-gateway-scheduler-authority.js";
import { getRustGatewayShadowSummary } from "./status.rust-gateway-shadow.js";

export type GatewayAuthorityStatusOptions = {
  json?: boolean;
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
    nextCommands: ["argent status", "argent gateway authority status --json"],
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
