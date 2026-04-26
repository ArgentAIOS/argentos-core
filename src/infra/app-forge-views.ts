import type { AppForgeBase } from "./app-forge-model.js";

export const APP_FORGE_VIEW_MODES = ["grid", "kanban", "form", "review"] as const;
export const APP_FORGE_VIEW_SORT_DIRECTIONS = ["asc", "desc"] as const;

export type AppForgeViewMode = (typeof APP_FORGE_VIEW_MODES)[number];
export type AppForgeViewSortDirection = (typeof APP_FORGE_VIEW_SORT_DIRECTIONS)[number];

export type AppForgeNamedViewSettings = {
  filterText: string;
  sortFieldId: string;
  sortDirection: AppForgeViewSortDirection;
  groupFieldId: string;
};

export type AppForgeNamedView = {
  id: string;
  tableId: string;
  name: string;
  viewMode: AppForgeViewMode;
  settings: AppForgeNamedViewSettings;
  createdAt: string;
  updatedAt: string;
};

export type AppForgeNamedViewsState = {
  version: 1;
  activeViewIdByTable: Record<string, string>;
  items: AppForgeNamedView[];
};

type AppForgeNamedViewInput = {
  id?: unknown;
  tableId?: unknown;
  name?: unknown;
  viewMode?: unknown;
  settings?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  filterText?: unknown;
  sortFieldId?: unknown;
  sortDirection?: unknown;
  groupFieldId?: unknown;
};

type NamedViewsOptions = {
  tableIds?: Iterable<string>;
  now?: () => string;
};

const DEFAULT_NAMED_VIEW_SETTINGS: AppForgeNamedViewSettings = {
  filterText: "",
  sortFieldId: "",
  sortDirection: "asc",
  groupFieldId: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function viewModeValue(value: unknown): AppForgeViewMode {
  return APP_FORGE_VIEW_MODES.includes(value as AppForgeViewMode)
    ? (value as AppForgeViewMode)
    : "grid";
}

function sortDirectionValue(value: unknown): AppForgeViewSortDirection {
  return value === "desc" ? "desc" : "asc";
}

function tableIdSet(tableIds: Iterable<string> | undefined): Set<string> | null {
  if (!tableIds) {
    return null;
  }
  const values = new Set(
    Array.from(tableIds)
      .map((tableId) => tableId.trim())
      .filter((tableId) => tableId.length > 0),
  );
  return values.size > 0 ? values : null;
}

export function normalizeAppForgeNamedViewSettings(value: unknown): AppForgeNamedViewSettings {
  const source = isRecord(value) ? value : {};
  return {
    filterText: typeof source.filterText === "string" ? source.filterText : "",
    sortFieldId: typeof source.sortFieldId === "string" ? source.sortFieldId : "",
    sortDirection: sortDirectionValue(source.sortDirection),
    groupFieldId: typeof source.groupFieldId === "string" ? source.groupFieldId : "",
  };
}

function normalizeAppForgeNamedView(
  value: unknown,
  options: NamedViewsOptions = {},
): AppForgeNamedView | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const tableId = stringValue(value.tableId);
  const name = stringValue(value.name);
  const allowedTableIds = tableIdSet(options.tableIds);
  if (!id || !tableId || !name) {
    return null;
  }
  if (allowedTableIds && !allowedTableIds.has(tableId)) {
    return null;
  }
  const now = options.now ?? nowIso;
  const createdAt = stringValue(value.createdAt) ?? now();
  return {
    id,
    tableId,
    name,
    viewMode: viewModeValue(value.viewMode),
    settings: normalizeAppForgeNamedViewSettings(isRecord(value.settings) ? value.settings : value),
    createdAt,
    updatedAt: stringValue(value.updatedAt) ?? createdAt,
  };
}

export function normalizeAppForgeNamedViews(
  value: unknown,
  options: NamedViewsOptions = {},
): AppForgeNamedViewsState {
  const source = isRecord(value) ? value : {};
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(source.items)
      ? source.items
      : Array.isArray(source.views)
        ? source.views
        : [];
  const itemsById = new Map<string, AppForgeNamedView>();
  for (const candidate of rawItems) {
    const normalized = normalizeAppForgeNamedView(candidate, options);
    if (normalized) {
      itemsById.set(normalized.id, normalized);
    }
  }
  const items = Array.from(itemsById.values());
  const allowedTableIds = tableIdSet(options.tableIds);
  const activeViewIdByTableSource = isRecord(source.activeViewIdByTable)
    ? source.activeViewIdByTable
    : {};
  const activeViewIdByTable = Object.entries(activeViewIdByTableSource).reduce<
    Record<string, string>
  >((acc, [tableId, viewId]) => {
    if (typeof viewId !== "string") {
      return acc;
    }
    if (allowedTableIds && !allowedTableIds.has(tableId)) {
      return acc;
    }
    if (itemsById.get(viewId)?.tableId !== tableId) {
      return acc;
    }
    acc[tableId] = viewId;
    return acc;
  }, {});
  return {
    version: 1,
    activeViewIdByTable,
    items,
  };
}

export function serializeAppForgeNamedViews(
  state: AppForgeNamedViewsState,
): Record<string, unknown> {
  const normalized = normalizeAppForgeNamedViews(state);
  return {
    version: normalized.version,
    activeViewIdByTable: { ...normalized.activeViewIdByTable },
    items: normalized.items.map((view) => ({
      ...view,
      settings: { ...view.settings },
    })),
  };
}

export function projectAppForgeNamedViewsFromMetadata(
  metadata: unknown,
  base?: Pick<AppForgeBase, "tables">,
): AppForgeNamedViewsState {
  const root = isRecord(metadata) ? metadata : {};
  const appForge = isRecord(root.appForge) ? root.appForge : {};
  const structured = isRecord(appForge.structured) ? appForge.structured : {};
  return normalizeAppForgeNamedViews(structured.views, {
    tableIds: base?.tables.map((table) => table.id),
  });
}

export function mergeAppForgeNamedViewsIntoMetadata(
  metadata: unknown,
  state: AppForgeNamedViewsState,
): Record<string, unknown> {
  const root = isRecord(metadata) ? metadata : {};
  const appForge = isRecord(root.appForge) ? root.appForge : {};
  const structured = isRecord(appForge.structured) ? appForge.structured : {};
  return {
    ...root,
    appForge: {
      ...appForge,
      structured: {
        ...structured,
        views: serializeAppForgeNamedViews(state),
      },
    },
  };
}

export function putAppForgeNamedView(
  state: AppForgeNamedViewsState,
  value: AppForgeNamedViewInput,
  options: NamedViewsOptions = {},
): AppForgeNamedViewsState {
  const normalized = normalizeAppForgeNamedView(value, options);
  if (!normalized) {
    return normalizeAppForgeNamedViews(state, options);
  }
  const existing = state.items.find((item) => item.id === normalized.id);
  const nextItems = [
    ...state.items.filter((item) => item.id !== normalized.id),
    existing ? { ...normalized, createdAt: existing.createdAt } : normalized,
  ];
  return normalizeAppForgeNamedViews(
    {
      version: 1,
      activeViewIdByTable: state.activeViewIdByTable,
      items: nextItems,
    },
    options,
  );
}

export function deleteAppForgeNamedView(
  state: AppForgeNamedViewsState,
  viewId: string,
  options: NamedViewsOptions = {},
): AppForgeNamedViewsState {
  const activeViewIdByTable = Object.fromEntries(
    Object.entries(state.activeViewIdByTable).filter(([, activeViewId]) => activeViewId !== viewId),
  );
  return normalizeAppForgeNamedViews(
    {
      version: 1,
      activeViewIdByTable,
      items: state.items.filter((item) => item.id !== viewId),
    },
    options,
  );
}

export function setActiveAppForgeNamedView(
  state: AppForgeNamedViewsState,
  tableId: string,
  viewId: string | null,
  options: NamedViewsOptions = {},
): AppForgeNamedViewsState {
  const activeViewIdByTable = { ...state.activeViewIdByTable };
  if (!viewId) {
    delete activeViewIdByTable[tableId];
  } else {
    activeViewIdByTable[tableId] = viewId;
  }
  return normalizeAppForgeNamedViews(
    {
      version: 1,
      activeViewIdByTable,
      items: state.items,
    },
    options,
  );
}

export const appForgeNamedViewDefaults = {
  settings: DEFAULT_NAMED_VIEW_SETTINGS,
};
