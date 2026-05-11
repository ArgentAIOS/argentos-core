import type { GatewayServiceRuntime } from "../daemon/service-runtime.js";
import type { PortUsage } from "../infra/ports-types.js";

/**
 * Reconciled gateway status — combines what the supervisor reports about the
 * service (PID / state) with what the kernel reports about the listening
 * socket. Resolves the inconsistency observed in #155 where `argent update`
 * ran doctor mid-restart and the doctor flow rendered both
 * "Gateway not running" and "Runtime: running (pid …)" in the same audit.
 */
export type GatewayTransitionState =
  | "listening" // service alive + port bound (steady-state healthy)
  | "starting" // service alive but port not yet bound — transitioning forward
  | "stale-port" // port bound but service supervisor says it isn't running
  | "stopped" // service not running and port free
  | "missing" // service unit missing entirely
  | "unknown"; // we couldn't decide either way

export type DetectGatewayTransitionStateInput = {
  /** Result of `GatewayService#readRuntime()` (or `undefined` if unavailable). */
  runtime: GatewayServiceRuntime | undefined;
  /** Result of `inspectPortUsage(port)` (or `undefined` if unavailable). */
  portUsage: PortUsage | undefined;
};

/**
 * Pure classifier. No I/O — call the supervisor + port probes separately and
 * pass the snapshots in. Keeps this trivially unit-testable.
 */
export function detectGatewayTransitionState(
  input: DetectGatewayTransitionStateInput,
): GatewayTransitionState {
  const { runtime, portUsage } = input;

  if (runtime?.missingUnit) {
    return "missing";
  }

  const supervisorSaysRunning = runtime?.status === "running";
  const portIsBusy = portUsage?.status === "busy";
  const portIsFree = portUsage?.status === "free";

  if (supervisorSaysRunning && portIsBusy) {
    return "listening";
  }
  if (supervisorSaysRunning && portIsFree) {
    // PID alive, but the listening socket isn't bound yet (or has just been
    // released). This is the dominant signature during launchctl bootstrap +
    // gateway startup; it's a transient state, not "inconsistent".
    return "starting";
  }
  if (!supervisorSaysRunning && runtime?.status === "stopped" && portIsBusy) {
    // Old gateway PID held the socket past supervisor's notice of exit.
    return "stale-port";
  }
  if (!supervisorSaysRunning && portIsFree) {
    return "stopped";
  }
  return "unknown";
}

/**
 * Human-readable rendering of a transition state suitable for a doctor note.
 * Returns `null` when there's nothing useful to surface (steady-state healthy
 * or missing unit handled separately).
 */
export function describeGatewayTransitionState(state: GatewayTransitionState): string | null {
  switch (state) {
    case "starting":
      return "Gateway is transitioning (process started, port not yet listening). Re-run doctor in a few seconds.";
    case "stale-port":
      return "Gateway is transitioning (previous process still holds the port). Re-run doctor in a few seconds.";
    case "stopped":
      return "Gateway not running.";
    case "missing":
      return "Gateway service is not installed.";
    case "listening":
    case "unknown":
    default:
      return null;
  }
}
