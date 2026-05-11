import type { ArgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveGatewayPort } from "../config/config.js";
import { resolveGatewayService } from "../daemon/service.js";
import { buildGatewayConnectionDetails, callGateway } from "../gateway/call.js";
import { collectChannelStatusIssues } from "../infra/channels-status-issues.js";
import { inspectPortUsage } from "../infra/ports.js";
import { note } from "../terminal/note.js";
import {
  describeGatewayTransitionState,
  detectGatewayTransitionState,
  type GatewayTransitionState,
} from "./doctor-gateway-transition.js";
import { formatHealthCheckFailure } from "./health-format.js";
import { healthCommand } from "./health.js";

export type GatewayHealthResult = {
  healthOk: boolean;
  /**
   * Reconciled gateway state observed at the time of the health probe.
   * Populated whenever the probe completes; downstream code uses this to
   * avoid emitting contradictory "Gateway not running" + "Runtime: running"
   * audit lines during update / restart transitions (see #155).
   */
  transitionState: GatewayTransitionState;
};

export async function checkGatewayHealth(params: {
  runtime: RuntimeEnv;
  cfg: ArgentConfig;
  timeoutMs?: number;
}): Promise<GatewayHealthResult> {
  const gatewayDetails = buildGatewayConnectionDetails({ config: params.cfg });
  const timeoutMs =
    typeof params.timeoutMs === "number" && params.timeoutMs > 0 ? params.timeoutMs : 10_000;
  let healthOk = false;
  let healthError: unknown;
  try {
    await healthCommand({ json: false, timeoutMs, config: params.cfg }, params.runtime);
    healthOk = true;
  } catch (err) {
    healthError = err;
  }

  let transitionState: GatewayTransitionState = healthOk ? "listening" : "unknown";

  if (!healthOk) {
    const message = String(healthError);
    if (message.includes("gateway closed")) {
      transitionState = await reconcileGatewayTransitionState(params.cfg);
      const description = describeGatewayTransitionState(transitionState);
      if (description) {
        note(description, "Argent gateway");
      }
      note(gatewayDetails.message, "Argent gateway connection");
    } else {
      params.runtime.error(formatHealthCheckFailure(healthError));
    }
  }

  if (healthOk) {
    try {
      const status = await callGateway({
        method: "channels.status",
        params: { probe: true, timeoutMs: 5000 },
        timeoutMs: 6000,
      });
      const issues = collectChannelStatusIssues(status);
      if (issues.length > 0) {
        note(
          issues
            .map(
              (issue) =>
                `- ${issue.channel} ${issue.accountId}: ${issue.message}${
                  issue.fix ? ` (${issue.fix})` : ""
                }`,
            )
            .join("\n"),
          "Argent channel warnings",
        );
      }
    } catch {
      // ignore: doctor already reported gateway health
    }
  }

  return { healthOk, transitionState };
}

async function reconcileGatewayTransitionState(cfg: ArgentConfig): Promise<GatewayTransitionState> {
  if (cfg.gateway?.mode === "remote") {
    return "unknown";
  }
  try {
    const service = resolveGatewayService();
    const [runtime, portUsage] = await Promise.all([
      service.readRuntime(process.env).catch(() => undefined),
      inspectPortUsage(resolveGatewayPort(cfg, process.env)).catch(() => undefined),
    ]);
    return detectGatewayTransitionState({ runtime, portUsage });
  } catch {
    return "unknown";
  }
}
