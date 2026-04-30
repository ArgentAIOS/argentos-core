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
