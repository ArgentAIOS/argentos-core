import { describe, expect, it } from "vitest";
import type { ForgeApp } from "../../dashboard/src/hooks/useApps";
import type { ForgeStructuredField } from "../../dashboard/src/hooks/useForgeStructuredData";
import { forgeStructuredDataTestUtils } from "../../dashboard/src/hooks/useForgeStructuredData";

function app(overrides: Partial<ForgeApp> = {}): ForgeApp {
  return {
    id: "app-1",
    name: "Campaign Review",
    description: "Review queue",
    icon: "",
    code: "<html></html>",
    creator: "ai",
    version: 1,
    createdAt: "2026-04-25T20:00:00.000Z",
    updatedAt: "2026-04-25T20:00:00.000Z",
    openCount: 0,
    pinned: false,
    metadata: {},
    ...overrides,
  };
}

describe("forge structured data metadata", () => {
  it("builds a default base from workflow capability metadata", () => {
    const base = forgeStructuredDataTestUtils.defaultBase(
      app({
        metadata: {
          workflowCapabilities: [{ id: "campaign_review", label: "Campaign Review" }],
        },
      }),
    );

    expect(base).toMatchObject({
      appId: "app-1",
      name: "Campaign Review",
      activeTableId: "table-main",
    });
    expect(base.tables[0]?.fields.map((field) => field.id)).toEqual([
      "name",
      "status",
      "owner",
      "dueDate",
      "capability",
    ]);
    expect(base.tables[0]?.records[0]?.values).toMatchObject({
      name: "Campaign Review",
      capability: "campaign_review",
    });
  });

  it("normalizes metadata-backed tables while preserving valid app metadata", () => {
    const source = app({
      metadata: {
        workflowCapabilities: [{ id: "review", label: "Review" }],
        appForge: {
          structured: {
            baseId: "base-existing",
            activeTableId: "table-review",
            updatedAt: "2026-04-25T21:00:00.000Z",
            tables: [
              {
                id: "table-review",
                name: "Reviews",
                fields: [
                  { id: "title", name: "Title", type: "text", required: true },
                  { id: "notes", name: "Notes", type: "long_text" },
                  {
                    id: "approved",
                    name: "Approved",
                    type: "checkbox",
                    required: false,
                  },
                  {
                    id: "tags",
                    name: "Tags",
                    type: "multi_select",
                    options: ["Design", "Launch"],
                  },
                  { id: "files", name: "Files", type: "attachment" },
                  { id: "related", name: "Related", type: "linked_record" },
                  { id: "contact", name: "Contact", type: "email" },
                  { id: "site", name: "Site", type: "url" },
                  { id: "bad-field" },
                ],
                records: [
                  {
                    id: "record-1",
                    values: {
                      title: "Asset A",
                      notes: "Needs compliance review",
                      approved: true,
                      tags: ["Design", "Launch"],
                      files: ["brief.pdf"],
                      related: "record-2",
                      contact: "owner@example.com",
                      site: "https://example.com/review",
                      ignored: { nested: true },
                    },
                    createdAt: "2026-04-25T21:00:00.000Z",
                    updatedAt: "2026-04-25T21:00:00.000Z",
                  },
                  { values: { title: "Missing id" } },
                ],
              },
            ],
          },
        },
      },
    });

    const base = forgeStructuredDataTestUtils.normalizeBase(source);
    const metadata = forgeStructuredDataTestUtils.metadataWithBase(source, base);

    expect(base.id).toBe("base-existing");
    expect(base.activeTableId).toBe("table-review");
    expect(base.tables).toHaveLength(1);
    expect(base.tables[0]?.fields.map((field) => field.id)).toEqual([
      "title",
      "notes",
      "approved",
      "tags",
      "files",
      "related",
      "contact",
      "site",
    ]);
    expect(base.tables[0]?.records).toHaveLength(1);
    expect(base.tables[0]?.records[0]?.values).toEqual({
      title: "Asset A",
      notes: "Needs compliance review",
      approved: true,
      tags: ["Design", "Launch"],
      files: ["brief.pdf"],
      related: ["record-2"],
      contact: "owner@example.com",
      site: "https://example.com/review",
    });
    expect(metadata.workflowCapabilities).toEqual([{ id: "review", label: "Review" }]);
    expect(metadata.appForge).toMatchObject({
      structured: {
        version: 1,
        baseId: "base-existing",
        activeTableId: "table-review",
      },
    });
  });

  it("coerces record values when field types change", () => {
    const selectField: ForgeStructuredField = {
      id: "status",
      name: "Status",
      type: "single_select",
      options: ["Planning", "Review"],
    };

    expect(
      forgeStructuredDataTestUtils.coerceValueForField("12", {
        id: "score",
        name: "Score",
        type: "number",
      }),
    ).toBe(12);
    expect(
      forgeStructuredDataTestUtils.coerceValueForField("true", {
        id: "done",
        name: "Done",
        type: "checkbox",
      }),
    ).toBe(true);
    expect(
      forgeStructuredDataTestUtils.coerceValueForField("Design, Launch", {
        id: "tags",
        name: "Tags",
        type: "multi_select",
        options: ["Design", "Launch"],
      }),
    ).toEqual(["Design", "Launch"]);
    expect(
      forgeStructuredDataTestUtils.coerceValueForField("Design, Invalid", {
        id: "tags",
        name: "Tags",
        type: "multi_select",
        options: ["Design", "Launch"],
      }),
    ).toEqual(["Design"]);
    expect(
      forgeStructuredDataTestUtils.coerceValueForField("brief.pdf, mock.png", {
        id: "files",
        name: "Files",
        type: "attachment",
      }),
    ).toEqual(["brief.pdf", "mock.png"]);
    expect(
      forgeStructuredDataTestUtils.coerceValueForField("record-1, record-2", {
        id: "related",
        name: "Related",
        type: "linked_record",
      }),
    ).toEqual(["record-1", "record-2"]);
    expect(forgeStructuredDataTestUtils.coerceValueForField("Blocked", selectField)).toBe(
      "Planning",
    );
    expect(forgeStructuredDataTestUtils.coerceValueForField("Review", selectField)).toBe("Review");
  });
});
