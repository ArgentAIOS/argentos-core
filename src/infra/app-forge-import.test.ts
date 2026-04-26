import { describe, expect, it } from "vitest";
import type { AppForgeBase } from "./app-forge-model.js";
import { buildAppForgeImportPreview } from "./app-forge-import.js";

function base(overrides: Partial<AppForgeBase> = {}): AppForgeBase {
  return {
    id: "base-1",
    appId: "app-1",
    name: "Campaign Review",
    description: "Review workspace",
    activeTableId: "table-1",
    revision: 1,
    updatedAt: "2026-04-25T20:00:00.000Z",
    tables: [
      {
        id: "table-1",
        name: "Reviews",
        revision: 1,
        fields: [
          { id: "name", name: "Name", type: "text", required: true },
          {
            id: "status",
            name: "Status",
            type: "single_select",
            options: ["Planning", "Review", "Approved"],
          },
          { id: "score", name: "Score", type: "number" },
          { id: "done", name: "Done", type: "checkbox" },
        ],
        records: [],
      },
    ],
    ...overrides,
  };
}

describe("AppForge import preview", () => {
  it("infers fields and coerces preview values from CSV rows", () => {
    const preview = buildAppForgeImportPreview({
      csv: [
        "Name,Status,Score,Done,Due",
        "Asset A,Review,42,true,2026-05-01",
        "Asset B,Planning,7,false,2026-05-02",
      ].join("\n"),
      tableName: "Campaign Intake",
    });

    expect(preview.tableName).toBe("Campaign Intake");
    expect(preview.delimiter).toBe(",");
    expect(preview.columns.map((column) => column.type)).toEqual([
      "text",
      "single_select",
      "number",
      "checkbox",
      "date",
    ]);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toMatchObject({
      rowNumber: 2,
      values: {
        name: "Asset A",
        status: "Review",
        score: 42,
        done: true,
        due: "2026-05-01",
      },
      errors: [],
    });
  });

  it("reuses matching table fields and surfaces validation issues against the target schema", () => {
    const preview = buildAppForgeImportPreview({
      csv: ["Name,Status,Score,Done", "Asset A,Approved,7,true", ",Blocked,oops,maybe"].join("\n"),
      base: base(),
      targetTableId: "table-1",
    });

    expect(preview.tableName).toBe("Reviews");
    expect(preview.columns.map((column) => column.matchedFieldId)).toEqual([
      "name",
      "status",
      "score",
      "done",
    ]);
    expect(preview.rows[0]?.errors).toEqual([]);
    expect(preview.rows[1]?.errors.map((error) => error.code)).toEqual([
      "required",
      "invalid_option",
      "invalid_number",
    ]);
  });

  it("parses quoted CSV cells, de-duplicates headers, and honors preview limits", () => {
    const preview = buildAppForgeImportPreview({
      csv: [
        "Name,Name,Notes",
        '"Asset, A",Primary,"Line 1\nLine 2"',
        "Asset B,Secondary,Short note",
      ].join("\n"),
      maxRows: 1,
    });

    expect(preview.previewRowCount).toBe(1);
    expect(preview.totalRows).toBe(2);
    expect(preview.columns.map((column) => column.fieldId)).toEqual(["name", "name-2", "notes"]);
    expect(preview.columns[2]?.type).toBe("long_text");
    expect(preview.rows[0]?.values).toMatchObject({
      name: "Asset, A",
      "name-2": "Primary",
      notes: "Line 1\nLine 2",
    });
    expect(preview.warnings[0]).toContain('Duplicate header "Name"');
  });
});
