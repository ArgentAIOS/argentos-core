import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppForgeWorkflowEventRequest, ForgeApp } from "./useApps";
import { fetchLocalApi } from "../utils/localApiFetch";

export type ForgeFieldType = "text" | "single_select" | "number" | "date" | "checkbox";

export type ForgeStructuredField = {
  id: string;
  name: string;
  type: ForgeFieldType;
  description?: string;
  required?: boolean;
  options?: string[];
};

export type ForgeStructuredRecordValue = string | number | boolean | null;

export type ForgeStructuredRecord = {
  id: string;
  values: Record<string, ForgeStructuredRecordValue>;
  createdAt: string;
  updatedAt: string;
};

export type ForgeStructuredTable = {
  id: string;
  name: string;
  fields: ForgeStructuredField[];
  records: ForgeStructuredRecord[];
};

export type ForgeStructuredBase = {
  id: string;
  appId: string;
  name: string;
  description?: string;
  activeTableId: string;
  tables: ForgeStructuredTable[];
  updatedAt: string;
};

export type ForgeReviewDecision = "approved" | "denied";

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
  selectedField: ForgeStructuredField | null;
  saving: boolean;
  error: string | null;
  selectBase: (appId: string) => void;
  selectTable: (tableId: string) => Promise<void>;
  selectField: (fieldId: string) => void;
  addTable: () => Promise<void>;
  updateTable: (
    tableId: string,
    updates: Partial<Pick<ForgeStructuredTable, "name">>,
  ) => Promise<void>;
  duplicateTable: (tableId: string) => Promise<void>;
  deleteTable: (tableId: string) => Promise<void>;
  addField: () => Promise<void>;
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

function cloneValue(value: ForgeStructuredRecordValue): ForgeStructuredRecordValue {
  return value;
}

function defaultValueForField(field: ForgeStructuredField, label = ""): ForgeStructuredRecordValue {
  if (field.type === "number") return 0;
  if (field.type === "checkbox") return false;
  if (field.type === "single_select") return field.options?.[0] ?? "";
  return label;
}

function coerceValueForField(
  value: ForgeStructuredRecordValue | undefined,
  field: ForgeStructuredField,
): ForgeStructuredRecordValue {
  if (field.type === "number") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }
  if (field.type === "checkbox") {
    return value === true || value === "true";
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
      name,
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
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) return null;
  const rawType = stringValue(value.type);
  const type: ForgeFieldType =
    rawType === "single_select" ||
    rawType === "number" ||
    rawType === "date" ||
    rawType === "checkbox"
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
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const values = isRecord(value.values) ? value.values : {};
  if (!id) return null;
  const normalizedValues: Record<string, ForgeStructuredRecordValue> = {};
  for (const [key, raw] of Object.entries(values)) {
    if (raw === null || typeof raw === "string" || typeof raw === "boolean") {
      normalizedValues[key] = raw;
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
    createdAt: stringValue(value.createdAt) ?? nowIso(),
    updatedAt: stringValue(value.updatedAt) ?? nowIso(),
  };
}

function normalizeTable(value: unknown): ForgeStructuredTable | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) return null;
  const fields = Array.isArray(value.fields)
    ? value.fields.map(normalizeField).filter((field): field is ForgeStructuredField => !!field)
    : [];
  const records = Array.isArray(value.records)
    ? value.records
        .map(normalizeRecord)
        .filter((record): record is ForgeStructuredRecord => !!record)
    : [];
  return {
    id,
    name,
    fields: fields.length > 0 ? fields : defaultFields(),
    records,
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
  if (!payload) return fallback;
  const tables = Array.isArray(payload.tables)
    ? payload.tables.map(normalizeTable).filter((table): table is ForgeStructuredTable => !!table)
    : [];
  if (tables.length === 0) return fallback;
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
  if (!record) return {};
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

function toGatewayRecord(record: ForgeStructuredRecord): GatewayStructuredRecord {
  return {
    ...record,
    revision: 0,
    values: { ...record.values },
  };
}

function toGatewayTable(table: ForgeStructuredTable): GatewayStructuredTable {
  return {
    ...table,
    revision: 0,
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
    revision: 0,
    tables: base.tables.map(toGatewayTable),
  };
}

function buildGatewayMirrorCalls(
  base: ForgeStructuredBase,
  mutation: GatewayMirrorMutation = { kind: "base.put" },
): GatewayMirrorCall[] {
  const seedBase =
    mutation.kind === "table.delete" || mutation.kind === "record.delete"
      ? mutation.seedBase
      : base;
  const calls: GatewayMirrorCall[] = [
    {
      method: "appforge.bases.put",
      params: {
        base: toGatewayBase(seedBase),
        idempotencyKey: `dashboard-base-${seedBase.id}-${seedBase.updatedAt}`,
      },
    },
  ];

  if (mutation.kind === "table.put") {
    calls.push({
      method: "appforge.tables.put",
      params: {
        baseId: base.id,
        table: toGatewayTable(mutation.table),
        idempotencyKey: `dashboard-table-${base.id}-${mutation.table.id}-${base.updatedAt}`,
      },
    });
  } else if (mutation.kind === "table.delete") {
    calls.push({
      method: "appforge.tables.delete",
      params: { baseId: seedBase.id, tableId: mutation.tableId },
    });
  } else if (mutation.kind === "record.put") {
    calls.push({
      method: "appforge.records.put",
      params: {
        baseId: base.id,
        tableId: mutation.tableId,
        record: toGatewayRecord(mutation.record),
        idempotencyKey: `dashboard-record-${base.id}-${mutation.tableId}-${mutation.record.id}-${mutation.record.updatedAt}`,
      },
    });
  } else if (mutation.kind === "record.delete") {
    calls.push({
      method: "appforge.records.delete",
      params: {
        baseId: seedBase.id,
        tableId: mutation.tableId,
        recordId: mutation.recordId,
      },
    });
  }

  return calls;
}

async function mirrorGatewayMutation(
  gatewayRequest: GatewayRequestFn | undefined,
  base: ForgeStructuredBase,
  mutation?: GatewayMirrorMutation,
) {
  if (!gatewayRequest) {
    return;
  }
  const calls = buildGatewayMirrorCalls(base, mutation);
  for (const call of calls) {
    await gatewayRequest(call.method, call.params, { timeoutMs: 5_000 });
  }
}

function storedFieldSelectionKey(appId: string, tableId: string): string {
  return `argent.appForge.selectedField.${appId}.${tableId}`;
}

export const forgeStructuredDataTestUtils = {
  buildGatewayMirrorCalls,
  coerceValueForField,
  defaultBase,
  defaultValueForField,
  metadataWithBase,
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
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bases = useMemo(
    () => apps.map((app) => overrides[app.id] ?? normalizeBase(app)),
    [apps, overrides],
  );
  const activeBase = bases.find((base) => base.appId === selectedAppId) ?? bases[0] ?? null;
  const activeTable =
    activeBase?.tables.find((table) => table.id === activeBase.activeTableId) ??
    activeBase?.tables[0] ??
    null;
  const selectedField =
    activeTable?.fields.find((field) => field.id === selectedFieldId) ??
    activeTable?.fields[1] ??
    activeTable?.fields[0] ??
    null;

  useEffect(() => {
    if (!activeBase) return;
    if (selectedAppId !== activeBase.appId) {
      onSelectApp(activeBase.appId);
    }
  }, [activeBase, onSelectApp, selectedAppId]);

  useEffect(() => {
    if (!selectedField || selectedField.id === selectedFieldId) return;
    setSelectedFieldId(selectedField.id);
  }, [selectedField, selectedFieldId]);

  useEffect(() => {
    if (!selectedAppId || !activeTable || typeof window === "undefined") return;
    const stored = window.localStorage.getItem(
      storedFieldSelectionKey(selectedAppId, activeTable.id),
    );
    if (stored && activeTable.fields.some((field) => field.id === stored)) {
      setSelectedFieldId(stored);
    }
  }, [activeTable, selectedAppId]);

  const persistBase = useCallback(
    async (
      base: ForgeStructuredBase,
      event?: Omit<AppForgeWorkflowEventRequest, "payload"> & {
        payload?: Record<string, unknown>;
      },
      gatewayMutation?: GatewayMirrorMutation,
    ) => {
      const app = apps.find((candidate) => candidate.id === base.appId);
      if (!app) return;
      const nextBase = { ...base, updatedAt: nowIso() };
      setOverrides((prev) => ({ ...prev, [base.appId]: nextBase }));
      setSaving(true);
      setError(null);
      try {
        const response = await fetchLocalApi(`/api/apps/${app.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: metadataWithBase(app, nextBase) }),
        });
        if (!response.ok) {
          throw new Error(`Failed to save structured base (${response.status})`);
        }
        try {
          await mirrorGatewayMutation(gatewayRequest, nextBase, gatewayMutation);
        } catch (gatewayErr) {
          console.warn("[AppForge] Gateway mirror failed; metadata persistence remains active.", {
            error: gatewayErr,
          });
        }
        if (event && emitWorkflowEvent) {
          await emitWorkflowEvent(app.id, event);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save structured base");
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
      if (!activeBase || activeBase.activeTableId === tableId) return;
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
      if (!activeBase || !activeTable) return;
      const nextTable = updater(activeTable);
      const nextBase = {
        ...activeBase,
        tables: activeBase.tables.map((table) => (table.id === activeTable.id ? nextTable : table)),
      };
      const workflowEvent =
        event ??
        ({
          eventType: "forge.table.updated",
          tableId: activeTable.id,
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
          previousBase: activeBase,
          previousTable: activeTable,
          nextBase,
          nextTable,
        }) ?? { kind: "table.put", table: nextTable },
      );
    },
    [activeBase, activeTable, persistBase],
  );

  const addTable = useCallback(async () => {
    if (!activeBase) return;
    const table: ForgeStructuredTable = {
      id: newId("table"),
      name: `Table ${activeBase.tables.length + 1}`,
      fields: defaultFields(),
      records: [],
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
  }, [activeBase, persistBase]);

  const updateTable = useCallback(
    async (tableId: string, updates: Partial<Pick<ForgeStructuredTable, "name">>) => {
      if (!activeBase) return;
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
      if (!activeBase) return;
      const source = activeBase.tables.find((table) => table.id === tableId);
      if (!source) return;
      const fieldIdMap = new Map(source.fields.map((field) => [field.id, newId("field")]));
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
      if (!activeBase || activeBase.tables.length <= 1) return;
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

  const addField = useCallback(async () => {
    const field: ForgeStructuredField = {
      id: newId("field"),
      name: "New Field",
      type: "text",
      description: "New structured field",
    };
    await updateActiveTable((table) => ({
      ...table,
      fields: [...table.fields, field],
      records: table.records.map((record) => ({
        ...record,
        values: { ...record.values, [field.id]: "" },
        updatedAt: nowIso(),
      })),
    }));
    setSelectedFieldId(field.id);
  }, [updateActiveTable]);

  const updateField = useCallback(
    async (fieldId: string, updates: Partial<ForgeStructuredField>) => {
      await updateActiveTable((table) => ({
        ...table,
        fields: table.fields.map((field) => {
          if (field.id !== fieldId) return field;
          const nextField = {
            ...field,
            ...updates,
            id: field.id,
            name: updates.name?.trim() || field.name,
            options:
              updates.type && updates.type !== "single_select"
                ? undefined
                : (updates.options ?? field.options),
          };
          return nextField;
        }),
        records: table.records.map((record) => {
          const field = table.fields.find((candidate) => candidate.id === fieldId);
          if (!field) return record;
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
      if (!activeTable) return;
      const source = activeTable.fields.find((field) => field.id === fieldId);
      if (!source) return;
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
      if (!activeTable || activeTable.fields.length <= 1) return;
      const nextField = activeTable.fields.find((field) => field.id !== fieldId);
      await updateActiveTable((table) => ({
        ...table,
        fields: table.fields.filter((field) => field.id !== fieldId),
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
      if (!activeTable) return;
      const index = activeTable.fields.findIndex((field) => field.id === fieldId);
      const targetIndex = direction === "left" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= activeTable.fields.length) return;
      await updateActiveTable((table) => {
        const fields = [...table.fields];
        const [field] = fields.splice(index, 1);
        if (!field) return table;
        fields.splice(targetIndex, 0, field);
        return { ...table, fields };
      });
    },
    [activeTable, updateActiveTable],
  );

  const addRecord = useCallback(async () => {
    if (!activeBase || !activeTable) return;
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
      if (!activeTable) return;
      const source = activeTable.records.find((record) => record.id === recordId);
      if (!source) return;
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
      if (!activeTable) return;
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
      if (!activeTable) return;
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
      if (!activeTable) return;
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
      if (!activeTable) return;
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
      if (!activeTable) return;
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
    selectedField,
    saving,
    error,
    selectBase,
    selectTable,
    selectField,
    addTable,
    updateTable,
    duplicateTable,
    deleteTable,
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
