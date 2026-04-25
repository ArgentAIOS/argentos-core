import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Search,
  Plus,
  Pin,
  Trash2,
  Boxes,
  ExternalLink,
  Send,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import type { AppForgeWorkflowEventRequest, ForgeApp } from "../hooks/useApps";
import type { AppWindowState } from "../hooks/useAppWindows";
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
  const searchRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const appCountAtBuild = useRef(0);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 200);
    } else {
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
    }
  }, [isOpen]);

  // Focus name input when form shown
  useEffect(() => {
    if (showNewAppInput) {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [showNewAppInput]);

  // Detect when a new app arrives while building
  useEffect(() => {
    if (building && apps.length > appCountAtBuild.current) {
      setBuilding(false);
      setShowNewAppInput(false);
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

  // Filter apps by search
  const filteredApps = searchQuery
    ? apps.filter(
        (app) =>
          app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          app.description?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : apps;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, appId: string) => {
      if (deleteMode) return;
      e.preventDefault();
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
          <div className="flex items-center justify-between px-8 py-5 shrink-0">
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <h1 className="text-xl font-light text-white/80 tracking-wide">App Forge</h1>

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
            </div>
          </div>

          {/* App Grid */}
          <div className="flex-1 overflow-auto px-8 pb-16">
            <AnimatePresence>
              {workflowEventStatus && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={`mx-auto mb-4 flex max-w-3xl items-center justify-between rounded-xl border px-4 py-3 text-sm ${
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

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 max-w-6xl mx-auto">
              {filteredApps.map((app, index) => (
                <motion.div
                  key={app.id}
                  layout
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={
                    deleteMode
                      ? {
                          scale: 1,
                          opacity: 1,
                          rotate: [-1.2, 1.2, -1.2],
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
                      : { duration: 0.2 }
                  }
                  className="group relative"
                  onContextMenu={(e) => handleContextMenu(e, app.id)}
                >
                  <div
                    role="button"
                    tabIndex={deleteMode ? -1 : 0}
                    onClick={() => {
                      if (deleteMode) return;
                      onOpenApp(app.id);
                    }}
                    onKeyDown={(e) => {
                      if (deleteMode) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenApp(app.id);
                      }
                    }}
                    className={`w-full flex flex-col items-center gap-3 rounded-xl p-4 transition-colors ${
                      deleteMode ? "cursor-default" : "cursor-pointer hover:bg-white/5"
                    }`}
                  >
                    {/* Icon */}
                    <div className="relative h-16 w-16">
                      <div className="h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition-colors group-hover:border-purple-500/30 flex items-center justify-center">
                        {app.icon ? (
                          <div
                            className="w-10 h-10"
                            dangerouslySetInnerHTML={{ __html: sanitizeSvg(app.icon) }}
                          />
                        ) : (
                          <div
                            className="w-full h-full rounded-2xl flex items-center justify-center"
                            style={{
                              backgroundColor: `hsl(${hashString(app.name) % 360}, 50%, 25%)`,
                            }}
                          >
                            <Boxes className="w-8 h-8 text-white/60" />
                          </div>
                        )}
                      </div>

                      {/* Pin indicator */}
                      {app.pinned && (
                        <Pin className="absolute top-1 right-1 w-3 h-3 text-purple-400" />
                      )}

                      <AnimatePresence>
                        {deleteMode && (
                          <motion.button
                            initial={{ scale: 0.7, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.7, opacity: 0 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              requestDeleteApp(app.id);
                            }}
                            className="absolute -top-1 -right-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-red-500 text-white shadow-lg transition-colors hover:bg-red-400"
                            title={`Delete ${app.name}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Name */}
                    <span className="text-sm text-white/70 text-center truncate w-full">
                      {app.name}
                    </span>
                  </div>
                </motion.div>
              ))}

              {/* New App tile */}
              <motion.div
                layout
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
              >
                <button
                  onClick={() => {
                    if (deleteMode) return;
                    setShowNewAppInput(true);
                  }}
                  className={`w-full flex flex-col items-center gap-3 p-4 rounded-xl transition-colors border border-dashed ${
                    deleteMode
                      ? "opacity-35 cursor-default border-white/10"
                      : "hover:bg-white/5 border-white/10 hover:border-purple-500/30"
                  }`}
                >
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-purple-500/10 border border-purple-500/20">
                    <Plus className="w-8 h-8 text-purple-400" />
                  </div>
                  <span className="text-sm text-white/50">New App</span>
                </button>
              </motion.div>
            </div>

            {/* New App Form */}
            <AnimatePresence>
              {(showNewAppInput || building) && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="max-w-lg mx-auto mt-8 px-4"
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

            {/* Empty state */}
            {filteredApps.length === 0 && searchQuery && (
              <div className="text-center py-16 text-white/30">
                <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No apps matching "{searchQuery}"</p>
              </div>
            )}

            {filteredApps.length === 0 && !searchQuery && !showNewAppInput && (
              <div className="text-center py-16 text-white/30">
                <Boxes className="w-12 h-12 mx-auto mb-4 opacity-30" />
                {deleteMode ? (
                  <>
                    <p className="text-lg mb-2">No apps left to delete</p>
                    <p className="text-sm">Click the trash can again to leave delete mode.</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg mb-2">No apps yet</p>
                    <p className="text-sm">Describe an app and the AI will build it for you.</p>
                    <button
                      onClick={() => setShowNewAppInput(true)}
                      className="mt-4 px-4 py-2 bg-purple-600/50 hover:bg-purple-600/70 rounded-lg text-sm text-white/80 transition-colors"
                    >
                      Build your first app
                    </button>
                  </>
                )}
              </div>
            )}
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
