import { describe, expect, it } from "vitest";
import {
  checkAppForgeRevision,
  projectLegacyAppForgeBase,
  validateAppForgeFieldDefinitions,
  validateAppForgeRecordValues,
  type AppForgeField,
} from "./app-forge-model.js";

describe("AppForge core model", () => {
  const fields: AppForgeField[] = [
    { id: "name", name: "Name", type: "text", required: true },
    { id: "notes", name: "Notes", type: "long_text" },
    { id: "status", name: "Status", type: "single_select", options: ["Planning", "Review"] },
    { id: "score", name: "Score", type: "number" },
    { id: "done", name: "Done", type: "checkbox" },
    { id: "due", name: "Due", type: "date" },
    { id: "tags", name: "Tags", type: "multi_select", options: ["Design", "Launch"] },
    { id: "files", name: "Files", type: "attachment" },
    { id: "related", name: "Related", type: "linked_record" },
    { id: "email", name: "Email", type: "email" },
    { id: "url", name: "URL", type: "url" },
  ];

  it("validates and coerces record values by field type", () => {
    const result = validateAppForgeRecordValues(fields, {
      name: "Campaign",
      notes: "Line one\nLine two",
      status: "Review",
      score: "42",
      done: "true",
      due: "2026-05-01",
      tags: ["Design", "Launch"],
      files: "brief.pdf, https://example.com/mock.png",
      related: "record-1,\nrecord-2",
      email: "operator@example.com",
      url: "https://example.com/review",
      extra: "ignored",
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.values).toEqual({
      name: "Campaign",
      notes: "Line one\nLine two",
      status: "Review",
      score: 42,
      done: true,
      due: "2026-05-01",
      tags: ["Design", "Launch"],
      files: ["brief.pdf", "https://example.com/mock.png"],
      related: ["record-1", "record-2"],
      email: "operator@example.com",
      url: "https://example.com/review",
    });
  });

  it("rejects required, typed, and select option violations", () => {
    const result = validateAppForgeRecordValues(fields, {
      name: "",
      status: "Blocked",
      score: "not-a-number",
      done: {},
      due: "05/01/2026",
      tags: ["Design", "Bad"],
      files: { id: "asset-1" },
      related: { id: "record-1" },
      email: "operator",
      url: "not a url",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      "required",
      "invalid_option",
      "invalid_number",
      "invalid_boolean",
      "invalid_date",
      "invalid_option",
      "invalid_array",
      "invalid_array",
      "invalid_email",
      "invalid_url",
    ]);
  });

  it("validates field definitions before they become durable table metadata", () => {
    const result = validateAppForgeFieldDefinitions([
      { id: "name", name: "", type: "text" },
      { id: "name", name: "Duplicate Name", type: "text" },
      {
        id: "status",
        name: "Status",
        type: "single_select",
        selectOptions: [
          { id: "opt-open", label: "Open" },
          { id: "opt-empty", label: "" },
          { id: "opt-open-2", label: "Open" },
        ],
        defaultValue: "Missing",
      },
      {
        id: "files",
        name: "Files",
        type: "attachment",
        defaultValue: ["brief.pdf"],
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      "missing_name",
      "duplicate_field_id",
      "missing_option",
      "duplicate_option",
      "invalid_default",
      "invalid_default",
    ]);
  });

  it("uses rich select options when validating record values and defaults", () => {
    const fieldsWithRichOptions: AppForgeField[] = [
      {
        id: "status",
        name: "Status",
        type: "single_select",
        selectOptions: [
          { id: "opt-plan", label: "Planning", color: "sky" },
          { id: "opt-review", label: "Review", color: "amber" },
        ],
        defaultValue: "Review",
      },
    ];

    expect(validateAppForgeFieldDefinitions(fieldsWithRichOptions)).toEqual({
      ok: true,
      errors: [],
    });
    expect(validateAppForgeRecordValues(fieldsWithRichOptions, { status: "Review" })).toMatchObject(
      { ok: true, values: { status: "Review" } },
    );
    expect(
      validateAppForgeRecordValues(fieldsWithRichOptions, { status: "Blocked" }).errors,
    ).toEqual([expect.objectContaining({ code: "invalid_option" })]);
  });

  it("returns a conflict when expected revision is stale", () => {
    expect(checkAppForgeRevision(3, undefined)).toEqual({ ok: true });
    expect(checkAppForgeRevision(3, 3)).toEqual({ ok: true });
    expect(checkAppForgeRevision(3, 2)).toEqual({
      ok: false,
      code: "revision_conflict",
      expectedRevision: 2,
      actualRevision: 3,
      message: "Expected revision 2, found 3.",
    });
  });

  it("projects legacy metadata-backed structured apps into a core base", () => {
    const base = projectLegacyAppForgeBase({
      id: "app-1",
      name: "Campaign Review",
      description: "Review workspace",
      updatedAt: "2026-04-25T20:00:00.000Z",
      metadata: {
        appForge: {
          structured: {
            baseId: "base-1",
            activeTableId: "table-1",
            revision: 7,
            tables: [
              {
                id: "table-1",
                name: "Reviews",
                revision: 2,
                fields: [
                  { id: "name", name: "Name", type: "text", required: true },
                  { id: "notes", name: "Notes", type: "long_text" },
                  {
                    id: "status",
                    name: "Status",
                    type: "single_select",
                    defaultValue: "Review",
                    selectOptions: [{ id: "opt-review", label: "Review", color: "amber" }],
                  },
                  { id: "score", name: "Score", type: "number" },
                  { id: "files", name: "Files", type: "attachment" },
                  { id: "related", name: "Related", type: "linked_record" },
                ],
                records: [
                  {
                    id: "record-1",
                    revision: 4,
                    values: {
                      name: "Asset",
                      notes: "Needs second review",
                      status: "Review",
                      score: "5",
                      files: "brief.pdf, https://example.com/mock.png",
                      related: ["record-2"],
                      ignored: true,
                    },
                    createdAt: "2026-04-25T20:00:00.000Z",
                    updatedAt: "2026-04-25T21:00:00.000Z",
                  },
                  { values: { name: "Missing id" } },
                ],
              },
            ],
          },
        },
      },
    });

    expect(base).toMatchObject({
      id: "base-1",
      appId: "app-1",
      activeTableId: "table-1",
      revision: 7,
    });
    expect(base.tables[0]).toMatchObject({ id: "table-1", revision: 2 });
    expect(base.tables[0]?.records).toHaveLength(1);
    expect(base.tables[0]?.records[0]).toMatchObject({
      id: "record-1",
      revision: 4,
      values: {
        name: "Asset",
        notes: "Needs second review",
        status: "Review",
        score: 5,
        files: ["brief.pdf", "https://example.com/mock.png"],
        related: ["record-2"],
      },
    });
    expect(base.tables[0]?.fields[2]).toMatchObject({
      defaultValue: "Review",
      options: ["Review"],
      selectOptions: [{ id: "opt-review", label: "Review", color: "amber" }],
    });
  });
});
