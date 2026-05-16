import { describe, expect, it } from "vitest";
import type { AppForgeBase } from "./app-forge-model.js";
import {
  deleteAppForgeNamedView,
  mergeAppForgeNamedViewsIntoMetadata,
  normalizeAppForgeNamedViews,
  projectAppForgeNamedViewsFromMetadata,
  putAppForgeNamedView,
  setActiveAppForgeNamedView,
} from "./app-forge-views.js";

function base(tableIds: string[]): Pick<AppForgeBase, "tables"> {
  return {
    tables: tableIds.map((id) => ({
      id,
      name: id,
      fields: [],
      records: [],
      revision: 1,
    })),
  };
}

describe("AppForge saved named views", () => {
  it("projects valid per-table views from structured metadata and drops invalid entries", () => {
    const views = projectAppForgeNamedViewsFromMetadata(
      {
        workflowCapabilities: [{ id: "review", label: "Review" }],
        appForge: {
          structured: {
            baseId: "base-1",
            activeTableId: "table-review",
            views: {
              version: 1,
              activeViewIdByTable: {
                "table-review": "view-review",
                "table-design": "view-orphan",
                "table-missing": "view-missing",
              },
              items: [
                {
                  id: "view-review",
                  tableId: "table-review",
                  name: "Needs Review",
                  viewMode: "review",
                  settings: {
                    filterText: "urgent",
                    sortFieldId: "status",
                    sortDirection: "desc",
                    groupFieldId: "owner",
                  },
                  createdAt: "2026-04-26T18:00:00.000Z",
                  updatedAt: "2026-04-26T18:05:00.000Z",
                },
                {
                  id: "view-design",
                  tableId: "table-design",
                  name: "Design Board",
                  viewMode: "calendar",
                  filterText: "brand",
                  groupFieldId: "status",
                },
                {
                  id: "view-orphan",
                  tableId: "table-missing",
                  name: "Orphan",
                },
                {
                  id: "view-incomplete",
                  tableId: "table-review",
                },
              ],
            },
          },
        },
      },
      base(["table-review", "table-design"]),
    );

    expect(views.activeViewIdByTable).toEqual({ "table-review": "view-review" });
    expect(views.items).toHaveLength(2);
    expect(views.items[0]).toEqual({
      id: "view-review",
      tableId: "table-review",
      name: "Needs Review",
      viewMode: "review",
      settings: {
        filterText: "urgent",
        sortFieldId: "status",
        sortDirection: "desc",
        groupFieldId: "owner",
      },
      createdAt: "2026-04-26T18:00:00.000Z",
      updatedAt: "2026-04-26T18:05:00.000Z",
    });
    expect(views.items[1]).toMatchObject({
      id: "view-design",
      tableId: "table-design",
      name: "Design Board",
      viewMode: "calendar",
      settings: {
        filterText: "brand",
        sortFieldId: "",
        sortDirection: "asc",
        groupFieldId: "status",
      },
    });
  });

  it("round-trips a calendar named view through metadata projection", () => {
    // Calendar is the AppForge Phase-4 parity-gap view mode. The saved-view
    // union (`APP_FORGE_SAVED_VIEW_TYPES`) has known about it for a while;
    // this regression locks in that the *named-view* union no longer
    // silently downgrades it to "grid".
    const views = projectAppForgeNamedViewsFromMetadata(
      {
        appForge: {
          structured: {
            baseId: "base-1",
            activeTableId: "table-launches",
            views: {
              version: 1,
              activeViewIdByTable: { "table-launches": "view-launch-cal" },
              items: [
                {
                  id: "view-launch-cal",
                  tableId: "table-launches",
                  name: "Launch Calendar",
                  viewMode: "calendar",
                  settings: {
                    filterText: "",
                    sortFieldId: "",
                    sortDirection: "asc",
                    groupFieldId: "ship_date",
                  },
                  createdAt: "2026-05-16T18:00:00.000Z",
                  updatedAt: "2026-05-16T18:00:00.000Z",
                },
              ],
            },
          },
        },
      },
      base(["table-launches"]),
    );

    expect(views.activeViewIdByTable).toEqual({ "table-launches": "view-launch-cal" });
    expect(views.items).toHaveLength(1);
    expect(views.items[0]).toEqual({
      id: "view-launch-cal",
      tableId: "table-launches",
      name: "Launch Calendar",
      viewMode: "calendar",
      settings: {
        filterText: "",
        sortFieldId: "",
        sortDirection: "asc",
        groupFieldId: "ship_date",
      },
      createdAt: "2026-05-16T18:00:00.000Z",
      updatedAt: "2026-05-16T18:00:00.000Z",
    });
  });

  it("round-trips a gallery named view through metadata projection", () => {
    // Gallery is the AppForge Phase-4 parity-gap view mode #2 (Airtable's
    // 2nd-most-used view after Grid). This regression locks in that the
    // named-view union accepts `"gallery"` without silently downgrading
    // it to `"grid"`. Mirrors the calendar coverage immediately above.
    const views = projectAppForgeNamedViewsFromMetadata(
      {
        appForge: {
          structured: {
            baseId: "base-1",
            activeTableId: "table-assets",
            views: {
              version: 1,
              activeViewIdByTable: { "table-assets": "view-asset-gallery" },
              items: [
                {
                  id: "view-asset-gallery",
                  tableId: "table-assets",
                  name: "Asset Gallery",
                  viewMode: "gallery",
                  settings: {
                    filterText: "",
                    sortFieldId: "",
                    sortDirection: "asc",
                    // Gallery reuses the kanban/calendar `groupFieldId`
                    // slot to remember which attachment field powers the
                    // card thumbnails.
                    groupFieldId: "cover_image",
                  },
                  createdAt: "2026-05-16T18:00:00.000Z",
                  updatedAt: "2026-05-16T18:00:00.000Z",
                },
              ],
            },
          },
        },
      },
      base(["table-assets"]),
    );

    expect(views.activeViewIdByTable).toEqual({ "table-assets": "view-asset-gallery" });
    expect(views.items).toHaveLength(1);
    expect(views.items[0]).toEqual({
      id: "view-asset-gallery",
      tableId: "table-assets",
      name: "Asset Gallery",
      viewMode: "gallery",
      settings: {
        filterText: "",
        sortFieldId: "",
        sortDirection: "asc",
        groupFieldId: "cover_image",
      },
      createdAt: "2026-05-16T18:00:00.000Z",
      updatedAt: "2026-05-16T18:00:00.000Z",
    });
  });

  it("falls back to grid when viewMode is an unknown value", () => {
    // Regression: any unrecognized viewMode string MUST normalize to the
    // safe default ("grid"). Previously this guarded "calendar"; after
    // #358 + this PR the union also accepts `"gallery"`. The guard still
    // has to fire for genuinely unknown future-or-typo values like
    // "gantt" so dashboards never crash on persisted state from a newer
    // build.
    const views = projectAppForgeNamedViewsFromMetadata(
      {
        appForge: {
          structured: {
            baseId: "base-1",
            activeTableId: "table-deals",
            views: {
              version: 1,
              activeViewIdByTable: {},
              items: [
                {
                  id: "view-gantt",
                  tableId: "table-deals",
                  name: "Roadmap",
                  viewMode: "gantt",
                  settings: {},
                },
              ],
            },
          },
        },
      },
      base(["table-deals"]),
    );

    expect(views.items).toHaveLength(1);
    expect(views.items[0]?.viewMode).toBe("grid");
  });

  it("merges saved named views into structured metadata without clobbering other fields", () => {
    const metadata = mergeAppForgeNamedViewsIntoMetadata(
      {
        workflowCapabilities: [{ id: "review", label: "Review" }],
        appForge: {
          workflowCapabilities: [{ id: "local-review", label: "Local Review" }],
          structured: {
            baseId: "base-1",
            activeTableId: "table-review",
            updatedAt: "2026-04-26T20:00:00.000Z",
            tables: [{ id: "table-review", name: "Reviews" }],
          },
        },
      },
      normalizeAppForgeNamedViews({
        activeViewIdByTable: { "table-review": "view-review" },
        items: [
          {
            id: "view-review",
            tableId: "table-review",
            name: "Needs Review",
            viewMode: "review",
            settings: {
              filterText: "urgent",
              sortFieldId: "status",
              sortDirection: "desc",
              groupFieldId: "owner",
            },
            createdAt: "2026-04-26T18:00:00.000Z",
            updatedAt: "2026-04-26T18:05:00.000Z",
          },
        ],
      }),
    );

    expect(metadata).toMatchObject({
      workflowCapabilities: [{ id: "review", label: "Review" }],
      appForge: {
        workflowCapabilities: [{ id: "local-review", label: "Local Review" }],
        structured: {
          baseId: "base-1",
          activeTableId: "table-review",
          updatedAt: "2026-04-26T20:00:00.000Z",
          tables: [{ id: "table-review", name: "Reviews" }],
          views: {
            version: 1,
            activeViewIdByTable: { "table-review": "view-review" },
            items: [
              {
                id: "view-review",
                tableId: "table-review",
                name: "Needs Review",
                viewMode: "review",
              },
            ],
          },
        },
      },
    });
  });

  it("supports upserting, activating, and deleting views while preserving timestamps", () => {
    let views = normalizeAppForgeNamedViews(undefined);

    views = putAppForgeNamedView(views, {
      id: "view-review",
      tableId: "table-review",
      name: "Needs Review",
      viewMode: "grid",
      settings: {
        filterText: "asset",
      },
      createdAt: "2026-04-26T19:00:00.000Z",
      updatedAt: "2026-04-26T19:00:00.000Z",
    });
    views = setActiveAppForgeNamedView(views, "table-review", "view-review");
    views = putAppForgeNamedView(views, {
      id: "view-review",
      tableId: "table-review",
      name: "Hot Assets",
      viewMode: "review",
      settings: {
        filterText: "hot",
        sortFieldId: "status",
        sortDirection: "desc",
      },
      updatedAt: "2026-04-26T19:05:00.000Z",
    });

    expect(views.activeViewIdByTable).toEqual({ "table-review": "view-review" });
    expect(views.items).toEqual([
      {
        id: "view-review",
        tableId: "table-review",
        name: "Hot Assets",
        viewMode: "review",
        settings: {
          filterText: "hot",
          sortFieldId: "status",
          sortDirection: "desc",
          groupFieldId: "",
        },
        createdAt: "2026-04-26T19:00:00.000Z",
        updatedAt: "2026-04-26T19:05:00.000Z",
      },
    ]);

    views = deleteAppForgeNamedView(views, "view-review");

    expect(views).toEqual({
      version: 1,
      activeViewIdByTable: {},
      items: [],
    });
  });

  it("survives a full save/reload metadata round-trip with the active view selection intact", () => {
    // Simulates the gateway-backed durability path the dashboard depends on:
    //   1. Operator creates a named view + activates it.
    //   2. The dashboard merges named-view state into the base metadata.
    //   3. The metadata blob is persisted (gateway / metadata fallback).
    //   4. Operator restarts (browser close + token rotation).
    //   5. Dashboard projects views back from metadata.
    // The active view selection MUST survive — that's the regression that
    // motivates moving view state out of localStorage.
    const tables = base(["table-leads", "table-deals"]);

    const initial = normalizeAppForgeNamedViews(undefined);
    const afterSave = setActiveAppForgeNamedView(
      putAppForgeNamedView(initial, {
        id: "view-pipeline",
        tableId: "table-deals",
        name: "Pipeline",
        viewMode: "kanban",
        settings: {
          filterText: "Open",
          sortFieldId: "close_date",
          sortDirection: "desc",
          groupFieldId: "stage",
        },
        createdAt: "2026-05-06T19:00:00.000Z",
        updatedAt: "2026-05-06T19:00:00.000Z",
      }),
      "table-deals",
      "view-pipeline",
    );

    const persisted = mergeAppForgeNamedViewsIntoMetadata(
      {
        appForge: {
          structured: {
            baseId: "base-1",
            activeTableId: "table-deals",
            tables: [{ id: "table-deals", name: "Deals" }],
          },
        },
      },
      afterSave,
    );

    // Round-trip through JSON to mimic what the gateway/metadata fallback
    // path does end-to-end (serialize, transit, deserialize).
    const reloaded = JSON.parse(JSON.stringify(persisted));
    const projected = projectAppForgeNamedViewsFromMetadata(reloaded, tables);

    expect(projected.activeViewIdByTable).toEqual({ "table-deals": "view-pipeline" });
    expect(projected.items).toEqual([
      {
        id: "view-pipeline",
        tableId: "table-deals",
        name: "Pipeline",
        viewMode: "kanban",
        settings: {
          filterText: "Open",
          sortFieldId: "close_date",
          sortDirection: "desc",
          groupFieldId: "stage",
        },
        createdAt: "2026-05-06T19:00:00.000Z",
        updatedAt: "2026-05-06T19:00:00.000Z",
      },
    ]);
  });
});
