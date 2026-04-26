import type { AppForgeBase } from "../../infra/app-forge-model.js";
import type { GatewayRequestHandlers } from "./types.js";
import {
  createInMemoryAppForgeAdapter,
  type AppForgeAdapter,
} from "../../infra/app-forge-adapter.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

let adapter: AppForgeAdapter = createInMemoryAppForgeAdapter();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringParam(params: Record<string, unknown>, name: string): string | null {
  const value = params[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumberParam(params: Record<string, unknown>, name: string): number | undefined {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asAppForgeBase(value: unknown): AppForgeBase | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.appId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.activeTableId !== "string" ||
    typeof value.revision !== "number" ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.tables)
  ) {
    return null;
  }
  return value as AppForgeBase;
}

export function resetAppForgeAdapterForTests(seed: AppForgeBase[] = []) {
  adapter = createInMemoryAppForgeAdapter(seed);
}

export const appForgeHandlers: GatewayRequestHandlers = {
  "appforge.bases.list": async ({ params, respond }) => {
    const appId = stringParam(params, "appId") ?? undefined;
    const bases = await adapter.listBases({ appId });
    respond(true, { bases }, undefined);
  },

  "appforge.bases.get": async ({ params, respond }) => {
    const baseId = stringParam(params, "baseId");
    if (!baseId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "baseId is required"));
      return;
    }

    const base = await adapter.getBase(baseId);
    if (!base) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "base not found"));
      return;
    }
    respond(true, { base }, undefined);
  },

  "appforge.bases.put": async ({ params, respond }) => {
    const base = asAppForgeBase(params.base);
    if (!base) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "valid base is required"));
      return;
    }

    const result = await adapter.putBase({
      base,
      expectedRevision: optionalNumberParam(params, "expectedRevision"),
      idempotencyKey: stringParam(params, "idempotencyKey") ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base }, undefined);
  },

  "appforge.bases.delete": async ({ params, respond }) => {
    const baseId = stringParam(params, "baseId");
    if (!baseId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "baseId is required"));
      return;
    }

    const result = await adapter.deleteBase(baseId, {
      expectedRevision: optionalNumberParam(params, "expectedRevision"),
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base }, undefined);
  },
};
