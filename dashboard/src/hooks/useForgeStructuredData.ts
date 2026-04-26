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
  emitWorkflowEvent?: (appId: string, event: AppForgeWorkflowEventRequest) => Promise<boolean>;
};

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
  addField: () => Promise<void>;
  updateField: (fieldId: string, updates: Partial<ForgeStructuredField>) => Promise<void>;
  addRecord: () => Promise<void>;
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

export function useForgeStructuredData({
  apps,
  selectedAppId,
  onSelectApp,
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

  const persistBase = useCallback(
    async (
      base: ForgeStructuredBase,
      event?: Omit<AppForgeWorkflowEventRequest, "payload"> & {
        payload?: Record<string, unknown>;
      },
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
        if (event && emitWorkflowEvent) {
          await emitWorkflowEvent(app.id, event);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save structured base");
      } finally {
        setSaving(false);
      }
    },
    [apps, emitWorkflowEvent],
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

  const selectField = useCallback((fieldId: string) => {
    setSelectedFieldId(fieldId);
  }, []);

  const updateActiveTable = useCallback(
    async (
      updater: (table: ForgeStructuredTable) => ForgeStructuredTable,
      event?: Omit<AppForgeWorkflowEventRequest, "payload"> & { payload?: Record<string, unknown> },
    ) => {
      if (!activeBase || !activeTable) return;
      const nextTable = updater(activeTable);
      const nextBase = {
        ...activeBase,
        tables: activeBase.tables.map((table) => (table.id === activeTable.id ? nextTable : table)),
      };
      await persistBase(nextBase, event);
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
    await persistBase({
      ...activeBase,
      activeTableId: table.id,
      tables: [...activeBase.tables, table],
    });
  }, [activeBase, persistBase]);

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
        fields: table.fields.map((field) =>
          field.id === fieldId
            ? {
                ...field,
                ...updates,
                id: field.id,
                name: updates.name?.trim() || field.name,
              }
            : field,
        ),
      }));
    },
    [updateActiveTable],
  );

  const addRecord = useCallback(async () => {
    if (!activeBase || !activeTable) return;
    const recordId = newId("record");
    const createdAt = nowIso();
    const values = Object.fromEntries(
      activeTable.fields.map((field, index) => [
        field.id,
        index === 0 ? `Untitled ${activeTable.records.length + 1}` : "",
      ]),
    );
    await updateActiveTable(
      (table) => ({
        ...table,
        records: [...table.records, { id: recordId, createdAt, updatedAt: createdAt, values }],
      }),
      {
        eventType: "forge.record.created",
        tableId: activeTable.id,
        recordId,
        payload: { tableId: activeTable.id, recordId, values },
      },
    );
  }, [activeBase, activeTable, updateActiveTable]);

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
    addField,
    updateField,
    addRecord,
    updateCell,
    deleteRecord,
    requestReview,
    completeReview,
    completeCapability,
  };
}
