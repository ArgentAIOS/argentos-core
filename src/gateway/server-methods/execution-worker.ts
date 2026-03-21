import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function readOptionalAgentId(params: Record<string, unknown>): string | undefined {
  if (params.agentId === undefined) {
    return undefined;
  }
  if (typeof params.agentId !== "string") {
    throw new Error("agentId must be a string");
  }
  const trimmed = params.agentId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const executionWorkerHandlers: GatewayRequestHandlers = {
  "execution.worker.status": ({ params, respond, context }) => {
    const runner = context.executionWorkerRunner;
    if (!runner) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "execution worker runtime unavailable"),
      );
      return;
    }
    try {
      const agentId = readOptionalAgentId(params);
      respond(true, runner.getStatus({ agentId }), undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "execution.worker.pause": ({ params, respond, context }) => {
    const runner = context.executionWorkerRunner;
    if (!runner) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "execution worker runtime unavailable"),
      );
      return;
    }
    try {
      const agentId = readOptionalAgentId(params);
      const control = runner.pause({ agentId });
      if (!control.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown execution worker agent: ${agentId}`),
        );
        return;
      }
      respond(true, { control, status: runner.getStatus({ agentId }) }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "execution.worker.resume": ({ params, respond, context }) => {
    const runner = context.executionWorkerRunner;
    if (!runner) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "execution worker runtime unavailable"),
      );
      return;
    }
    try {
      const agentId = readOptionalAgentId(params);
      const control = runner.resume({ agentId });
      if (!control.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown execution worker agent: ${agentId}`),
        );
        return;
      }
      respond(true, { control, status: runner.getStatus({ agentId }) }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "execution.worker.runNow": ({ params, respond, context }) => {
    const runner = context.executionWorkerRunner;
    if (!runner) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "execution worker runtime unavailable"),
      );
      return;
    }
    try {
      const agentId = readOptionalAgentId(params);
      const result = runner.dispatchNow({
        agentId,
        reason: typeof params.reason === "string" ? params.reason.trim() || undefined : undefined,
      });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown execution worker agent: ${agentId}`),
        );
        return;
      }
      respond(true, { dispatch: result, status: runner.getStatus({ agentId }) }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "execution.worker.metrics.reset": ({ params, respond, context }) => {
    const runner = context.executionWorkerRunner;
    if (!runner) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "execution worker runtime unavailable"),
      );
      return;
    }
    try {
      const agentId = readOptionalAgentId(params);
      const control = runner.resetMetrics({ agentId });
      if (!control.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown execution worker agent: ${agentId}`),
        );
        return;
      }
      respond(true, { control, status: runner.getStatus({ agentId }) }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};
