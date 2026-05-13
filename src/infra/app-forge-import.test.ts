import { describe, expect, it, vi } from "vitest";
import type { AppForgeBase, AppForgeRecord } from "./app-forge-model.js";
import {
  buildAppForgeImportCommitPlan,
  buildAppForgeImportPreview,
  executeAppForgeImportCommit,
  type AppForgeImportWriteRecordFn,
} from "./app-forge-import.js";

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

  it("propagates rating field config and flags out-of-range CSV values", () => {
    const preview = buildAppForgeImportPreview({
      csv: ["Name,Quality", "Asset A,4", "Asset B,9", "Asset C,not-a-number"].join("\n"),
      base: base({
        tables: [
          {
            id: "table-1",
            name: "Reviews",
            revision: 1,
            fields: [
              { id: "name", name: "Name", type: "text", required: true },
              {
                id: "quality",
                name: "Quality",
                type: "rating",
                ratingMax: 7,
                ratingIcon: "heart",
              },
            ],
            records: [],
          },
        ],
      }),
      targetTableId: "table-1",
    });

    const ratingColumn = preview.columns.find((column) => column.fieldId === "quality");
    expect(ratingColumn).toMatchObject({
      type: "rating",
      ratingMax: 7,
      ratingIcon: "heart",
      matchedFieldId: "quality",
    });

    // 4 is within [0, 7] — preserved as a number.
    expect(preview.rows[0]?.values.quality).toBe(4);
    expect(preview.rows[0]?.errors).toEqual([]);

    // 9 exceeds the configured max of 7 — flagged.
    expect(preview.rows[1]?.values.quality).toBeNull();
    expect(preview.rows[1]?.errors.map((error) => error.code)).toContain("invalid_rating");

    // Non-numeric input — flagged.
    expect(preview.rows[2]?.values.quality).toBeNull();
    expect(preview.rows[2]?.errors.map((error) => error.code)).toContain("invalid_rating");
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

  it("applies caller overrides to rename, retype, and skip columns", () => {
    const preview = buildAppForgeImportPreview({
      csv: ["Name,Internal,Notes", "Asset A,xyz,short", "Asset B,abc,short"].join("\n"),
      overrides: [
        { header: "Name", fieldName: "Asset" },
        { header: "Internal", skip: true },
        { header: "Notes", type: "long_text" },
      ],
    });

    expect(preview.columns.map((column) => column.fieldName)).toEqual([
      "Asset",
      "Internal",
      "Notes",
    ]);
    expect(preview.columns[1]?.skipped).toBe(true);
    expect(preview.columns[2]?.type).toBe("long_text");
    expect(preview.fields.map((field) => field.id)).toEqual(["name", "notes"]);
    expect(preview.rows[0]?.values).toMatchObject({ name: "Asset A", notes: "short" });
    expect(preview.rows[0]?.values).not.toHaveProperty("internal");
  });
});

describe("AppForge import commit plan", () => {
  it("parses every row, batches them, and reports per-row validation errors", () => {
    const plan = buildAppForgeImportCommitPlan({
      csv: [
        "Name,Status,Score,Done",
        "Asset A,Approved,7,true",
        ",Blocked,oops,maybe",
        "Asset C,Review,9,false",
      ].join("\n"),
      base: base(),
      targetTableId: "table-1",
      batchSize: 2,
    });

    expect(plan.totalRows).toBe(3);
    expect(plan.validRowCount).toBe(2);
    expect(plan.invalidRowCount).toBe(1);
    expect(plan.skippedInvalidRows).toBe(1);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.map((row) => row.rowNumber)).toEqual([2, 4]);

    const invalid = plan.rows.find((row) => row.rowNumber === 3);
    expect(invalid?.skip).toBe(true);
    expect(invalid?.skipReason).toBe("invalid");
    expect(invalid?.errors.map((error) => error.code)).toEqual([
      "required",
      "invalid_option",
      "invalid_number",
    ]);
  });

  it("clamps batch size to a safe range and honors skipInvalidRows=false", () => {
    const plan = buildAppForgeImportCommitPlan({
      csv: ["Name,Status,Score,Done", "Asset A,Approved,7,true", ",Blocked,oops,maybe"].join("\n"),
      base: base(),
      targetTableId: "table-1",
      batchSize: 9999,
      skipInvalidRows: false,
    });

    // Clamped to MAX_BATCH_SIZE = 500.
    expect(plan.batchSize).toBe(500);
    // skipInvalidRows=false means invalid rows still go into the commit set.
    expect(plan.skippedInvalidRows).toBe(0);
    expect(plan.batches[0]?.map((row) => row.rowNumber)).toEqual([2, 3]);
    expect(plan.rows.every((row) => !row.skip)).toBe(true);
  });

  it("chunks committable rows into multiple batches when totalRows > batchSize", () => {
    const csvRows = ["Name,Score"];
    for (let i = 0; i < 7; i += 1) {
      csvRows.push(`Row ${i},${i}`);
    }
    const plan = buildAppForgeImportCommitPlan({
      csv: csvRows.join("\n"),
      batchSize: 3,
    });
    expect(plan.totalRows).toBe(7);
    expect(plan.batches.map((batch) => batch.length)).toEqual([3, 3, 1]);
    expect(plan.batchSize).toBe(3);
  });
});

describe("AppForge import commit execution", () => {
  it("commits batches sequentially and reports per-row pass/fail", async () => {
    const plan = buildAppForgeImportCommitPlan({
      csv: ["Name,Status,Score,Done", "Asset A,Approved,7,true", "Asset C,Review,9,false"].join(
        "\n",
      ),
      base: base(),
      targetTableId: "table-1",
      batchSize: 1,
      recordIdPrefix: "rec",
    });

    const writes: Array<{ recordId: string; rowNumber: number; batchIndex: number }> = [];
    const writeRecord: AppForgeImportWriteRecordFn = vi.fn(async (record, ctx) => {
      writes.push({ recordId: record.id, rowNumber: ctx.rowNumber, batchIndex: ctx.batchIndex });
      return { ok: true, record };
    });

    const report = await executeAppForgeImportCommit(plan, writeRecord, {
      nowIso: "2026-05-13T00:00:00.000Z",
    });

    expect(report.totalRows).toBe(2);
    expect(report.attempted).toBe(2);
    expect(report.committed).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.skippedInvalid).toBe(0);
    expect(report.batchCount).toBe(2);
    expect(writes).toEqual([
      { recordId: "rec-1", rowNumber: 2, batchIndex: 0 },
      { recordId: "rec-2", rowNumber: 3, batchIndex: 1 },
    ]);
    expect(report.rows.map((row) => row.ok)).toEqual([true, true]);
  });

  it("surfaces invalid rows as skipped without invoking writeRecord", async () => {
    const plan = buildAppForgeImportCommitPlan({
      csv: ["Name,Status,Score,Done", "Asset A,Approved,7,true", ",Blocked,oops,maybe"].join("\n"),
      base: base(),
      targetTableId: "table-1",
    });

    const writeRecord: AppForgeImportWriteRecordFn = vi.fn(async (record) => ({
      ok: true,
      record,
    }));

    const report = await executeAppForgeImportCommit(plan, writeRecord);

    expect(report.committed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.skippedInvalid).toBe(1);
    expect(writeRecord).toHaveBeenCalledTimes(1);

    const failed = report.rows.find((row) => row.rowNumber === 3);
    expect(failed?.ok).toBe(false);
    expect(failed?.reason).toBe("invalid");
    expect(failed?.errors?.map((error) => error.code)).toEqual([
      "required",
      "invalid_option",
      "invalid_number",
    ]);
  });

  it("captures per-row write failures and continues across batches", async () => {
    const plan = buildAppForgeImportCommitPlan({
      csv: ["Name,Score", "Asset A,1", "Asset B,2", "Asset C,3"].join("\n"),
      batchSize: 2,
    });

    const writeRecord: AppForgeImportWriteRecordFn = async (record: AppForgeRecord, ctx) => {
      if (ctx.rowNumber === 3) {
        return { ok: false, message: "duplicate row" };
      }
      if (ctx.rowNumber === 4) {
        throw new Error("boom");
      }
      return { ok: true, record };
    };

    const report = await executeAppForgeImportCommit(plan, writeRecord);

    expect(report.attempted).toBe(3);
    expect(report.committed).toBe(1);
    expect(report.failed).toBe(2);
    expect(report.rows.map((row) => row.ok)).toEqual([true, false, false]);
    expect(report.rows[1]?.message).toBe("duplicate row");
    expect(report.rows[2]?.message).toBe("boom");
    expect(report.rows[1]?.reason).toBe("write_failed");
    expect(report.rows[2]?.reason).toBe("write_failed");
  });
});
