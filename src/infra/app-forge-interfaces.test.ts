import { describe, expect, it } from "vitest";
import type { AppForgeBase } from "./app-forge-model.js";
import {
  defaultAppForgeInterfaceBundle,
  mergeAppForgeInterfaceBundleIntoMetadata,
  normalizeAppForgeInterfaceBundle,
  projectAppForgeInterfaceBundleFromMetadata,
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
