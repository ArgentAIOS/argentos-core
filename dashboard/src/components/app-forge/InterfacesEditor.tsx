import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GatewayRequestFn } from "../../hooks/useForgeStructuredData";

/**
 * Phase 4 gap #5 — editable interfaces.
 *
 * Operators see read-mode by default (matches the truth-labeled placeholder
 * this component replaces). Toggling Edit reveals widget add/remove/reorder
 * controls. Every mutation goes through the gateway so state is durable
 * metadata and shared across operators — there is no localStorage path.
 */

export type AppForgeInterfaceSource = {
  tableId?: string;
  viewId?: string;
  recordId?: string;
  fieldIds?: string[];
};

export type AppForgeInterfacePage = {
  id: string;
  name: string;
  route: string;
  kind: "list" | "record" | "dashboard" | "form" | "review";
  source?: AppForgeInterfaceSource;
  layoutId: string;
  revision: number;
};

export type AppForgeInterfaceLayoutRegionWidget = {
  widgetId: string;
  order: number;
  span?: number;
};

export type AppForgeInterfaceLayoutRegion = {
  id: string;
  kind: "header" | "sidebar" | "main" | "footer";
  widgets: AppForgeInterfaceLayoutRegionWidget[];
};

export type AppForgeInterfaceLayout = {
  id: string;
  name: string;
  breakpoint: "desktop" | "tablet" | "mobile";
  regions: AppForgeInterfaceLayoutRegion[];
  revision: number;
};

export type AppForgeInterfaceWidgetKind =
  | "record_grid"
  | "record_board"
  | "record_form"
  | "record_detail"
  | "metric"
  | "activity"
  | "markdown"
  | "action";

export type AppForgeInterfaceWidget = {
  id: string;
  kind: AppForgeInterfaceWidgetKind;
  title?: string;
  source?: AppForgeInterfaceSource;
  config?: Record<string, unknown>;
  revision: number;
};

export type AppForgeInterfaceBundle = {
  version: 1;
  revision: number;
  defaultPageId?: string;
  pages: AppForgeInterfacePage[];
  layouts: AppForgeInterfaceLayout[];
  widgets: AppForgeInterfaceWidget[];
  updatedAt: string;
};

type AvailableTable = {
  id: string;
  name: string;
  fields: Array<{ id: string; name: string }>;
  recordCount: number;
};

export interface InterfacesEditorProps {
  baseId: string | null;
  baseName?: string;
  tables: AvailableTable[];
  gatewayRequest: GatewayRequestFn | undefined;
  /**
   * Called after every successful gateway mutation so the surrounding
   * dashboard can surface "Saved" / "Failed" copy in its status bar without
   * the component having to own its own toast layer.
   */
  onMutationStatus?: (status: "saved" | "saving" | "error", message?: string) => void;
}

const WIDGET_KIND_LABELS: Record<AppForgeInterfaceWidgetKind, string> = {
  record_grid: "Record list",
  record_board: "Kanban board",
  record_form: "Form (writes records)",
  record_detail: "Record detail",
  metric: "Metric",
  activity: "Activity feed",
  markdown: "Markdown block",
  action: "Action button",
};

const WIDGET_KIND_OPTIONS: AppForgeInterfaceWidgetKind[] = [
  "record_grid",
  "record_board",
  "record_form",
  "record_detail",
  "metric",
  "activity",
  "markdown",
  "action",
];

function randomId(prefix: string): string {
  // crypto.randomUUID is available in modern browsers, but the dashboard
  // tests can run under jsdom without crypto, so we fall back to Math.random.
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return `${prefix}-${cryptoRef.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function sortedWidgets(
  region: AppForgeInterfaceLayoutRegion,
): AppForgeInterfaceLayoutRegionWidget[] {
  return [...region.widgets].sort((a, b) => a.order - b.order);
}

export function InterfacesEditor(props: InterfacesEditorProps) {
  const { baseId, baseName, tables, gatewayRequest, onMutationStatus } = props;
  const [bundle, setBundle] = useState<AppForgeInterfaceBundle | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const lastBaseIdRef = useRef<string | null>(null);

  const reportStatus = useCallback(
    (status: "saved" | "saving" | "error", message?: string) => {
      onMutationStatus?.(status, message);
    },
    [onMutationStatus],
  );

  // ---- fetch bundle ------------------------------------------------------
  useEffect(() => {
    if (!baseId || !gatewayRequest) {
      setBundle(null);
      setActivePageId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    gatewayRequest<{ bundle: AppForgeInterfaceBundle }>("appforge.interfaces.get", { baseId })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const fetched = response?.bundle ?? null;
        setBundle(fetched);
        setActivePageId(fetched?.defaultPageId ?? fetched?.pages[0]?.id ?? null);
        lastBaseIdRef.current = baseId;
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load interface bundle");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseId, gatewayRequest]);

  // ---- helpers -----------------------------------------------------------
  const callGateway = useCallback(
    async <T extends { bundle?: AppForgeInterfaceBundle }>(
      method: string,
      params: Record<string, unknown>,
      actionLabel: string,
    ): Promise<T | null> => {
      if (!gatewayRequest || !baseId || !bundle) {
        return null;
      }
      setBusyAction(actionLabel);
      reportStatus("saving");
      try {
        const response = await gatewayRequest<T>(method, {
          ...params,
          baseId,
          expectedBundleRevision: bundle.revision,
        });
        if (response?.bundle) {
          setBundle(response.bundle);
          if (!response.bundle.pages.some((page) => page.id === activePageId)) {
            setActivePageId(response.bundle.defaultPageId ?? response.bundle.pages[0]?.id ?? null);
          }
        }
        reportStatus("saved");
        setError(null);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : `Failed to ${actionLabel}`;
        setError(message);
        reportStatus("error", message);
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [baseId, bundle, gatewayRequest, reportStatus, activePageId],
  );

  // ---- mutations ---------------------------------------------------------
  const addWidget = useCallback(
    async (kind: AppForgeInterfaceWidgetKind) => {
      if (!bundle) {
        return;
      }
      const page = bundle.pages.find((item) => item.id === activePageId) ?? bundle.pages[0];
      const layout = bundle.layouts.find((item) => item.id === page?.layoutId);
      const region = layout?.regions.find((item) => item.kind === "main") ?? layout?.regions[0];
      if (!page || !layout || !region) {
        return;
      }
      const widgetId = randomId(`widget-${kind.replace(/_/g, "-")}`);
      const firstTable = tables[0];
      const sourceTableId = page.source?.tableId ?? firstTable?.id;
      const widget: AppForgeInterfaceWidget = {
        id: widgetId,
        kind,
        title: WIDGET_KIND_LABELS[kind],
        source: sourceTableId ? { tableId: sourceTableId } : undefined,
        revision: 0,
      };
      const putResponse = await callGateway<{ bundle: AppForgeInterfaceBundle }>(
        "appforge.interfaces.widget.put",
        { widget },
        "add widget",
      );
      if (!putResponse?.bundle) {
        return;
      }
      const nextOrder = region.widgets.length;
      await callGateway<{ bundle: AppForgeInterfaceBundle }>(
        "appforge.interfaces.region.place",
        {
          layoutId: layout.id,
          regionId: region.id,
          entry: { widgetId, order: nextOrder, span: 12 },
        },
        "place widget",
      );
    },
    [activePageId, bundle, callGateway, tables],
  );

  const removeWidget = useCallback(
    async (widgetId: string) => {
      await callGateway<{ bundle: AppForgeInterfaceBundle }>(
        "appforge.interfaces.widget.delete",
        { widgetId },
        "remove widget",
      );
    },
    [callGateway],
  );

  const moveWidget = useCallback(
    async (regionId: string, layoutId: string, widgetIds: string[]) => {
      await callGateway<{ bundle: AppForgeInterfaceBundle }>(
        "appforge.interfaces.region.reorder",
        { layoutId, regionId, widgetIds },
        "reorder widgets",
      );
    },
    [callGateway],
  );

  const addPage = useCallback(async () => {
    if (!bundle) {
      return;
    }
    const baseLayout = bundle.layouts[0];
    if (!baseLayout) {
      return;
    }
    const pageId = randomId("page");
    const name = `New page ${bundle.pages.length + 1}`;
    await callGateway<{ bundle: AppForgeInterfaceBundle }>(
      "appforge.interfaces.page.put",
      {
        page: {
          id: pageId,
          name,
          route: `/${pageId}`,
          kind: "dashboard",
          layoutId: baseLayout.id,
        },
      },
      "add page",
    );
    setActivePageId(pageId);
  }, [bundle, callGateway]);

  const removePage = useCallback(
    async (pageId: string) => {
      if (!bundle) {
        return;
      }
      if (bundle.pages.length <= 1) {
        setError("Cannot delete the last remaining page.");
        return;
      }
      await callGateway<{ bundle: AppForgeInterfaceBundle }>(
        "appforge.interfaces.page.delete",
        { pageId },
        "remove page",
      );
    },
    [bundle, callGateway],
  );

  const bindWidgetToTable = useCallback(
    async (widget: AppForgeInterfaceWidget, tableId: string) => {
      await callGateway<{ bundle: AppForgeInterfaceBundle }>(
        "appforge.interfaces.widget.put",
        {
          widget: {
            ...widget,
            source: { tableId },
          },
        },
        "bind widget",
      );
    },
    [callGateway],
  );

  // ---- derived state -----------------------------------------------------
  const activePage = useMemo(
    () => bundle?.pages.find((page) => page.id === activePageId) ?? bundle?.pages[0] ?? null,
    [activePageId, bundle],
  );
  const activeLayout = useMemo(
    () => bundle?.layouts.find((layout) => layout.id === activePage?.layoutId) ?? null,
    [activePage?.layoutId, bundle],
  );
  const widgetsById = useMemo(() => {
    const map = new Map<string, AppForgeInterfaceWidget>();
    for (const widget of bundle?.widgets ?? []) {
      map.set(widget.id, widget);
    }
    return map;
  }, [bundle]);

  // ---- render ------------------------------------------------------------
  if (!baseId) {
    return (
      <div className="min-h-[420px] rounded-2xl border border-dashed border-white/16 bg-black/30 p-12 text-center text-sm text-white/55">
        Select a base to edit its interface.
      </div>
    );
  }

  if (!gatewayRequest) {
    return (
      <div className="min-h-[420px] rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/10 p-12 text-center text-sm text-amber-100/80">
        Gateway not connected — interface edits require a durable persistence path. Reconnect and
        retry.
      </div>
    );
  }

  return (
    <div className="min-h-[520px] overflow-hidden rounded-2xl border border-white/10 bg-black/24">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/30 px-6 py-4">
        <div>
          <div className="text-sm font-semibold text-white/85">
            {baseName ?? "Interface"} · {activePage?.name ?? "(no page)"}
          </div>
          <div className="text-xs text-white/40">
            Bundle revision {bundle?.revision ?? 0} · {bundle?.widgets.length ?? 0} widgets
          </div>
        </div>
        <div className="flex items-center gap-3">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-white/40" />}
          {busyAction && (
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/60">
              {busyAction}…
            </span>
          )}
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            data-testid="appforge-interfaces-edit-toggle"
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              editing
                ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
                : "border-white/15 bg-white/[0.04] text-white/72 hover:border-white/30 hover:bg-white/10"
            }`}
          >
            {editing ? (
              <>
                <Save className="h-3.5 w-3.5" /> Done editing
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5" /> Edit interface
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-rose-400/30 bg-rose-500/10 px-6 py-2 text-xs text-rose-100/85">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-0">
        <aside className="border-r border-white/10 bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-white/35">
            <span>Pages</span>
            {editing && (
              <button
                type="button"
                onClick={addPage}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/65 hover:bg-white/5"
                data-testid="appforge-interfaces-add-page"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {(bundle?.pages ?? []).map((page) => (
              <li key={page.id}>
                <button
                  type="button"
                  onClick={() => setActivePageId(page.id)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition ${
                    page.id === activePageId
                      ? "bg-sky-500/15 text-sky-100"
                      : "text-white/72 hover:bg-white/5"
                  }`}
                >
                  <span className="truncate">{page.name}</span>
                  {editing && bundle && bundle.pages.length > 1 && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void removePage(page.id);
                      }}
                      className="ml-2 rounded p-0.5 text-white/40 hover:bg-rose-500/20 hover:text-rose-200"
                      aria-label={`Delete page ${page.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="flex flex-col gap-4 p-6">
          {editing && (
            <WidgetPalette
              onAdd={(kind) => {
                void addWidget(kind);
              }}
            />
          )}

          {activeLayout?.regions.map((region) => {
            const entries = sortedWidgets(region);
            const entryIds = entries.map((entry) => entry.widgetId);
            return (
              <div
                key={region.id}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
                data-testid={`appforge-region-${region.id}`}
              >
                <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-white/35">
                  {region.kind} region
                </div>
                {entries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/12 px-4 py-6 text-center text-xs text-white/40">
                    No widgets here yet.
                    {editing && " Use the palette above to add one."}
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {entries.map((entry, index) => {
                      const widget = widgetsById.get(entry.widgetId);
                      if (!widget) {
                        return null;
                      }
                      return (
                        <WidgetCard
                          key={widget.id}
                          widget={widget}
                          editing={editing}
                          tables={tables}
                          canMoveUp={index > 0}
                          canMoveDown={index < entries.length - 1}
                          onMoveUp={() => {
                            const next = [...entryIds];
                            [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                            void moveWidget(region.id, activeLayout.id, next);
                          }}
                          onMoveDown={() => {
                            const next = [...entryIds];
                            [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                            void moveWidget(region.id, activeLayout.id, next);
                          }}
                          onRemove={() => {
                            void removeWidget(widget.id);
                          }}
                          onBindTable={(tableId) => {
                            void bindWidgetToTable(widget, tableId);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

interface WidgetPaletteProps {
  onAdd: (kind: AppForgeInterfaceWidgetKind) => void;
}

function WidgetPalette({ onAdd }: WidgetPaletteProps) {
  return (
    <div className="rounded-2xl border border-dashed border-sky-400/30 bg-sky-500/[0.06] p-4">
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-sky-100/65">
        Widget palette
      </div>
      <div className="flex flex-wrap gap-2">
        {WIDGET_KIND_OPTIONS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onAdd(kind)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-black/30 px-3 py-1.5 text-xs text-white/82 hover:border-sky-300/40 hover:bg-sky-500/15"
            data-testid={`appforge-interfaces-add-${kind}`}
          >
            <Plus className="h-3 w-3" /> {WIDGET_KIND_LABELS[kind]}
          </button>
        ))}
      </div>
    </div>
  );
}

interface WidgetCardProps {
  widget: AppForgeInterfaceWidget;
  editing: boolean;
  tables: AvailableTable[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onBindTable: (tableId: string) => void;
}

function WidgetCard({
  widget,
  editing,
  tables,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  onBindTable,
}: WidgetCardProps) {
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-white/12 bg-black/35 p-4 text-sm"
      data-testid={`appforge-widget-${widget.id}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-white/40">
            {WIDGET_KIND_LABELS[widget.kind]}
          </div>
          <div className="mt-1 text-sm font-semibold text-white/85">
            {widget.title ?? widget.id}
          </div>
          <div className="text-xs text-white/40">
            {widget.source?.tableId
              ? `Bound to ${tables.find((table) => table.id === widget.source?.tableId)?.name ?? widget.source.tableId}`
              : "No data binding"}
          </div>
        </div>
        {editing && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="rounded p-1 text-white/50 hover:bg-white/10 disabled:opacity-30"
              aria-label={`Move widget ${widget.id} up`}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="rounded p-1 text-white/50 hover:bg-white/10 disabled:opacity-30"
              aria-label={`Move widget ${widget.id} down`}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="rounded p-1 text-rose-200 hover:bg-rose-500/15"
              aria-label={`Delete widget ${widget.id}`}
              data-testid={`appforge-widget-${widget.id}-remove`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {editing && tables.length > 0 && (
        <label className="text-xs text-white/55">
          <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-white/35">
            Data binding
          </span>
          <select
            value={widget.source?.tableId ?? ""}
            onChange={(event) => onBindTable(event.target.value)}
            data-testid={`appforge-widget-${widget.id}-bind-table`}
            className="h-8 w-full rounded-md border border-white/15 bg-black/40 px-2 text-xs text-white/85 focus:border-sky-300/60"
          >
            <option value="">No binding</option>
            {tables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {widget.kind === "record_form" && widget.source?.tableId && (
        <div className="rounded-md border border-dashed border-white/12 bg-black/30 px-3 py-2 text-[11px] text-white/45">
          Submissions create real records in{" "}
          {tables.find((table) => table.id === widget.source?.tableId)?.name ??
            widget.source.tableId}
          .
        </div>
      )}
    </div>
  );
}
