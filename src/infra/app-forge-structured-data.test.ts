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

  it("normalizes gateway-backed bases and preserves revisions", () => {
    const base = forgeStructuredDataTestUtils.normalizeGatewayBase({
      id: "base-gateway",
      appId: "app-1",
      name: "Gateway Base",
      description: "Loaded from gateway",
      activeTableId: "table-review",
      revision: 4,
      updatedAt: "2026-04-26T17:30:00.000Z",
      tables: [
        {
          id: "table-review",
          name: "Reviews",
          revision: 3,
          fields: [{ id: "title", name: "Title", type: "text" }],
          records: [
            {
              id: "record-1",
              revision: 2,
              values: { title: "Asset A" },
              createdAt: "2026-04-26T17:20:00.000Z",
              updatedAt: "2026-04-26T17:25:00.000Z",
            },
          ],
        },
      ],
    });

    expect(base).toMatchObject({
      id: "base-gateway",
      appId: "app-1",
      name: "Gateway Base",
      activeTableId: "table-review",
      revision: 4,
      tables: [
        expect.objectContaining({
          id: "table-review",
          revision: 3,
          records: [expect.objectContaining({ id: "record-1", revision: 2 })],
        }),
      ],
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
    expect(tableCalls.map((call) => call.method)).toEqual(["appforge.bases.put"]);
    expect(tableCalls[0]?.params.base).toMatchObject({
      id: "base-existing",
      revision: 0,
      tables: [expect.objectContaining({ id: "table-review", revision: 0 })],
    });
    expect(tableCalls[0]?.params.expectedRevision).toBe(0);

    const recordCalls = forgeStructuredDataTestUtils.buildGatewayMirrorCalls(base, {
      kind: "record.put",
      tableId: table.id,
      record,
    });
    expect(recordCalls.map((call) => call.method)).toEqual(["appforge.bases.put"]);
    expect(recordCalls[0]?.params).toMatchObject({
      base: expect.objectContaining({ id: "base-existing", revision: 0 }),
      expectedRevision: 0,
    });
  });

  it("preserves gateway revisions when building gateway write calls", () => {
    const base = forgeStructuredDataTestUtils.normalizeGatewayBase({
      id: "base-existing",
      appId: "app-1",
      name: "Gateway Base",
      activeTableId: "table-review",
      revision: 7,
      updatedAt: "2026-04-26T17:30:00.000Z",
      tables: [
        {
          id: "table-review",
          name: "Reviews",
          revision: 5,
          fields: [{ id: "title", name: "Title", type: "text" }],
          records: [
            {
              id: "record-1",
              revision: 2,
              values: { title: "Asset A" },
              createdAt: "2026-04-26T17:20:00.000Z",
              updatedAt: "2026-04-26T17:25:00.000Z",
            },
          ],
        },
      ],
    });
    if (!base) {
      throw new Error("gateway base did not normalize");
    }

    const table = base.tables[0];
    if (!table) {
      throw new Error("gateway table did not normalize");
    }
    const record = table.records[0];
    if (!record) {
      throw new Error("gateway record did not normalize");
    }
    const calls = forgeStructuredDataTestUtils.buildGatewayMirrorCalls(base, {
      kind: "record.put",
      tableId: table.id,
      record,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("appforge.records.put");
    expect(calls[0]?.params).toMatchObject({
      baseId: "base-existing",
      tableId: "table-review",
      expectedBaseRevision: 7,
      expectedTableRevision: 5,
      expectedRecordRevision: 2,
    });
    expect(calls[0]?.params.record).toMatchObject({
      id: "record-1",
      revision: 2,
    });
  });

  it("builds revision-checked gateway delete calls from previous state", () => {
    const base = forgeStructuredDataTestUtils.normalizeGatewayBase({
      id: "base-existing",
      appId: "app-1",
      name: "Gateway Base",
      activeTableId: "table-review",
      revision: 7,
      updatedAt: "2026-04-26T17:30:00.000Z",
      tables: [
        {
          id: "table-review",
          name: "Reviews",
          revision: 5,
          fields: [{ id: "title", name: "Title", type: "text" }],
          records: [
            {
              id: "record-1",
              revision: 2,
              values: { title: "Asset A" },
              createdAt: "2026-04-26T17:20:00.000Z",
              updatedAt: "2026-04-26T17:25:00.000Z",
            },
          ],
        },
      ],
    });
    if (!base) {
      throw new Error("gateway base did not normalize");
    }
    const table = base.tables[0];
    if (!table) {
      throw new Error("gateway table did not normalize");
    }

    const calls = forgeStructuredDataTestUtils.buildGatewayMirrorCalls(
      { ...base, tables: [{ ...table, records: [] }] },
      {
        kind: "record.delete",
        tableId: "table-review",
        recordId: "record-1",
        seedBase: base,
      },
    );

    expect(calls).toEqual([
      {
        method: "appforge.records.delete",
        params: {
          baseId: "base-existing",
          tableId: "table-review",
          recordId: "record-1",
          expectedBaseRevision: 7,
          expectedTableRevision: 5,
          expectedRecordRevision: 2,
        },
      },
    ]);
  });

  it("formats revision conflicts for operator recovery", () => {
    const message = forgeStructuredDataTestUtils.formatStructuredSaveError(
      new Error("Expected revision 3, found 4."),
    );

    expect(message).toContain("Reload AppForge");
    expect(forgeStructuredDataTestUtils.isRevisionConflictError(message)).toBe(true);
  });
});
