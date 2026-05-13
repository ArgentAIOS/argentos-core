import type { GatewayRequestHandlers } from "./types.js";
import { getPgClient } from "../../data/pg-client.js";
import { isPostgresEnabled } from "../../data/storage-config.js";
import { resolveRuntimeStorageConfig } from "../../data/storage-resolver.js";
import {
  buildAppForgeImportCommitPlan,
  buildAppForgeImportPreview,
  executeAppForgeImportCommit,
  type AppForgeImportColumnOverride,
  type AppForgeImportWriteRecordFn,
} from "../../infra/app-forge-import.js";
import {
  APP_FORGE_INTERFACE_BREAKPOINTS,
  APP_FORGE_INTERFACE_PAGE_KINDS,
  APP_FORGE_INTERFACE_REGION_KINDS,
  APP_FORGE_INTERFACE_WIDGET_KINDS,
  type AppForgeInterfaceLayout,
  type AppForgeInterfaceLayoutRegionWidget,
  type AppForgeInterfacePage,
  type AppForgeInterfaceWidget,
} from "../../infra/app-forge-interfaces.js";
import {
  normalizeAppForgeSavedView,
  type AppForgeBase,
  type AppForgeRecord,
  type AppForgeSavedView,
  type AppForgeTable,
} from "../../infra/app-forge-model.js";
import {
  AppForgeAclDeniedError,
  assertAppForgeAclWrite,
  coerceAppForgePermissionScope,
  normalizeAppForgeActor,
  type AppForgeActorEnvelope,
  type AppForgeAclWriteAction,
  type AppForgePermissionCheckAuditEvent,
  type AppForgePermissionScope,
} from "../../infra/app-forge-permissions.js";
import {
  type AppForgeAdapter,
  createInMemoryAppForgeStore,
  createPostgresAppForgeStore,
} from "../../infra/app-forge-store.js";
import {
  getAppForgeTemplate,
  listAppForgeTemplates,
} from "../../infra/app-forge-templates/index.js";
import {
  buildAppForgeRecordMutationEvent,
  buildAppForgeTableMutationEvent,
} from "../../infra/appforge-workflow-events.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { workflowsHandlers } from "./workflows.js";

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

function asAppForgeSavedView(value: unknown): AppForgeSavedView | null {
  return normalizeAppForgeSavedView(value);
}

function asAppForgeInterfaceSource(value: unknown):
  | {
      tableId?: string;
      viewId?: string;
      recordId?: string;
      fieldIds?: string[];
    }
  | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const tableId = typeof value.tableId === "string" ? value.tableId.trim() : undefined;
  const viewId = typeof value.viewId === "string" ? value.viewId.trim() : undefined;
  const recordId = typeof value.recordId === "string" ? value.recordId.trim() : undefined;
  const fieldIds = Array.isArray(value.fieldIds)
    ? value.fieldIds.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const source: ReturnType<typeof asAppForgeInterfaceSource> = {};
  if (tableId) source.tableId = tableId;
  if (viewId) source.viewId = viewId;
  if (recordId) source.recordId = recordId;
  if (fieldIds?.length) source.fieldIds = fieldIds;
  return Object.keys(source).length > 0 ? source : undefined;
}

function asAppForgeInterfacePage(value: unknown): AppForgeInterfacePage | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  if (typeof value.layoutId !== "string") {
    return null;
  }
  const kind = APP_FORGE_INTERFACE_PAGE_KINDS.includes(
    value.kind as (typeof APP_FORGE_INTERFACE_PAGE_KINDS)[number],
  )
    ? (value.kind as AppForgeInterfacePage["kind"])
    : "list";
  return {
    id: value.id,
    name: value.name,
    route: typeof value.route === "string" ? value.route : `/${value.id}`,
    kind,
    source: asAppForgeInterfaceSource(value.source),
    layoutId: value.layoutId,
    revision: typeof value.revision === "number" ? value.revision : 0,
  };
}

function asAppForgeInterfaceLayout(value: unknown): AppForgeInterfaceLayout | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  const breakpoint = APP_FORGE_INTERFACE_BREAKPOINTS.includes(
    value.breakpoint as (typeof APP_FORGE_INTERFACE_BREAKPOINTS)[number],
  )
    ? (value.breakpoint as AppForgeInterfaceLayout["breakpoint"])
    : "desktop";
  const regions = Array.isArray(value.regions)
    ? value.regions
        .map((region) => {
          if (!isRecord(region) || typeof region.id !== "string") {
            return null;
          }
          const kind = APP_FORGE_INTERFACE_REGION_KINDS.includes(
            region.kind as (typeof APP_FORGE_INTERFACE_REGION_KINDS)[number],
          )
            ? (region.kind as AppForgeInterfaceLayout["regions"][number]["kind"])
            : "main";
          const widgets = Array.isArray(region.widgets)
            ? region.widgets
                .map((entry) => {
                  if (!isRecord(entry) || typeof entry.widgetId !== "string") {
                    return null;
                  }
                  const order = typeof entry.order === "number" ? entry.order : 0;
                  const span = typeof entry.span === "number" ? entry.span : undefined;
                  return span
                    ? { widgetId: entry.widgetId, order, span }
                    : { widgetId: entry.widgetId, order };
                })
                .filter((entry): entry is AppForgeInterfaceLayoutRegionWidget => Boolean(entry))
            : [];
          return { id: region.id, kind, widgets };
        })
        .filter((region): region is AppForgeInterfaceLayout["regions"][number] => Boolean(region))
    : [];
  return {
    id: value.id,
    name: value.name,
    breakpoint,
    regions,
    revision: typeof value.revision === "number" ? value.revision : 0,
  };
}

function asAppForgeInterfaceWidget(value: unknown): AppForgeInterfaceWidget | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string") {
    return null;
  }
  const kind = APP_FORGE_INTERFACE_WIDGET_KINDS.includes(
    value.kind as (typeof APP_FORGE_INTERFACE_WIDGET_KINDS)[number],
  )
    ? (value.kind as AppForgeInterfaceWidget["kind"])
    : "record_grid";
  return {
    id: value.id,
    kind,
    title: typeof value.title === "string" ? value.title : undefined,
    source: asAppForgeInterfaceSource(value.source),
    config: isRecord(value.config) ? { ...value.config } : undefined,
    revision: typeof value.revision === "number" ? value.revision : 0,
  };
}

function asAppForgeInterfaceRegionWidget(
  value: unknown,
): AppForgeInterfaceLayoutRegionWidget | null {
  if (!isRecord(value) || typeof value.widgetId !== "string") {
    return null;
  }
  const order = typeof value.order === "number" ? value.order : 0;
  const span = typeof value.span === "number" ? value.span : undefined;
  return span ? { widgetId: value.widgetId, order, span } : { widgetId: value.widgetId, order };
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value.filter((entry): entry is string => typeof entry === "string");
  return items.length === value.length ? items : null;
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

/**
 * Look up the appId for an audit event without forcing a base read in legacy
 * single-operator mode (no multi-user ACL claims). Returns "" when the base
 * is not found or ACL is not in play — the audit still fires; downstream
 * revision checks will report any actual not-found state.
 */
async function resolveAppIdForAudit(
  adapter: AppForgeAdapter,
  baseId: string,
  params: Record<string, unknown>,
): Promise<string> {
  if (params.actor === undefined && params.permissions === undefined) {
    return "";
  }
  const current = await adapter.getBase(baseId);
  return current?.appId ?? "";
}

type AppForgeWriteGuardOk = {
  ok: true;
  actor: AppForgeActorEnvelope | null;
  audit: AppForgePermissionCheckAuditEvent;
};

type AppForgeWriteGuardDenied = {
  ok: false;
  message: string;
  details?: Record<string, unknown>;
};

/**
 * Single ACL gate for every AppForge write boundary (#336).
 *
 * Behaviour matrix (preserves existing test contract):
 *  - neither `actor` nor `permissions` provided → allow, emit "no-acl-scope" audit
 *  - both provided                              → run gate; throw → deny w/ audit
 *  - only one of them provided                  → reject as partial multi-user claim
 *  - malformed actor / permissions              → reject with clear message
 */
function appForgeWriteGuard(
  params: Record<string, unknown>,
  appId: string,
  action: AppForgeAclWriteAction,
  opts: { resourceId?: string } = {},
): AppForgeWriteGuardOk | AppForgeWriteGuardDenied {
  const hasActor = params.actor !== undefined;
  const hasPermissions = params.permissions !== undefined;

  // Legacy single-operator mode: no ACL claims supplied. Still log an audit
  // entry so EVERY write boundary has a trail.
  if (!hasActor && !hasPermissions) {
    const audit = assertAppForgeAclWrite({
      appId,
      actor: null,
      action,
      resourceId: opts.resourceId,
    });
    return { ok: true, actor: null, audit };
  }

  if (!hasActor || !hasPermissions) {
    return {
      ok: false,
      message: "actor and permissions are required together for AppForge multi-user writes",
    };
  }

  let actor: AppForgeActorEnvelope;
  try {
    actor = normalizeAppForgeActor(params.actor as Parameters<typeof normalizeAppForgeActor>[0]);
  } catch {
    return { ok: false, message: "valid AppForge actor is required" };
  }

  const scope: AppForgePermissionScope | null = coerceAppForgePermissionScope(params.permissions);
  if (!scope) {
    return { ok: false, message: "valid AppForge permissions are required" };
  }

  try {
    const audit = assertAppForgeAclWrite({
      appId,
      actor,
      action,
      scope,
      resourceId: opts.resourceId,
    });
    return { ok: true, actor, audit };
  } catch (error) {
    if (error instanceof AppForgeAclDeniedError) {
      return {
        ok: false,
        message: error.message,
        details: { audit: error.audit },
      };
    }
    throw error;
  }
}

function booleanParam(params: Record<string, unknown>, name: string): boolean | undefined {
  const value = params[name];
  return typeof value === "boolean" ? value : undefined;
}

function parseImportColumnOverrides(value: unknown): AppForgeImportColumnOverride[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const overrides: AppForgeImportColumnOverride[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const header = typeof entry.header === "string" ? entry.header : undefined;
    const fieldId = typeof entry.fieldId === "string" ? entry.fieldId : undefined;
    if (!header && !fieldId) {
      continue;
    }
    const fieldName = typeof entry.fieldName === "string" ? entry.fieldName : undefined;
    const type =
      typeof entry.type === "string"
        ? (entry.type as AppForgeImportColumnOverride["type"])
        : undefined;
    const skip = typeof entry.skip === "boolean" ? entry.skip : undefined;
    const options = Array.isArray(entry.options)
      ? entry.options.filter((option): option is string => typeof option === "string")
      : undefined;
    overrides.push({ header, fieldId, fieldName, type, skip, options });
  }
  return overrides.length > 0 ? overrides : undefined;
}

function isWebchatClient(client: { connect?: { client?: { id?: string } } } | null): boolean {
  return client?.connect?.client?.id === "webchat";
}

function shouldEmitWorkflowEvent(
  client: { connect?: { client?: { id?: string } } } | null,
  params: Record<string, unknown>,
): boolean {
  const explicit = booleanParam(params, "emitWorkflowEvent");
  if (explicit !== undefined) {
    return explicit;
  }
  // The current dashboard AppForge path already emits through its workflow-event API after
  // metadata/gateway persistence. Suppress automatic gateway-side emission for that client
  // until structured storage becomes the single source of truth.
  return !isWebchatClient(client);
}

async function emitWorkflowEventBestEffort(
  eventParams: Record<string, unknown>,
  opts: Parameters<NonNullable<(typeof workflowsHandlers)["workflows.emitAppForgeEvent"]>>[0],
): Promise<void> {
  const handler = workflowsHandlers["workflows.emitAppForgeEvent"];
  if (!handler) {
    return;
  }

  let emitError: unknown;
  try {
    await handler({
      ...opts,
      req: {
        type: "req",
        id: `${opts.req.id}:appforge-event`,
        method: "workflows.emitAppForgeEvent",
        params: eventParams,
      },
      params: eventParams,
      respond: (ok, _payload, error) => {
        if (!ok) {
          emitError = error ?? new Error("failed to emit AppForge workflow event");
        }
      },
    });
  } catch (error) {
    emitError = error;
  }

  if (emitError) {
    console.warn("[AppForge] Failed to emit workflow event after gateway mutation.", {
      method: opts.req.method,
      eventType: eventParams.eventType,
      error: emitError,
    });
  }
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
  "appforge.templates.list": async ({ respond }) => {
    respond(true, { templates: listAppForgeTemplates() }, undefined);
  },

  "appforge.templates.get": async ({ params, respond }) => {
    const templateId = stringParam(params, "templateId");
    if (!templateId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "templateId is required"));
      return;
    }
    const template = getAppForgeTemplate(templateId);
    if (!template) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "template not found"));
      return;
    }
    respond(true, { template }, undefined);
  },

  "appforge.import.preview": async ({ params, respond }) => {
    const csv = stringParam(params, "csv");
    if (!csv) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "csv is required"));
      return;
    }
    const tableName = stringParam(params, "tableName") ?? undefined;
    const targetTableId = stringParam(params, "targetTableId") ?? undefined;
    const maxRows = optionalNumberParam(params, "maxRows");
    const baseValue = isRecord(params.base) ? asAppForgeBase(params.base) : null;
    const overrides = parseImportColumnOverrides(params.overrides);
    try {
      const preview = buildAppForgeImportPreview({
        csv,
        tableName,
        targetTableId,
        maxRows,
        overrides,
        base: baseValue
          ? { activeTableId: baseValue.activeTableId, tables: baseValue.tables }
          : null,
      });
      respond(true, { preview }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "failed to build CSV import preview",
        ),
      );
    }
  },

  "appforge.import.commit": async ({ req, params, client, context, isWebchatConnect, respond }) => {
    const csv = stringParam(params, "csv");
    if (!csv) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "csv is required"));
      return;
    }
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

    const adapter = getAppForgeAdapter();
    const targetBase = await adapter.getBase(baseId);
    if (!targetBase) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "base not found"));
      return;
    }
    const targetTable = targetBase.tables.find((table) => table.id === tableId);
    if (!targetTable) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "table not found"));
      return;
    }

    const guard = appForgeWriteGuard(params, targetBase.appId, "record.import", {
      resourceId: `${baseId}/${tableId}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const guardActor = guard.actor;

    const overrides = parseImportColumnOverrides(params.overrides);
    const batchSize = optionalNumberParam(params, "batchSize");
    const skipInvalidParam = booleanParam(params, "skipInvalidRows");
    const recordIdPrefix = stringParam(params, "recordIdPrefix") ?? undefined;
    const idempotencyKey = stringParam(params, "idempotencyKey") ?? undefined;
    const tableName = stringParam(params, "tableName") ?? undefined;

    let plan;
    try {
      plan = buildAppForgeImportCommitPlan({
        csv,
        tableName,
        targetTableId: tableId,
        base: { activeTableId: targetBase.activeTableId, tables: targetBase.tables },
        overrides,
        batchSize,
        skipInvalidRows: skipInvalidParam,
        recordIdPrefix,
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "failed to plan CSV import commit",
        ),
      );
      return;
    }

    const emit = shouldEmitWorkflowEvent(client, params);
    const writeRecord: AppForgeImportWriteRecordFn = async (record, ctx) => {
      const result = await adapter.putRecord(baseId, tableId, record, {
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:${ctx.rowNumber}` : undefined,
        actor: guardActor ?? undefined,
      });
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      if (emit) {
        const event = buildAppForgeRecordMutationEvent({
          action: result.record.revision <= 1 ? "created" : "updated",
          base: result.base,
          table: result.table,
          record: result.record,
        });
        await emitWorkflowEventBestEffort(event as Record<string, unknown>, {
          req,
          params,
          client,
          context,
          isWebchatConnect,
          respond,
        });
      }
      return { ok: true, record: result.record };
    };

    const report = await executeAppForgeImportCommit(plan, writeRecord);
    const refreshedBase = await adapter.getBase(baseId);
    const refreshedTable =
      refreshedBase?.tables.find((table) => table.id === tableId) ?? targetTable;

    respond(
      true,
      {
        base: refreshedBase ?? targetBase,
        table: refreshedTable,
        report,
      },
      undefined,
    );
  },

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

    const guard = appForgeWriteGuard(params, base.appId, "base.put", { resourceId: base.id });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }

    const result = await adapter.putBase({
      base,
      expectedRevision: optionalNumberParam(params, "expectedRevision"),
      idempotencyKey: stringParam(params, "idempotencyKey") ?? undefined,
      actor: guard.actor ?? undefined,
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

    // Always run the ACL gate, even in legacy single-operator mode, so deletes
    // emit an audit event (#336). Resolve the appId by looking up the base
    // when multi-user ACL claims are present (so audit can attribute correctly).
    let appIdForAudit = "";
    if (params.actor !== undefined || params.permissions !== undefined) {
      const current = await adapter.getBase(baseId);
      if (!current) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "base not found"));
        return;
      }
      appIdForAudit = current.appId;
    }

    const guard = appForgeWriteGuard(params, appIdForAudit, "base.delete", { resourceId: baseId });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
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

  "appforge.tables.put": async ({ req, params, client, context, isWebchatConnect, respond }) => {
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

    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "table.put", {
      resourceId: `${baseId}/${table.id}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }

    const result = await adapter.putTable(baseId, table, {
      expectedBaseRevision: optionalNumberParam(params, "expectedBaseRevision"),
      expectedTableRevision: optionalNumberParam(params, "expectedTableRevision"),
      idempotencyKey: stringParam(params, "idempotencyKey") ?? undefined,
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    if (shouldEmitWorkflowEvent(client, params)) {
      const event = buildAppForgeTableMutationEvent({
        action: result.table.revision <= 1 ? "created" : "updated",
        base: result.base,
        table: result.table,
      });
      await emitWorkflowEventBestEffort(event as Record<string, unknown>, {
        req,
        params,
        client,
        context,
        isWebchatConnect,
        respond,
      });
    }
    respond(true, { base: result.base, table: result.table }, undefined);
  },

  "appforge.tables.delete": async ({ req, params, client, context, isWebchatConnect, respond }) => {
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

    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "table.delete", {
      resourceId: `${baseId}/${tableId}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
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
    if (shouldEmitWorkflowEvent(client, params)) {
      const event = buildAppForgeTableMutationEvent({
        action: "deleted",
        base: result.base,
        table: result.table,
        nextActiveTableId:
          result.base.activeTableId && result.base.activeTableId !== result.table.id
            ? result.base.activeTableId
            : undefined,
      });
      await emitWorkflowEventBestEffort(event as Record<string, unknown>, {
        req,
        params,
        client,
        context,
        isWebchatConnect,
        respond,
      });
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

  "appforge.records.put": async ({ req, params, client, context, isWebchatConnect, respond }) => {
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

    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "record.put", {
      resourceId: `${baseId}/${tableId}/${record.id}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }

    const result = await adapter.putRecord(baseId, tableId, record, {
      expectedBaseRevision: optionalNumberParam(params, "expectedBaseRevision"),
      expectedTableRevision: optionalNumberParam(params, "expectedTableRevision"),
      expectedRecordRevision: optionalNumberParam(params, "expectedRecordRevision"),
      idempotencyKey: stringParam(params, "idempotencyKey") ?? undefined,
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    if (shouldEmitWorkflowEvent(client, params)) {
      const event = buildAppForgeRecordMutationEvent({
        action: result.record.revision <= 1 ? "created" : "updated",
        base: result.base,
        table: result.table,
        record: result.record,
      });
      await emitWorkflowEventBestEffort(event as Record<string, unknown>, {
        req,
        params,
        client,
        context,
        isWebchatConnect,
        respond,
      });
    }
    respond(true, { base: result.base, table: result.table, record: result.record }, undefined);
  },

  "appforge.records.delete": async ({
    req,
    params,
    client,
    context,
    isWebchatConnect,
    respond,
  }) => {
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

    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "record.delete", {
      resourceId: `${baseId}/${tableId}/${recordId}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
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
    if (shouldEmitWorkflowEvent(client, params)) {
      const event = buildAppForgeRecordMutationEvent({
        action: "deleted",
        base: result.base,
        table: result.table,
        record: result.record,
      });
      await emitWorkflowEventBestEffort(event as Record<string, unknown>, {
        req,
        params,
        client,
        context,
        isWebchatConnect,
        respond,
      });
    }
    respond(true, { base: result.base, table: result.table, record: result.record }, undefined);
  },

  // -------------------------------------------------------------------------
  // Saved-view CRUD (Phase 4 gap #1). Views are durable table metadata; the
  // operator-local localStorage cache used to be the only home, so anyone
  // who joined the project couldn't see the same views. These methods make
  // views shareable across operators by routing them through the table
  // metadata path with table-level permission inheritance.
  // -------------------------------------------------------------------------

  "appforge.views.list": async ({ params, respond }) => {
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
    const views = await adapter.listViews(baseId, tableId);
    respond(true, { views }, undefined);
  },

  "appforge.views.put": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const tableId = stringParam(params, "tableId");
    const view = asAppForgeSavedView(params.view);
    if (!baseId || !tableId || !view) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "baseId, tableId, and a valid view (id+name+type) are required",
        ),
      );
      return;
    }
    // Views inherit table-level permissions. Run the single ACL gate (#336)
    // so every view write goes through the same audit/deny path.
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "view.put", {
      resourceId: `${baseId}/${tableId}/${view.id}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.putView(baseId, tableId, view, {
      expectedBaseRevision: optionalNumberParam(params, "expectedBaseRevision"),
      expectedTableRevision: optionalNumberParam(params, "expectedTableRevision"),
      idempotencyKey: stringParam(params, "idempotencyKey") ?? undefined,
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, table: result.table, view: result.view }, undefined);
  },

  "appforge.views.delete": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const tableId = stringParam(params, "tableId");
    const viewId = stringParam(params, "viewId");
    if (!baseId || !tableId || !viewId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId, tableId, and viewId are required"),
      );
      return;
    }
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "view.delete", {
      resourceId: `${baseId}/${tableId}/${viewId}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.deleteView(baseId, tableId, viewId, {
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
    respond(true, { base: result.base, table: result.table, view: result.view }, undefined);
  },

  // -------------------------------------------------------------------------
  // Editable-interface CRUD (Phase 4 gap #5). The bundle is per-base durable
  // metadata; permissions inherit base-level ACL through the same gate used
  // for table writes. Each gateway method maps 1:1 to an adapter helper so
  // the dashboard never has to hand-roll bundle math.
  // -------------------------------------------------------------------------

  "appforge.interfaces.get": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    if (!baseId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "baseId is required"));
      return;
    }
    const bundle = await adapter.getInterfaces(baseId);
    if (!bundle) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "base not found"));
      return;
    }
    respond(true, { bundle }, undefined);
  },

  "appforge.interfaces.page.put": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const page = asAppForgeInterfacePage(params.page);
    if (!baseId || !page) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "baseId and a valid interface page (id + name + layoutId) are required",
        ),
      );
      return;
    }
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "interface.put", {
      resourceId: `${baseId}/page/${page.id}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.putInterfacePage(baseId, page, {
      expectedBundleRevision: optionalNumberParam(params, "expectedBundleRevision"),
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, bundle: result.bundle }, undefined);
  },

  "appforge.interfaces.page.delete": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const pageId = stringParam(params, "pageId");
    if (!baseId || !pageId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId and pageId are required"),
      );
      return;
    }
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "interface.delete", {
      resourceId: `${baseId}/page/${pageId}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.deleteInterfacePage(baseId, pageId, {
      expectedBundleRevision: optionalNumberParam(params, "expectedBundleRevision"),
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, bundle: result.bundle }, undefined);
  },

  "appforge.interfaces.layout.put": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const layout = asAppForgeInterfaceLayout(params.layout);
    if (!baseId || !layout) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "baseId and a valid interface layout (id + name) are required",
        ),
      );
      return;
    }
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "interface.put", {
      resourceId: `${baseId}/layout/${layout.id}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.putInterfaceLayout(baseId, layout, {
      expectedBundleRevision: optionalNumberParam(params, "expectedBundleRevision"),
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, bundle: result.bundle }, undefined);
  },

  "appforge.interfaces.layout.delete": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const layoutId = stringParam(params, "layoutId");
    if (!baseId || !layoutId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId and layoutId are required"),
      );
      return;
    }
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "interface.delete", {
      resourceId: `${baseId}/layout/${layoutId}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.deleteInterfaceLayout(baseId, layoutId, {
      expectedBundleRevision: optionalNumberParam(params, "expectedBundleRevision"),
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, bundle: result.bundle }, undefined);
  },

  "appforge.interfaces.widget.put": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const widget = asAppForgeInterfaceWidget(params.widget);
    if (!baseId || !widget) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "baseId and a valid interface widget (id + kind) are required",
        ),
      );
      return;
    }
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "interface.put", {
      resourceId: `${baseId}/widget/${widget.id}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.putInterfaceWidget(baseId, widget, {
      expectedBundleRevision: optionalNumberParam(params, "expectedBundleRevision"),
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, bundle: result.bundle }, undefined);
  },

  "appforge.interfaces.widget.delete": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const widgetId = stringParam(params, "widgetId");
    if (!baseId || !widgetId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "baseId and widgetId are required"),
      );
      return;
    }
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "interface.delete", {
      resourceId: `${baseId}/widget/${widgetId}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.deleteInterfaceWidget(baseId, widgetId, {
      expectedBundleRevision: optionalNumberParam(params, "expectedBundleRevision"),
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, bundle: result.bundle }, undefined);
  },

  "appforge.interfaces.region.place": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const layoutId = stringParam(params, "layoutId");
    const regionId = stringParam(params, "regionId");
    const entry = asAppForgeInterfaceRegionWidget(params.entry);
    if (!baseId || !layoutId || !regionId || !entry) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "baseId, layoutId, regionId, and a valid region entry (widgetId + order) are required",
        ),
      );
      return;
    }
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "interface.put", {
      resourceId: `${baseId}/layout/${layoutId}/region/${regionId}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.placeInterfaceWidget(baseId, layoutId, regionId, entry, {
      expectedBundleRevision: optionalNumberParam(params, "expectedBundleRevision"),
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, bundle: result.bundle }, undefined);
  },

  "appforge.interfaces.region.unplace": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const layoutId = stringParam(params, "layoutId");
    const regionId = stringParam(params, "regionId");
    const widgetId = stringParam(params, "widgetId");
    if (!baseId || !layoutId || !regionId || !widgetId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "baseId, layoutId, regionId, and widgetId are required",
        ),
      );
      return;
    }
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "interface.delete", {
      resourceId: `${baseId}/layout/${layoutId}/region/${regionId}/${widgetId}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.unplaceInterfaceWidget(baseId, layoutId, regionId, widgetId, {
      expectedBundleRevision: optionalNumberParam(params, "expectedBundleRevision"),
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, bundle: result.bundle }, undefined);
  },

  "appforge.interfaces.region.reorder": async ({ params, respond }) => {
    const adapter = getAppForgeAdapter();
    const baseId = stringParam(params, "baseId");
    const layoutId = stringParam(params, "layoutId");
    const regionId = stringParam(params, "regionId");
    const widgetIds = asStringArray(params.widgetIds);
    if (!baseId || !layoutId || !regionId || !widgetIds) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "baseId, layoutId, regionId, and widgetIds[] are required",
        ),
      );
      return;
    }
    const appIdForAudit = await resolveAppIdForAudit(adapter, baseId, params);
    const guard = appForgeWriteGuard(params, appIdForAudit, "interface.put", {
      resourceId: `${baseId}/layout/${layoutId}/region/${regionId}`,
    });
    if (!guard.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, guard.message, guard.details),
      );
      return;
    }
    const result = await adapter.reorderInterfaceRegion(baseId, layoutId, regionId, widgetIds, {
      expectedBundleRevision: optionalNumberParam(params, "expectedBundleRevision"),
      actor: guard.actor ?? undefined,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.message, { details: result }),
      );
      return;
    }
    respond(true, { base: result.base, bundle: result.bundle }, undefined);
  },
};
