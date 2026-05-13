import { describe, expect, it } from "vitest";
import type { AppForgeBase } from "./app-forge-model.js";
import {
  addAppForgeInterfaceWidgetToRegion,
  defaultAppForgeInterfaceBundle,
  deleteAppForgeInterfaceLayout,
  deleteAppForgeInterfacePage,
  deleteAppForgeInterfaceWidget,
  mergeAppForgeInterfaceBundleIntoMetadata,
  normalizeAppForgeInterfaceBundle,
  projectAppForgeInterfaceBundleFromMetadata,
  putAppForgeInterfaceLayout,
  putAppForgeInterfacePage,
  putAppForgeInterfaceWidget,
  removeAppForgeInterfaceWidgetFromRegion,
  reorderAppForgeInterfaceRegionWidgets,
  validateAppForgeInterfaceWidgetForBase,
  type AppForgeInterfaceBundle,
} from "./app-forge-interfaces.js";

function base(overrides: Partial<AppForgeBase> = {}): AppForgeBase {
  return {
    id: "base-1",
    appId: "app-1",
    name: "Campaign Review",
    activeTableId: "table-review",
    revision: 1,
    updatedAt: "2026-04-26T20:00:00.000Z",
    tables: [
      {
        id: "table-review",
        name: "Reviews",
        revision: 1,
        fields: [
          { id: "title", name: "Title", type: "text" },
          { id: "status", name: "Status", type: "single_select" },
        ],
        records: [],
      },
    ],
    ...overrides,
  };
}

describe("AppForge interface metadata", () => {
  it("builds a default interface bundle from the active table", () => {
    const bundle = defaultAppForgeInterfaceBundle(base());

    expect(bundle).toMatchObject({
      version: 1,
      revision: 1,
      defaultPageId: "page-main",
      pages: [
        {
          id: "page-main",
          name: "Reviews Review",
          source: { tableId: "table-review", fieldIds: ["title", "status"] },
        },
      ],
      widgets: [
        {
          id: "widget-table-review-grid",
          kind: "record_grid",
          source: { tableId: "table-review", fieldIds: ["title", "status"] },
        },
      ],
    });
  });

  it("normalizes interface bundles and prunes dangling references", () => {
    const bundle = normalizeAppForgeInterfaceBundle(
      {
        version: 1,
        defaultPageId: "page-review",
        pages: [
          {
            id: "page-review",
            name: "Review Queue",
            route: "/review",
            kind: "review",
            source: { tableId: "table-review", fieldIds: ["title", "missing"] },
            layoutId: "layout-review",
            revision: 2,
          },
          {
            id: "page-orphan",
            name: "Orphan",
            layoutId: "missing-layout",
          },
        ],
        layouts: [
          {
            id: "layout-review",
            name: "Review Layout",
            breakpoint: "desktop",
            regions: [
              {
                id: "main",
                kind: "main",
                widgets: [
                  { widgetId: "widget-review", order: 0, span: 8 },
                  { widgetId: "missing-widget", order: 1 },
                ],
              },
            ],
            revision: 3,
          },
        ],
        widgets: [
          {
            id: "widget-review",
            kind: "record_detail",
            title: "Review",
            source: { tableId: "table-review", fieldIds: ["status", "missing"] },
            revision: 4,
          },
          {
            id: "widget-bad-source",
            kind: "record_grid",
            source: { tableId: "missing-table", fieldIds: ["title"] },
          },
        ],
        updatedAt: "2026-04-26T21:00:00.000Z",
      },
      base(),
    );

    expect(bundle.defaultPageId).toBe("page-review");
    expect(bundle.pages).toHaveLength(1);
    expect(bundle.pages[0]).toMatchObject({
      id: "page-review",
      kind: "review",
      source: { tableId: "table-review", fieldIds: ["title"] },
    });
    expect(bundle.layouts[0]?.regions[0]?.widgets).toEqual([
      { widgetId: "widget-review", order: 0, span: 8 },
    ]);
    expect(bundle.widgets[0]?.source).toEqual({
      tableId: "table-review",
      fieldIds: ["status"],
    });
    expect(bundle.widgets[1]?.source).toBeUndefined();
  });

  it("round-trips interface metadata without clobbering other AppForge metadata", () => {
    const metadata = mergeAppForgeInterfaceBundleIntoMetadata(
      {
        workflowCapabilities: [{ id: "review", label: "Review" }],
        appForge: {
          structured: { baseId: "base-1" },
          workflowCapabilities: [{ id: "local-review", label: "Local Review" }],
        },
      },
      defaultAppForgeInterfaceBundle(base()),
    );

    expect(metadata).toMatchObject({
      workflowCapabilities: [{ id: "review", label: "Review" }],
      appForge: {
        structured: { baseId: "base-1" },
        workflowCapabilities: [{ id: "local-review", label: "Local Review" }],
        interfaces: {
          version: 1,
          defaultPageId: "page-main",
          pages: [{ id: "page-main" }],
        },
      },
    });

    expect(projectAppForgeInterfaceBundleFromMetadata(metadata, base()).pages[0]?.id).toBe(
      "page-main",
    );
  });
});

describe("AppForge interface CRUD (Phase 4 gap #5)", () => {
  function bundle(): AppForgeInterfaceBundle {
    return defaultAppForgeInterfaceBundle(base());
  }

  const now = () => "2026-05-13T00:00:00.000Z";

  it("adds a new page only when the referenced layout exists", () => {
    const start = bundle();
    const accepted = putAppForgeInterfacePage(
      start,
      {
        id: "page-dashboard",
        name: "Dashboard",
        route: "/dashboard",
        kind: "dashboard",
        layoutId: "layout-main",
        revision: 0,
      },
      { now },
    );
    expect(accepted.pages).toHaveLength(2);
    expect(accepted.revision).toBe(start.revision + 1);
    expect(accepted.pages[1]?.revision).toBe(1);

    const rejected = putAppForgeInterfacePage(
      start,
      {
        id: "page-orphan",
        name: "Orphan",
        route: "/orphan",
        kind: "list",
        layoutId: "missing-layout",
        revision: 0,
      },
      { now },
    );
    expect(rejected).toBe(start);
  });

  it("removes a page and reselects the default", () => {
    const start = bundle();
    const withExtra = putAppForgeInterfacePage(
      start,
      {
        id: "page-extra",
        name: "Extra",
        route: "/extra",
        kind: "list",
        layoutId: "layout-main",
        revision: 0,
      },
      { now },
    );
    const removed = deleteAppForgeInterfacePage(withExtra, "page-main", { now });
    expect(removed.pages.map((page) => page.id)).toEqual(["page-extra"]);
    expect(removed.defaultPageId).toBe("page-extra");
    expect(removed.revision).toBe(withExtra.revision + 1);

    const noop = deleteAppForgeInterfacePage(removed, "missing", { now });
    expect(noop).toBe(removed);
  });

  it("upserts a layout but drops region-widget refs that point at missing widgets", () => {
    const start = bundle();
    const updated = putAppForgeInterfaceLayout(
      start,
      {
        id: "layout-main",
        name: "Main",
        breakpoint: "desktop",
        regions: [
          {
            id: "main",
            kind: "main",
            widgets: [
              { widgetId: "widget-table-review-grid", order: 0, span: 8 },
              { widgetId: "ghost-widget", order: 1, span: 4 },
            ],
          },
        ],
        revision: 0,
      },
      { now },
    );
    expect(updated.layouts[0]?.regions[0]?.widgets).toEqual([
      { widgetId: "widget-table-review-grid", order: 0, span: 8 },
    ]);
    expect(updated.layouts[0]?.revision).toBe(2);
  });

  it("refuses to delete a layout that is still referenced by a page", () => {
    const start = bundle();
    const same = deleteAppForgeInterfaceLayout(start, "layout-main", { now });
    expect(same).toBe(start);
  });

  it("upserts widgets and removes them from every region on delete", () => {
    const start = bundle();
    const withWidget = putAppForgeInterfaceWidget(
      start,
      {
        id: "widget-form",
        kind: "record_form",
        title: "Form",
        source: { tableId: "table-review", fieldIds: ["title"] },
        revision: 0,
      },
      { now },
    );
    const placed = addAppForgeInterfaceWidgetToRegion(
      withWidget,
      "layout-main",
      "main",
      { widgetId: "widget-form", order: 1, span: 6 },
      { now },
    );
    expect(placed.layouts[0]?.regions[0]?.widgets.map((entry) => entry.widgetId)).toEqual([
      "widget-table-review-grid",
      "widget-form",
    ]);

    const removed = deleteAppForgeInterfaceWidget(placed, "widget-form", { now });
    expect(removed.widgets.map((widget) => widget.id)).toEqual(["widget-table-review-grid"]);
    expect(removed.layouts[0]?.regions[0]?.widgets.map((entry) => entry.widgetId)).toEqual([
      "widget-table-review-grid",
    ]);
  });

  it("reorders region widgets while preserving entries not in the order list", () => {
    const start = bundle();
    const withSecond = putAppForgeInterfaceWidget(
      start,
      {
        id: "widget-second",
        kind: "metric",
        revision: 0,
      },
      { now },
    );
    const placed = addAppForgeInterfaceWidgetToRegion(
      withSecond,
      "layout-main",
      "main",
      { widgetId: "widget-second", order: 1, span: 6 },
      { now },
    );
    const withThird = putAppForgeInterfaceWidget(
      placed,
      {
        id: "widget-third",
        kind: "activity",
        revision: 0,
      },
      { now },
    );
    const placedThird = addAppForgeInterfaceWidgetToRegion(
      withThird,
      "layout-main",
      "main",
      { widgetId: "widget-third", order: 2, span: 6 },
      { now },
    );

    const reordered = reorderAppForgeInterfaceRegionWidgets(
      placedThird,
      "layout-main",
      "main",
      ["widget-third", "widget-table-review-grid"],
      { now },
    );
    expect(
      reordered.layouts[0]?.regions[0]?.widgets.map((entry) => `${entry.widgetId}:${entry.order}`),
    ).toEqual(["widget-third:0", "widget-table-review-grid:1", "widget-second:2"]);
  });

  it("removes a widget reference from a single region without touching the widget catalog", () => {
    const start = bundle();
    const cleared = removeAppForgeInterfaceWidgetFromRegion(
      start,
      "layout-main",
      "main",
      "widget-table-review-grid",
      { now },
    );
    expect(cleared.layouts[0]?.regions[0]?.widgets).toEqual([]);
    expect(cleared.widgets.map((widget) => widget.id)).toEqual(["widget-table-review-grid"]);
    expect(cleared.revision).toBe(start.revision + 1);
  });

  it("validates widget shape against the base table fields", () => {
    expect(
      validateAppForgeInterfaceWidgetForBase(
        {
          id: "widget-x",
          kind: "record_grid",
          source: { tableId: "table-review", fieldIds: ["title"] },
          revision: 1,
        },
        base(),
      ),
    ).toBeNull();
    expect(
      validateAppForgeInterfaceWidgetForBase(
        {
          id: "widget-x",
          kind: "record_grid",
          source: { tableId: "table-review", fieldIds: ["missing"] },
          revision: 1,
        },
        base(),
      ),
    ).toMatch(/unknown fieldId/);
    expect(
      validateAppForgeInterfaceWidgetForBase(
        {
          id: "widget-x",
          kind: "record_grid",
          source: { tableId: "missing" },
          revision: 1,
        },
        base(),
      ),
    ).toMatch(/unknown tableId/);
  });
});
