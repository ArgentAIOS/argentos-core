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
    isPinned: false,
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
                  {
                    id: "approved",
                    name: "Approved",
                    type: "checkbox",
                    required: false,
                  },
                  { id: "bad-field" },
                ],
                records: [
                  {
                    id: "record-1",
                    values: {
                      title: "Asset A",
                      approved: true,
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
    expect(base.tables[0]?.fields.map((field) => field.id)).toEqual(["title", "approved"]);
    expect(base.tables[0]?.records).toHaveLength(1);
    expect(base.tables[0]?.records[0]?.values).toEqual({
      title: "Asset A",
      approved: true,
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
    expect(forgeStructuredDataTestUtils.coerceValueForField("Blocked", selectField)).toBe(
      "Planning",
    );
    expect(forgeStructuredDataTestUtils.coerceValueForField("Review", selectField)).toBe("Review");
  });

  it("builds gateway mirror calls for table and record mutations", () => {
    const base = forgeStructuredDataTestUtils.normalizeBase(
      app({
        metadata: {
          appForge: {
            structured: {
              baseId: "base-existing",
              activeTableId: "table-review",
              updatedAt: "2026-04-25T21:00:00.000Z",
              tables: [
                {
                  id: "table-review",
                  name: "Reviews",
                  fields: [{ id: "title", name: "Title", type: "text" }],
                  records: [
                    {
                      id: "record-1",
                      values: { title: "Asset A" },
                      createdAt: "2026-04-25T21:00:00.000Z",
                      updatedAt: "2026-04-25T21:00:00.000Z",
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
    );
    const table = base.tables[0];
    const record = table.records[0];

    const tableCalls = forgeStructuredDataTestUtils.buildGatewayMirrorCalls(base, {
      kind: "table.put",
      table,
    });
    expect(tableCalls.map((call) => call.method)).toEqual([
      "appforge.bases.put",
      "appforge.tables.put",
    ]);
    expect(tableCalls[0]?.params.base).toMatchObject({
      id: "base-existing",
      revision: 0,
      tables: [expect.objectContaining({ id: "table-review", revision: 0 })],
    });
    expect(tableCalls[1]?.params.table).toMatchObject({
      id: "table-review",
      revision: 0,
      records: [expect.objectContaining({ id: "record-1", revision: 0 })],
    });

    const recordCalls = forgeStructuredDataTestUtils.buildGatewayMirrorCalls(base, {
      kind: "record.put",
      tableId: table.id,
      record,
    });
    expect(recordCalls.map((call) => call.method)).toEqual([
      "appforge.bases.put",
      "appforge.records.put",
    ]);
    expect(recordCalls[1]?.params).toMatchObject({
      baseId: "base-existing",
      tableId: "table-review",
      record: expect.objectContaining({ id: "record-1", revision: 0 }),
    });
  });
});
