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
      name: "Sample: Campaign Review",
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
                views: [
                  {
                    id: "view-review",
                    name: "Review queue",
                    type: "grid",
                    filterText: "asset",
                    sortFieldId: "title",
                    sortDirection: "desc",
                    groupFieldId: "bad-field",
                    visibleFieldIds: ["title", "missing-field"],
                    createdAt: "2026-04-25T21:00:00.000Z",
                    updatedAt: "2026-04-25T21:00:00.000Z",
                  },
                  { id: "bad-view", name: "Bad view", type: "timeline" },
                ],
                activeViewId: "view-review",
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
    expect(base.tables[0]?.activeViewId).toBe("view-review");
    expect(base.tables[0]?.views).toEqual([
      expect.objectContaining({
        id: "view-review",
        name: "Review queue",
        type: "grid",
        filterText: "asset",
        sortFieldId: "title",
        sortDirection: "desc",
        groupFieldId: "",
        visibleFieldIds: ["title"],
      }),
    ]);
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
        tables: [
          expect.objectContaining({
            id: "table-review",
            activeViewId: "view-review",
            views: [
              expect.objectContaining({
                id: "view-review",
                name: "Review queue",
                filterText: "asset",
              }),
            ],
          }),
        ],
      },
    });
  });

  it("drops stale or duplicate visible field ids instead of persisting blank views", () => {
    const base = forgeStructuredDataTestUtils.normalizeBase(
      app({
        metadata: {
          appForge: {
            structured: {
              baseId: "base-existing",
              activeTableId: "table-review",
              tables: [
                {
                  id: "table-review",
                  name: "Reviews",
                  fields: [
                    { id: "title", name: "Title", type: "text" },
                    { id: "status", name: "Status", type: "single_select" },
                  ],
                  records: [],
                  views: [
                    {
                      id: "view-valid",
                      name: "Valid columns",
                      type: "grid",
                      visibleFieldIds: ["status", "missing", "status", "title"],
                    },
                    {
                      id: "view-stale",
                      name: "Stale columns",
                      type: "grid",
                      visibleFieldIds: ["missing", "deleted"],
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
    );

    expect(base.tables[0]?.views).toEqual([
      expect.objectContaining({
        id: "view-valid",
        visibleFieldIds: ["status", "title"],
      }),
      expect.objectContaining({
        id: "view-stale",
        visibleFieldIds: undefined,
      }),
    ]);
  });

  it("normalizes live field configuration metadata", () => {
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
                  fields: [
                    {
                      id: "status",
                      name: "Status",
                      type: "single_select",
                      description: "Review state",
                      required: true,
                      defaultValue: "Review",
                      selectOptions: [
                        { id: "opt-plan", label: "Planning", color: "sky" },
                        { id: "opt-review", label: "Review", color: "amber" },
                      ],
                    },
                    {
                      id: "legacy",
                      name: "Legacy",
                      type: "multi_select",
                      options: ["One", "Two"],
                      defaultValue: "One,Two",
                    },
                  ],
                  records: [],
                },
              ],
            },
          },
        },
      }),
    );

    expect(base.tables[0]?.fields[0]).toMatchObject({
      id: "status",
      description: "Review state",
      required: true,
      defaultValue: "Review",
      options: ["Planning", "Review"],
      selectOptions: [
        { id: "opt-plan", label: "Planning", color: "sky" },
        { id: "opt-review", label: "Review", color: "amber" },
      ],
    });
    expect(base.tables[0]?.fields[1]).toMatchObject({
      options: ["One", "Two"],
      selectOptions: [
        expect.objectContaining({ label: "One" }),
        expect.objectContaining({ label: "Two" }),
      ],
      defaultValue: ["One", "Two"],
    });
  });

  it("drops invalid defaults and duplicate select options during field normalization", () => {
    const base = forgeStructuredDataTestUtils.normalizeBase(
      app({
        metadata: {
          appForge: {
            structured: {
              baseId: "base-existing",
              activeTableId: "table-review",
              tables: [
                {
                  id: "table-review",
                  name: "Reviews",
                  fields: [
                    {
                      id: "status",
                      name: "Status",
                      type: "single_select",
                      defaultValue: "Blocked",
                      selectOptions: [
                        { id: "opt-plan", label: "Planning", color: "sky" },
                        { id: "opt-empty", label: "", color: "rose" },
                        { id: "opt-plan-2", label: "Planning", color: "amber" },
                        { id: "opt-review", label: "Review", color: "violet" },
                      ],
                    },
                    {
                      id: "score",
                      name: "Score",
                      type: "number",
                      defaultValue: "not-a-number",
                    },
                    {
                      id: "due",
                      name: "Due Date",
                      type: "date",
                      defaultValue: "05/01/2026",
                    },
                  ],
                  records: [],
                },
              ],
            },
          },
        },
      }),
    );

    expect(base.tables[0]?.fields[0]).toMatchObject({
      options: ["Planning", "Review"],
      selectOptions: [
        { id: "opt-plan", label: "Planning", color: "sky" },
        { id: "opt-review", label: "Review", color: "violet" },
      ],
    });
    expect(base.tables[0]?.fields[0]?.defaultValue).toBeUndefined();
    expect(base.tables[0]?.fields[1]?.defaultValue).toBeUndefined();
    expect(base.tables[0]?.fields[2]?.defaultValue).toBeUndefined();
  });

  it("seeds empty structured bases with the default TableForge table", () => {
    const base = forgeStructuredDataTestUtils.normalizeBase(
      app({
        metadata: {
          appForge: {
            structured: {
              baseId: "base-empty",
              activeTableId: "",
              updatedAt: "2026-04-26T22:00:00.000Z",
              tables: [],
            },
          },
        },
      }),
    );

    expect(base).toMatchObject({
      id: "base-app-1",
      appId: "app-1",
      activeTableId: "table-main",
    });
    expect(base.tables[0]?.name).toBe("Projects");
    expect(base.tables[0]?.fields.map((field) => field.id)).toEqual([
      "name",
      "status",
      "owner",
      "dueDate",
      "capability",
    ]);
    expect(base.tables[0]?.views).toEqual([
      expect.objectContaining({ id: "view-grid", name: "All records", type: "grid" }),
    ]);
    expect(base.tables[0]?.activeViewId).toBe("view-grid");
  });

  it("normalizes legacy tables with no views into a default grid view", () => {
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
                  records: [],
                },
              ],
            },
          },
        },
      }),
    );

    expect(base.tables[0]?.views).toEqual([
      expect.objectContaining({
        id: "view-grid",
        name: "All records",
        type: "grid",
        sortDirection: "asc",
      }),
    ]);
    expect(base.tables[0]?.activeViewId).toBe("view-grid");
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

  it("uses configured field defaults for new record values", () => {
    expect(
      forgeStructuredDataTestUtils.defaultValueForField({
        id: "score",
        name: "Score",
        type: "number",
        defaultValue: 7,
      }),
    ).toBe(7);
    expect(
      forgeStructuredDataTestUtils.defaultValueForField({
        id: "done",
        name: "Done",
        type: "checkbox",
        defaultValue: true,
      }),
    ).toBe(true);
    expect(
      forgeStructuredDataTestUtils.defaultValueForField({
        id: "status",
        name: "Status",
        type: "single_select",
        defaultValue: "Review",
        selectOptions: [
          { id: "opt-plan", label: "Planning", color: "sky" },
          { id: "opt-review", label: "Review", color: "amber" },
        ],
      }),
    ).toBe("Review");
  });

  it("hardens field updates and required cell edits before persistence", () => {
    const status: ForgeStructuredField = {
      id: "status",
      name: "Status",
      type: "single_select",
      defaultValue: "Blocked",
      selectOptions: [
        { id: "opt-plan", label: "Planning", color: "sky" },
        { id: "opt-review", label: "Review", color: "amber" },
      ],
    };
    const updatedStatus = forgeStructuredDataTestUtils.normalizeFieldDraft(status, {
      selectOptions: [
        { id: "opt-plan", label: "Planning", color: "sky" },
        { id: "opt-plan-copy", label: "Planning", color: "rose" },
        { id: "opt-approved", label: "Approved", color: "emerald" },
      ],
      defaultValue: "Approved",
    });

    expect(updatedStatus).toMatchObject({
      options: ["Planning", "Approved"],
      defaultValue: "Approved",
    });

    expect(
      forgeStructuredDataTestUtils.valueForCellUpdate(
        { id: "name", name: "Name", type: "text", required: true },
        "",
        "Previous name",
      ),
    ).toBe("Previous name");
    expect(
      forgeStructuredDataTestUtils.valueForCellUpdate(
        { id: "name", name: "Name", type: "text", required: true },
        "",
        "",
      ),
    ).toBe("Untitled");
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
    expect(tableCalls[0]?.params.expectedRevision).toBeUndefined();

    const recordCalls = forgeStructuredDataTestUtils.buildGatewayMirrorCalls(base, {
      kind: "record.put",
      tableId: table.id,
      record,
    });
    expect(recordCalls.map((call) => call.method)).toEqual(["appforge.bases.put"]);
    expect(recordCalls[0]?.params).toMatchObject({
      base: expect.objectContaining({ id: "base-existing", revision: 0 }),
    });
    expect(recordCalls[0]?.params.expectedRevision).toBeUndefined();
  });

  it("shapes new dashboard bases for gateway writes", () => {
    const base = forgeStructuredDataTestUtils.defaultBase(app());
    const gatewayBase = forgeStructuredDataTestUtils.toGatewayBase(base);

    expect(gatewayBase).toMatchObject({
      id: base.id,
      appId: base.appId,
      revision: 0,
      tables: [expect.objectContaining({ id: "table-main", revision: 0 })],
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

  it("round trips saved views and selected fields through gateway-shaped tables", () => {
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
          activeViewId: "view-review",
          defaultViewId: "view-owner",
          selectedFieldId: "status",
          activeCell: { recordId: "record-1", fieldId: "status" },
          fields: [
            { id: "title", name: "Title", type: "text" },
            { id: "status", name: "Status", type: "single_select", options: ["Open", "Done"] },
          ],
          records: [
            {
              id: "record-1",
              revision: 1,
              values: { title: "First review", status: "Open" },
              createdAt: "2026-04-26T17:05:00.000Z",
              updatedAt: "2026-04-26T17:06:00.000Z",
            },
          ],
          views: [
            {
              id: "view-review",
              name: "Review queue",
              type: "grid",
              filterText: "open",
              sortFieldId: "title",
              sortDirection: "desc",
              groupFieldId: "status",
              visibleFieldIds: ["status", "title"],
              createdAt: "2026-04-26T17:00:00.000Z",
              updatedAt: "2026-04-26T17:10:00.000Z",
            },
            {
              id: "view-owner",
              name: "Owner scan",
              type: "grid",
              filterText: "avery",
              sortFieldId: "status",
              sortDirection: "asc",
              visibleFieldIds: ["title", "status"],
              createdAt: "2026-04-26T17:20:00.000Z",
              updatedAt: "2026-04-26T17:25:00.000Z",
            },
          ],
        },
      ],
    });

    expect(base?.tables[0]).toMatchObject({
      activeViewId: "view-review",
      defaultViewId: "view-owner",
      selectedFieldId: "status",
      activeCell: { recordId: "record-1", fieldId: "status" },
      views: [
        expect.objectContaining({
          id: "view-review",
          filterText: "open",
          sortFieldId: "title",
          sortDirection: "desc",
          groupFieldId: "status",
          visibleFieldIds: ["status", "title"],
        }),
        expect.objectContaining({
          id: "view-owner",
          filterText: "avery",
          sortFieldId: "status",
          sortDirection: "asc",
          groupFieldId: "",
          visibleFieldIds: ["title", "status"],
        }),
      ],
    });
    const table = base?.tables[0];
    if (!base || !table) {
      throw new Error("gateway base/table did not normalize");
    }

    const calls = forgeStructuredDataTestUtils.buildGatewayMirrorCalls(base, {
      kind: "table.put",
      table,
    });

    expect(calls[0]?.params.table).toMatchObject({
      activeViewId: "view-review",
      defaultViewId: "view-owner",
      selectedFieldId: "status",
      activeCell: { recordId: "record-1", fieldId: "status" },
      views: [
        expect.objectContaining({ visibleFieldIds: ["status", "title"] }),
        expect.objectContaining({ visibleFieldIds: ["title", "status"] }),
      ],
    });
  });

  it("normalizes saved views and active field state from gateway table metadata", () => {
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
          fields: [
            { id: "title", name: "Title", type: "text" },
            { id: "status", name: "Status", type: "single_select", options: ["Open", "Done"] },
          ],
          records: [
            {
              id: "record-1",
              revision: 1,
              values: { title: "First review", status: "Open" },
              createdAt: "2026-04-26T17:05:00.000Z",
              updatedAt: "2026-04-26T17:06:00.000Z",
            },
          ],
          metadata: {
            activeViewId: "view-follow-up",
            defaultViewId: "view-follow-up",
            selectedFieldId: "status",
            activeCell: { recordId: "record-1", fieldId: "status" },
            views: [
              {
                id: "view-follow-up",
                name: "Follow-up queue",
                type: "grid",
                filterText: "open",
                sortFieldId: "title",
                sortDirection: "desc",
                groupFieldId: "status",
                visibleFieldIds: ["status", "title"],
                createdAt: "2026-04-26T17:00:00.000Z",
                updatedAt: "2026-04-26T17:10:00.000Z",
              },
            ],
          },
        },
      ],
    });

    expect(base?.tables[0]).toMatchObject({
      activeViewId: "view-follow-up",
      defaultViewId: "view-follow-up",
      selectedFieldId: "status",
      activeCell: { recordId: "record-1", fieldId: "status" },
      views: [
        expect.objectContaining({
          id: "view-follow-up",
          name: "Follow-up queue",
          filterText: "open",
          sortFieldId: "title",
          sortDirection: "desc",
          groupFieldId: "status",
          visibleFieldIds: ["status", "title"],
        }),
      ],
    });
  });

  it("recovers stale selected field and active cell from the active view", () => {
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
          activeViewId: "missing-view",
          defaultViewId: "view-follow-up",
          selectedFieldId: "deleted-field",
          activeCell: { recordId: "record-1", fieldId: "deleted-field" },
          fields: [
            { id: "title", name: "Title", type: "text" },
            { id: "status", name: "Status", type: "single_select", options: ["Open", "Done"] },
            { id: "owner", name: "Owner", type: "text" },
          ],
          records: [
            {
              id: "record-1",
              revision: 1,
              values: { title: "First review", status: "Open", owner: "Avery" },
              createdAt: "2026-04-26T17:05:00.000Z",
              updatedAt: "2026-04-26T17:06:00.000Z",
            },
          ],
          views: [
            {
              id: "view-follow-up",
              name: "Follow-up queue",
              type: "grid",
              visibleFieldIds: ["status", "title"],
              createdAt: "2026-04-26T17:00:00.000Z",
              updatedAt: "2026-04-26T17:10:00.000Z",
            },
          ],
        },
      ],
    });

    expect(base?.tables[0]).toMatchObject({
      activeViewId: "view-follow-up",
      defaultViewId: "view-follow-up",
      selectedFieldId: "status",
      activeCell: { recordId: "record-1", fieldId: "status" },
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

  it("formats timeout and abort save failures for operator recovery", () => {
    expect(
      forgeStructuredDataTestUtils.formatStructuredSaveError(
        new Error("signal is aborted without reason"),
      ),
    ).toBe("Timed out while saving structured base changes. Try again.");
    expect(
      forgeStructuredDataTestUtils.formatStructuredSaveError(new Error("Request timeout")),
    ).toBe("Timed out while saving structured base changes. Try again.");
  });
});
