import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function readOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRequiredString(params: Record<string, unknown>, key: string): string {
  const value = readOptionalString(params, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function readOptionalObject(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value as Record<string, unknown>;
}

export const jobsOrchestratorHandlers: GatewayRequestHandlers = {
  "jobs.orchestrator.status": ({ context, respond }) => {
    const runner = context.jobOrchestratorRunner;
    if (!runner) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "job orchestrator runtime unavailable"),
      );
      return;
    }
    respond(true, runner.getStatus(), undefined);
  },
  "jobs.orchestrator.event": async ({ params, context, respond }) => {
    const runner = context.jobOrchestratorRunner;
    if (!runner) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "job orchestrator runtime unavailable"),
      );
      return;
    }
    try {
      const eventType = readRequiredString(params, "eventType");
      const sourceRaw = readOptionalString(params, "source");
      const source =
        sourceRaw === "webhook" || sourceRaw === "system" || sourceRaw === "internal_hook"
          ? sourceRaw
          : "manual";
      const result = await runner.enqueueEvent({
        eventType,
        source,
        idempotencyKey: readOptionalString(params, "idempotencyKey"),
        targetAgentId: readOptionalString(params, "targetAgentId"),
        payload: readOptionalObject(params, "payload"),
        metadata: readOptionalObject(params, "metadata"),
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};
