import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppForgeWorkflowEventRequest, ForgeApp } from "./useApps";
import { fetchLocalApi } from "../utils/localApiFetch";

export type ForgeFieldType =
  | "text"
  | "long_text"
  | "single_select"
  | "multi_select"
  | "number"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "attachment"
  | "linked_record";

export type ForgeStructuredField = {
  id: string;
  name: string;
  type: ForgeFieldType;
  description?: string;
  required?: boolean;
  options?: string[];
};

export type ForgeStructuredRecordValue = string | number | boolean | string[] | null;

export type ForgeStructuredRecord = {
  id: string;
  values: Record<string, ForgeStructuredRecordValue>;
  revision?: number;
  createdAt: string;
  updatedAt: string;
};

export type ForgeStructuredViewType = "grid" | "kanban" | "form" | "review";

export type ForgeStructuredView = {
  id: string;
  name: string;
  type: ForgeStructuredViewType;
  filterText?: string;
  sortFieldId?: string;
  sortDirection?: "asc" | "desc";
  groupFieldId?: string;
  visibleFieldIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type ForgeStructuredTable = {
  id: string;
  name: string;
  fields: ForgeStructuredField[];
  records: ForgeStructuredRecord[];
  views: ForgeStructuredView[];
  activeViewId: string;
  revision?: number;
};

export type ForgeStructuredBase = {
  id: string;
  appId: string;
  name: string;
  description?: string;
  activeTableId: string;
  tables: ForgeStructuredTable[];
  revision?: number;
  updatedAt: string;
};

export type ForgeReviewDecision = "approved" | "denied";

export type ForgeStructuredSaveStatus = {
  kind: "idle" | "saving" | "saved" | "degraded" | "conflict" | "error";
  message: string | null;
  updatedAt: string | null;
};

export type ForgeStructuredSourceStatus = {
  kind: "loading" | "gateway" | "metadata" | "degraded";
  message: string | null;
  updatedAt: string | null;
};

type StructuredPayload = {
  version?: number;
  baseId?: unknown;
  activeTableId?: unknown;
  tables?: unknown;
  updatedAt?: unknown;
};

type UseForgeStructuredDataOptions = {
  apps: ForgeApp[];
  selectedAppId: string | null;
  onSelectApp: (appId: string) => void;
  gatewayRequest?: GatewayRequestFn;
  emitWorkflowEvent?: (appId: string, event: AppForgeWorkflowEventRequest) => Promise<boolean>;
};

export type GatewayRequestFn = <T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<T>;

type UseForgeStructuredDataReturn = {
  bases: ForgeStructuredBase[];
  activeBase: ForgeStructuredBase | null;
  activeTable: ForgeStructuredTable | null;
  activeView: ForgeStructuredView | null;
  selectedField: ForgeStructuredField | null;
  saving: boolean;
  error: string | null;
  saveStatus: ForgeStructuredSaveStatus;
  sourceStatus: ForgeStructuredSourceStatus;
  reload: () => void;
  selectBase: (appId: string) => void;
  selectTable: (tableId: string) => Promise<void>;
  selectField: (fieldId: string) => void;
  addTable: (input?: { name?: string }) => Promise<void>;
  updateTable: (
    tableId: string,
    updates: Partial<Pick<ForgeStructuredTable, "name">>,
  ) => Promise<void>;
  duplicateTable: (tableId: string) => Promise<void>;
  deleteTable: (tableId: string) => Promise<void>;
  selectView: (viewId: string) => Promise<void>;
  addView: (input?: { name?: string; type?: ForgeStructuredViewType }) => Promise<void>;
  updateView: (viewId: string, updates: Partial<ForgeStructuredView>) => Promise<void>;
  duplicateView: (viewId: string) => Promise<void>;
  deleteView: (viewId: string) => Promise<void>;
  updateActiveViewSettings: (
    updates: Partial<
      Pick<
        ForgeStructuredView,
        "filterText" | "sortFieldId" | "sortDirection" | "groupFieldId" | "visibleFieldIds"
      >
    >,
  ) => Promise<void>;
  addField: (input?: { name?: string; type?: ForgeFieldType }) => Promise<void>;
  updateField: (fieldId: string, updates: Partial<ForgeStructuredField>) => Promise<void>;
  duplicateField: (fieldId: string) => Promise<void>;
  deleteField: (fieldId: string) => Promise<void>;
  moveField: (fieldId: string, direction: "left" | "right") => Promise<void>;
  addRecord: () => Promise<void>;
  duplicateRecord: (recordId: string) => Promise<void>;
  updateCell: (
    recordId: string,
    fieldId: string,
    value: ForgeStructuredRecordValue,
  ) => Promise<void>;
  deleteRecord: (recordId: string) => Promise<void>;
  requestReview: (recordId: string) => Promise<void>;
  completeReview: (recordId: string, decision: ForgeReviewDecision) => Promise<void>;
  completeCapability: (recordId: string) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isArrayFieldType(type: ForgeFieldType): boolean {
  return type === "multi_select" || type === "attachment" || type === "linked_record";
}

function fieldSupportsOptions(type: ForgeFieldType): boolean {
  return type === "single_select" || type === "multi_select";
}

function cloneValue(value: ForgeStructuredRecordValue): ForgeStructuredRecordValue {
  return Array.isArray(value) ? [...value] : value;
}

function defaultValueForField(field: ForgeStructuredField, label = ""): ForgeStructuredRecordValue {
  if (field.type === "number") {
    return 0;
  }
  if (field.type === "checkbox") {
    return false;
  }
  if (isArrayFieldType(field.type)) {
    return [];
  }
  if (field.type === "single_select") {
    return field.options?.[0] ?? "";
  }
  return label;
}

function coerceValueForField(
  value: ForgeStructuredRecordValue | undefined,
  field: ForgeStructuredField,
): ForgeStructuredRecordValue {
  if (field.type === "number") {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }
  if (field.type === "checkbox") {
    return value === true || value === "true";
  }
  if (isArrayFieldType(field.type)) {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    return [];
  }
  if (field.type === "single_select") {
    const text = value === null || value === undefined ? "" : String(value);
    return field.options?.includes(text) ? text : (field.options?.[0] ?? "");
  }
  return value === null || value === undefined ? "" : String(value);
}

function workflowCapabilityId(app: ForgeApp): string {
  const metadata = isRecord(app.metadata) ? app.metadata : {};
  const rootCapabilities = Array.isArray(metadata.workflowCapabilities)
    ? metadata.workflowCapabilities
    : [];
  const workflow = isRecord(metadata.workflow) ? metadata.workflow : {};
  const workflowCapabilities = Array.isArray(workflow.capabilities) ? workflow.capabilities : [];
  const appForge = isRecord(metadata.appForge) ? metadata.appForge : {};
  const appForgeCapabilities = Array.isArray(appForge.workflowCapabilities)
    ? appForge.workflowCapabilities
    : [];
  const capability = [...rootCapabilities, ...workflowCapabilities, ...appForgeCapabilities].find(
    isRecord,
  );
  return stringValue(capability?.id) ?? "None";
}

function defaultFields(): ForgeStructuredField[] {
  return [
    {
      id: "name",
      name: "Name",
      type: "text",
      description: "Primary record label",
      required: true,
    },
    {
      id: "status",
      name: "Status",
      type: "single_select",
      options: [
        "Planning",
        "In Progress",
        "On Track",
        "Review",
        "Blocked",
        "Approved",
        "Denied",
        "Completed",
      ],
      description: "Current status for this record",
    },
    {
      id: "owner",
      name: "Owner",
      type: "text",
      description: "Responsible operator",
    },
    {
      id: "dueDate",
      name: "Due Date",
      type: "date",
      description: "Target date",
    },
    {
      id: "capability",
      name: "Capability",
      type: "text",
      description: "Workflow capability attached to the source app",
    },
  ];
}

function isViewType(value: unknown): value is ForgeStructuredViewType {
  return value === "grid" || value === "kanban" || value === "form" || value === "review";
}

function defaultViews(type: ForgeStructuredViewType = "grid"): ForgeStructuredView[] {
  const createdAt = nowIso();
  return [
    {
      id: `view-${type}`,
      name:
        type === "kanban"
          ? "Kanban"
          : type === "form"
            ? "Form"
            : type === "review"
              ? "Review"
              : "Grid",
      type,
      sortDirection: "asc",
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function normalizeView(value: unknown, fields: ForgeStructuredField[]): ForgeStructuredView | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const type = isViewType(value.type) ? value.type : undefined;
  if (!id || !name || !type) {
    return null;
  }
  const fieldIds = new Set(fields.map((field) => field.id));
  const sortFieldId = stringValue(value.sortFieldId);
  const groupFieldId = stringValue(value.groupFieldId);
  const visibleFieldIds = Array.isArray(value.visibleFieldIds)
    ? value.visibleFieldIds.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return {
    id,
    name,
    type,
    filterText: stringValue(value.filterText) ?? "",
    sortFieldId: sortFieldId && fieldIds.has(sortFieldId) ? sortFieldId : "",
    sortDirection: value.sortDirection === "desc" ? "desc" : "asc",
    groupFieldId: groupFieldId && fieldIds.has(groupFieldId) ? groupFieldId : "",
    visibleFieldIds: visibleFieldIds?.filter((fieldId) => fieldIds.has(fieldId)),
    createdAt: stringValue(value.createdAt) ?? nowIso(),
    updatedAt: stringValue(value.updatedAt) ?? nowIso(),
  };
}

function defaultRecords(app: ForgeApp): ForgeStructuredRecord[] {
  const createdAt = app.createdAt || nowIso();
  const updatedAt = app.updatedAt || createdAt;
  const baseNames = [
    app.name,
    "Website Redesign",
    "Review Queue",
    "Asset Approval",
    "Launch Checklist",
  ];
  const statuses = ["In Progress", "Planning", "Review", "On Track", "Blocked"];
  const owners = [app.creator || "ai", "Avery Vargas", "Jordan Kim", "Taylor Chen", "Morgan Lee"];
  return baseNames.map((name, index) => ({
    id: index === 0 ? "record-app" : `record-seed-${index}`,
    createdAt,
    updatedAt,
    values: {
      name: index === 0 ? `Sample: ${name}` : name,
      status: statuses[index] ?? "Planning",
      owner: owners[index] ?? app.creator ?? "ai",
      dueDate: index === 0 ? "" : `2026-05-${String(12 + index).padStart(2, "0")}`,
      capability: index === 0 ? workflowCapabilityId(app) : "",
    },
  }));
}

function defaultBase(app: ForgeApp): ForgeStructuredBase {
  const table: ForgeStructuredTable = {
    id: "table-main",
    name: "Projects",
    fields: defaultFields(),
    records: defaultRecords(app),
    views: defaultViews("grid"),
    activeViewId: "view-grid",
  };
  return {
    id: `base-${app.id}`,
    appId: app.id,
    name: app.name,
    description: app.description,
    activeTableId: table.id,
    tables: [table],
    updatedAt: app.updatedAt || app.createdAt || nowIso(),
  };
}

function normalizeField(value: unknown): ForgeStructuredField | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) {
    return null;
  }
  const rawType = stringValue(value.type);
  const type: ForgeFieldType =
    rawType === "single_select" ||
    rawType === "long_text" ||
    rawType === "multi_select" ||
    rawType === "number" ||
    rawType === "date" ||
    rawType === "checkbox" ||
    rawType === "url" ||
    rawType === "email" ||
    rawType === "attachment" ||
    rawType === "linked_record"
      ? rawType
      : "text";
  return {
    id,
    name,
    type,
    description: stringValue(value.description),
    required: booleanValue(value.required),
    options: Array.isArray(value.options)
      ? value.options.map(stringValue).filter((option): option is string => !!option)
      : undefined,
  };
}

function normalizeRecord(value: unknown): ForgeStructuredRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const values = isRecord(value.values) ? value.values : {};
  if (!id) {
    return null;
  }
  const normalizedValues: Record<string, ForgeStructuredRecordValue> = {};
  for (const [key, raw] of Object.entries(values)) {
    if (raw === null || typeof raw === "string" || typeof raw === "boolean") {
      normalizedValues[key] = raw as ForgeStructuredRecordValue;
      continue;
    }
    if (Array.isArray(raw)) {
      normalizedValues[key] = raw.filter((entry): entry is string => typeof entry === "string");
      continue;
    }
    const numeric = numberValue(raw);
    if (numeric !== undefined) {
      normalizedValues[key] = numeric;
    }
  }
  return {
    id,
    values: normalizedValues,
    revision: numberValue(value.revision),
    createdAt: stringValue(value.createdAt) ?? nowIso(),
    updatedAt: stringValue(value.updatedAt) ?? nowIso(),
  };
}

function normalizeTable(value: unknown): ForgeStructuredTable | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) {
    return null;
  }
  const fields = Array.isArray(value.fields)
    ? value.fields.map(normalizeField).filter((field): field is ForgeStructuredField => !!field)
    : [];
  const records = Array.isArray(value.records)
    ? value.records
        .map(normalizeRecord)
        .filter((record): record is ForgeStructuredRecord => !!record)
    : [];
  const normalizedFields = fields.length > 0 ? fields : defaultFields();
  const views = Array.isArray(value.views)
    ? value.views
        .map((view) => normalizeView(view, normalizedFields))
        .filter((view): view is ForgeStructuredView => !!view)
    : [];
  const normalizedViews = views.length > 0 ? views : defaultViews("grid");
  const activeViewId = stringValue(value.activeViewId);
  return {
    id,
    name,
    fields: normalizedFields,
    records,
    views: normalizedViews,
    activeViewId:
      activeViewId && normalizedViews.some((view) => view.id === activeViewId)
        ? activeViewId
        : normalizedViews[0].id,
    revision: numberValue(value.revision),
  };
}

function structuredPayload(app: ForgeApp): StructuredPayload | undefined {
  const metadata = isRecord(app.metadata) ? app.metadata : undefined;
  const appForge = isRecord(metadata?.appForge) ? metadata.appForge : undefined;
  return isRecord(appForge?.structured) ? appForge.structured : undefined;
}

function normalizeBase(app: ForgeApp): ForgeStructuredBase {
  const fallback = defaultBase(app);
  const payload = structuredPayload(app);
  if (!payload) {
    return fallback;
  }
  const tables = Array.isArray(payload.tables)
    ? payload.tables.map(normalizeTable).filter((table): table is ForgeStructuredTable => !!table)
    : [];
  if (tables.length === 0) {
    return fallback;
  }
  const activeTableId = stringValue(payload.activeTableId);
  return {
    id: stringValue(payload.baseId) ?? fallback.id,
    appId: app.id,
    name: app.name,
    description: app.description,
    activeTableId:
      activeTableId && tables.some((table) => table.id === activeTableId)
        ? activeTableId
        : tables[0].id,
    tables,
    updatedAt: stringValue(payload.updatedAt) ?? app.updatedAt ?? fallback.updatedAt,
  };
}

function normalizeGatewayBase(value: unknown): ForgeStructuredBase | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const appId = stringValue(value.appId);
  const name = stringValue(value.name);
  if (!id || !appId || !name) {
    return null;
  }
  const tables = Array.isArray(value.tables)
    ? value.tables.map(normalizeTable).filter((table): table is ForgeStructuredTable => !!table)
    : [];
  const activeTableId = stringValue(value.activeTableId);
  return {
    id,
    appId,
    name,
    description: stringValue(value.description),
    activeTableId:
      activeTableId && tables.some((table) => table.id === activeTableId)
        ? activeTableId
        : (tables[0]?.id ?? ""),
    tables,
    revision: numberValue(value.revision),
    updatedAt: stringValue(value.updatedAt) ?? nowIso(),
  };
}

function metadataWithBase(app: ForgeApp, base: ForgeStructuredBase): Record<string, unknown> {
  const metadata = isRecord(app.metadata) ? app.metadata : {};
  const appForge = isRecord(metadata.appForge) ? metadata.appForge : {};
  return {
    ...metadata,
    appForge: {
      ...appForge,
      structured: {
        version: 1,
        baseId: base.id,
        activeTableId: base.activeTableId,
        updatedAt: base.updatedAt,
        tables: base.tables,
      },
    },
  };
}

function fieldByName(table: ForgeStructuredTable, name: string): ForgeStructuredField | undefined {
  const normalized = name.trim().toLowerCase();
  return table.fields.find(
    (field) => field.id.toLowerCase() === normalized || field.name.toLowerCase() === normalized,
  );
}

function recordValues(table: ForgeStructuredTable, recordId: string): Record<string, unknown> {
  const record = table.records.find((candidate) => candidate.id === recordId);
  if (!record) {
    return {};
  }
  return Object.fromEntries(
    table.fields.map((field) => [field.name, record.values[field.id] ?? null]),
  );
}

function tableEventPayload(
  table: ForgeStructuredTable,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tableId: table.id,
    tableName: table.name,
    fieldIds: table.fields.map((field) => field.id),
    recordCount: table.records.length,
    ...extras,
  };
}

type GatewayRecordValue = ForgeStructuredRecordValue | string[];

type GatewayStructuredRecord = ForgeStructuredRecord & {
  revision: number;
  values: Record<string, GatewayRecordValue>;
};

type GatewayStructuredTable = Omit<ForgeStructuredTable, "records"> & {
  revision: number;
  records: GatewayStructuredRecord[];
};

type GatewayStructuredBase = Omit<ForgeStructuredBase, "tables"> & {
  revision: number;
  tables: GatewayStructuredTable[];
};

type GatewayMirrorMutation =
  | { kind: "base.put" }
  | { kind: "table.put"; table: ForgeStructuredTable }
  | { kind: "table.delete"; tableId: string; seedBase: ForgeStructuredBase }
  | { kind: "record.put"; tableId: string; record: ForgeStructuredRecord }
  | { kind: "record.delete"; tableId: string; recordId: string; seedBase: ForgeStructuredBase };

type GatewayMirrorCall = {
  method: string;
  params: Record<string, unknown>;
};

type GatewayBasesListResponse = {
  bases?: unknown;
};

type GatewayMirrorResponse = {
  base?: unknown;
};

function toGatewayRecord(record: ForgeStructuredRecord): GatewayStructuredRecord {
  return {
    ...record,
    revision: record.revision ?? 0,
    values: { ...record.values },
  };
}

function toGatewayTable(table: ForgeStructuredTable): GatewayStructuredTable {
  return {
    ...table,
    revision: table.revision ?? 0,
    fields: table.fields.map((field) => ({
      ...field,
      options: field.options ? [...field.options] : undefined,
    })),
    records: table.records.map(toGatewayRecord),
  };
}

function toGatewayBase(base: ForgeStructuredBase): GatewayStructuredBase {
  return {
    ...base,
    revision: base.revision ?? 0,
    tables: base.tables.map(toGatewayTable),
  };
}

function buildGatewayMirrorCalls(
  base: ForgeStructuredBase,
  mutation: GatewayMirrorMutation = { kind: "base.put" },
): GatewayMirrorCall[] {
  const baseRevision = base.revision ?? 0;
  const seedBase =
    mutation.kind === "table.delete" || mutation.kind === "record.delete"
      ? mutation.seedBase
      : base;
  const seedRevision = seedBase.revision ?? 0;
  const seedBaseCall: GatewayMirrorCall = {
    method: "appforge.bases.put",
    params: {
      base: toGatewayBase(seedBase),
      expectedRevision: seedRevision,
      idempotencyKey: `dashboard-base-${seedBase.id}-${seedBase.updatedAt}`,
    },
  };

  if (mutation.kind === "table.put") {
    if (baseRevision <= 0) {
      return [seedBaseCall];
    }
    return [
      {
        method: "appforge.tables.put",
        params: {
          baseId: base.id,
          table: toGatewayTable(mutation.table),
          expectedBaseRevision: baseRevision,
          expectedTableRevision: mutation.table.revision ?? 0,
          idempotencyKey: `dashboard-table-${base.id}-${mutation.table.id}-${base.updatedAt}`,
        },
      },
    ];
  }
  if (mutation.kind === "table.delete") {
    const table = seedBase.tables.find((candidate) => candidate.id === mutation.tableId);
    return [
      {
        method: "appforge.tables.delete",
        params: {
          baseId: seedBase.id,
          tableId: mutation.tableId,
          expectedBaseRevision: seedRevision,
          expectedTableRevision: table?.revision ?? 0,
        },
      },
    ];
  }
  if (mutation.kind === "record.put") {
    if (baseRevision <= 0) {
      return [seedBaseCall];
    }
    const table = base.tables.find((candidate) => candidate.id === mutation.tableId);
    return [
      {
        method: "appforge.records.put",
        params: {
          baseId: base.id,
          tableId: mutation.tableId,
          record: toGatewayRecord(mutation.record),
          expectedBaseRevision: baseRevision,
          expectedTableRevision: table?.revision ?? 0,
          expectedRecordRevision: mutation.record.revision ?? 0,
          idempotencyKey: `dashboard-record-${base.id}-${mutation.tableId}-${mutation.record.id}-${mutation.record.updatedAt}`,
        },
      },
    ];
  }
  if (mutation.kind === "record.delete") {
    const table = seedBase.tables.find((candidate) => candidate.id === mutation.tableId);
    const record = table?.records.find((candidate) => candidate.id === mutation.recordId);
    return [
      {
        method: "appforge.records.delete",
        params: {
          baseId: seedBase.id,
          tableId: mutation.tableId,
          recordId: mutation.recordId,
          expectedBaseRevision: seedRevision,
          expectedTableRevision: table?.revision ?? 0,
          expectedRecordRevision: record?.revision ?? 0,
        },
      },
    ];
  }

  return [seedBaseCall];
}

function isRevisionConflictError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/revision_conflict|expected revision \d+,\s*found \d+/i.test(message)) {
    return true;
  }
  if (isRecord(err)) {
    const details = isRecord(err.details) ? err.details : undefined;
    return err.code === "revision_conflict" || details?.code === "revision_conflict";
  }
  return false;
}

function formatStructuredSaveError(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Failed to save structured base";
  if (message.startsWith("This table changed elsewhere.")) {
    return message;
  }
  if (isRevisionConflictError(err)) {
    return `This table changed elsewhere. Reload AppForge and try again. ${message}`;
  }
  if (/\b(aborted|abort|timeout|timed out)\b/i.test(message)) {
    return "Timed out while saving structured base changes. Try again.";
  }
  return message || "Failed to save structured base";
}

async function mirrorGatewayMutation(
  gatewayRequest: GatewayRequestFn | undefined,
  base: ForgeStructuredBase,
  mutation?: GatewayMirrorMutation,
): Promise<ForgeStructuredBase | null> {
  if (!gatewayRequest) {
    return null;
  }
  const calls = buildGatewayMirrorCalls(base, mutation);
  let latestBase: ForgeStructuredBase | null = null;
  for (const call of calls) {
    const response = await gatewayRequest<GatewayMirrorResponse>(call.method, call.params, {
      timeoutMs: 5_000,
    });
    const normalizedBase = normalizeGatewayBase(response.base);
    if (normalizedBase) {
      latestBase = normalizedBase;
    }
  }
  return latestBase;
}

function storedFieldSelectionKey(appId: string, tableId: string): string {
  return `argent.appForge.selectedField.${appId}.${tableId}`;
}

export const forgeStructuredDataTestUtils = {
  buildGatewayMirrorCalls,
  coerceValueForField,
  defaultBase,
  defaultValueForField,
  formatStructuredSaveError,
  isRevisionConflictError,
  metadataWithBase,
  normalizeGatewayBase,
  normalizeBase,
};

export function useForgeStructuredData({
  apps,
  selectedAppId,
  onSelectApp,
  gatewayRequest,
  emitWorkflowEvent,
}: UseForgeStructuredDataOptions): UseForgeStructuredDataReturn {
  const [overrides, setOverrides] = useState<Record<string, ForgeStructuredBase>>({});
  const [gatewayBases, setGatewayBases] = useState<Record<string, ForgeStructuredBase>>({});
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<ForgeStructuredSaveStatus>({
    kind: "idle",
    message: null,
    updatedAt: null,
  });
  const [sourceStatus, setSourceStatus] = useState<ForgeStructuredSourceStatus>({
    kind: gatewayRequest ? "loading" : "metadata",
    message: gatewayRequest ? "Loading AppForge gateway data..." : "Using metadata fallback",
    updatedAt: null,
  });
  const [reloadVersion, setReloadVersion] = useState(0);
  const gatewayLoadAppIds = useMemo(() => apps.map((app) => app.id), [apps]);

  const bases = useMemo(
    () => apps.map((app) => overrides[app.id] ?? gatewayBases[app.id] ?? normalizeBase(app)),
    [apps, gatewayBases, overrides],
  );
  const activeBase = bases.find((base) => base.appId === selectedAppId) ?? bases[0] ?? null;
  const activeTable =
    activeBase?.tables.find((table) => table.id === activeBase.activeTableId) ??
    activeBase?.tables[0] ??
    null;
  const activeView =
    activeTable?.views.find((view) => view.id === activeTable.activeViewId) ??
    activeTable?.views[0] ??
    null;
  const activeBaseRef = useRef<ForgeStructuredBase | null>(activeBase);
  const activeTableRef = useRef<ForgeStructuredTable | null>(activeTable);
  useEffect(() => {
    activeBaseRef.current = activeBase;
    activeTableRef.current = activeTable;
  }, [activeBase, activeTable]);
  const activeSourceStatus = useMemo<ForgeStructuredSourceStatus>(() => {
    if (sourceStatus.kind === "loading" || sourceStatus.kind === "degraded") {
      return sourceStatus;
    }
    if (activeBase && gatewayBases[activeBase.appId]) {
      return {
        kind: "gateway",
        message: "Gateway source of truth loaded.",
        updatedAt: sourceStatus.updatedAt,
      };
    }
    return {
      kind: gatewayRequest ? "metadata" : sourceStatus.kind,
      message: gatewayRequest
        ? "Gateway connected; using metadata fallback until this app has a durable base."
        : (sourceStatus.message ?? "Using metadata fallback."),
      updatedAt: sourceStatus.updatedAt,
    };
  }, [activeBase, gatewayBases, gatewayRequest, sourceStatus]);
  const selectedField =
    activeTable?.fields.find((field) => field.id === selectedFieldId) ??
    activeTable?.fields[1] ??
    activeTable?.fields[0] ??
    null;

  useEffect(() => {
    if (!activeBase) {
      return;
    }
    if (selectedAppId !== activeBase.appId) {
      onSelectApp(activeBase.appId);
    }
  }, [activeBase, onSelectApp, selectedAppId]);

  useEffect(() => {
    if (!selectedField || selectedField.id === selectedFieldId) {
      return;
    }
    queueMicrotask(() => setSelectedFieldId(selectedField.id));
  }, [selectedField, selectedFieldId]);

  useEffect(() => {
    if (!selectedAppId || !activeTable || typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(
      storedFieldSelectionKey(selectedAppId, activeTable.id),
    );
    if (stored && activeTable.fields.some((field) => field.id === stored)) {
      queueMicrotask(() => setSelectedFieldId(stored));
    }
  }, [activeTable, selectedAppId]);

  useEffect(() => {
    if (!gatewayRequest) {
      queueMicrotask(() =>
        setSourceStatus({
          kind: "metadata",
          message: "Gateway unavailable; using metadata fallback.",
          updatedAt: nowIso(),
        }),
      );
      return;
    }
    if (gatewayLoadAppIds.length === 0) {
      return;
    }
    const requestGateway: NonNullable<typeof gatewayRequest> = gatewayRequest;
    let cancelled = false;
    const appIds = new Set(gatewayLoadAppIds);

    async function loadGatewayBases() {
      setSourceStatus({
        kind: "loading",
        message: "Loading AppForge gateway data...",
        updatedAt: null,
      });
      try {
        const result = await requestGateway<GatewayBasesListResponse>(
          "appforge.bases.list",
          {},
          { timeoutMs: 5_000 },
        );
        if (cancelled) {
          return;
        }
        const gatewayBaseList = Array.isArray(result.bases) ? result.bases : [];
        const nextBases: Record<string, ForgeStructuredBase> = {};
        for (const rawBase of gatewayBaseList) {
          const base = normalizeGatewayBase(rawBase);
          if (base && appIds.has(base.appId)) {
            nextBases[base.appId] = base;
          }
        }
        setGatewayBases((prev) => {
          const next = { ...prev };
          for (const appId of appIds) {
            delete next[appId];
          }
          return { ...next, ...nextBases };
        });
        setOverrides((prev) => {
          const next = { ...prev };
          for (const appId of appIds) {
            delete next[appId];
          }
          return next;
        });
        setSourceStatus({
          kind: Object.keys(nextBases).length > 0 ? "gateway" : "metadata",
          message:
            Object.keys(nextBases).length > 0
              ? "Gateway source of truth loaded."
              : "Gateway connected; using metadata fallback until this app has a durable base.",
          updatedAt: nowIso(),
        });
      } catch (err) {
        if (!cancelled) {
          console.warn("[AppForge] Gateway base load failed; using metadata fallback.", {
            error: err,
          });
          setSourceStatus({
            kind: "degraded",
            message: "Gateway load failed; using metadata fallback. Retry before trusting reloads.",
            updatedAt: nowIso(),
          });
        }
      }
    }

    void loadGatewayBases();
    return () => {
      cancelled = true;
    };
  }, [gatewayLoadAppIds, gatewayRequest, reloadVersion]);

  const reload = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  const persistBase = useCallback(
    async (
      base: ForgeStructuredBase,
      event?: Omit<AppForgeWorkflowEventRequest, "payload"> & {
        payload?: Record<string, unknown>;
      },
      gatewayMutation?: GatewayMirrorMutation,
    ) => {
      const app = apps.find((candidate) => candidate.id === base.appId);
      if (!app) {
        return;
      }
      const nextBase = { ...base, updatedAt: nowIso() };
      if (activeBaseRef.current?.appId === nextBase.appId) {
        activeBaseRef.current = nextBase;
        activeTableRef.current =
          nextBase.tables.find((table) => table.id === nextBase.activeTableId) ??
          nextBase.tables[0] ??
          null;
      }
      setOverrides((prev) => ({ ...prev, [base.appId]: nextBase }));
      setSaving(true);
      setError(null);
      setSaveStatus({ kind: "saving", message: "Saving changes...", updatedAt: null });
      try {
        let savedToGateway = false;
        let savedToMetadata = false;
        let gatewayError: unknown;
        let metadataError: unknown;

        if (gatewayRequest) {
          try {
            const gatewayBase = await mirrorGatewayMutation(
              gatewayRequest,
              nextBase,
              gatewayMutation,
            );
            savedToGateway = true;
            const savedBase = gatewayBase ?? nextBase;
            if (activeBaseRef.current?.appId === savedBase.appId) {
              activeBaseRef.current = savedBase;
              activeTableRef.current =
                savedBase.tables.find((table) => table.id === savedBase.activeTableId) ??
                savedBase.tables[0] ??
                null;
            }
            setGatewayBases((prev) => ({
              ...prev,
              [nextBase.appId]: savedBase,
            }));
            setOverrides((prev) => ({
              ...prev,
              [nextBase.appId]: savedBase,
            }));
            setSourceStatus({
              kind: "gateway",
              message: "Gateway source of truth saved.",
              updatedAt: nowIso(),
            });
          } catch (err) {
            gatewayError = err;
            if (isRevisionConflictError(err)) {
              throw err;
            }
            console.warn("[AppForge] Gateway save failed; trying metadata fallback.", {
              error: err,
            });
          }
        }

        try {
          const response = await fetchLocalApi(`/api/apps/${app.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metadata: metadataWithBase(app, nextBase) }),
          });
          if (!response.ok) {
            throw new Error(`Failed to save structured base metadata (${response.status})`);
          }
          savedToMetadata = true;
          if (!savedToGateway) {
            setSourceStatus({
              kind: gatewayRequest ? "degraded" : "metadata",
              message: gatewayRequest
                ? "Gateway save failed; changes were saved to metadata fallback."
                : "Saved to metadata fallback.",
              updatedAt: nowIso(),
            });
          }
        } catch (err) {
          metadataError = err;
          if (!savedToGateway) {
            throw err;
          }
          console.warn("[AppForge] Metadata fallback save failed; gateway save remains active.", {
            error: err,
          });
        }

        if (!savedToGateway && !savedToMetadata) {
          throw gatewayError ?? metadataError ?? new Error("Failed to save structured base");
        }

        if (event && emitWorkflowEvent) {
          await emitWorkflowEvent(app.id, event);
        }
        setSaveStatus({
          kind: savedToGateway || !gatewayRequest ? "saved" : "degraded",
          message: savedToGateway || !gatewayRequest ? "Saved" : "Saved to metadata fallback",
          updatedAt: nowIso(),
        });
      } catch (err) {
        const message = formatStructuredSaveError(err);
        setError(message);
        setSaveStatus({
          kind: isRevisionConflictError(err) ? "conflict" : "error",
          message,
          updatedAt: nowIso(),
        });
      } finally {
        setSaving(false);
      }
    },
    [apps, emitWorkflowEvent, gatewayRequest],
  );

  const selectBase = useCallback(
    (appId: string) => {
      onSelectApp(appId);
    },
    [onSelectApp],
  );

  const selectTable = useCallback(
    async (tableId: string) => {
      if (!activeBase || activeBase.activeTableId === tableId) {
        return;
      }
      await persistBase({ ...activeBase, activeTableId: tableId });
    },
    [activeBase, persistBase],
  );

  const selectField = useCallback(
    (fieldId: string) => {
      setSelectedFieldId(fieldId);
      if (selectedAppId && activeTable && typeof window !== "undefined") {
        window.localStorage.setItem(
          storedFieldSelectionKey(selectedAppId, activeTable.id),
          fieldId,
        );
      }
    },
    [activeTable, selectedAppId],
  );

  const updateActiveTable = useCallback(
    async (
      updater: (table: ForgeStructuredTable) => ForgeStructuredTable,
      event?: Omit<AppForgeWorkflowEventRequest, "payload"> & { payload?: Record<string, unknown> },
      gatewayMutation?: (params: {
        previousBase: ForgeStructuredBase;
        previousTable: ForgeStructuredTable;
        nextBase: ForgeStructuredBase;
        nextTable: ForgeStructuredTable;
      }) => GatewayMirrorMutation,
    ) => {
      const previousBase = activeBaseRef.current ?? activeBase;
      const previousTable =
        previousBase?.tables.find(
          (table) => table.id === (activeTableRef.current?.id ?? previousBase.activeTableId),
        ) ??
        previousBase?.tables.find((table) => table.id === previousBase.activeTableId) ??
        previousBase?.tables[0] ??
        null;
      if (!previousBase || !previousTable) {
        return;
      }
      const nextTable = updater(previousTable);
      const nextBase = {
        ...previousBase,
        tables: previousBase.tables.map((table) =>
          table.id === previousTable.id ? nextTable : table,
        ),
      };
      const workflowEvent =
        event ??
        ({
          eventType: "forge.table.updated",
          tableId: previousTable.id,
          payload: tableEventPayload(nextTable, {
            changeType: "table.updated",
          }),
        } satisfies Omit<AppForgeWorkflowEventRequest, "payload"> & {
          payload?: Record<string, unknown>;
        });
      await persistBase(
        nextBase,
        workflowEvent,
        gatewayMutation?.({
          previousBase,
          previousTable,
          nextBase,
          nextTable,
        }) ?? { kind: "table.put", table: nextTable },
      );
    },
    [activeBase, persistBase],
  );

  const addTable = useCallback(
    async (input?: { name?: string }) => {
      if (!activeBase) {
        return;
      }
      const name = input?.name?.trim() || `Table ${activeBase.tables.length + 1}`;
      const table: ForgeStructuredTable = {
        id: newId("table"),
        name,
        fields: defaultFields(),
        records: [],
        views: defaultViews("grid"),
        activeViewId: "view-grid",
      };
      const nextBase = {
        ...activeBase,
        activeTableId: table.id,
        tables: [...activeBase.tables, table],
      };
      await persistBase(
        nextBase,
        {
          eventType: "forge.table.created",
          tableId: table.id,
          payload: tableEventPayload(table, { changeType: "table.created" }),
        },
        { kind: "table.put", table },
      );
    },
    [activeBase, persistBase],
  );

  const updateTable = useCallback(
    async (tableId: string, updates: Partial<Pick<ForgeStructuredTable, "name">>) => {
      if (!activeBase) {
        return;
      }
      let nextTable: ForgeStructuredTable | null = null;
      const nextBase = {
        ...activeBase,
        tables: activeBase.tables.map((table) =>
          table.id === tableId
            ? (nextTable = {
                ...table,
                name: updates.name?.trim() || table.name,
              })
            : table,
        ),
      };
      await persistBase(
        nextBase,
        nextTable
          ? {
              eventType: "forge.table.updated",
              tableId,
              payload: tableEventPayload(nextTable, {
                changeType: "table.renamed",
                previousName: activeBase.tables.find((table) => table.id === tableId)?.name,
              }),
            }
          : undefined,
        nextTable ? { kind: "table.put", table: nextTable } : { kind: "base.put" },
      );
    },
    [activeBase, persistBase],
  );

  const duplicateTable = useCallback(
    async (tableId: string) => {
      if (!activeBase) {
        return;
      }
      const source = activeBase.tables.find((table) => table.id === tableId);
      if (!source) {
        return;
      }
      const fieldIdMap = new Map(source.fields.map((field) => [field.id, newId("field")]));
      const viewIdMap = new Map(source.views.map((view) => [view.id, newId("view")]));
      const copiedFieldIds = new Set(fieldIdMap.values());
      const table: ForgeStructuredTable = {
        id: newId("table"),
        name: `${source.name} Copy`,
        fields: source.fields.map((field) => ({
          ...field,
          id: fieldIdMap.get(field.id) ?? newId("field"),
          options: field.options ? [...field.options] : undefined,
        })),
        records: source.records.map((record) => {
          const recordId = newId("record");
          return {
            id: recordId,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            values: Object.fromEntries(
              source.fields.map((field) => [
                fieldIdMap.get(field.id) ?? field.id,
                cloneValue(record.values[field.id] ?? defaultValueForField(field)),
              ]),
            ),
          };
        }),
        views: source.views.map((view) => ({
          ...view,
          id: viewIdMap.get(view.id) ?? newId("view"),
          name: view.name,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          visibleFieldIds: view.visibleFieldIds
            ?.map((fieldId) => fieldIdMap.get(fieldId) ?? fieldId)
            .filter((fieldId) => copiedFieldIds.has(fieldId)),
          sortFieldId: view.sortFieldId ? (fieldIdMap.get(view.sortFieldId) ?? "") : "",
          groupFieldId: view.groupFieldId ? (fieldIdMap.get(view.groupFieldId) ?? "") : "",
        })),
        activeViewId:
          viewIdMap.get(source.activeViewId) ??
          viewIdMap.get(source.views[0]?.id ?? "") ??
          "view-grid",
      };
      const nextBase = {
        ...activeBase,
        activeTableId: table.id,
        tables: [...activeBase.tables, table],
      };
      await persistBase(
        nextBase,
        {
          eventType: "forge.table.created",
          tableId: table.id,
          payload: tableEventPayload(table, {
            changeType: "table.duplicated",
            duplicatedFrom: source.id,
          }),
        },
        { kind: "table.put", table },
      );
    },
    [activeBase, persistBase],
  );

  const deleteTable = useCallback(
    async (tableId: string) => {
      if (!activeBase || activeBase.tables.length <= 1) {
        return;
      }
      const tables = activeBase.tables.filter((table) => table.id !== tableId);
      const nextBase = {
        ...activeBase,
        activeTableId:
          activeBase.activeTableId === tableId
            ? (tables[0]?.id ?? activeBase.activeTableId)
            : activeBase.activeTableId,
        tables,
      };
      const deletedTable = activeBase.tables.find((table) => table.id === tableId);
      await persistBase(
        nextBase,
        deletedTable
          ? {
              eventType: "forge.table.deleted",
              tableId,
              payload: tableEventPayload(deletedTable, {
                changeType: "table.deleted",
                nextActiveTableId: nextBase.activeTableId,
              }),
            }
          : undefined,
        {
          kind: "table.delete",
          tableId,
          seedBase: activeBase,
        },
      );
    },
    [activeBase, persistBase],
  );

  const selectView = useCallback(
    async (viewId: string) => {
      if (
        !activeTable ||
        activeTable.activeViewId === viewId ||
        !activeTable.views.some((view) => view.id === viewId)
      ) {
        return;
      }
      await updateActiveTable((table) => ({ ...table, activeViewId: viewId }));
    },
    [activeTable, updateActiveTable],
  );

  const addView = useCallback(
    async (input?: { name?: string; type?: ForgeStructuredViewType }) => {
      const type = isViewType(input?.type) ? input.type : "grid";
      const createdAt = nowIso();
      const view: ForgeStructuredView = {
        id: newId("view"),
        name:
          input?.name?.trim() ||
          (type === "kanban"
            ? "Kanban"
            : type === "form"
              ? "Form"
              : type === "review"
                ? "Review"
                : "New grid view"),
        type,
        sortDirection: "asc",
        createdAt,
        updatedAt: createdAt,
      };
      await updateActiveTable((table) => ({
        ...table,
        views: [...table.views, view],
        activeViewId: view.id,
      }));
    },
    [updateActiveTable],
  );

  const updateView = useCallback(
    async (viewId: string, updates: Partial<ForgeStructuredView>) => {
      await updateActiveTable((table) => {
        const fieldIds = new Set(table.fields.map((field) => field.id));
        return {
          ...table,
          views: table.views.map((view) => {
            if (view.id !== viewId) {
              return view;
            }
            const sortFieldId =
              updates.sortFieldId !== undefined
                ? fieldIds.has(updates.sortFieldId)
                  ? updates.sortFieldId
                  : ""
                : view.sortFieldId;
            const groupFieldId =
              updates.groupFieldId !== undefined
                ? fieldIds.has(updates.groupFieldId)
                  ? updates.groupFieldId
                  : ""
                : view.groupFieldId;
            return {
              ...view,
              ...updates,
              id: view.id,
              name: updates.name?.trim() || view.name,
              type: updates.type && isViewType(updates.type) ? updates.type : view.type,
              sortFieldId,
              groupFieldId,
              sortDirection:
                updates.sortDirection !== undefined
                  ? updates.sortDirection === "desc"
                    ? "desc"
                    : "asc"
                  : view.sortDirection,
              visibleFieldIds: updates.visibleFieldIds
                ? updates.visibleFieldIds.filter((fieldId) => fieldIds.has(fieldId))
                : view.visibleFieldIds,
              updatedAt: nowIso(),
            };
          }),
        };
      });
    },
    [updateActiveTable],
  );

  const duplicateView = useCallback(
    async (viewId: string) => {
      if (!activeTable) {
        return;
      }
      const source = activeTable.views.find((view) => view.id === viewId);
      if (!source) {
        return;
      }
      const createdAt = nowIso();
      const view: ForgeStructuredView = {
        ...source,
        id: newId("view"),
        name: `${source.name} Copy`,
        createdAt,
        updatedAt: createdAt,
        visibleFieldIds: source.visibleFieldIds ? [...source.visibleFieldIds] : undefined,
      };
      await updateActiveTable((table) => ({
        ...table,
        views: [...table.views, view],
        activeViewId: view.id,
      }));
    },
    [activeTable, updateActiveTable],
  );

  const deleteView = useCallback(
    async (viewId: string) => {
      if (!activeTable || activeTable.views.length <= 1) {
        return;
      }
      await updateActiveTable((table) => {
        const views = table.views.filter((view) => view.id !== viewId);
        return {
          ...table,
          views,
          activeViewId:
            table.activeViewId === viewId
              ? (views[0]?.id ?? table.activeViewId)
              : table.activeViewId,
        };
      });
    },
    [activeTable, updateActiveTable],
  );

  const updateActiveViewSettings = useCallback(
    async (
      updates: Partial<
        Pick<
          ForgeStructuredView,
          "filterText" | "sortFieldId" | "sortDirection" | "groupFieldId" | "visibleFieldIds"
        >
      >,
    ) => {
      if (!activeView) {
        return;
      }
      await updateView(activeView.id, updates);
    },
    [activeView, updateView],
  );

  const addField = useCallback(
    async (input?: { name?: string; type?: ForgeFieldType }) => {
      const type = input?.type ?? "text";
      const field: ForgeStructuredField = {
        id: newId("field"),
        name: input?.name?.trim() || "New Field",
        type,
        options: fieldSupportsOptions(type) ? ["Option 1", "Option 2"] : undefined,
        description: "New structured field",
      };
      await updateActiveTable((table) => ({
        ...table,
        fields: [...table.fields, field],
        records: table.records.map((record) => ({
          ...record,
          values: { ...record.values, [field.id]: defaultValueForField(field) },
          updatedAt: nowIso(),
        })),
      }));
      setSelectedFieldId(field.id);
    },
    [updateActiveTable],
  );

  const updateField = useCallback(
    async (fieldId: string, updates: Partial<ForgeStructuredField>) => {
      await updateActiveTable((table) => ({
        ...table,
        fields: table.fields.map((field) => {
          if (field.id !== fieldId) {
            return field;
          }
          const nextField = {
            ...field,
            ...updates,
            id: field.id,
            name: updates.name?.trim() || field.name,
            options:
              updates.type && !fieldSupportsOptions(updates.type)
                ? undefined
                : updates.type && fieldSupportsOptions(updates.type)
                  ? (updates.options ?? field.options ?? ["Option 1", "Option 2"])
                  : (updates.options ?? field.options),
          };
          return nextField;
        }),
        records: table.records.map((record) => {
          const field = table.fields.find((candidate) => candidate.id === fieldId);
          if (!field) {
            return record;
          }
          const nextField = { ...field, ...updates, id: field.id };
          return {
            ...record,
            values: {
              ...record.values,
              [fieldId]: coerceValueForField(record.values[fieldId], nextField),
            },
            updatedAt: nowIso(),
          };
        }),
      }));
    },
    [updateActiveTable],
  );

  const duplicateField = useCallback(
    async (fieldId: string) => {
      if (!activeTable) {
        return;
      }
      const source = activeTable.fields.find((field) => field.id === fieldId);
      if (!source) {
        return;
      }
      const sourceIndex = activeTable.fields.findIndex((field) => field.id === fieldId);
      const field: ForgeStructuredField = {
        ...source,
        id: newId("field"),
        name: `${source.name} Copy`,
        options: source.options ? [...source.options] : undefined,
      };
      await updateActiveTable((table) => ({
        ...table,
        fields: [
          ...table.fields.slice(0, sourceIndex + 1),
          field,
          ...table.fields.slice(sourceIndex + 1),
        ],
        records: table.records.map((record) => ({
          ...record,
          values: {
            ...record.values,
            [field.id]: cloneValue(record.values[fieldId] ?? defaultValueForField(field)),
          },
          updatedAt: nowIso(),
        })),
      }));
      setSelectedFieldId(field.id);
    },
    [activeTable, updateActiveTable],
  );

  const deleteField = useCallback(
    async (fieldId: string) => {
      if (!activeTable || activeTable.fields.length <= 1) {
        return;
      }
      const nextField = activeTable.fields.find((field) => field.id !== fieldId);
      await updateActiveTable((table) => ({
        ...table,
        fields: table.fields.filter((field) => field.id !== fieldId),
        views: table.views.map((view) => ({
          ...view,
          sortFieldId: view.sortFieldId === fieldId ? "" : view.sortFieldId,
          groupFieldId: view.groupFieldId === fieldId ? "" : view.groupFieldId,
          visibleFieldIds: view.visibleFieldIds?.filter((candidate) => candidate !== fieldId),
          updatedAt: nowIso(),
        })),
        records: table.records.map((record) => {
          return {
            ...record,
            values: Object.fromEntries(
              Object.entries(record.values).filter(([key]) => key !== fieldId),
            ),
            updatedAt: nowIso(),
          };
        }),
      }));
      if (nextField) {
        setSelectedFieldId(nextField.id);
      }
    },
    [activeTable, updateActiveTable],
  );

  const moveField = useCallback(
    async (fieldId: string, direction: "left" | "right") => {
      if (!activeTable) {
        return;
      }
      const index = activeTable.fields.findIndex((field) => field.id === fieldId);
      const targetIndex = direction === "left" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= activeTable.fields.length) {
        return;
      }
      await updateActiveTable((table) => {
        const fields = [...table.fields];
        const [field] = fields.splice(index, 1);
        if (!field) {
          return table;
        }
        fields.splice(targetIndex, 0, field);
        return { ...table, fields };
      });
    },
    [activeTable, updateActiveTable],
  );

  const addRecord = useCallback(async () => {
    if (!activeBase || !activeTable) {
      return;
    }
    const recordId = newId("record");
    const createdAt = nowIso();
    const values = Object.fromEntries(
      activeTable.fields.map((field, index) => [
        field.id,
        defaultValueForField(
          field,
          index === 0 ? `Untitled ${activeTable.records.length + 1}` : "",
        ),
      ]),
    );
    const nextRecord = { id: recordId, createdAt, updatedAt: createdAt, values };
    await updateActiveTable(
      (table) => ({
        ...table,
        records: [...table.records, nextRecord],
      }),
      {
        eventType: "forge.record.created",
        tableId: activeTable.id,
        recordId,
        payload: { tableId: activeTable.id, recordId, values },
      },
      () => ({ kind: "record.put", tableId: activeTable.id, record: nextRecord }),
    );
  }, [activeBase, activeTable, updateActiveTable]);

  const duplicateRecord = useCallback(
    async (recordId: string) => {
      if (!activeTable) {
        return;
      }
      const source = activeTable.records.find((record) => record.id === recordId);
      if (!source) {
        return;
      }
      const nextRecordId = newId("record");
      const createdAt = nowIso();
      const values = Object.fromEntries(
        activeTable.fields.map((field, index) => {
          const value = cloneValue(source.values[field.id] ?? defaultValueForField(field));
          return [
            field.id,
            index === 0 && typeof value === "string" && value.trim() ? `${value} Copy` : value,
          ];
        }),
      );
      await updateActiveTable(
        (table) => {
          const sourceIndex = table.records.findIndex((record) => record.id === recordId);
          const nextRecord = {
            id: nextRecordId,
            createdAt,
            updatedAt: createdAt,
            values,
          };
          return {
            ...table,
            records: [
              ...table.records.slice(0, sourceIndex + 1),
              nextRecord,
              ...table.records.slice(sourceIndex + 1),
            ],
          };
        },
        {
          eventType: "forge.record.created",
          tableId: activeTable.id,
          recordId: nextRecordId,
          payload: {
            tableId: activeTable.id,
            recordId: nextRecordId,
            values,
            duplicatedFrom: recordId,
          },
        },
        ({ nextTable }) => {
          const mirroredRecord = nextTable.records.find(
            (candidate) => candidate.id === nextRecordId,
          );
          return mirroredRecord
            ? { kind: "record.put", tableId: activeTable.id, record: mirroredRecord }
            : { kind: "table.put", table: nextTable };
        },
      );
    },
    [activeTable, updateActiveTable],
  );

  const updateCell = useCallback(
    async (recordId: string, fieldId: string, value: ForgeStructuredRecordValue) => {
      if (!activeTable) {
        return;
      }
      await updateActiveTable(
        (table) => ({
          ...table,
          records: table.records.map((record) =>
            record.id === recordId
              ? {
                  ...record,
                  values: { ...record.values, [fieldId]: value },
                  updatedAt: nowIso(),
                }
              : record,
          ),
        }),
        {
          eventType: "forge.record.updated",
          tableId: activeTable.id,
          recordId,
          payload: { tableId: activeTable.id, recordId, fieldId, value },
        },
        ({ nextTable }) => {
          const mirroredRecord = nextTable.records.find((candidate) => candidate.id === recordId);
          return mirroredRecord
            ? { kind: "record.put", tableId: activeTable.id, record: mirroredRecord }
            : { kind: "table.put", table: nextTable };
        },
      );
    },
    [activeTable, updateActiveTable],
  );

  const deleteRecord = useCallback(
    async (recordId: string) => {
      if (!activeTable) {
        return;
      }
      await updateActiveTable(
        (table) => ({
          ...table,
          records: table.records.filter((record) => record.id !== recordId),
        }),
        {
          eventType: "forge.record.deleted",
          tableId: activeTable.id,
          recordId,
          payload: { tableId: activeTable.id, recordId },
        },
        ({ previousBase }) => ({
          kind: "record.delete",
          tableId: activeTable.id,
          recordId,
          seedBase: previousBase,
        }),
      );
    },
    [activeTable, updateActiveTable],
  );

  const requestReview = useCallback(
    async (recordId: string) => {
      if (!activeTable) {
        return;
      }
      const statusField = fieldByName(activeTable, "status");
      await updateActiveTable(
        (table) => ({
          ...table,
          records: table.records.map((record) =>
            record.id === recordId && statusField
              ? {
                  ...record,
                  values: { ...record.values, [statusField.id]: "Review" },
                  updatedAt: nowIso(),
                }
              : record,
          ),
        }),
        {
          eventType: "forge.review.requested",
          tableId: activeTable.id,
          recordId,
          reviewId: `review-${recordId}-${Date.now()}`,
          payload: {
            tableId: activeTable.id,
            recordId,
            values: recordValues(activeTable, recordId),
          },
        },
        ({ nextTable }) => {
          const mirroredRecord = nextTable.records.find((candidate) => candidate.id === recordId);
          return mirroredRecord
            ? { kind: "record.put", tableId: activeTable.id, record: mirroredRecord }
            : { kind: "table.put", table: nextTable };
        },
      );
    },
    [activeTable, updateActiveTable],
  );

  const completeReview = useCallback(
    async (recordId: string, decision: ForgeReviewDecision) => {
      if (!activeTable) {
        return;
      }
      const statusField = fieldByName(activeTable, "status");
      const capabilityField = fieldByName(activeTable, "capability");
      const record = activeTable.records.find((candidate) => candidate.id === recordId);
      const capabilityId = capabilityField
        ? stringValue(record?.values[capabilityField.id]) || undefined
        : undefined;
      await updateActiveTable(
        (table) => ({
          ...table,
          records: table.records.map((candidate) =>
            candidate.id === recordId && statusField
              ? {
                  ...candidate,
                  values: {
                    ...candidate.values,
                    [statusField.id]: decision === "approved" ? "Approved" : "Denied",
                  },
                  updatedAt: nowIso(),
                }
              : candidate,
          ),
        }),
        {
          eventType: "forge.review.completed",
          capabilityId,
          tableId: activeTable.id,
          recordId,
          reviewId: `review-${recordId}-${Date.now()}`,
          decision,
          payload: {
            tableId: activeTable.id,
            recordId,
            decision,
            approvedItems: decision === "approved" ? [recordId] : [],
            values: recordValues(activeTable, recordId),
          },
        },
        ({ nextTable }) => {
          const mirroredRecord = nextTable.records.find((candidate) => candidate.id === recordId);
          return mirroredRecord
            ? { kind: "record.put", tableId: activeTable.id, record: mirroredRecord }
            : { kind: "table.put", table: nextTable };
        },
      );
    },
    [activeTable, updateActiveTable],
  );

  const completeCapability = useCallback(
    async (recordId: string) => {
      if (!activeTable) {
        return;
      }
      const statusField = fieldByName(activeTable, "status");
      const capabilityField = fieldByName(activeTable, "capability");
      const record = activeTable.records.find((candidate) => candidate.id === recordId);
      const capabilityId = capabilityField
        ? stringValue(record?.values[capabilityField.id]) || undefined
        : undefined;
      await updateActiveTable(
        (table) => ({
          ...table,
          records: table.records.map((candidate) =>
            candidate.id === recordId && statusField
              ? {
                  ...candidate,
                  values: { ...candidate.values, [statusField.id]: "Completed" },
                  updatedAt: nowIso(),
                }
              : candidate,
          ),
        }),
        {
          eventType: "forge.capability.completed",
          capabilityId,
          tableId: activeTable.id,
          recordId,
          payload: {
            tableId: activeTable.id,
            recordId,
            capabilityId,
            values: recordValues(activeTable, recordId),
          },
        },
        ({ nextTable }) => {
          const mirroredRecord = nextTable.records.find((candidate) => candidate.id === recordId);
          return mirroredRecord
            ? { kind: "record.put", tableId: activeTable.id, record: mirroredRecord }
            : { kind: "table.put", table: nextTable };
        },
      );
    },
    [activeTable, updateActiveTable],
  );

  return {
    bases,
    activeBase,
    activeTable,
    activeView,
    selectedField,
    saving,
    error,
    saveStatus,
    sourceStatus: activeSourceStatus,
    reload,
    selectBase,
    selectTable,
    selectField,
    addTable,
    updateTable,
    duplicateTable,
    deleteTable,
    selectView,
    addView,
    updateView,
    duplicateView,
    deleteView,
    updateActiveViewSettings,
    addField,
    updateField,
    duplicateField,
    deleteField,
    moveField,
    addRecord,
    duplicateRecord,
    updateCell,
    deleteRecord,
    requestReview,
    completeReview,
    completeCapability,
  };
}
