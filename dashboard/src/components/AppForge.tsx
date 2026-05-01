import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Boxes,
  ChevronDown,
  Copy,
  Ellipsis,
  ExternalLink,
  Lock,
  Loader2,
  Monitor,
  PanelsTopLeft,
  Pin,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Send,
  Settings,
  Share2,
  Sparkles,
  Star,
  Table2,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { AppForgeWorkflowEventRequest, ForgeApp } from "../hooks/useApps";
import type { AppWindowState } from "../hooks/useAppWindows";
import {
  useForgeStructuredData,
  type GatewayRequestFn,
  type ForgeFieldType,
  type ForgeStructuredBase,
  type ForgeStructuredField,
  type ForgeStructuredRecord,
  type ForgeStructuredRecordValue,
  type ForgeStructuredSelectOption,
  type ForgeStructuredTable,
  type ForgeStructuredViewType,
} from "../hooks/useForgeStructuredData";
import { fetchLocalApi } from "../utils/localApiFetch";
import { AppDock } from "./AppDock";

interface AppForgeProps {
  isOpen: boolean;
  apps: ForgeApp[];
  windows: AppWindowState[];
  onClose: () => void;
  onOpenApp: (appId: string) => void;
  onPinApp: (appId: string) => void;
  onDeleteApp: (appId: string) => Promise<boolean>;
  onNewApp: (name: string, description: string) => void;
  onRestoreApp: (appId: string) => void;
  onFocusApp: (appId: string) => void;
  gatewayConnected?: boolean;
  gatewayRequest?: GatewayRequestFn;
  onEmitWorkflowEvent?: (appId: string, event: AppForgeWorkflowEventRequest) => Promise<boolean>;
}

type WorkflowEventStatus = {
  kind: "pending" | "success" | "error";
  appId: string;
  message: string;
};

type AppFilter = "all" | "pinned" | "running";
type ForgeViewMode = "grid" | "kanban" | "form" | "review";
type ForgeInspectorMode = "field" | "table";
type ForgeSortDirection = "asc" | "desc";

type ForgeViewSettings = {
  filterText: string;
  sortFieldId: string;
  sortDirection: ForgeSortDirection;
  groupFieldId: string;
};

type EditingCell = {
  recordId: string;
  fieldId: string;
  value: string;
};

const FIELD_TYPE_OPTIONS: Array<{ value: ForgeFieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "long_text", label: "Long text" },
  { value: "single_select", label: "Single select" },
  { value: "multi_select", label: "Multi select" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "attachment", label: "Attachment" },
  { value: "linked_record", label: "Linked record" },
];

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:/gi, "");
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(values: unknown): string | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function appWorkflowCapability(app: ForgeApp): { id?: string; eventType?: string } {
  const metadata = asRecord(app.metadata);
  const workflow = asRecord(metadata?.workflow);
  const appForge = asRecord(metadata?.appForge);
  const candidates = [
    metadata?.workflowCapabilities,
    workflow?.capabilities,
    appForge?.workflowCapabilities,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    const capability = candidate.find(asRecord);
    if (!capability) {
      continue;
    }
    return {
      id:
        typeof capability.id === "string" && capability.id.trim()
          ? capability.id.trim()
          : undefined,
      eventType: firstString(capability.eventTypes),
    };
  }
  return {};
}

const APP_FORGE_NAV = [
  { id: "desktop", label: "Desktop", icon: Monitor },
  { id: "bases", label: "Bases", icon: Boxes },
  { id: "tables", label: "Tables", icon: Table2 },
  { id: "interfaces", label: "Interfaces", icon: PanelsTopLeft },
  { id: "automations", label: "Automations", icon: Zap },
  { id: "connectors", label: "Connectors", icon: Puzzle },
  { id: "permissions", label: "Permissions", icon: Lock },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

const FORGE_VIEW_MODES: Array<{ id: ForgeViewMode; label: string }> = [
  { id: "grid", label: "Grid" },
  { id: "kanban", label: "Kanban" },
  { id: "form", label: "Form" },
  { id: "review", label: "Review" },
];

const APP_FORGE_UI_STATE_KEY = "argent.appForge.workspaceState.v1";
const DEFAULT_VIEW_SETTINGS: ForgeViewSettings = {
  filterText: "",
  sortFieldId: "",
  sortDirection: "asc",
  groupFieldId: "",
};

type AppForgeUiState = {
  selectedAppId?: string | null;
  activeSection?: (typeof APP_FORGE_NAV)[number]["id"];
  activeViewMode?: ForgeViewMode;
  inspectorMode?: ForgeInspectorMode;
};

function isForgeSection(value: unknown): value is (typeof APP_FORGE_NAV)[number]["id"] {
  return typeof value === "string" && APP_FORGE_NAV.some((item) => item.id === value);
}

function isForgeViewMode(value: unknown): value is ForgeViewMode {
  return typeof value === "string" && FORGE_VIEW_MODES.some((item) => item.id === value);
}

function isForgeInspectorMode(value: unknown): value is ForgeInspectorMode {
  return value === "field" || value === "table";
}

function loadAppForgeUiState(): AppForgeUiState {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(APP_FORGE_UI_STATE_KEY) ?? "{}",
    ) as Record<string, unknown> | null;
    if (!parsed) {
      return {};
    }
    return {
      selectedAppId: typeof parsed.selectedAppId === "string" ? parsed.selectedAppId : null,
      activeSection: isForgeSection(parsed.activeSection) ? parsed.activeSection : undefined,
      activeViewMode: isForgeViewMode(parsed.activeViewMode) ? parsed.activeViewMode : undefined,
      inspectorMode: isForgeInspectorMode(parsed.inspectorMode) ? parsed.inspectorMode : undefined,
    };
  } catch {
    return {};
  }
}

function fieldValue(value: ForgeStructuredRecordValue | undefined): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return value === null || value === undefined ? "" : String(value);
}

function fieldInputType(field: ForgeStructuredField): string {
  if (field.type === "number") {
    return "number";
  }
  if (field.type === "date") {
    return "date";
  }
  if (field.type === "url") {
    return "url";
  }
  if (field.type === "email") {
    return "email";
  }
  return "text";
}

const SELECT_OPTION_PALETTE = [
  { id: "emerald", label: "Emerald", color: "#34d399" },
  { id: "sky", label: "Sky", color: "#38bdf8" },
  { id: "violet", label: "Violet", color: "#a78bfa" },
  { id: "amber", label: "Amber", color: "#fbbf24" },
  { id: "rose", label: "Rose", color: "#fb7185" },
  { id: "cyan", label: "Cyan", color: "#22d3ee" },
  { id: "lime", label: "Lime", color: "#a3e635" },
  { id: "orange", label: "Orange", color: "#fb923c" },
] as const;

function optionColorValue(color: string | undefined): string {
  return SELECT_OPTION_PALETTE.find((entry) => entry.id === color)?.color ?? "#34d399";
}

function fieldSupportsDefaultValue(type: ForgeFieldType): boolean {
  return type !== "attachment" && type !== "linked_record";
}

function fieldSupportsSelectOptions(type: ForgeFieldType): boolean {
  return type === "single_select" || type === "multi_select";
}

function fieldDefaultInputType(type: ForgeFieldType): string {
  if (type === "number") {
    return "number";
  }
  if (type === "date") {
    return "date";
  }
  if (type === "url") {
    return "url";
  }
  if (type === "email") {
    return "email";
  }
  return "text";
}

function fieldTypeConversionWarning(from: ForgeFieldType, to: ForgeFieldType): string | null {
  if (from === to) {
    return null;
  }
  if (
    from === "attachment" ||
    from === "linked_record" ||
    to === "attachment" ||
    to === "linked_record"
  ) {
    return "Attachment and linked-record fields are metadata-only in this slice. Existing cell values will be coerced to the new field shape.";
  }
  if (from === "multi_select" || to === "multi_select") {
    return "Multi-select conversions can split or collapse values. Existing cells will be normalized when you apply the type change.";
  }
  if (to === "number" || to === "checkbox" || to === "date") {
    return "This type conversion may rewrite existing cell values that do not match the new field type.";
  }
  if (fieldSupportsSelectOptions(from) || fieldSupportsSelectOptions(to)) {
    return "Select conversions will keep option labels where possible and normalize unmatched values.";
  }
  return "Existing cells will be coerced to the new field type when you apply this change.";
}

function selectOptionsForField(field: ForgeStructuredField): ForgeStructuredSelectOption[] {
  if (field.selectOptions?.length) {
    return field.selectOptions;
  }
  return (field.options ?? []).map((label, index) => ({
    id: `opt-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "option"}-${index + 1}`,
    label,
    color: SELECT_OPTION_PALETTE[index % SELECT_OPTION_PALETTE.length].id,
  }));
}

function cellValueFromInput(
  field: ForgeStructuredField,
  value: string,
): ForgeStructuredRecordValue {
  if (field.type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (field.type === "checkbox") {
    return value === "true";
  }
  if (
    field.type === "multi_select" ||
    field.type === "attachment" ||
    field.type === "linked_record"
  ) {
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return value;
}

function fieldByName(
  table: ForgeStructuredTable | null | undefined,
  name: string,
): ForgeStructuredField | undefined {
  if (!table) {
    return undefined;
  }
  const normalized = name.toLowerCase();
  return table.fields.find(
    (field) => field.id.toLowerCase() === normalized || field.name.toLowerCase() === normalized,
  );
}

function recordStatus(
  table: ForgeStructuredTable | null | undefined,
  record: ForgeStructuredRecord,
) {
  const statusField = fieldByName(table, "status");
  return statusField ? fieldValue(record.values[statusField.id]) : "";
}

function recordTitle(
  table: ForgeStructuredTable | null | undefined,
  record: ForgeStructuredRecord,
) {
  const nameField = fieldByName(table, "name") ?? table?.fields[0];
  return nameField ? fieldValue(record.values[nameField.id]) || "Untitled" : "Untitled";
}

function baseRecordCount(base: ForgeStructuredBase | null | undefined): number {
  return base?.tables.reduce((total, table) => total + table.records.length, 0) ?? 0;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function structuredBaseIcon(): string {
  return `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="8" fill="#123243"/><path d="M16 5.5 7.5 10.2v9.6L16 24.5l8.5-4.7v-9.6L16 5.5Z" stroke="#BAE6FD" stroke-width="1.8"/><path d="M8 10.5 16 15l8-4.5M16 15v9" stroke="#BAE6FD" stroke-width="1.8"/><path d="M11.5 17.5 7.5 19.8M20.5 17.5l4 2.3" stroke="#7DD3FC" stroke-width="1.8"/></svg>`;
}

function structuredBaseAppCode(name: string, description: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(name)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #05080a; color: #e5eef5; font-family: Inter, system-ui, sans-serif; }
    main { max-width: 560px; padding: 32px; }
    h1 { margin: 0 0 10px; font-size: 28px; }
    p { margin: 0; color: #9aa8b3; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(name)}</h1>
    <p>${escapeHtml(description)}</p>
  </main>
</body>
</html>`;
}

function createEmptyStructuredBase(
  appId: string,
  name: string,
  description: string,
  baseId = `base-${appId}`,
): ForgeStructuredBase {
  const updatedAt = new Date().toISOString();
  return {
    id: baseId,
    appId,
    name,
    description,
    activeTableId: "table-main",
    tables: [
      {
        id: "table-main",
        name: "Table 1",
        fields: [
          {
            id: "name",
            name: "Name",
            type: "text",
            description: "Primary record name",
            required: true,
          },
        ],
        records: [],
        views: [
          {
            id: "view-grid",
            name: "Grid",
            type: "grid",
            sortDirection: "asc",
            createdAt: updatedAt,
            updatedAt,
          },
        ],
        activeViewId: "view-grid",
      },
    ],
    updatedAt,
  };
}

function createBaseId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  return `base-${randomId}`;
}

function structuredBaseMetadata(
  metadata: Record<string, unknown>,
  base: ForgeStructuredBase,
): Record<string, unknown> {
  const appForge =
    metadata.appForge && typeof metadata.appForge === "object"
      ? (metadata.appForge as Record<string, unknown>)
      : {};
  return {
    ...metadata,
    appForge: {
      ...appForge,
      kind: "structured_base",
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

function metadataWithStructuredBase(
  app: ForgeApp,
  base: ForgeStructuredBase,
): Record<string, unknown> {
  const metadata = app.metadata && typeof app.metadata === "object" ? app.metadata : {};
  return structuredBaseMetadata(metadata, base);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function recordsByField(
  table: ForgeStructuredTable | null | undefined,
  fieldId: string | undefined,
  records: ForgeStructuredRecord[] = table?.records ?? [],
) {
  const field = fieldId
    ? table?.fields.find((candidate) => candidate.id === fieldId)
    : fieldByName(table, "status");
  const options = field?.options?.length
    ? field.options
    : field?.id
      ? []
      : ["Planning", "In Progress", "On Track", "Review", "Blocked"];
  const grouped = new Map<string, ForgeStructuredRecord[]>();
  for (const record of records) {
    const label = field ? fieldValue(record.values[field.id]) || "Unassigned" : "Records";
    grouped.set(label, [...(grouped.get(label) ?? []), record]);
  }
  const orderedLabels = [
    ...options,
    ...[...grouped.keys()].filter((label) => !options.includes(label)),
  ];
  return options
    .map((status) => ({
      status,
      records: grouped.get(status) ?? [],
    }))
    .concat(
      orderedLabels
        .filter((label) => !options.includes(label))
        .map((label) => ({ status: label, records: grouped.get(label) ?? [] })),
    );
}

export function AppForge({
  isOpen,
  apps,
  windows,
  onClose,
  onOpenApp,
  onPinApp,
  onDeleteApp,
  onRestoreApp,
  onFocusApp,
  gatewayConnected = false,
  gatewayRequest,
  onEmitWorkflowEvent,
}: AppForgeProps) {
  const [persistedUiState] = useState<AppForgeUiState>(loadAppForgeUiState);
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{ appId: string; x: number; y: number } | null>(
    null,
  );
  const [deleteMode, setDeleteMode] = useState(false);
  const [pendingDeleteApp, setPendingDeleteApp] = useState<ForgeApp | null>(null);
  const [deletingAppId, setDeletingAppId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showNewAppInput, setShowNewAppInput] = useState(false);
  const [building, setBuilding] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [newAppDescription, setNewAppDescription] = useState("");
  const [localCreatedApps, setLocalCreatedApps] = useState<ForgeApp[]>([]);
  const [workflowEventStatus, setWorkflowEventStatus] = useState<WorkflowEventStatus | null>(null);
  const [activeFilter, setActiveFilter] = useState<AppFilter>("all");
  const [activeSection, setActiveSection] = useState<(typeof APP_FORGE_NAV)[number]["id"]>(
    persistedUiState.activeSection ?? "desktop",
  );
  const [activeViewMode, setActiveViewMode] = useState<ForgeViewMode>(
    persistedUiState.activeViewMode ?? "grid",
  );
  const [inspectorMode, setInspectorMode] = useState<ForgeInspectorMode>(
    persistedUiState.inspectorMode ?? "field",
  );
  const [selectedAppId, setSelectedAppId] = useState<string | null>(
    persistedUiState.selectedAppId ?? null,
  );
  const [hoveredBaseId, setHoveredBaseId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [newTableName, setNewTableName] = useState("");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<ForgeFieldType>("text");
  const [pendingFieldType, setPendingFieldType] = useState<ForgeFieldType>("text");
  const [fieldNameDraft, setFieldNameDraft] = useState("");
  const [fieldDescriptionDraft, setFieldDescriptionDraft] = useState("");
  const [fieldDefaultDraft, setFieldDefaultDraft] = useState("");
  const [selectOptionDrafts, setSelectOptionDrafts] = useState<Record<string, string>>({});
  const [newViewName, setNewViewName] = useState("");
  const [newViewType, setNewViewType] = useState<ForgeStructuredViewType>("grid");
  const [formRecordId, setFormRecordId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const baseWorkspaceRef = useRef<HTMLDivElement>(null);
  const appCountAtBuild = useRef(0);
  const effectiveGatewayRequest = gatewayConnected ? gatewayRequest : undefined;

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 200);
    } else {
      queueMicrotask(() => {
        setSearchQuery("");
        setContextMenu(null);
        setDeleteMode(false);
        setPendingDeleteApp(null);
        setDeletingAppId(null);
        setDeleteError(null);
        setShowNewAppInput(false);
        setNewAppName("");
        setNewAppDescription("");
        setBuilding(false);
        setWorkflowEventStatus(null);
        setActiveFilter("all");
        setEditingCell(null);
        setHoveredBaseId(null);
        setNewTableName("");
        setNewFieldName("");
        setNewFieldType("text");
        setNewViewName("");
        setNewViewType("grid");
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      APP_FORGE_UI_STATE_KEY,
      JSON.stringify({
        selectedAppId,
        activeSection,
        activeViewMode,
        inspectorMode,
      }),
    );
  }, [activeSection, activeViewMode, inspectorMode, selectedAppId]);

  // Focus name input when form shown
  useEffect(() => {
    if (showNewAppInput) {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [showNewAppInput]);

  // Detect when a new app arrives while building
  useEffect(() => {
    if (building && apps.length > appCountAtBuild.current) {
      queueMicrotask(() => {
        setBuilding(false);
        setShowNewAppInput(false);
      });
    }
  }, [building, apps.length]);

  useEffect(() => {
    const appIds = new Set(apps.map((app) => app.id));
    queueMicrotask(() =>
      setLocalCreatedApps((current) => current.filter((app) => !appIds.has(app.id))),
    );
  }, [apps]);

  const handleNewAppSubmit = useCallback(async () => {
    const baseName = newAppName.trim() || `Untitled Base ${apps.length + 1}`;
    const description =
      newAppDescription.trim() ||
      "Structured AppForge base with tables, records, fields, and workflow capabilities.";
    appCountAtBuild.current = apps.length;
    setBuilding(true);
    try {
      const baseId = createBaseId();
      const pendingBase = createEmptyStructuredBase("", baseName, description, baseId);
      const createResponse = await fetchLocalApi(
        "/api/apps",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: baseName,
            description,
            icon: structuredBaseIcon(),
            code: structuredBaseAppCode(baseName, description),
            metadata: structuredBaseMetadata({ workflowCapabilities: [] }, pendingBase),
          }),
        },
        2_500,
      );
      if (!createResponse.ok) {
        throw new Error(`Failed to create base app (${createResponse.status})`);
      }
      const created = (await createResponse.json()) as { app?: ForgeApp };
      if (!created.app?.id) {
        throw new Error("Create base response did not include an app id");
      }
      const base = { ...pendingBase, appId: created.app.id };
      let gatewayWriteFailed = false;
      if (effectiveGatewayRequest) {
        try {
          const gatewayWrite = effectiveGatewayRequest("appforge.bases.put", {
            base,
            expectedRevision: 0,
            idempotencyKey: `create-base:${created.app.id}`,
          });
          void gatewayWrite.catch(() => undefined);
          await withTimeout(gatewayWrite, 2_000, "Gateway base create timed out");
        } catch (err) {
          gatewayWriteFailed = true;
          console.warn("[AppForge] Gateway base create failed; saving metadata fallback.", err);
        }
      }
      const metadata = metadataWithStructuredBase(created.app, base);
      const patchResponse = await fetchLocalApi(
        `/api/apps/${created.app.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata }),
        },
        2_500,
      );
      if (!patchResponse.ok) {
        throw new Error(`Failed to attach structured base metadata (${patchResponse.status})`);
      }
      const patched = (await patchResponse.json().catch(() => undefined)) as
        | { app?: ForgeApp }
        | undefined;
      const localApp = {
        ...(patched?.app ?? created.app),
        metadata,
        updatedAt: base.updatedAt,
      };
      setLocalCreatedApps((current) => [
        localApp,
        ...current.filter((app) => app.id !== localApp.id),
      ]);
      setSelectedAppId(localApp.id);
      setShowNewAppInput(false);
      setNewAppName("");
      setNewAppDescription("");
      setWorkflowEventStatus({
        kind: "success",
        appId: created.app.id,
        message: gatewayWriteFailed
          ? `${baseName} base created in metadata fallback.`
          : `${baseName} base created.`,
      });
    } catch (err) {
      setWorkflowEventStatus({
        kind: "error",
        appId: "new-base",
        message: err instanceof Error ? err.message : "Failed to create base.",
      });
    } finally {
      setBuilding(false);
    }
  }, [newAppName, apps.length, newAppDescription, effectiveGatewayRequest]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  useEffect(() => {
    if (!deleteMode && !pendingDeleteApp) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pendingDeleteApp) {
          setPendingDeleteApp(null);
          setDeleteError(null);
          return;
        }
        setDeleteMode(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deleteMode, pendingDeleteApp]);

  const runningAppIds = new Set(windows.map((window) => window.appId));
  const displayApps = useMemo(() => {
    const appIds = new Set(apps.map((app) => app.id));
    return [...localCreatedApps.filter((app) => !appIds.has(app.id)), ...apps];
  }, [apps, localCreatedApps]);
  const baseFilteredApps =
    activeFilter === "pinned"
      ? displayApps.filter((app) => app.pinned)
      : activeFilter === "running"
        ? displayApps.filter((app) => runningAppIds.has(app.id))
        : displayApps;

  // Filter apps by search
  const filteredApps = searchQuery
    ? baseFilteredApps.filter(
        (app) =>
          app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          app.description?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : baseFilteredApps;

  const selectedApp =
    displayApps.find((app) => app.id === selectedAppId) ??
    filteredApps[0] ??
    displayApps[0] ??
    null;
  const selectedWindow = selectedApp
    ? windows.find((window) => window.appId === selectedApp.id)
    : undefined;
  const selectedCapability = selectedApp ? appWorkflowCapability(selectedApp) : {};
  const shortcutApps = filteredApps.slice(0, 5);
  const capabilityCount = displayApps.filter((app) => appWorkflowCapability(app).id).length;
  const structured = useForgeStructuredData({
    apps: displayApps,
    selectedAppId,
    onSelectApp: setSelectedAppId,
    gatewayRequest: effectiveGatewayRequest,
    emitWorkflowEvent: onEmitWorkflowEvent,
  });
  useEffect(() => {
    if (structured.selectedField) {
      setPendingFieldType(structured.selectedField.type);
      setFieldNameDraft(structured.selectedField.name);
      setFieldDescriptionDraft(structured.selectedField.description ?? "");
      setFieldDefaultDraft(fieldValue(structured.selectedField.defaultValue));
      setSelectOptionDrafts(
        Object.fromEntries(
          selectOptionsForField(structured.selectedField).map((option) => [
            option.id,
            option.label,
          ]),
        ),
      );
    }
  }, [structured.selectedField]);
  const baseByAppId = useMemo(
    () => new Map(structured.bases.map((base) => [base.appId, base])),
    [structured.bases],
  );
  const selectBaseAndFocusWorkspace = useCallback(
    (appId: string) => {
      structured.selectBase(appId);
      setInspectorMode("table");
      window.requestAnimationFrame(() => {
        baseWorkspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    },
    [structured],
  );
  const visibleFields = useMemo(() => {
    const fields = structured.activeTable?.fields ?? [];
    const visibleFieldIds = structured.activeView?.visibleFieldIds;
    if (visibleFieldIds?.length) {
      const fieldsById = new Map(fields.map((field) => [field.id, field]));
      const ordered = visibleFieldIds
        .map((fieldId) => fieldsById.get(fieldId))
        .filter((field): field is ForgeStructuredField => Boolean(field));
      return ordered.length ? ordered : fields;
    }
    return fields;
  }, [structured.activeTable, structured.activeView]);
  const handleToggleViewField = useCallback(
    async (fieldId: string) => {
      const fields = structured.activeTable?.fields ?? [];
      if (!fields.some((field) => field.id === fieldId)) {
        return;
      }
      const currentIds = structured.activeView?.visibleFieldIds?.length
        ? structured.activeView.visibleFieldIds
        : fields.map((field) => field.id);
      const current = new Set(currentIds);
      if (current.has(fieldId)) {
        current.delete(fieldId);
      } else {
        current.add(fieldId);
      }
      const nextVisibleFieldIds = fields
        .map((field) => field.id)
        .filter((candidate) => current.has(candidate));
      if (!nextVisibleFieldIds.length) {
        return;
      }
      await structured.updateActiveViewSettings({ visibleFieldIds: nextVisibleFieldIds });
    },
    [structured],
  );
  const handleCreateTable = useCallback(async () => {
    const name = newTableName.trim();
    await structured.addTable(name ? { name } : undefined);
    setNewTableName("");
    setInspectorMode("table");
    setActiveViewMode("grid");
  }, [newTableName, structured]);
  const handleCreateField = useCallback(async () => {
    const name = newFieldName.trim();
    await structured.addField({
      name: name || undefined,
      type: newFieldType,
    });
    setNewFieldName("");
    setNewFieldType("text");
    setInspectorMode("field");
    setActiveViewMode("grid");
  }, [newFieldName, newFieldType, structured]);
  const handleApplyFieldType = useCallback(async () => {
    if (!structured.selectedField || pendingFieldType === structured.selectedField.type) {
      return;
    }
    await structured.updateField(structured.selectedField.id, { type: pendingFieldType });
  }, [pendingFieldType, structured]);
  const handleUpdateSelectOption = useCallback(
    async (
      optionId: string,
      updates: Partial<Pick<ForgeStructuredSelectOption, "label" | "color">>,
    ) => {
      if (!structured.selectedField) {
        return;
      }
      const selectOptions = selectOptionsForField(structured.selectedField)
        .map((option) =>
          option.id === optionId
            ? {
                ...option,
                ...updates,
                label: updates.label !== undefined ? updates.label : option.label,
              }
            : option,
        )
        .filter((option) => option.label.trim());
      await structured.updateField(structured.selectedField.id, {
        selectOptions,
        options: selectOptions.map((option) => option.label),
      });
    },
    [structured],
  );
  const handleAddSelectOption = useCallback(async () => {
    if (!structured.selectedField) {
      return;
    }
    const selectOptions = selectOptionsForField(structured.selectedField);
    const nextIndex = selectOptions.length;
    const option = {
      id: `opt-option-${Date.now().toString(36)}-${nextIndex + 1}`,
      label: `Option ${nextIndex + 1}`,
      color: SELECT_OPTION_PALETTE[nextIndex % SELECT_OPTION_PALETTE.length].id,
    };
    const nextOptions = [...selectOptions, option];
    await structured.updateField(structured.selectedField.id, {
      selectOptions: nextOptions,
      options: nextOptions.map((entry) => entry.label),
    });
  }, [structured]);
  const handleDeleteSelectOption = useCallback(
    async (optionId: string) => {
      if (!structured.selectedField) {
        return;
      }
      const selectOptions = selectOptionsForField(structured.selectedField).filter(
        (option) => option.id !== optionId,
      );
      await structured.updateField(structured.selectedField.id, {
        selectOptions,
        options: selectOptions.map((option) => option.label),
      });
    },
    [structured],
  );
  const handleUpdateDefaultValue = useCallback(
    async (field: ForgeStructuredField, rawValue: string | boolean) => {
      const value =
        field.type === "number"
          ? Number(rawValue) || 0
          : field.type === "checkbox"
            ? rawValue === true
            : field.type === "multi_select"
              ? String(rawValue)
                  .split(/[\n,]/)
                  .map((entry) => entry.trim())
                  .filter(Boolean)
              : String(rawValue);
      await structured.updateField(field.id, { defaultValue: value });
    },
    [structured],
  );
  const commitFieldNameDraft = useCallback(async () => {
    const field = structured.selectedField;
    if (!field) {
      return;
    }
    const name = fieldNameDraft.trim() || field.name;
    setFieldNameDraft(name);
    if (name !== field.name) {
      await structured.updateField(field.id, { name });
    }
  }, [fieldNameDraft, structured]);
  const commitFieldDescriptionDraft = useCallback(async () => {
    const field = structured.selectedField;
    if (!field) {
      return;
    }
    if (fieldDescriptionDraft !== (field.description ?? "")) {
      await structured.updateField(field.id, { description: fieldDescriptionDraft });
    }
  }, [fieldDescriptionDraft, structured]);
  const commitDefaultDraft = useCallback(async () => {
    const field = structured.selectedField;
    if (!field || !fieldSupportsDefaultValue(field.type)) {
      return;
    }
    if (fieldDefaultDraft !== fieldValue(field.defaultValue)) {
      await handleUpdateDefaultValue(field, fieldDefaultDraft);
    }
  }, [fieldDefaultDraft, handleUpdateDefaultValue, structured.selectedField]);
  const commitSelectOptionDraft = useCallback(
    async (option: ForgeStructuredSelectOption) => {
      const label = (selectOptionDrafts[option.id] ?? option.label).trim();
      if (!label) {
        setSelectOptionDrafts((current) => ({ ...current, [option.id]: option.label }));
        return;
      }
      if (label !== option.label) {
        await handleUpdateSelectOption(option.id, { label });
      }
    },
    [handleUpdateSelectOption, selectOptionDrafts],
  );
  const viewSettings: ForgeViewSettings = useMemo(
    () => ({
      filterText: structured.activeView?.filterText ?? DEFAULT_VIEW_SETTINGS.filterText,
      sortFieldId: structured.activeView?.sortFieldId ?? DEFAULT_VIEW_SETTINGS.sortFieldId,
      sortDirection: structured.activeView?.sortDirection ?? DEFAULT_VIEW_SETTINGS.sortDirection,
      groupFieldId: structured.activeView?.groupFieldId ?? DEFAULT_VIEW_SETTINGS.groupFieldId,
    }),
    [structured.activeView],
  );
  const handleSelectViewMode = useCallback(
    async (mode: ForgeStructuredViewType) => {
      const existingView = structured.activeTable?.views.find((view) => view.type === mode);
      setActiveViewMode(mode);
      if (existingView) {
        await structured.selectView(existingView.id);
        return;
      }
      await structured.addView({ type: mode });
    },
    [structured],
  );
  const handleCreateView = useCallback(async () => {
    await structured.addView({
      name: newViewName.trim() || undefined,
      type: newViewType,
    });
    setNewViewName("");
    setNewViewType("grid");
  }, [newViewName, newViewType, structured]);
  const viewRecords = useMemo(() => {
    const table = structured.activeTable;
    if (!table) {
      return [];
    }
    const normalizedFilter = viewSettings.filterText.trim().toLowerCase();
    const filtered = normalizedFilter
      ? table.records.filter((record) =>
          table.fields.some((field) =>
            fieldValue(record.values[field.id]).toLowerCase().includes(normalizedFilter),
          ),
        )
      : table.records;
    const sortField = table.fields.find((field) => field.id === viewSettings.sortFieldId);
    if (!sortField) {
      return filtered;
    }
    const sorted = [...filtered];
    // oxlint-disable-next-line unicorn/no-array-sort -- dashboard target does not include ES2023 toSorted.
    return sorted.sort((left: ForgeStructuredRecord, right: ForgeStructuredRecord) => {
      const leftValue = left.values[sortField.id];
      const rightValue = right.values[sortField.id];
      const direction = viewSettings.sortDirection === "desc" ? -1 : 1;
      if (sortField.type === "number") {
        return (Number(leftValue ?? 0) - Number(rightValue ?? 0)) * direction;
      }
      return (
        fieldValue(leftValue).localeCompare(fieldValue(rightValue), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * direction
      );
    });
  }, [structured.activeTable, viewSettings]);
  const reviewRecords =
    viewRecords.filter((record) => recordStatus(structured.activeTable, record) === "Review") ?? [];
  const tableRecords = useMemo(
    () => structured.activeTable?.records ?? [],
    [structured.activeTable],
  );
  const formRecord =
    tableRecords.find((record) => record.id === formRecordId) ?? tableRecords[0] ?? null;
  const activeNav = APP_FORGE_NAV.find((item) => item.id === activeSection);
  const sectionTitle = activeNav?.label ?? "Desktop";
  const sectionSubtitle =
    activeSection === "desktop"
      ? "Bases are separate structured databases. Select one to work with its tables."
      : activeSection === "bases"
        ? "Create, choose, and manage the databases that power AppForge tables."
        : activeSection === "tables"
          ? "Fields, records, and view modes for the active base"
          : activeSection === "interfaces"
            ? "Generated operator surfaces for this base"
            : activeSection === "automations"
              ? "Workflow capabilities and local event producers"
              : activeSection === "connectors"
                ? "Live connector declarations for future sync lanes"
                : activeSection === "permissions"
                  ? "Owner, editor, and viewer declarations"
                  : activeSection === "activity"
                    ? "Recent structured changes and event status"
                    : "Base and runtime settings";

  useEffect(() => {
    if (!structured.activeView || structured.activeView.type === activeViewMode) {
      return;
    }
    queueMicrotask(() => setActiveViewMode(structured.activeView?.type ?? "grid"));
  }, [activeViewMode, structured.activeView]);

  useEffect(() => {
    const nextRecordId = tableRecords.some((record) => record.id === formRecordId)
      ? formRecordId
      : (tableRecords[0]?.id ?? null);
    if (nextRecordId === formRecordId) {
      return;
    }
    queueMicrotask(() => setFormRecordId(nextRecordId));
  }, [formRecordId, tableRecords]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, appId: string) => {
      if (deleteMode) {
        return;
      }
      e.preventDefault();
      setSelectedAppId(appId);
      setContextMenu({ appId, x: e.clientX, y: e.clientY });
    },
    [deleteMode],
  );

  const toggleDeleteMode = useCallback(() => {
    setContextMenu(null);
    setPendingDeleteApp(null);
    setDeleteError(null);
    setShowNewAppInput(false);
    setDeleteMode((prev) => !prev);
  }, []);

  const requestDeleteApp = useCallback(
    (appId: string) => {
      const app = displayApps.find((candidate) => candidate.id === appId);
      if (!app) {
        return;
      }
      setContextMenu(null);
      setDeleteError(null);
      setPendingDeleteApp(app);
    },
    [displayApps],
  );

  const confirmDeleteApp = useCallback(async () => {
    if (!pendingDeleteApp || deletingAppId) {
      return;
    }
    setDeleteError(null);
    setDeletingAppId(pendingDeleteApp.id);
    const deleted = await onDeleteApp(pendingDeleteApp.id);
    setDeletingAppId(null);
    if (deleted) {
      setLocalCreatedApps((current) => current.filter((app) => app.id !== pendingDeleteApp.id));
      setPendingDeleteApp(null);
      return;
    }
    setDeleteError(`Failed to delete ${pendingDeleteApp.name}.`);
  }, [pendingDeleteApp, deletingAppId, onDeleteApp]);

  const emitTestWorkflowEvent = useCallback(
    async (appId: string) => {
      if (!onEmitWorkflowEvent) {
        return;
      }
      const app = displayApps.find((candidate) => candidate.id === appId);
      if (!app) {
        return;
      }

      const capability = appWorkflowCapability(app);
      const eventType = capability.eventType ?? "forge.review.completed";
      setWorkflowEventStatus({
        kind: "pending",
        appId,
        message: `Emitting ${eventType} for ${app.name}...`,
      });

      const ok = await onEmitWorkflowEvent(appId, {
        eventType,
        capabilityId: capability.id,
        decision: "approved",
        reviewId: `manual-${Date.now()}`,
        payload: {
          decision: "approved",
          emittedBy: "app-forge",
          manualTest: true,
        },
      });

      setWorkflowEventStatus({
        kind: ok ? "success" : "error",
        appId,
        message: ok
          ? `Emitted ${eventType} for ${app.name}.`
          : `Failed to emit ${eventType} for ${app.name}.`,
      });
    },
    [displayApps, onEmitWorkflowEvent],
  );

  const commitEditingCell = useCallback(async () => {
    if (!editingCell) {
      return;
    }
    const field = structured.activeTable?.fields.find(
      (candidate) => candidate.id === editingCell.fieldId,
    );
    const nextValue = field ? cellValueFromInput(field, editingCell.value) : editingCell.value;
    setEditingCell(null);
    await structured.updateCell(editingCell.recordId, editingCell.fieldId, nextValue);
  }, [editingCell, structured]);

  async function handleReviewDecision(
    record: ForgeStructuredRecord,
    decision: "approved" | "denied",
  ) {
    if (!selectedApp?.id) {
      return;
    }
    const appId = selectedApp.id;
    setWorkflowEventStatus({
      kind: "pending",
      appId,
      message: `${decision === "approved" ? "Approving" : "Denying"} ${recordTitle(
        structured.activeTable,
        record,
      )}...`,
    });
    await structured.completeReview(record.id, decision);
    setWorkflowEventStatus({
      kind: "success",
      appId,
      message: `Review ${decision} for ${recordTitle(structured.activeTable, record)}.`,
    });
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex flex-col"
          style={{ background: "rgba(0, 0, 0, 0.85)", backdropFilter: "blur(20px)" }}
        >
          {/* Header */}
          <div className="relative flex items-center justify-between px-8 py-5 shrink-0">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-amber-300" />
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
            </div>

            <h1 className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 text-sm font-medium text-white/75">
              <Boxes className="h-4 w-4 text-white/45" />
              Projects — AppForge Workspace
            </h1>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search apps..."
                  className="bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500/50 w-64"
                />
              </div>
              <button
                onClick={toggleDeleteMode}
                className={`p-2 rounded-lg border transition-colors ${
                  deleteMode
                    ? "bg-red-500/15 border-red-400/40 text-red-300 hover:bg-red-500/20"
                    : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
                }`}
                title={deleteMode ? "Done Deleting" : "Delete Apps"}
                aria-pressed={deleteMode}
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                className="p-2 rounded-lg border border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                title="Share"
              >
                <Share2 className="w-4 h-4" />
              </button>
              <button
                className="p-2 rounded-lg border border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                title="Favorite"
              >
                <Star className="w-4 h-4" />
              </button>
              <button
                className="p-2 rounded-lg border border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                title="More"
              >
                <Ellipsis className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Desktop Shell */}
          <div className="flex-1 min-h-0 px-6 pb-6">
            <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
              <aside className="hidden min-h-0 rounded-2xl border border-white/10 bg-black/45 p-3 lg:flex lg:flex-col">
                <div className="mb-8 flex items-center gap-3 px-2 pt-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-400/25 bg-sky-400/10">
                    <Boxes className="h-5 w-5 text-sky-300" />
                  </div>
                  <div className="text-sm font-semibold text-white/85">AppForge 2.0</div>
                </div>
                <div className="space-y-2">
                  {APP_FORGE_NAV.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveSection(item.id);
                          if (
                            item.id === "desktop" ||
                            item.id === "bases" ||
                            item.id === "tables"
                          ) {
                            setActiveFilter("all");
                          }
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors ${
                          activeSection === item.id
                            ? "bg-sky-500/15 text-sky-100"
                            : "text-white/58 hover:bg-white/5 hover:text-white/85"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-auto border-t border-white/10 px-2 pt-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-medium text-white/75">
                      AV
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white/70">Avery Vargas</div>
                      <div className="truncate text-xs text-white/35">operator@appforge.io</div>
                    </div>
                    <ChevronDown className="ml-auto h-4 w-4 text-white/35" />
                  </div>
                </div>
              </aside>

              <main className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-black/25 p-4">
                <AnimatePresence>
                  {workflowEventStatus && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className={`mb-4 flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                        workflowEventStatus.kind === "error"
                          ? "border-red-400/30 bg-red-500/10 text-red-200"
                          : workflowEventStatus.kind === "success"
                            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                            : "border-purple-400/30 bg-purple-500/10 text-purple-200"
                      }`}
                    >
                      <span>{workflowEventStatus.message}</span>
                      <button
                        onClick={() => setWorkflowEventStatus(null)}
                        className="rounded-md p-1 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                        title="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_75%_5%,rgba(73,117,135,0.26),transparent_34%),linear-gradient(180deg,rgba(18,28,32,0.74),rgba(6,8,10,0.88))] p-5">
                  <div className="absolute inset-x-0 top-0 h-40 bg-white/[0.03]" />
                  <div className="relative">
                    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-semibold text-white/90">{sectionTitle}</h2>
                        <p className="mt-1 text-sm text-white/52">{sectionSubtitle}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-white/42">
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-emerald-200">
                          {windows.length} running
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                          {capabilityCount} workflow capabilities
                        </span>
                      </div>
                    </div>

                    {activeSection === "desktop" || activeSection === "bases" ? (
                      <div className="mb-7 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                        {shortcutApps.map((app, index) => {
                          const running = runningAppIds.has(app.id);
                          const base = baseByAppId.get(app.id);
                          const tableCount = base?.tables.length ?? 0;
                          const recordCount = baseRecordCount(base);
                          const isSelected = selectedApp?.id === app.id;
                          const isPreviewed = hoveredBaseId === app.id;
                          const capability = appWorkflowCapability(app);
                          return (
                            <motion.button
                              type="button"
                              key={app.id}
                              layout
                              initial={{ scale: 0.92, opacity: 0 }}
                              animate={
                                deleteMode
                                  ? {
                                      scale: 1,
                                      opacity: 1,
                                      rotate: [-1.1, 1.1, -1.1],
                                    }
                                  : { scale: 1, opacity: 1, rotate: 0 }
                              }
                              transition={
                                deleteMode
                                  ? {
                                      duration: 0.22,
                                      ease: "easeInOut",
                                      repeat: Infinity,
                                      repeatType: "reverse",
                                      delay: (index % 6) * 0.03,
                                    }
                                  : { duration: 0.18 }
                              }
                              onClick={() => {
                                if (deleteMode) {
                                  requestDeleteApp(app.id);
                                  return;
                                }
                                selectBaseAndFocusWorkspace(app.id);
                              }}
                              onDoubleClick={() => {
                                if (!deleteMode) {
                                  onOpenApp(app.id);
                                }
                              }}
                              onContextMenu={(e) => handleContextMenu(e, app.id)}
                              onMouseEnter={() => setHoveredBaseId(app.id)}
                              onMouseLeave={() => setHoveredBaseId(null)}
                              onFocus={() => setHoveredBaseId(app.id)}
                              onBlur={() => setHoveredBaseId(null)}
                              aria-label={`Select ${app.name} base. ${tableCount} ${
                                tableCount === 1 ? "table" : "tables"
                              }, ${recordCount} ${recordCount === 1 ? "record" : "records"}.`}
                              data-app-id={app.id}
                              data-testid={`appforge-base-card-${app.id}`}
                              className={`group relative flex min-h-[138px] flex-col items-center justify-center gap-3 rounded-xl border p-3 transition-colors ${
                                isSelected
                                  ? "border-sky-400/30 bg-sky-400/10"
                                  : isPreviewed
                                    ? "border-white/24 bg-white/[0.07]"
                                    : "border-white/10 bg-white/[0.04] hover:border-white/18 hover:bg-white/[0.07]"
                              }`}
                            >
                              <span
                                className={`absolute left-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  isSelected
                                    ? "bg-sky-300/18 text-sky-100"
                                    : "bg-white/[0.06] text-white/38"
                                }`}
                              >
                                {isSelected ? "Selected" : "Base"}
                              </span>
                              <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/25">
                                {app.icon ? (
                                  <div
                                    className="h-9 w-9"
                                    dangerouslySetInnerHTML={{ __html: sanitizeSvg(app.icon) }}
                                  />
                                ) : (
                                  <div
                                    className="flex h-full w-full items-center justify-center"
                                    style={{
                                      backgroundColor: `hsl(${hashString(app.name) % 360}, 42%, 26%)`,
                                    }}
                                  >
                                    <Boxes className="h-7 w-7 text-white/62" />
                                  </div>
                                )}
                                {running && (
                                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-300" />
                                )}
                                {app.pinned && (
                                  <Pin className="absolute bottom-1 right-1 h-3 w-3 text-amber-200" />
                                )}
                              </div>
                              <div className="w-full min-w-0 text-center">
                                <div className="truncate text-sm font-medium text-white/78">
                                  {app.name}
                                </div>
                                <div className="mt-0.5 text-xs text-white/38">
                                  {tableCount} {tableCount === 1 ? "table" : "tables"} ·{" "}
                                  {recordCount} {recordCount === 1 ? "record" : "records"}
                                </div>
                                {capability.id && (
                                  <div className="mx-auto mt-2 w-fit rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100/80">
                                    Workflow-ready
                                  </div>
                                )}
                              </div>
                            </motion.button>
                          );
                        })}

                        <button
                          type="button"
                          onClick={() => {
                            if (deleteMode) {
                              return;
                            }
                            setNewAppName("");
                            setNewAppDescription(
                              "Structured base for tracking records, views, and workflow capabilities.",
                            );
                            setShowNewAppInput(true);
                          }}
                          aria-label="Create a new AppForge base"
                          data-testid="appforge-new-base"
                          className={`flex min-h-[138px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-3 transition-colors ${
                            deleteMode
                              ? "cursor-default border-white/10 opacity-35"
                              : "border-white/16 bg-black/15 hover:border-sky-300/35 hover:bg-white/[0.05]"
                          }`}
                        >
                          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/12 bg-white/[0.04]">
                            <Plus className="h-7 w-7 text-white/45" />
                          </div>
                          <div className="text-center">
                            <div className="text-sm text-white/55">New Base</div>
                            <div className="mt-0.5 text-xs text-white/32">Create database</div>
                          </div>
                        </button>
                      </div>
                    ) : (
                      <div className="mb-7 grid gap-3 md:grid-cols-3">
                        {activeSection === "tables" &&
                          (structured.activeTable?.fields ?? []).slice(0, 6).map((field) => (
                            <button
                              key={field.id}
                              onClick={() => structured.selectField(field.id)}
                              className={`rounded-xl border p-4 text-left transition-colors ${
                                structured.selectedField?.id === field.id
                                  ? "border-sky-400/35 bg-sky-400/10"
                                  : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"
                              }`}
                            >
                              <div className="text-sm font-medium text-white/78">{field.name}</div>
                              <div className="mt-1 text-xs text-white/42">{field.type}</div>
                            </button>
                          ))}
                        {activeSection === "interfaces" &&
                          FORGE_VIEW_MODES.map((view) => (
                            <button
                              key={view.id}
                              onClick={() => void handleSelectViewMode(view.id)}
                              className={`rounded-xl border p-4 text-left transition-colors ${
                                activeViewMode === view.id
                                  ? "border-sky-400/35 bg-sky-400/10"
                                  : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"
                              }`}
                            >
                              <div className="text-sm font-medium text-white/78">{view.label}</div>
                              <div className="mt-1 text-xs text-white/42">
                                {view.id === "review"
                                  ? `${reviewRecords.length} pending`
                                  : `${viewRecords.length} records`}
                              </div>
                            </button>
                          ))}
                        {activeSection === "automations" &&
                          [
                            "forge.record.created",
                            "forge.record.updated",
                            "forge.review.completed",
                          ].map((eventType) => (
                            <div
                              key={eventType}
                              className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
                            >
                              <div className="text-sm font-medium text-white/78">{eventType}</div>
                              <div className="mt-1 text-xs text-white/42">
                                {selectedCapability.id ?? "No capability"}
                              </div>
                            </div>
                          ))}
                        {activeSection === "connectors" &&
                          ["Airtable import", "Argent tables", "Webhook source"].map(
                            (connector) => (
                              <div
                                key={connector}
                                className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
                              >
                                <div className="text-sm font-medium text-white/78">{connector}</div>
                                <div className="mt-1 text-xs text-white/42">Declared</div>
                              </div>
                            ),
                          )}
                        {activeSection === "permissions" &&
                          ["Owner", "Editor", "Viewer"].map((role) => (
                            <div
                              key={role}
                              className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
                            >
                              <div className="text-sm font-medium text-white/78">{role}</div>
                              <div className="mt-1 text-xs text-white/42">
                                {role === "Owner" ? (selectedApp?.creator ?? "ai") : "Unassigned"}
                              </div>
                            </div>
                          ))}
                        {activeSection === "activity" &&
                          [
                            `${viewRecords.length} records`,
                            `${structured.activeTable?.fields.length ?? 0} fields`,
                            `${reviewRecords.length} reviews`,
                          ].map((item) => (
                            <div
                              key={item}
                              className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm font-medium text-white/78"
                            >
                              {item}
                            </div>
                          ))}
                        {activeSection === "settings" &&
                          [
                            "metadata.appForge.structured",
                            `v${selectedApp?.version ?? 1}`,
                            "Core lane",
                          ].map((item) => (
                            <div
                              key={item}
                              className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm font-medium text-white/78"
                            >
                              {item}
                            </div>
                          ))}
                      </div>
                    )}

                    {structured.error && (
                      <div
                        className={`mb-3 rounded-xl border px-4 py-3 text-sm ${
                          structured.saveStatus.kind === "conflict"
                            ? "border-amber-300/30 bg-amber-400/10 text-amber-100"
                            : "border-red-400/25 bg-red-500/10 text-red-200"
                        }`}
                      >
                        {structured.error}
                      </div>
                    )}

                    {structured.sourceStatus.kind !== "gateway" && (
                      <div
                        className={`mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                          structured.sourceStatus.kind === "loading"
                            ? "border-sky-300/25 bg-sky-400/10 text-sky-100"
                            : structured.sourceStatus.kind === "metadata"
                              ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
                              : "border-red-400/25 bg-red-500/10 text-red-100"
                        }`}
                      >
                        <span>{structured.sourceStatus.message}</span>
                        <button
                          onClick={structured.reload}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/12 px-3 py-1.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Retry
                        </button>
                      </div>
                    )}

                    <div
                      ref={baseWorkspaceRef}
                      className="overflow-hidden rounded-2xl border border-white/12 bg-[#0e1316]/90 shadow-2xl"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Boxes className="h-5 w-5 text-white/55" />
                          <div className="min-w-0">
                            <button className="flex items-center gap-1 text-sm font-medium text-white/82">
                              <span className="truncate" data-testid="appforge-active-base-name">
                                {structured.activeBase?.name ?? "Projects"}
                              </span>
                              <ChevronDown className="h-4 w-4 shrink-0 text-white/35" />
                            </button>
                            <div className="mt-0.5 text-xs text-white/35">
                              Selected base database · {structured.activeBase?.tables.length ?? 0}{" "}
                              {(structured.activeBase?.tables.length ?? 0) === 1
                                ? "table"
                                : "tables"}{" "}
                              · {baseRecordCount(structured.activeBase)}{" "}
                              {baseRecordCount(structured.activeBase) === 1 ? "record" : "records"}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-white/48">
                          {FORGE_VIEW_MODES.map((view) => (
                            <button
                              key={view.id}
                              onClick={() => void handleSelectViewMode(view.id)}
                              className={`border-b-2 py-1 transition-colors ${
                                activeViewMode === view.id
                                  ? "border-sky-400 text-sky-200"
                                  : "border-transparent hover:text-white/76"
                              }`}
                            >
                              {view.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-white/48">
                          {(structured.activeTable?.views ?? []).map((view) => (
                            <div
                              key={view.id}
                              className={`group inline-flex h-8 items-center gap-1 rounded-lg border px-2 transition-colors ${
                                structured.activeView?.id === view.id
                                  ? "border-sky-300/35 bg-sky-400/14 text-sky-100"
                                  : "border-white/10 bg-black/22 hover:bg-white/10 hover:text-white/75"
                              }`}
                            >
                              <button
                                onClick={() => void structured.selectView(view.id)}
                                className="max-w-32 truncate"
                                title={`Open ${view.name}`}
                              >
                                {view.name}
                              </button>
                              <button
                                onClick={() => void structured.duplicateView(view.id)}
                                className="rounded p-0.5 text-white/25 opacity-0 transition group-hover:opacity-100 hover:text-white"
                                title="Duplicate view"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => void structured.deleteView(view.id)}
                                disabled={(structured.activeTable?.views.length ?? 0) <= 1}
                                className="rounded p-0.5 text-white/25 opacity-0 transition group-hover:opacity-100 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-20"
                                title="Delete view"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <input
                            value={newViewName}
                            onChange={(event) => setNewViewName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                void handleCreateView();
                              }
                            }}
                            placeholder="New view"
                            className="h-8 w-28 rounded-lg border border-white/10 bg-black/22 px-2 text-xs text-white/70 outline-none placeholder:text-white/30"
                          />
                          <select
                            value={newViewType}
                            onChange={(event) =>
                              setNewViewType(event.target.value as ForgeStructuredViewType)
                            }
                            className="h-8 rounded-lg border border-white/10 bg-black/22 px-2 text-xs text-white/70 outline-none"
                          >
                            {FORGE_VIEW_MODES.map((view) => (
                              <option key={view.id} value={view.id}>
                                {view.label}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => void handleCreateView()}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2 text-xs text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                            title="Create saved view"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            View
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-white/45">
                          {structured.saveStatus.kind === "saving" && (
                            <span className="inline-flex items-center gap-1 text-sky-200">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Saving
                            </span>
                          )}
                          {structured.saveStatus.kind === "saved" && (
                            <span className="text-emerald-200">Saved</span>
                          )}
                          {structured.saveStatus.kind === "degraded" && (
                            <span className="text-amber-200">Fallback saved</span>
                          )}
                          {structured.saveStatus.kind === "conflict" && (
                            <span className="text-amber-200">Reload needed</span>
                          )}
                          <input
                            value={structured.activeView?.name ?? ""}
                            onChange={(event) =>
                              structured.activeView &&
                              void structured.updateView(structured.activeView.id, {
                                name: event.target.value,
                              })
                            }
                            placeholder="View name"
                            className="h-8 w-28 rounded-lg border border-white/10 bg-black/22 px-2 text-xs text-white/70 outline-none placeholder:text-white/30"
                            title="Rename active saved view"
                          />
                          <input
                            value={viewSettings.filterText}
                            onChange={(event) =>
                              void structured.updateActiveViewSettings({
                                filterText: event.target.value,
                              })
                            }
                            placeholder="Filter records"
                            className="h-8 w-32 rounded-lg border border-white/10 bg-black/22 px-2 text-xs text-white/70 outline-none placeholder:text-white/30"
                          />
                          <select
                            value={viewSettings.sortFieldId}
                            onChange={(event) =>
                              void structured.updateActiveViewSettings({
                                sortFieldId: event.target.value,
                              })
                            }
                            className="h-8 rounded-lg border border-white/10 bg-black/22 px-2 text-xs text-white/70 outline-none"
                          >
                            <option value="">Sort</option>
                            {(structured.activeTable?.fields ?? []).map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.name}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() =>
                              void structured.updateActiveViewSettings({
                                sortDirection:
                                  viewSettings.sortDirection === "asc" ? "desc" : "asc",
                              })
                            }
                            className="h-8 rounded-lg border border-white/10 px-2 text-xs transition-colors hover:bg-white/10 hover:text-white"
                            title="Toggle sort direction"
                          >
                            {viewSettings.sortDirection === "asc" ? "Asc" : "Desc"}
                          </button>
                          <select
                            value={viewSettings.groupFieldId}
                            onChange={(event) =>
                              void structured.updateActiveViewSettings({
                                groupFieldId: event.target.value,
                              })
                            }
                            className="h-8 rounded-lg border border-white/10 bg-black/22 px-2 text-xs text-white/70 outline-none"
                          >
                            <option value="">Group</option>
                            {(structured.activeTable?.fields ?? []).map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.name}
                              </option>
                            ))}
                          </select>
                          <details className="relative">
                            <summary className="flex h-8 cursor-pointer list-none items-center rounded-lg border border-white/10 px-2 text-xs text-white/58 transition-colors hover:bg-white/10 hover:text-white">
                              Fields
                            </summary>
                            <div className="absolute right-0 z-30 mt-2 max-h-72 w-56 overflow-auto rounded-xl border border-white/12 bg-[#0d1114] p-2 shadow-2xl">
                              {(structured.activeTable?.fields ?? []).map((field) => {
                                const currentVisible = structured.activeView?.visibleFieldIds
                                  ?.length
                                  ? structured.activeView.visibleFieldIds
                                  : (structured.activeTable?.fields ?? []).map((item) => item.id);
                                const checked = currentVisible.includes(field.id);
                                return (
                                  <label
                                    key={field.id}
                                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-white/68 hover:bg-white/[0.06]"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => void handleToggleViewField(field.id)}
                                      className="h-3.5 w-3.5 rounded border-white/20 bg-black/45 accent-sky-400"
                                    />
                                    <span className="min-w-0 truncate">{field.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </details>
                        </div>
                      </div>

                      <div className="grid min-h-[390px] grid-cols-[210px_minmax(560px,1fr)] overflow-auto xl:grid-cols-[230px_minmax(640px,1fr)]">
                        <div className="border-r border-white/10 bg-black/18 p-3">
                          <div className="mb-3 flex items-center justify-between text-sm text-white/72">
                            <span>Tables</span>
                            <button
                              onClick={() => void handleCreateTable()}
                              className="rounded p-1 text-white/38 transition-colors hover:bg-white/10 hover:text-white/75"
                              title="Add table"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="space-y-1">
                            {(structured.activeBase?.tables ?? []).map((table) => (
                              <div
                                key={table.id}
                                className={`group flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                                  structured.activeTable?.id === table.id
                                    ? "bg-sky-500/14 text-sky-100"
                                    : "text-white/55 hover:bg-white/[0.05] hover:text-white/78"
                                }`}
                              >
                                <button
                                  onClick={() => {
                                    setInspectorMode("table");
                                    void structured.selectTable(table.id);
                                  }}
                                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
                                >
                                  <Table2 className="h-4 w-4 shrink-0" />
                                  <span className="truncate">{table.name}</span>
                                  <span className="ml-auto text-xs text-white/34">
                                    {table.records.length}
                                  </span>
                                </button>
                                <button
                                  onClick={() => void structured.duplicateTable(table.id)}
                                  className="rounded p-1 text-white/25 opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-white/75"
                                  title="Duplicate table"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => void structured.deleteTable(table.id)}
                                  disabled={(structured.activeBase?.tables.length ?? 0) <= 1}
                                  className="rounded p-1 text-white/25 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-20"
                                  title="Delete table"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div className="mt-5 rounded-xl border border-white/10 bg-black/18 p-2">
                            <div className="mb-2 text-xs text-white/36">New table</div>
                            <div className="flex gap-2">
                              <input
                                data-testid="appforge-create-table-input"
                                value={newTableName}
                                onChange={(event) => setNewTableName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    void handleCreateTable();
                                  }
                                }}
                                placeholder="Customers"
                                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white/72 outline-none placeholder:text-white/28"
                              />
                              <button
                                data-testid="appforge-create-table-button"
                                onClick={() => void handleCreateTable()}
                                className="rounded-lg border border-white/10 px-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                                title="Create table"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="mt-2 text-[11px] leading-snug text-white/30">
                              Imports are planned. This creates a live native TableForge table.
                            </div>
                          </div>
                        </div>

                        <div className="overflow-auto">
                          {activeViewMode === "grid" && (
                            <>
                              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/16 px-3 py-2 text-xs text-white/45">
                                <span>Add field</span>
                                <input
                                  data-testid="appforge-create-field-input"
                                  value={newFieldName}
                                  onChange={(event) => setNewFieldName(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      void handleCreateField();
                                    }
                                  }}
                                  placeholder="Budget"
                                  className="h-8 w-36 rounded-lg border border-white/10 bg-black/28 px-2 text-white/70 outline-none placeholder:text-white/28"
                                />
                                <select
                                  data-testid="appforge-create-field-type"
                                  value={newFieldType}
                                  onChange={(event) =>
                                    setNewFieldType(event.target.value as ForgeFieldType)
                                  }
                                  className="h-8 rounded-lg border border-white/10 bg-black/28 px-2 text-white/70 outline-none"
                                >
                                  {FIELD_TYPE_OPTIONS.map((fieldType) => (
                                    <option key={fieldType.value} value={fieldType.value}>
                                      {fieldType.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  data-testid="appforge-create-field-button"
                                  onClick={() => void handleCreateField()}
                                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2 text-white/62 transition-colors hover:bg-white/10 hover:text-white"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Field
                                </button>
                                <button
                                  data-testid="appforge-add-record-button"
                                  onClick={() => void structured.addRecord()}
                                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2 text-white/62 transition-colors hover:bg-white/10 hover:text-white"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Record
                                </button>
                              </div>
                              <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                                <thead className="sticky top-0 z-10 bg-[#11171a] text-xs font-medium uppercase tracking-[0.08em] text-white/38">
                                  <tr>
                                    <th className="w-12 border-b border-r border-white/10 px-3 py-3">
                                      <span className="block h-4 w-4 rounded border border-white/22" />
                                    </th>
                                    <th className="w-14 border-b border-r border-white/10 px-3 py-3">
                                      #
                                    </th>
                                    {visibleFields.map((field) => (
                                      <th
                                        key={field.id}
                                        className="group min-w-36 border-b border-r border-white/10 px-3 py-3 hover:text-white/62"
                                      >
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => {
                                              setInspectorMode("field");
                                              structured.selectField(field.id);
                                            }}
                                            className="min-w-0 flex-1 truncate text-left"
                                            title={field.name}
                                          >
                                            {field.name}
                                          </button>
                                          <button
                                            onClick={() =>
                                              void structured.moveField(field.id, "left")
                                            }
                                            className="rounded p-1 text-white/20 opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-white/70"
                                            title="Move field left"
                                          >
                                            <ArrowLeft className="h-3 w-3" />
                                          </button>
                                          <button
                                            onClick={() =>
                                              void structured.moveField(field.id, "right")
                                            }
                                            className="rounded p-1 text-white/20 opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-white/70"
                                            title="Move field right"
                                          >
                                            <ArrowRight className="h-3 w-3" />
                                          </button>
                                        </div>
                                      </th>
                                    ))}
                                    <th className="w-12 border-b border-white/10 px-3 py-3">
                                      <button
                                        onClick={() => void handleCreateField()}
                                        className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                                        title="Add field"
                                      >
                                        <Plus className="h-4 w-4" />
                                      </button>
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {viewRecords.map((record, index) => (
                                    <tr
                                      key={record.id}
                                      className="group border-b border-white/[0.07] transition-colors hover:bg-white/[0.04]"
                                    >
                                      <td className="border-r border-white/[0.07] px-2 py-2">
                                        <div className="flex items-center gap-1">
                                          <button
                                            onClick={() =>
                                              void structured.duplicateRecord(record.id)
                                            }
                                            className="rounded p-1 text-white/18 transition-colors group-hover:text-white/55 hover:bg-white/10 hover:text-white"
                                            title="Duplicate record"
                                          >
                                            <Copy className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            data-testid="appforge-delete-record-button"
                                            onClick={() => void structured.deleteRecord(record.id)}
                                            className="rounded p-1 text-white/18 transition-colors group-hover:text-red-200 hover:bg-red-500/15 hover:text-red-100"
                                            title="Delete record"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </td>
                                      <td className="border-r border-white/[0.07] px-3 py-2 text-white/42">
                                        {index + 1}
                                      </td>
                                      {visibleFields.map((field) => {
                                        const value = fieldValue(record.values[field.id]);
                                        const activeEditingCell =
                                          editingCell?.recordId === record.id &&
                                          editingCell.fieldId === field.id
                                            ? editingCell
                                            : null;
                                        return (
                                          <td
                                            key={field.id}
                                            onClick={() => structured.selectField(field.id)}
                                            onDoubleClick={() =>
                                              setEditingCell({
                                                recordId: record.id,
                                                fieldId: field.id,
                                                value,
                                              })
                                            }
                                            className="border-r border-white/[0.07] px-4 py-2 text-white/66"
                                          >
                                            {activeEditingCell && field.type === "single_select" ? (
                                              <select
                                                autoFocus
                                                value={activeEditingCell.value}
                                                onChange={(event) =>
                                                  setEditingCell({
                                                    ...activeEditingCell,
                                                    value: event.target.value,
                                                  })
                                                }
                                                onBlur={() => void commitEditingCell()}
                                                onKeyDown={(event) => {
                                                  if (event.key === "Enter") {
                                                    void commitEditingCell();
                                                  }
                                                  if (event.key === "Escape") {
                                                    setEditingCell(null);
                                                  }
                                                }}
                                                className="w-full rounded-md border border-sky-400/40 bg-black/75 px-2 py-1 text-sm text-white outline-none"
                                              >
                                                {(field.options ?? []).map((option) => (
                                                  <option key={option} value={option}>
                                                    {option}
                                                  </option>
                                                ))}
                                              </select>
                                            ) : activeEditingCell && field.type === "checkbox" ? (
                                              <input
                                                autoFocus
                                                type="checkbox"
                                                checked={activeEditingCell.value === "true"}
                                                onChange={(event) =>
                                                  setEditingCell({
                                                    ...activeEditingCell,
                                                    value: event.target.checked ? "true" : "false",
                                                  })
                                                }
                                                onBlur={() => void commitEditingCell()}
                                                onKeyDown={(event) => {
                                                  if (event.key === "Enter") {
                                                    void commitEditingCell();
                                                  }
                                                  if (event.key === "Escape") {
                                                    setEditingCell(null);
                                                  }
                                                }}
                                                className="h-4 w-4 rounded border-white/20 bg-black/45 accent-sky-400"
                                              />
                                            ) : activeEditingCell ? (
                                              <input
                                                autoFocus
                                                type={fieldInputType(field)}
                                                value={activeEditingCell.value}
                                                onChange={(event) =>
                                                  setEditingCell({
                                                    ...activeEditingCell,
                                                    value: event.target.value,
                                                  })
                                                }
                                                onBlur={() => void commitEditingCell()}
                                                onKeyDown={(event) => {
                                                  if (event.key === "Enter") {
                                                    void commitEditingCell();
                                                  }
                                                  if (event.key === "Escape") {
                                                    setEditingCell(null);
                                                  }
                                                }}
                                                className="w-full rounded-md border border-sky-400/40 bg-black/45 px-2 py-1 text-sm text-white outline-none"
                                              />
                                            ) : field.type === "single_select" && value ? (
                                              <span className="inline-flex rounded-md bg-emerald-500/18 px-2 py-1 text-xs font-medium text-emerald-100">
                                                {value}
                                              </span>
                                            ) : field.type === "checkbox" ? (
                                              <input
                                                type="checkbox"
                                                checked={value === "true"}
                                                readOnly
                                                className="h-4 w-4 rounded border-white/20 bg-black/45 accent-sky-400"
                                              />
                                            ) : (
                                              <span className="truncate">{value || " "}</span>
                                            )}
                                          </td>
                                        );
                                      })}
                                      <td className="px-3 py-2" />
                                    </tr>
                                  ))}
                                  {viewRecords.length === 0 && (
                                    <tr>
                                      <td
                                        colSpan={visibleFields.length + 3}
                                        className="px-4 py-16 text-center text-white/35"
                                      >
                                        No records
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                              <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-sm text-white/45">
                                <button
                                  onClick={() => void structured.addRecord()}
                                  className="flex items-center gap-2 transition-colors hover:text-white/75"
                                >
                                  <Plus className="h-4 w-4" />
                                  Add record
                                </button>
                                <span>
                                  {viewRecords.length}
                                  {structured.activeTable?.records.length !== viewRecords.length
                                    ? ` of ${structured.activeTable?.records.length ?? 0}`
                                    : ""}{" "}
                                  records
                                </span>
                              </div>
                            </>
                          )}

                          {activeViewMode === "kanban" && (
                            <div className="grid min-w-[760px] grid-cols-4 gap-3 p-4">
                              {recordsByField(
                                structured.activeTable,
                                viewSettings.groupFieldId ||
                                  fieldByName(structured.activeTable, "status")?.id,
                                viewRecords,
                              )
                                .filter((group) => group.records.length > 0)
                                .map((group) => (
                                  <div
                                    key={group.status}
                                    className="min-h-56 rounded-xl border border-white/10 bg-black/18 p-3"
                                  >
                                    <div className="mb-3 flex items-center justify-between text-sm text-white/70">
                                      <span>{group.status}</span>
                                      <span className="text-xs text-white/35">
                                        {group.records.length}
                                      </span>
                                    </div>
                                    <div className="space-y-2">
                                      {group.records.map((record) => (
                                        <div
                                          key={record.id}
                                          className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
                                        >
                                          <div className="text-sm font-medium text-white/76">
                                            {recordTitle(structured.activeTable, record)}
                                          </div>
                                          <div className="mt-1 text-xs text-white/38">
                                            {fieldValue(
                                              record.values[
                                                fieldByName(structured.activeTable, "owner")?.id ??
                                                  ""
                                              ],
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          )}

                          {activeViewMode === "form" && (
                            <div className="space-y-4 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/18 px-3 py-2">
                                <div>
                                  <div className="text-xs uppercase tracking-[0.16em] text-white/30">
                                    Form record
                                  </div>
                                  <div className="text-sm text-white/70">
                                    {formRecord
                                      ? recordTitle(structured.activeTable, formRecord)
                                      : "No records"}
                                  </div>
                                </div>
                                <select
                                  value={formRecord?.id ?? ""}
                                  onChange={(event) => setFormRecordId(event.target.value)}
                                  className="h-9 min-w-52 rounded-lg border border-white/10 bg-black/55 px-3 text-sm text-white/72 outline-none"
                                >
                                  {tableRecords.map((record) => (
                                    <option key={record.id} value={record.id}>
                                      {recordTitle(structured.activeTable, record)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="grid gap-4 md:grid-cols-2">
                                {(structured.activeTable?.fields ?? []).map((field) => (
                                  <label key={field.id} className="block">
                                    <span className="mb-2 block text-xs text-white/38">
                                      {field.name}
                                    </span>
                                    {field.type === "single_select" ? (
                                      <select
                                        value={
                                          formRecord ? fieldValue(formRecord.values[field.id]) : ""
                                        }
                                        onChange={(event) => {
                                          if (!formRecord) {
                                            return;
                                          }
                                          void structured.updateCell(
                                            formRecord.id,
                                            field.id,
                                            cellValueFromInput(field, event.target.value),
                                          );
                                        }}
                                        className="w-full rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-sm text-white/72 outline-none"
                                      >
                                        {(field.options ?? []).map((option) => (
                                          <option key={option} value={option}>
                                            {option}
                                          </option>
                                        ))}
                                      </select>
                                    ) : field.type === "checkbox" ? (
                                      <input
                                        type="checkbox"
                                        checked={
                                          formRecord
                                            ? fieldValue(formRecord.values[field.id]) === "true"
                                            : false
                                        }
                                        onChange={(event) => {
                                          if (!formRecord) {
                                            return;
                                          }
                                          void structured.updateCell(
                                            formRecord.id,
                                            field.id,
                                            cellValueFromInput(
                                              field,
                                              event.target.checked ? "true" : "false",
                                            ),
                                          );
                                        }}
                                        className="h-5 w-5 rounded border-white/20 bg-black/45 accent-sky-400"
                                      />
                                    ) : (
                                      <input
                                        type={fieldInputType(field)}
                                        value={
                                          formRecord ? fieldValue(formRecord.values[field.id]) : ""
                                        }
                                        onChange={(event) => {
                                          if (!formRecord) {
                                            return;
                                          }
                                          void structured.updateCell(
                                            formRecord.id,
                                            field.id,
                                            cellValueFromInput(field, event.target.value),
                                          );
                                        }}
                                        className="w-full rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-sm text-white/72 outline-none"
                                      />
                                    )}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}

                          {activeViewMode === "review" && (
                            <div className="space-y-3 p-4">
                              {(reviewRecords.length > 0 ? reviewRecords : viewRecords).map(
                                (record) => (
                                  <div
                                    key={record.id}
                                    className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-4"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-medium text-white/78">
                                        {recordTitle(structured.activeTable, record)}
                                      </div>
                                      <div className="mt-1 text-xs text-white/42">
                                        {recordStatus(structured.activeTable, record) || "Ready"}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                      {recordStatus(structured.activeTable, record) !==
                                        "Review" && (
                                        <button
                                          onClick={() => void structured.requestReview(record.id)}
                                          className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                                        >
                                          Request
                                        </button>
                                      )}
                                      <button
                                        onClick={() =>
                                          void handleReviewDecision(record, "approved")
                                        }
                                        className="rounded-lg bg-emerald-500/20 px-3 py-2 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-500/30"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        onClick={() => void handleReviewDecision(record, "denied")}
                                        className="rounded-lg bg-red-500/18 px-3 py-2 text-xs font-medium text-red-100 transition-colors hover:bg-red-500/28"
                                      >
                                        Deny
                                      </button>
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* New App Form */}
                <AnimatePresence>
                  {(showNewAppInput || building) && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="mx-auto mt-8 max-w-lg px-4"
                    >
                      <div className="glass-panel rounded-2xl p-6">
                        {building ? (
                          <div className="flex flex-col items-center gap-3 py-4">
                            <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                            <span className="text-white/60 text-sm">
                              Creating {newAppName || "your base"}...
                            </span>
                            <span className="text-white/30 text-xs">
                              AppForge will add it to the desktop as a structured base.
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 mb-5">
                              <Sparkles className="w-5 h-5 text-purple-400" />
                              <span className="text-white/80 font-medium">Create Base</span>
                            </div>

                            <div className="space-y-4">
                              {/* App Name */}
                              <div>
                                <label className="block text-xs text-white/40 mb-1.5">
                                  Base name
                                </label>
                                <input
                                  ref={nameInputRef}
                                  type="text"
                                  aria-label="Base name"
                                  value={newAppName}
                                  onChange={(e) => setNewAppName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      setShowNewAppInput(false);
                                    }
                                  }}
                                  placeholder="e.g. Marketing Operations"
                                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 text-sm"
                                />
                              </div>

                              {/* Description */}
                              <div>
                                <label className="block text-xs text-white/40 mb-1.5">
                                  What should this base track?
                                </label>
                                <textarea
                                  aria-label="What should this base track?"
                                  value={newAppDescription}
                                  onChange={(e) => setNewAppDescription(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && e.metaKey) {
                                      void handleNewAppSubmit();
                                    }
                                    if (e.key === "Escape") {
                                      setShowNewAppInput(false);
                                    }
                                  }}
                                  placeholder="e.g. Campaigns, tasks, approvals, owners, due dates, and workflow review status."
                                  rows={4}
                                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 text-sm resize-none"
                                />
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-between mt-5">
                              <button
                                onClick={() => setShowNewAppInput(false)}
                                className="text-xs text-white/30 hover:text-white/50 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => void handleNewAppSubmit()}
                                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 rounded-xl text-white text-sm font-medium transition-colors flex items-center gap-2"
                              >
                                <Send className="w-4 h-4" />
                                Create Base
                              </button>
                            </div>
                            <p className="text-[10px] text-white/20 mt-3 text-center">
                              Press {navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to
                              submit
                            </p>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </main>

              <aside className="hidden min-h-0 overflow-auto rounded-2xl border border-white/10 bg-black/35 p-4 lg:flex lg:flex-col">
                {selectedApp ? (
                  <>
                    <div className="mb-5 flex items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                        {selectedApp.icon ? (
                          <div
                            className="h-7 w-7"
                            dangerouslySetInnerHTML={{ __html: sanitizeSvg(selectedApp.icon) }}
                          />
                        ) : (
                          <Boxes className="h-6 w-6 text-white/55" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white/85">
                          {selectedApp.name}
                        </div>
                        <div className="text-xs text-white/35">v{selectedApp.version}</div>
                      </div>
                    </div>

                    <div className="mb-4 grid grid-cols-2 border-b border-white/10 text-sm">
                      <button
                        onClick={() => setInspectorMode("field")}
                        className={`border-b-2 px-3 py-2 transition-colors ${
                          inspectorMode === "field"
                            ? "border-sky-400 text-sky-200"
                            : "border-transparent text-white/45 hover:text-white/70"
                        }`}
                      >
                        Field
                      </button>
                      <button
                        onClick={() => setInspectorMode("table")}
                        className={`border-b-2 px-3 py-2 transition-colors ${
                          inspectorMode === "table"
                            ? "border-sky-400 text-sky-200"
                            : "border-transparent text-white/45 hover:text-white/70"
                        }`}
                      >
                        Table
                      </button>
                    </div>

                    {inspectorMode === "field" ? (
                      <div className="space-y-5 text-sm">
                        {structured.selectedField ? (
                          <>
                            <div className="rounded-xl border border-emerald-300/15 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100/80">
                              Live field settings. Changes save through the structured base path and
                              reopen with this table.
                            </div>

                            <label className="block">
                              <span className="mb-2 block text-xs text-white/38">Field label</span>
                              <input
                                data-testid="appforge-field-name-input"
                                value={fieldNameDraft}
                                onChange={(event) => setFieldNameDraft(event.target.value)}
                                onBlur={() => void commitFieldNameDraft()}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                  if (event.key === "Escape") {
                                    setFieldNameDraft(structured.selectedField?.name ?? "");
                                    event.currentTarget.blur();
                                  }
                                }}
                                className="w-full rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-white/72 outline-none"
                              />
                            </label>

                            <div>
                              <label className="block">
                                <span className="mb-2 block text-xs text-white/38">Field type</span>
                                <select
                                  data-testid="appforge-field-type-select"
                                  value={pendingFieldType}
                                  onChange={(event) =>
                                    setPendingFieldType(event.target.value as ForgeFieldType)
                                  }
                                  className="w-full rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-white/72 outline-none"
                                >
                                  {FIELD_TYPE_OPTIONS.map((fieldType) => (
                                    <option key={fieldType.value} value={fieldType.value}>
                                      {fieldType.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {pendingFieldType !== structured.selectedField.type && (
                                <div
                                  data-testid="appforge-field-type-warning"
                                  className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-100/85"
                                >
                                  <div className="font-medium text-amber-100">
                                    Conversion requires confirmation
                                  </div>
                                  <div className="mt-1">
                                    {fieldTypeConversionWarning(
                                      structured.selectedField.type,
                                      pendingFieldType,
                                    )}
                                  </div>
                                  <div className="mt-3 flex gap-2">
                                    <button
                                      data-testid="appforge-field-type-apply"
                                      onClick={() => void handleApplyFieldType()}
                                      className="rounded-lg border border-amber-200/25 bg-amber-300/12 px-3 py-1.5 text-amber-50 transition-colors hover:bg-amber-300/18"
                                    >
                                      Apply type change
                                    </button>
                                    <button
                                      onClick={() =>
                                        setPendingFieldType(
                                          structured.selectedField?.type ?? "text",
                                        )
                                      }
                                      className="rounded-lg border border-white/10 px-3 py-1.5 text-white/62 transition-colors hover:bg-white/5"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {fieldSupportsSelectOptions(structured.selectedField.type) && (
                              <div>
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-xs text-white/38">Select options</span>
                                  <span className="text-[11px] text-white/30">
                                    Stable ids + color metadata
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  {selectOptionsForField(structured.selectedField).map((option) => (
                                    <div
                                      key={option.id}
                                      className="grid grid-cols-[auto_minmax(0,1fr)_84px_auto] items-center gap-2 rounded-lg bg-white/[0.05] px-2 py-2 text-white/65"
                                    >
                                      <span
                                        className="h-3 w-3 shrink-0 rounded-full"
                                        style={{ backgroundColor: optionColorValue(option.color) }}
                                      />
                                      <input
                                        value={selectOptionDrafts[option.id] ?? option.label}
                                        onChange={(event) =>
                                          setSelectOptionDrafts((current) => ({
                                            ...current,
                                            [option.id]: event.target.value,
                                          }))
                                        }
                                        onBlur={() => void commitSelectOptionDraft(option)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            event.currentTarget.blur();
                                          }
                                          if (event.key === "Escape") {
                                            setSelectOptionDrafts((current) => ({
                                              ...current,
                                              [option.id]: option.label,
                                            }));
                                            event.currentTarget.blur();
                                          }
                                        }}
                                        className="min-w-0 bg-transparent text-sm text-white/72 outline-none"
                                      />
                                      <select
                                        value={option.color}
                                        onChange={(event) =>
                                          void handleUpdateSelectOption(option.id, {
                                            color: event.target.value,
                                          })
                                        }
                                        className="rounded border border-white/10 bg-black/30 px-1.5 py-1 text-xs text-white/60 outline-none"
                                      >
                                        {SELECT_OPTION_PALETTE.map((palette) => (
                                          <option key={palette.id} value={palette.id}>
                                            {palette.label}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={() => void handleDeleteSelectOption(option.id)}
                                        className="rounded p-1 text-white/30 transition-colors hover:bg-red-500/15 hover:text-red-200"
                                        title="Delete option"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <button
                                  onClick={() => void handleAddSelectOption()}
                                  className="mt-3 flex items-center gap-2 text-sm text-sky-300/80 hover:text-sky-200"
                                >
                                  <Plus className="h-4 w-4" />
                                  Add option
                                </button>
                              </div>
                            )}

                            <label className="block">
                              <span className="mb-2 block text-xs text-white/38">Description</span>
                              <textarea
                                data-testid="appforge-field-description-input"
                                value={fieldDescriptionDraft}
                                onChange={(event) => setFieldDescriptionDraft(event.target.value)}
                                onBlur={() => void commitFieldDescriptionDraft()}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                    event.currentTarget.blur();
                                  }
                                  if (event.key === "Escape") {
                                    setFieldDescriptionDraft(
                                      structured.selectedField?.description ?? "",
                                    );
                                    event.currentTarget.blur();
                                  }
                                }}
                                rows={3}
                                className="w-full resize-none rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-white/72 outline-none"
                              />
                            </label>

                            <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                              <div className="mb-2 text-xs text-white/38">Default value</div>
                              {fieldSupportsDefaultValue(structured.selectedField.type) ? (
                                structured.selectedField.type === "checkbox" ? (
                                  <label className="flex items-center justify-between text-sm text-white/60">
                                    Checked by default
                                    <input
                                      data-testid="appforge-field-default-checkbox"
                                      type="checkbox"
                                      checked={structured.selectedField.defaultValue === true}
                                      onChange={(event) =>
                                        void handleUpdateDefaultValue(
                                          structured.selectedField as ForgeStructuredField,
                                          event.target.checked,
                                        )
                                      }
                                      className="h-4 w-4 accent-sky-400"
                                    />
                                  </label>
                                ) : structured.selectedField.type === "single_select" ? (
                                  <select
                                    data-testid="appforge-field-default-input"
                                    value={fieldValue(structured.selectedField.defaultValue)}
                                    onChange={(event) =>
                                      event.target.value
                                        ? void handleUpdateDefaultValue(
                                            structured.selectedField as ForgeStructuredField,
                                            event.target.value,
                                          )
                                        : void structured.updateField(structured.selectedField.id, {
                                            defaultValue: undefined,
                                          })
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-white/72 outline-none"
                                  >
                                    <option value="">No default</option>
                                    {selectOptionsForField(structured.selectedField).map(
                                      (option) => (
                                        <option key={option.id} value={option.label}>
                                          {option.label}
                                        </option>
                                      ),
                                    )}
                                  </select>
                                ) : (
                                  <input
                                    data-testid="appforge-field-default-input"
                                    type={fieldDefaultInputType(structured.selectedField.type)}
                                    value={fieldDefaultDraft}
                                    onChange={(event) => setFieldDefaultDraft(event.target.value)}
                                    onBlur={() => void commitDefaultDraft()}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.currentTarget.blur();
                                      }
                                      if (event.key === "Escape") {
                                        setFieldDefaultDraft(
                                          fieldValue(structured.selectedField?.defaultValue),
                                        );
                                        event.currentTarget.blur();
                                      }
                                    }}
                                    placeholder={
                                      structured.selectedField.type === "multi_select"
                                        ? "Planning, Review"
                                        : "No default"
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-white/72 outline-none placeholder:text-white/28"
                                  />
                                )
                              ) : (
                                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/45">
                                  Planned: defaults for attachment and linked-record fields require
                                  the next relation/asset storage slice.
                                </div>
                              )}
                            </div>

                            <label className="flex items-center justify-between border-t border-white/10 pt-4">
                              <span>
                                <span className="block text-sm text-white/55">Required</span>
                                <span className="text-[11px] text-white/30">
                                  Live for table edits; empty cells keep a safe value.
                                </span>
                              </span>
                              <input
                                data-testid="appforge-field-required-toggle"
                                type="checkbox"
                                checked={!!structured.selectedField.required}
                                onChange={(event) => {
                                  if (!structured.selectedField) {
                                    return;
                                  }
                                  void structured.updateField(structured.selectedField.id, {
                                    required: event.target.checked,
                                  });
                                }}
                                className="h-4 w-4 accent-sky-400"
                              />
                            </label>

                            <div className="grid grid-cols-2 gap-2 border-t border-white/10 pt-4">
                              <button
                                onClick={() =>
                                  structured.selectedField &&
                                  void structured.duplicateField(structured.selectedField.id)
                                }
                                className="flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/65 transition-colors hover:bg-white/5 hover:text-white"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                Duplicate
                              </button>
                              <button
                                onClick={() =>
                                  structured.selectedField &&
                                  void structured.deleteField(structured.selectedField.id)
                                }
                                disabled={(structured.activeTable?.fields.length ?? 0) <= 1}
                                className="flex items-center justify-center gap-2 rounded-lg border border-red-400/15 px-3 py-2 text-xs text-red-200/75 transition-colors hover:bg-red-500/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
                            Select a field from the grid header or Tables section to edit live
                            TableForge field settings.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-5 text-sm">
                        <label className="block">
                          <span className="mb-2 block text-xs text-white/38">Table name</span>
                          <input
                            value={structured.activeTable?.name ?? ""}
                            onChange={(event) => {
                              if (!structured.activeTable) {
                                return;
                              }
                              void structured.updateTable(structured.activeTable.id, {
                                name: event.target.value,
                              });
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-white/72 outline-none"
                          />
                        </label>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() =>
                              structured.activeTable &&
                              void structured.duplicateTable(structured.activeTable.id)
                            }
                            className="flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/65 transition-colors hover:bg-white/5 hover:text-white"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Duplicate
                          </button>
                          <button
                            onClick={() =>
                              structured.activeTable &&
                              void structured.deleteTable(structured.activeTable.id)
                            }
                            disabled={(structured.activeBase?.tables.length ?? 0) <= 1}
                            className="flex items-center justify-center gap-2 rounded-lg border border-red-400/15 px-3 py-2 text-xs text-red-200/75 transition-colors hover:bg-red-500/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                          <button
                            onClick={() => void structured.addField()}
                            className="flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/65 transition-colors hover:bg-white/5 hover:text-white"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Field
                          </button>
                          <button
                            onClick={() => void structured.addRecord()}
                            className="flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/65 transition-colors hover:bg-white/5 hover:text-white"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Record
                          </button>
                        </div>

                        <div className="border-t border-white/10 pt-4">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-xs text-white/38">Current table</span>
                            <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-white/65">
                              {structured.activeTable?.name ?? "No table"}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-xs text-white/30">Records</div>
                              <div className="truncate text-white/60">{viewRecords.length}</div>
                            </div>
                            <div>
                              <div className="text-xs text-white/30">Fields</div>
                              <div className="text-white/60">
                                {structured.activeTable?.fields.length ?? 0}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-white/30">Capability</div>
                              <div className="truncate text-white/60">
                                {selectedCapability.id ?? "None"}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-white/30">State</div>
                              <div className="text-white/60">
                                {selectedWindow ? "Running" : "Closed"}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-auto grid gap-2 pt-5">
                      <button
                        onClick={() => onOpenApp(selectedApp.id)}
                        className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open
                      </button>
                      <button
                        onClick={() => void emitTestWorkflowEvent(selectedApp.id)}
                        className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-white/65 transition-colors hover:bg-white/5 hover:text-white"
                        disabled={!onEmitWorkflowEvent}
                      >
                        <Send className="h-4 w-4" />
                        Emit Test Event
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-white/30">
                    No app selected
                  </div>
                )}
              </aside>
            </div>
          </div>

          {/* Dock */}
          <AppDock
            windows={windows}
            apps={displayApps}
            onRestore={onRestoreApp}
            onFocus={onFocusApp}
          />

          {/* Context Menu */}
          <AnimatePresence>
            {contextMenu && (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="fixed bg-gray-800/95 backdrop-blur border border-white/10 rounded-lg py-1 shadow-xl z-[300] min-w-[160px]"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    onOpenApp(contextMenu.appId);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open
                </button>
                <button
                  onClick={() => {
                    onPinApp(contextMenu.appId);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <Pin className="w-3.5 h-3.5" /> Toggle Pin
                </button>
                {onEmitWorkflowEvent && (
                  <button
                    onClick={() => {
                      void emitTestWorkflowEvent(contextMenu.appId);
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white"
                    data-testid="appforge-emit-workflow-event"
                  >
                    <Send className="w-3.5 h-3.5" /> Emit Test Event
                  </button>
                )}
                <div className="border-t border-white/10 my-1" />
                <button
                  onClick={() => {
                    requestDeleteApp(contextMenu.appId);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {pendingDeleteApp && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[320] flex items-center justify-center bg-black/45 px-4"
                onClick={() => {
                  if (deletingAppId) {
                    return;
                  }
                  setPendingDeleteApp(null);
                  setDeleteError(null);
                }}
              >
                <motion.div
                  initial={{ scale: 0.96, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.96, opacity: 0 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#121018]/95 p-6 shadow-2xl backdrop-blur-xl"
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="app-delete-title"
                >
                  <h2 id="app-delete-title" className="text-lg font-medium text-white">
                    Are you sure you want to delete?
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    This will remove <span className="text-white">{pendingDeleteApp.name}</span> and
                    its icon from App Forge.
                  </p>
                  {deleteError && <p className="mt-3 text-sm text-red-300">{deleteError}</p>}
                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      onClick={() => {
                        setPendingDeleteApp(null);
                        setDeleteError(null);
                      }}
                      disabled={!!deletingAppId}
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-default disabled:opacity-50"
                    >
                      No
                    </button>
                    <button
                      onClick={() => void confirmDeleteApp()}
                      disabled={!!deletingAppId}
                      className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-400 disabled:cursor-default disabled:bg-red-500/60"
                    >
                      {deletingAppId === pendingDeleteApp.id && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      Yes
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
