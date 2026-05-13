import type { AppForgeBase } from "./app-forge-model.js";

export const APP_FORGE_INTERFACE_PAGE_KINDS = [
  "list",
  "record",
  "dashboard",
  "form",
  "review",
] as const;
export const APP_FORGE_INTERFACE_BREAKPOINTS = ["desktop", "tablet", "mobile"] as const;
export const APP_FORGE_INTERFACE_REGION_KINDS = ["header", "sidebar", "main", "footer"] as const;
export const APP_FORGE_INTERFACE_WIDGET_KINDS = [
  "record_grid",
  "record_board",
  "record_form",
  "record_detail",
  "metric",
  "activity",
  "markdown",
  "action",
] as const;

export type AppForgeInterfacePageKind = (typeof APP_FORGE_INTERFACE_PAGE_KINDS)[number];
export type AppForgeInterfaceBreakpoint = (typeof APP_FORGE_INTERFACE_BREAKPOINTS)[number];
export type AppForgeInterfaceRegionKind = (typeof APP_FORGE_INTERFACE_REGION_KINDS)[number];
export type AppForgeInterfaceWidgetKind = (typeof APP_FORGE_INTERFACE_WIDGET_KINDS)[number];

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
  kind: AppForgeInterfacePageKind;
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
  kind: AppForgeInterfaceRegionKind;
  widgets: AppForgeInterfaceLayoutRegionWidget[];
};

export type AppForgeInterfaceLayout = {
  id: string;
  name: string;
  breakpoint: AppForgeInterfaceBreakpoint;
  regions: AppForgeInterfaceLayoutRegion[];
  revision: number;
};

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
  /**
   * Bundle-level revision. Incremented on every CRUD mutation through the
   * gateway so optimistic concurrency control works the same way as it does
   * for {@link AppForgeBase} / {@link AppForgeTable}. Operators racing to
   * edit the same interface get a conflict, not silently clobbered state.
   */
  revision: number;
  defaultPageId?: string;
  pages: AppForgeInterfacePage[];
  layouts: AppForgeInterfaceLayout[];
  widgets: AppForgeInterfaceWidget[];
  updatedAt: string;
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

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function nowIso(): string {
  return new Date().toISOString();
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanRoute(value: string): string {
  const cleaned = slug(value);
  return cleaned ? `/${cleaned}` : "/";
}

function oneOf<T extends readonly string[]>(
  values: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  return values.includes(value as T[number]) ? (value as T[number]) : fallback;
}

function fieldIdsForBase(base: Pick<AppForgeBase, "tables">): Map<string, Set<string>> {
  return new Map(
    base.tables.map((table) => [table.id, new Set(table.fields.map((field) => field.id))]),
  );
}

function normalizeSource(
  value: unknown,
  base?: Pick<AppForgeBase, "tables">,
): AppForgeInterfaceSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const tableId = stringValue(value.tableId);
  const tableExists = !tableId || !base || base.tables.some((table) => table.id === tableId);
  if (!tableExists) {
    return undefined;
  }
  const tableFields = tableId && base ? fieldIdsForBase(base).get(tableId) : undefined;
  const fieldIds = stringArrayValue(value.fieldIds)?.filter(
    (fieldId) => !tableFields || tableFields.has(fieldId),
  );
  const source: AppForgeInterfaceSource = {};
  if (tableId) {
    source.tableId = tableId;
  }
  const viewId = stringValue(value.viewId);
  if (viewId) {
    source.viewId = viewId;
  }
  const recordId = stringValue(value.recordId);
  if (recordId) {
    source.recordId = recordId;
  }
  if (fieldIds?.length) {
    source.fieldIds = fieldIds;
  }
  return Object.keys(source).length > 0 ? source : undefined;
}

function normalizeWidget(
  value: unknown,
  base?: Pick<AppForgeBase, "tables">,
): AppForgeInterfaceWidget | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  if (!id) {
    return null;
  }
  return {
    id,
    kind: oneOf(APP_FORGE_INTERFACE_WIDGET_KINDS, value.kind, "record_grid"),
    title: stringValue(value.title),
    source: normalizeSource(value.source, base),
    config: isRecord(value.config) ? { ...value.config } : undefined,
    revision: numberValue(value.revision) ?? 1,
  };
}

function normalizeRegionWidget(value: unknown, widgetIds: Set<string>) {
  if (!isRecord(value)) {
    return null;
  }
  const widgetId = stringValue(value.widgetId);
  if (!widgetId || !widgetIds.has(widgetId)) {
    return null;
  }
  const order = numberValue(value.order) ?? 0;
  const span = numberValue(value.span);
  return span ? { widgetId, order, span } : { widgetId, order };
}

function normalizeLayout(value: unknown, widgetIds: Set<string>): AppForgeInterfaceLayout | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) {
    return null;
  }
  const regions = Array.isArray(value.regions)
    ? value.regions
        .map((region): AppForgeInterfaceLayoutRegion | null => {
          if (!isRecord(region)) {
            return null;
          }
          const regionId = stringValue(region.id);
          if (!regionId) {
            return null;
          }
          const widgets = Array.isArray(region.widgets)
            ? region.widgets
                .map((widget) => normalizeRegionWidget(widget, widgetIds))
                .filter((widget): widget is AppForgeInterfaceLayoutRegionWidget => Boolean(widget))
            : [];
          return {
            id: regionId,
            kind: oneOf(APP_FORGE_INTERFACE_REGION_KINDS, region.kind, "main"),
            widgets,
          };
        })
        .filter((region): region is AppForgeInterfaceLayoutRegion => Boolean(region))
    : [];
  return {
    id,
    name,
    breakpoint: oneOf(APP_FORGE_INTERFACE_BREAKPOINTS, value.breakpoint, "desktop"),
    regions,
    revision: numberValue(value.revision) ?? 1,
  };
}

function normalizePage(
  value: unknown,
  layoutIds: Set<string>,
  base?: Pick<AppForgeBase, "tables">,
): AppForgeInterfacePage | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const layoutId = stringValue(value.layoutId);
  if (!id || !name || !layoutId || !layoutIds.has(layoutId)) {
    return null;
  }
  return {
    id,
    name,
    route: stringValue(value.route) ?? cleanRoute(name),
    kind: oneOf(APP_FORGE_INTERFACE_PAGE_KINDS, value.kind, "list"),
    source: normalizeSource(value.source, base),
    layoutId,
    revision: numberValue(value.revision) ?? 1,
  };
}

export function defaultAppForgeInterfaceBundle(
  base: Pick<AppForgeBase, "activeTableId" | "tables" | "updatedAt">,
): AppForgeInterfaceBundle {
  const table = base.tables.find((item) => item.id === base.activeTableId) ?? base.tables[0];
  const tableId = table?.id;
  const widgetId = tableId ? `widget-${tableId}-grid` : "widget-record-grid";
  const layoutId = "layout-main";
  const pageId = "page-main";
  return {
    version: 1,
    revision: 1,
    defaultPageId: pageId,
    pages: [
      {
        id: pageId,
        name: table ? `${table.name} Review` : "Records",
        route: "/",
        kind: "list",
        source: tableId ? { tableId, fieldIds: table.fields.map((field) => field.id) } : undefined,
        layoutId,
        revision: 1,
      },
    ],
    layouts: [
      {
        id: layoutId,
        name: "Main",
        breakpoint: "desktop",
        regions: [{ id: "main", kind: "main", widgets: [{ widgetId, order: 0, span: 12 }] }],
        revision: 1,
      },
    ],
    widgets: [
      {
        id: widgetId,
        kind: "record_grid",
        title: table?.name ?? "Records",
        source: tableId ? { tableId, fieldIds: table.fields.map((field) => field.id) } : undefined,
        revision: 1,
      },
    ],
    updatedAt: base.updatedAt,
  };
}

export function normalizeAppForgeInterfaceBundle(
  value: unknown,
  base?: Pick<AppForgeBase, "activeTableId" | "tables" | "updatedAt">,
): AppForgeInterfaceBundle {
  const source = isRecord(value) ? value : {};
  const widgets = Array.isArray(source.widgets)
    ? source.widgets
        .map((widget) => normalizeWidget(widget, base))
        .filter((widget): widget is AppForgeInterfaceWidget => Boolean(widget))
    : [];
  const widgetIds = new Set(widgets.map((widget) => widget.id));
  const layouts = Array.isArray(source.layouts)
    ? source.layouts
        .map((layout) => normalizeLayout(layout, widgetIds))
        .filter((layout): layout is AppForgeInterfaceLayout => Boolean(layout))
    : [];
  const layoutIds = new Set(layouts.map((layout) => layout.id));
  const pages = Array.isArray(source.pages)
    ? source.pages
        .map((page) => normalizePage(page, layoutIds, base))
        .filter((page): page is AppForgeInterfacePage => Boolean(page))
    : [];

  if (base && (widgets.length === 0 || layouts.length === 0 || pages.length === 0)) {
    return defaultAppForgeInterfaceBundle(base);
  }

  const defaultPageId = stringValue(source.defaultPageId);
  return {
    version: 1,
    revision: numberValue(source.revision) ?? 1,
    defaultPageId:
      defaultPageId && pages.some((page) => page.id === defaultPageId)
        ? defaultPageId
        : pages[0]?.id,
    pages,
    layouts,
    widgets,
    updatedAt: stringValue(source.updatedAt) ?? base?.updatedAt ?? nowIso(),
  };
}

export function projectAppForgeInterfaceBundleFromMetadata(
  metadata: unknown,
  base?: Pick<AppForgeBase, "activeTableId" | "tables" | "updatedAt">,
): AppForgeInterfaceBundle {
  const root = isRecord(metadata) ? metadata : {};
  const appForge = isRecord(root.appForge) ? root.appForge : {};
  return normalizeAppForgeInterfaceBundle(appForge.interfaces, base);
}

export function mergeAppForgeInterfaceBundleIntoMetadata(
  metadata: unknown,
  bundle: AppForgeInterfaceBundle,
): Record<string, unknown> {
  const root = isRecord(metadata) ? metadata : {};
  const appForge = isRecord(root.appForge) ? root.appForge : {};
  return {
    ...root,
    appForge: {
      ...appForge,
      interfaces: normalizeAppForgeInterfaceBundle(bundle),
    },
  };
}

// ---------------------------------------------------------------------------
// CRUD helpers for editable interfaces (Phase 4 gap #5). Each helper returns
// a new bundle with the bundle-level `revision` and `updatedAt` advanced so
// the gateway's OCC check can short-circuit clobbered state. Helpers do NOT
// mutate the input bundle.
// ---------------------------------------------------------------------------

function cloneBundle(bundle: AppForgeInterfaceBundle): AppForgeInterfaceBundle {
  return {
    version: 1,
    revision: bundle.revision,
    defaultPageId: bundle.defaultPageId,
    pages: bundle.pages.map((page) => ({
      ...page,
      source: page.source ? { ...page.source, fieldIds: page.source.fieldIds?.slice() } : undefined,
    })),
    layouts: bundle.layouts.map((layout) => ({
      ...layout,
      regions: layout.regions.map((region) => ({
        ...region,
        widgets: region.widgets.map((widget) => ({ ...widget })),
      })),
    })),
    widgets: bundle.widgets.map((widget) => ({
      ...widget,
      source: widget.source
        ? { ...widget.source, fieldIds: widget.source.fieldIds?.slice() }
        : undefined,
      config: widget.config ? { ...widget.config } : undefined,
    })),
    updatedAt: bundle.updatedAt,
  };
}

function bumpBundle(
  bundle: AppForgeInterfaceBundle,
  mutate: (next: AppForgeInterfaceBundle) => void,
  options: { now?: () => string } = {},
): AppForgeInterfaceBundle {
  const now = options.now ?? nowIso;
  const next = cloneBundle(bundle);
  mutate(next);
  next.revision = bundle.revision + 1;
  next.updatedAt = now();
  return next;
}

export type AppForgeInterfaceBundleOptions = {
  now?: () => string;
};

/**
 * Insert or update a page in the bundle. The layout referenced by the page
 * must already exist; otherwise the bundle is returned unchanged so dangling
 * page→layout references can never be persisted.
 */
export function putAppForgeInterfacePage(
  bundle: AppForgeInterfaceBundle,
  page: AppForgeInterfacePage,
  options: AppForgeInterfaceBundleOptions = {},
): AppForgeInterfaceBundle {
  if (!bundle.layouts.some((layout) => layout.id === page.layoutId)) {
    return bundle;
  }
  return bumpBundle(
    bundle,
    (next) => {
      const existing = next.pages.find((item) => item.id === page.id);
      const nextRevision = (existing?.revision ?? 0) + 1;
      const merged: AppForgeInterfacePage = { ...page, revision: nextRevision };
      next.pages = existing
        ? next.pages.map((item) => (item.id === page.id ? merged : item))
        : [...next.pages, merged];
      if (!next.defaultPageId || !next.pages.some((item) => item.id === next.defaultPageId)) {
        next.defaultPageId = next.pages[0]?.id;
      }
    },
    options,
  );
}

/**
 * Remove a page. If the page was the default, the next page (if any) becomes
 * the default. Layouts and widgets are NOT cascade-deleted — operators can
 * re-use them on other pages — but {@link deleteAppForgeInterfaceLayout}
 * will refuse to remove a layout that is still in use.
 */
export function deleteAppForgeInterfacePage(
  bundle: AppForgeInterfaceBundle,
  pageId: string,
  options: AppForgeInterfaceBundleOptions = {},
): AppForgeInterfaceBundle {
  if (!bundle.pages.some((page) => page.id === pageId)) {
    return bundle;
  }
  return bumpBundle(
    bundle,
    (next) => {
      next.pages = next.pages.filter((page) => page.id !== pageId);
      if (next.defaultPageId === pageId) {
        next.defaultPageId = next.pages[0]?.id;
      }
    },
    options,
  );
}

export function putAppForgeInterfaceLayout(
  bundle: AppForgeInterfaceBundle,
  layout: AppForgeInterfaceLayout,
  options: AppForgeInterfaceBundleOptions = {},
): AppForgeInterfaceBundle {
  // Drop any region-widget references that point at widgets the bundle does
  // not contain; that protects the dashboard from saving a dangling region.
  const widgetIds = new Set(bundle.widgets.map((widget) => widget.id));
  const sanitizedLayout: AppForgeInterfaceLayout = {
    ...layout,
    regions: layout.regions.map((region) => ({
      ...region,
      widgets: region.widgets.filter((entry) => widgetIds.has(entry.widgetId)),
    })),
  };
  return bumpBundle(
    bundle,
    (next) => {
      const existing = next.layouts.find((item) => item.id === layout.id);
      const nextRevision = (existing?.revision ?? 0) + 1;
      const merged: AppForgeInterfaceLayout = { ...sanitizedLayout, revision: nextRevision };
      next.layouts = existing
        ? next.layouts.map((item) => (item.id === layout.id ? merged : item))
        : [...next.layouts, merged];
    },
    options,
  );
}

/**
 * Refuse to remove a layout while any page still references it — that would
 * leave pages pointing at a missing layout and the normalizer would silently
 * drop them on next read. The caller is expected to delete or reassign the
 * pages first.
 */
export function deleteAppForgeInterfaceLayout(
  bundle: AppForgeInterfaceBundle,
  layoutId: string,
  options: AppForgeInterfaceBundleOptions = {},
): AppForgeInterfaceBundle {
  if (!bundle.layouts.some((layout) => layout.id === layoutId)) {
    return bundle;
  }
  if (bundle.pages.some((page) => page.layoutId === layoutId)) {
    return bundle;
  }
  return bumpBundle(
    bundle,
    (next) => {
      next.layouts = next.layouts.filter((layout) => layout.id !== layoutId);
    },
    options,
  );
}

export function putAppForgeInterfaceWidget(
  bundle: AppForgeInterfaceBundle,
  widget: AppForgeInterfaceWidget,
  options: AppForgeInterfaceBundleOptions = {},
): AppForgeInterfaceBundle {
  return bumpBundle(
    bundle,
    (next) => {
      const existing = next.widgets.find((item) => item.id === widget.id);
      const nextRevision = (existing?.revision ?? 0) + 1;
      const merged: AppForgeInterfaceWidget = { ...widget, revision: nextRevision };
      next.widgets = existing
        ? next.widgets.map((item) => (item.id === widget.id ? merged : item))
        : [...next.widgets, merged];
    },
    options,
  );
}

/**
 * Remove a widget. The widget is also pulled out of every region that
 * referenced it — leaving stale `widgetId`s in region-widget arrays would
 * otherwise render as silent gaps in the editor.
 */
export function deleteAppForgeInterfaceWidget(
  bundle: AppForgeInterfaceBundle,
  widgetId: string,
  options: AppForgeInterfaceBundleOptions = {},
): AppForgeInterfaceBundle {
  if (!bundle.widgets.some((widget) => widget.id === widgetId)) {
    return bundle;
  }
  return bumpBundle(
    bundle,
    (next) => {
      next.widgets = next.widgets.filter((widget) => widget.id !== widgetId);
      next.layouts = next.layouts.map((layout) => ({
        ...layout,
        regions: layout.regions.map((region) => ({
          ...region,
          widgets: region.widgets.filter((entry) => entry.widgetId !== widgetId),
        })),
      }));
    },
    options,
  );
}

/**
 * Place (or move) a widget into a region. Idempotent — if the widget is
 * already in the region, the order/span are updated rather than duplicated.
 */
export function addAppForgeInterfaceWidgetToRegion(
  bundle: AppForgeInterfaceBundle,
  layoutId: string,
  regionId: string,
  entry: AppForgeInterfaceLayoutRegionWidget,
  options: AppForgeInterfaceBundleOptions = {},
): AppForgeInterfaceBundle {
  if (!bundle.widgets.some((widget) => widget.id === entry.widgetId)) {
    return bundle;
  }
  const layout = bundle.layouts.find((item) => item.id === layoutId);
  if (!layout) {
    return bundle;
  }
  const region = layout.regions.find((item) => item.id === regionId);
  if (!region) {
    return bundle;
  }
  return bumpBundle(
    bundle,
    (next) => {
      next.layouts = next.layouts.map((existingLayout) => {
        if (existingLayout.id !== layoutId) {
          return existingLayout;
        }
        return {
          ...existingLayout,
          regions: existingLayout.regions.map((existingRegion) => {
            if (existingRegion.id !== regionId) {
              return existingRegion;
            }
            const existingEntry = existingRegion.widgets.find(
              (item) => item.widgetId === entry.widgetId,
            );
            const nextEntry: AppForgeInterfaceLayoutRegionWidget = {
              widgetId: entry.widgetId,
              order: entry.order,
              span: entry.span ?? existingEntry?.span,
            };
            const widgets = existingEntry
              ? existingRegion.widgets.map((item) =>
                  item.widgetId === entry.widgetId ? nextEntry : item,
                )
              : [...existingRegion.widgets, nextEntry];
            return { ...existingRegion, widgets };
          }),
        };
      });
    },
    options,
  );
}

export function removeAppForgeInterfaceWidgetFromRegion(
  bundle: AppForgeInterfaceBundle,
  layoutId: string,
  regionId: string,
  widgetId: string,
  options: AppForgeInterfaceBundleOptions = {},
): AppForgeInterfaceBundle {
  const layout = bundle.layouts.find((item) => item.id === layoutId);
  if (!layout) {
    return bundle;
  }
  const region = layout.regions.find((item) => item.id === regionId);
  if (!region || !region.widgets.some((entry) => entry.widgetId === widgetId)) {
    return bundle;
  }
  return bumpBundle(
    bundle,
    (next) => {
      next.layouts = next.layouts.map((existingLayout) => {
        if (existingLayout.id !== layoutId) {
          return existingLayout;
        }
        return {
          ...existingLayout,
          regions: existingLayout.regions.map((existingRegion) => {
            if (existingRegion.id !== regionId) {
              return existingRegion;
            }
            return {
              ...existingRegion,
              widgets: existingRegion.widgets.filter((entry) => entry.widgetId !== widgetId),
            };
          }),
        };
      });
    },
    options,
  );
}

/**
 * Set the explicit widget order in a region. Widgets not in `widgetIds` are
 * preserved in their existing relative order but pushed after the ordered
 * set — that way an operator dragging A,C in front of B doesn't accidentally
 * drop B from the region.
 */
export function reorderAppForgeInterfaceRegionWidgets(
  bundle: AppForgeInterfaceBundle,
  layoutId: string,
  regionId: string,
  widgetIds: string[],
  options: AppForgeInterfaceBundleOptions = {},
): AppForgeInterfaceBundle {
  const layout = bundle.layouts.find((item) => item.id === layoutId);
  if (!layout) {
    return bundle;
  }
  const region = layout.regions.find((item) => item.id === regionId);
  if (!region) {
    return bundle;
  }
  const ordered = widgetIds
    .map((id) => region.widgets.find((entry) => entry.widgetId === id))
    .filter((entry): entry is AppForgeInterfaceLayoutRegionWidget => Boolean(entry));
  const remaining = region.widgets.filter((entry) => !widgetIds.includes(entry.widgetId));
  if (ordered.length === 0 && remaining.length === region.widgets.length) {
    return bundle;
  }
  return bumpBundle(
    bundle,
    (next) => {
      next.layouts = next.layouts.map((existingLayout) => {
        if (existingLayout.id !== layoutId) {
          return existingLayout;
        }
        return {
          ...existingLayout,
          regions: existingLayout.regions.map((existingRegion) => {
            if (existingRegion.id !== regionId) {
              return existingRegion;
            }
            const combined = [...ordered, ...remaining].map((entry, index) => ({
              ...entry,
              order: index,
            }));
            return { ...existingRegion, widgets: combined };
          }),
        };
      });
    },
    options,
  );
}

/**
 * True when a candidate widget configuration is internally consistent
 * relative to a base — used by the gateway and the dashboard before
 * persisting an upsert. Returns null when valid; otherwise returns a
 * human-readable explanation pointing at the first invalid field.
 */
export function validateAppForgeInterfaceWidgetForBase(
  widget: AppForgeInterfaceWidget,
  base: Pick<AppForgeBase, "tables">,
): string | null {
  if (!widget.id || !widget.id.trim()) {
    return "widget id is required";
  }
  if (!APP_FORGE_INTERFACE_WIDGET_KINDS.includes(widget.kind)) {
    return `unknown widget kind: ${String(widget.kind)}`;
  }
  if (widget.source?.tableId) {
    const table = base.tables.find((item) => item.id === widget.source?.tableId);
    if (!table) {
      return `widget references unknown tableId: ${widget.source.tableId}`;
    }
    if (widget.source.fieldIds?.length) {
      const fieldIds = new Set(table.fields.map((field) => field.id));
      const unknown = widget.source.fieldIds.find((fieldId) => !fieldIds.has(fieldId));
      if (unknown) {
        return `widget references unknown fieldId on ${table.id}: ${unknown}`;
      }
    }
  }
  return null;
}
