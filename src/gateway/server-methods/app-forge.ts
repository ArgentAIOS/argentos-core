import type { AppForgeBase, AppForgeRecord, AppForgeTable } from "../../infra/app-forge-model.js";
import type { GatewayRequestHandlers } from "./types.js";
import { getPgClient } from "../../data/pg-client.js";
import { isPostgresEnabled } from "../../data/storage-config.js";
import { resolveRuntimeStorageConfig } from "../../data/storage-resolver.js";
import {
  type AppForgeAdapter,
  createInMemoryAppForgeStore,
  createPostgresAppForgeStore,
} from "../../infra/app-forge-store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

let cachedAdapter: AppForgeAdapter | null = null;

function createAppForgeAdapter(): AppForgeAdapter {
  const storageConfig = resolveRuntimeStorageConfig();
  if (isPostgresEnabled(storageConfig) && storageConfig.postgres) {
    return createPostgresAppForgeStore(getPgClient(storageConfig.postgres));
  }
  return createInMemoryAppForgeStore();
}

function getAppForgeAdapter(): AppForgeAdapter {
  cachedAdapter ??= createAppForgeAdapter();
  return cachedAdapter;
}

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

function asAppForgeTable(value: unknown): AppForgeTable | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.revision !== "number" ||
    !Array.isArray(value.fields) ||
    !Array.isArray(value.records)
  ) {
    return null;
  }
  return value as AppForgeTable;
}

function asAppForgeRecord(value: unknown): AppForgeRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.revision !== "number" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.values)
  ) {
    return null;
  }
  return value as AppForgeRecord;
}

function workflowPickerBase(base: AppForgeBase): AppForgeBase & {
  tableCount: number;
} {
  return {
    ...base,
    tableCount: base.tables.length,
  };
}

function workflowPickerTable(table: AppForgeTable): AppForgeTable & {
  fieldCount: number;
  recordCount: number;
} {
  return {
    ...table,
    fieldCount: table.fields.length,
    recordCount: table.records.length,
  };
}

export function resetAppForgeAdapterForTests(seed: AppForgeBase[] = []) {
  cachedAdapter = createInMemoryAppForgeStore(seed);
}

export const appForgeHandlers: GatewayRequestHandlers = {
  "appforge.bases.list": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const appId = stringParam(params, "appId") ?? undefined;
    const bases = await adapter.listBases({ appId });
    respond(true, { bases: bases.map(workflowPickerBase) }, undefined);
  },

  "appforge.bases.get": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
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
    const adapter = getAppForgeAdapter();
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
    const adapter = getAppForgeAdapter();
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

  "appforge.tables.list": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    if (!baseId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "baseId is required"));
      return;
    }

    const tables = await adapter.listTables(baseId);
    respond(true, { tables: tables.map(workflowPickerTable) }, undefined);
  },

  "appforge.tables.get": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const tableId = stringParam(params, "tableId");
    if (!baseId || !tableId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId and tableId are required"),
      );
      return;
    }

    const table = await adapter.getTable(baseId, tableId);
    if (!table) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "table not found"));
      return;
    }
    respond(true, { table }, undefined);
  },

  "appforge.tables.put": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const table = asAppForgeTable(params.table);
    if (!baseId || !table) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId and valid table are required"),
      );
      return;
    }

    const result = await adapter.putTable(baseId, table, {
      expectedBaseRevision: optionalNumberParam(params, "expectedBaseRevision"),
      expectedTableRevision: optionalNumberParam(params, "expectedTableRevision"),
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
    respond(true, { base: result.base, table: result.table }, undefined);
  },

  "appforge.tables.delete": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const tableId = stringParam(params, "tableId");
    if (!baseId || !tableId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId and tableId are required"),
      );
      return;
    }

    const result = await adapter.deleteTable(baseId, tableId, {
      expectedBaseRevision: optionalNumberParam(params, "expectedBaseRevision"),
      expectedTableRevision: optionalNumberParam(params, "expectedTableRevision"),
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, table: result.table }, undefined);
  },

  "appforge.records.list": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const tableId = stringParam(params, "tableId");
    if (!baseId || !tableId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId and tableId are required"),
      );
      return;
    }

    const records = await adapter.listRecords(baseId, tableId);
    respond(true, { records }, undefined);
  },

  "appforge.records.get": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const tableId = stringParam(params, "tableId");
    const recordId = stringParam(params, "recordId");
    if (!baseId || !tableId || !recordId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId, tableId, and recordId are required"),
      );
      return;
    }

    const records = await adapter.listRecords(baseId, tableId);
    const record = records.find((item) => item.id === recordId) ?? null;
    if (!record) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "record not found"));
      return;
    }
    respond(true, { record }, undefined);
  },

  "appforge.records.put": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const tableId = stringParam(params, "tableId");
    const record = asAppForgeRecord(params.record);
    if (!baseId || !tableId || !record) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId, tableId, and valid record are required"),
      );
      return;
    }

    const result = await adapter.putRecord(baseId, tableId, record, {
      expectedBaseRevision: optionalNumberParam(params, "expectedBaseRevision"),
      expectedTableRevision: optionalNumberParam(params, "expectedTableRevision"),
      expectedRecordRevision: optionalNumberParam(params, "expectedRecordRevision"),
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
    respond(true, { base: result.base, table: result.table, record: result.record }, undefined);
  },

  "appforge.records.delete": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const tableId = stringParam(params, "tableId");
    const recordId = stringParam(params, "recordId");
    if (!baseId || !tableId || !recordId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId, tableId, and recordId are required"),
      );
      return;
    }

    const result = await adapter.deleteRecord(baseId, tableId, recordId, {
      expectedBaseRevision: optionalNumberParam(params, "expectedBaseRevision"),
      expectedTableRevision: optionalNumberParam(params, "expectedTableRevision"),
      expectedRecordRevision: optionalNumberParam(params, "expectedRecordRevision"),
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, table: result.table, record: result.record }, undefined);
  },
};
