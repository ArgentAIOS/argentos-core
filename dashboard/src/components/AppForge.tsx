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
import { useState, useCallback, useRef, useEffect } from "react";
import type { AppForgeWorkflowEventRequest, ForgeApp } from "../hooks/useApps";
import type { AppWindowState } from "../hooks/useAppWindows";
import {
  useForgeStructuredData,
  type ForgeStructuredField,
  type ForgeStructuredRecord,
  type ForgeStructuredRecordValue,
  type ForgeStructuredTable,
} from "../hooks/useForgeStructuredData";
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

type EditingCell = {
  recordId: string;
  fieldId: string;
  value: string;
};

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
  if (!Array.isArray(values)) return undefined;
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
    if (!Array.isArray(candidate)) continue;
    const capability = candidate.find(asRecord);
    if (!capability) continue;
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
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(APP_FORGE_UI_STATE_KEY) ?? "{}",
    ) as Record<string, unknown> | null;
    if (!parsed) return {};
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
  return value === null || value === undefined ? "" : String(value);
}

function fieldByName(
  table: ForgeStructuredTable | null | undefined,
  name: string,
): ForgeStructuredField | undefined {
  if (!table) return undefined;
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

function recordsByStatus(table: ForgeStructuredTable | null | undefined) {
  const statusField = fieldByName(table, "status");
  const options = statusField?.options?.length
    ? statusField.options
    : ["Planning", "In Progress", "On Track", "Review", "Blocked"];
  const records = table?.records ?? [];
  return options.map((status) => ({
    status,
    records: records.filter((record) => recordStatus(table, record) === status),
  }));
}

export function AppForge({
  isOpen,
  apps,
  windows,
  onClose,
  onOpenApp,
  onPinApp,
  onDeleteApp,
  onNewApp,
  onRestoreApp,
  onFocusApp,
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
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const appCountAtBuild = useRef(0);

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
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
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

  const handleNewAppSubmit = useCallback(() => {
    const description = newAppDescription.trim();
    if (!description) return;
    appCountAtBuild.current = apps.length;
    setBuilding(true);
    onNewApp(newAppName.trim(), description);
  }, [newAppName, newAppDescription, onNewApp, apps.length]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  useEffect(() => {
    if (!deleteMode && !pendingDeleteApp) return;
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
  const baseFilteredApps =
    activeFilter === "pinned"
      ? apps.filter((app) => app.pinned)
      : activeFilter === "running"
        ? apps.filter((app) => runningAppIds.has(app.id))
        : apps;

  // Filter apps by search
  const filteredApps = searchQuery
    ? baseFilteredApps.filter(
        (app) =>
          app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          app.description?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : baseFilteredApps;

  const selectedApp =
    apps.find((app) => app.id === selectedAppId) ?? filteredApps[0] ?? apps[0] ?? null;
  const selectedWindow = selectedApp
    ? windows.find((window) => window.appId === selectedApp.id)
    : undefined;
  const selectedCapability = selectedApp ? appWorkflowCapability(selectedApp) : {};
  const shortcutApps = filteredApps.slice(0, 5);
  const capabilityCount = apps.filter((app) => appWorkflowCapability(app).id).length;
  const structured = useForgeStructuredData({
    apps: filteredApps,
    selectedAppId,
    onSelectApp: setSelectedAppId,
    emitWorkflowEvent: onEmitWorkflowEvent,
  });
  const visibleFields = structured.activeTable?.fields.slice(0, 6) ?? [];
  const reviewRecords =
    structured.activeTable?.records.filter(
      (record) => recordStatus(structured.activeTable, record) === "Review",
    ) ?? [];
  const formRecord = structured.activeTable?.records[0] ?? null;
  const activeNav = APP_FORGE_NAV.find((item) => item.id === activeSection);
  const sectionTitle = activeNav?.label ?? "Desktop";
  const sectionSubtitle =
    activeSection === "desktop"
      ? "All your bases at a glance"
      : activeSection === "bases"
        ? "Structured bases backed by AppForge metadata"
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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, appId: string) => {
      if (deleteMode) return;
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
      const app = apps.find((candidate) => candidate.id === appId);
      if (!app) return;
      setContextMenu(null);
      setDeleteError(null);
      setPendingDeleteApp(app);
    },
    [apps],
  );

  const confirmDeleteApp = useCallback(async () => {
    if (!pendingDeleteApp || deletingAppId) return;
    setDeleteError(null);
    setDeletingAppId(pendingDeleteApp.id);
    const deleted = await onDeleteApp(pendingDeleteApp.id);
    setDeletingAppId(null);
    if (deleted) {
      setPendingDeleteApp(null);
      return;
    }
    setDeleteError(`Failed to delete ${pendingDeleteApp.name}.`);
  }, [pendingDeleteApp, deletingAppId, onDeleteApp]);

  const emitTestWorkflowEvent = useCallback(
    async (appId: string) => {
      if (!onEmitWorkflowEvent) return;
      const app = apps.find((candidate) => candidate.id === appId);
      if (!app) return;

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
    [apps, onEmitWorkflowEvent],
  );

  const commitEditingCell = useCallback(async () => {
    if (!editingCell) return;
    const field = structured.activeTable?.fields.find(
      (candidate) => candidate.id === editingCell.fieldId,
    );
    const nextValue =
      field?.type === "number"
        ? Number(editingCell.value) || 0
        : field?.type === "checkbox"
          ? editingCell.value === "true"
          : editingCell.value;
    setEditingCell(null);
    await structured.updateCell(editingCell.recordId, editingCell.fieldId, nextValue);
  }, [editingCell, structured]);

  async function handleReviewDecision(
    record: ForgeStructuredRecord,
    decision: "approved" | "denied",
  ) {
    if (!selectedApp?.id) return;
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
                          return (
                            <motion.button
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
                                structured.selectBase(app.id);
                              }}
                              onDoubleClick={() => {
                                if (!deleteMode) onOpenApp(app.id);
                              }}
                              onContextMenu={(e) => handleContextMenu(e, app.id)}
                              onMouseEnter={() => setSelectedAppId(app.id)}
                              className={`group relative flex min-h-[112px] flex-col items-center justify-center gap-3 rounded-xl border p-3 transition-colors ${
                                selectedApp?.id === app.id
                                  ? "border-sky-400/30 bg-sky-400/10"
                                  : "border-white/10 bg-white/[0.04] hover:border-white/18 hover:bg-white/[0.07]"
                              }`}
                            >
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
                                  {appWorkflowCapability(app).id ? "Review table" : "Base"}
                                </div>
                              </div>
                            </motion.button>
                          );
                        })}

                        <button
                          onClick={() => {
                            if (deleteMode) return;
                            setShowNewAppInput(true);
                          }}
                          className={`flex min-h-[112px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-3 transition-colors ${
                            deleteMode
                              ? "cursor-default border-white/10 opacity-35"
                              : "border-white/16 bg-black/15 hover:border-sky-300/35 hover:bg-white/[0.05]"
                          }`}
                        >
                          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/12 bg-white/[0.04]">
                            <Plus className="h-7 w-7 text-white/45" />
                          </div>
                          <span className="text-sm text-white/48">New Base</span>
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
                              onClick={() => setActiveViewMode(view.id)}
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
                                  : `${structured.activeTable?.records.length ?? 0} records`}
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
                            `${structured.activeTable?.records.length ?? 0} records`,
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
                      <div className="mb-3 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {structured.error}
                      </div>
                    )}

                    <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#0e1316]/90 shadow-2xl">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Boxes className="h-5 w-5 text-white/55" />
                          <button className="flex items-center gap-1 text-sm font-medium text-white/82">
                            {structured.activeBase?.name ?? "Projects"}
                            <ChevronDown className="h-4 w-4 text-white/35" />
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-white/48">
                          {FORGE_VIEW_MODES.map((view) => (
                            <button
                              key={view.id}
                              onClick={() => setActiveViewMode(view.id)}
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
                        <div className="flex items-center gap-3 text-sm text-white/45">
                          {structured.saving && <span className="text-sky-200">Saving...</span>}
                          <button className="hover:text-white/75">Filter</button>
                          <button className="hover:text-white/75">Sort</button>
                          <button className="hover:text-white/75">Group</button>
                        </div>
                      </div>

                      <div className="grid min-h-[390px] grid-cols-[210px_minmax(560px,1fr)] overflow-auto xl:grid-cols-[230px_minmax(640px,1fr)]">
                        <div className="border-r border-white/10 bg-black/18 p-3">
                          <div className="mb-3 flex items-center justify-between text-sm text-white/72">
                            <span>Tables</span>
                            <button
                              onClick={() => void structured.addTable()}
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
                          <button
                            onClick={() => void structured.addTable()}
                            className="mt-5 flex items-center gap-2 px-3 text-sm text-white/48 transition-colors hover:text-white/75"
                          >
                            <Plus className="h-4 w-4" />
                            Add or import table
                          </button>
                        </div>

                        <div className="overflow-auto">
                          {activeViewMode === "grid" && (
                            <>
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
                                        onClick={() => void structured.addField()}
                                        className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                                        title="Add field"
                                      >
                                        <Plus className="h-4 w-4" />
                                      </button>
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(structured.activeTable?.records ?? []).map((record, index) => (
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
                                        const isEditing =
                                          editingCell?.recordId === record.id &&
                                          editingCell.fieldId === field.id;
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
                                            {isEditing ? (
                                              <input
                                                autoFocus
                                                value={editingCell.value}
                                                onChange={(event) =>
                                                  setEditingCell({
                                                    ...editingCell,
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
                                            ) : (
                                              <span className="truncate">{value || " "}</span>
                                            )}
                                          </td>
                                        );
                                      })}
                                      <td className="px-3 py-2" />
                                    </tr>
                                  ))}
                                  {(structured.activeTable?.records.length ?? 0) === 0 && (
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
                                <span>{structured.activeTable?.records.length ?? 0} records</span>
                              </div>
                            </>
                          )}

                          {activeViewMode === "kanban" && (
                            <div className="grid min-w-[760px] grid-cols-4 gap-3 p-4">
                              {recordsByStatus(structured.activeTable)
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
                            <div className="grid gap-4 p-4 md:grid-cols-2">
                              {(structured.activeTable?.fields ?? []).map((field) => (
                                <label key={field.id} className="block">
                                  <span className="mb-2 block text-xs text-white/38">
                                    {field.name}
                                  </span>
                                  <input
                                    value={
                                      formRecord ? fieldValue(formRecord.values[field.id]) : ""
                                    }
                                    onChange={(event) => {
                                      if (!formRecord) return;
                                      void structured.updateCell(
                                        formRecord.id,
                                        field.id,
                                        event.target.value,
                                      );
                                    }}
                                    className="w-full rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-sm text-white/72 outline-none"
                                  />
                                </label>
                              ))}
                            </div>
                          )}

                          {activeViewMode === "review" && (
                            <div className="space-y-3 p-4">
                              {(reviewRecords.length > 0
                                ? reviewRecords
                                : (structured.activeTable?.records ?? [])
                              ).map((record) => (
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
                                    {recordStatus(structured.activeTable, record) !== "Review" && (
                                      <button
                                        onClick={() => void structured.requestReview(record.id)}
                                        className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                                      >
                                        Request
                                      </button>
                                    )}
                                    <button
                                      onClick={() => void handleReviewDecision(record, "approved")}
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
                              ))}
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
                              Building {newAppName || "your app"}...
                            </span>
                            <span className="text-white/30 text-xs">
                              The AI is generating code. It will appear here when ready.
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 mb-5">
                              <Sparkles className="w-5 h-5 text-purple-400" />
                              <span className="text-white/80 font-medium">New App</span>
                            </div>

                            <div className="space-y-4">
                              {/* App Name */}
                              <div>
                                <label className="block text-xs text-white/40 mb-1.5">
                                  What do you want to call it?
                                </label>
                                <input
                                  ref={nameInputRef}
                                  type="text"
                                  value={newAppName}
                                  onChange={(e) => setNewAppName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") setShowNewAppInput(false);
                                  }}
                                  placeholder="e.g. Price Calculator"
                                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 text-sm"
                                />
                              </div>

                              {/* Description */}
                              <div>
                                <label className="block text-xs text-white/40 mb-1.5">
                                  Describe what it does and any design details
                                </label>
                                <textarea
                                  value={newAppDescription}
                                  onChange={(e) => setNewAppDescription(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && e.metaKey) handleNewAppSubmit();
                                    if (e.key === "Escape") setShowNewAppInput(false);
                                  }}
                                  placeholder="e.g. Calculate markup/markdown percentages on product prices. Show original price, percentage, and final price. Include a toggle for markup vs markdown mode."
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
                                onClick={handleNewAppSubmit}
                                disabled={!newAppDescription.trim()}
                                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-white/5 disabled:text-white/20 rounded-xl text-white text-sm font-medium transition-colors flex items-center gap-2"
                              >
                                <Send className="w-4 h-4" />
                                Build App
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
                        <label className="block">
                          <span className="mb-2 block text-xs text-white/38">Field name</span>
                          <input
                            value={structured.selectedField?.name ?? ""}
                            onChange={(event) => {
                              if (!structured.selectedField) return;
                              void structured.updateField(structured.selectedField.id, {
                                name: event.target.value,
                              });
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-white/72 outline-none"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-2 block text-xs text-white/38">Field type</span>
                          <select
                            value={structured.selectedField?.type ?? "text"}
                            onChange={(event) => {
                              if (!structured.selectedField) return;
                              void structured.updateField(structured.selectedField.id, {
                                type: event.target.value as
                                  | "text"
                                  | "single_select"
                                  | "number"
                                  | "date"
                                  | "checkbox",
                              });
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-white/72 outline-none"
                          >
                            <option value="text">Text</option>
                            <option value="single_select">Single select</option>
                            <option value="number">Number</option>
                            <option value="date">Date</option>
                            <option value="checkbox">Checkbox</option>
                          </select>
                        </label>

                        {structured.selectedField?.type === "single_select" && (
                          <div>
                            <div className="mb-2 text-xs text-white/38">Options</div>
                            <div className="space-y-2">
                              {(structured.selectedField.options ?? []).map((label, index) => (
                                <div
                                  key={`${label}-${index}`}
                                  className="flex items-center gap-2 rounded-lg bg-white/[0.05] px-2 py-2 text-white/65"
                                >
                                  <span className="h-3 w-3 shrink-0 rounded-full bg-emerald-400" />
                                  <input
                                    value={label}
                                    onChange={(event) => {
                                      if (!structured.selectedField) return;
                                      const options = [...(structured.selectedField.options ?? [])];
                                      options[index] = event.target.value;
                                      void structured.updateField(structured.selectedField.id, {
                                        options: options.filter((option) => option.trim()),
                                      });
                                    }}
                                    className="min-w-0 flex-1 bg-transparent text-sm text-white/72 outline-none"
                                  />
                                  <button
                                    onClick={() => {
                                      if (!structured.selectedField) return;
                                      void structured.updateField(structured.selectedField.id, {
                                        options: (structured.selectedField.options ?? []).filter(
                                          (_option, optionIndex) => optionIndex !== index,
                                        ),
                                      });
                                    }}
                                    className="rounded p-1 text-white/30 transition-colors hover:bg-red-500/15 hover:text-red-200"
                                    title="Delete option"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => {
                                if (!structured.selectedField) return;
                                void structured.updateField(structured.selectedField.id, {
                                  options: [
                                    ...(structured.selectedField.options ?? []),
                                    `Option ${(structured.selectedField.options ?? []).length + 1}`,
                                  ],
                                });
                              }}
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
                            value={structured.selectedField?.description ?? ""}
                            onChange={(event) => {
                              if (!structured.selectedField) return;
                              void structured.updateField(structured.selectedField.id, {
                                description: event.target.value,
                              });
                            }}
                            rows={3}
                            className="w-full resize-none rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-white/72 outline-none"
                          />
                        </label>

                        <label className="flex items-center justify-between border-t border-white/10 pt-4">
                          <span className="text-sm text-white/55">Required</span>
                          <input
                            type="checkbox"
                            checked={!!structured.selectedField?.required}
                            onChange={(event) => {
                              if (!structured.selectedField) return;
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
                      </div>
                    ) : (
                      <div className="space-y-5 text-sm">
                        <label className="block">
                          <span className="mb-2 block text-xs text-white/38">Table name</span>
                          <input
                            value={structured.activeTable?.name ?? ""}
                            onChange={(event) => {
                              if (!structured.activeTable) return;
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
                              <div className="truncate text-white/60">
                                {structured.activeTable?.records.length ?? 0}
                              </div>
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
          <AppDock windows={windows} apps={apps} onRestore={onRestoreApp} onFocus={onFocusApp} />

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
                  if (deletingAppId) return;
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
