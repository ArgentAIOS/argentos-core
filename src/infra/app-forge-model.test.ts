import { describe, expect, it } from "vitest";
import {
  APP_FORGE_DEFAULT_RATING_MAX,
  APP_FORGE_MAX_RATING_MAX,
  APP_FORGE_MIN_RATING_MAX,
  APP_FORGE_SAVED_VIEW_TYPES,
  checkAppForgeRevision,
  coerceAppForgeRatingValue,
  migrateLegacyLocalStorageSavedView,
  normalizeAppForgeSavedView,
  normalizeAppForgeSavedViews,
  projectLegacyAppForgeBase,
  resolveAppForgeRatingMax,
  validateAppForgeFieldDefinitions,
  validateAppForgeRecordValues,
  validateAppForgeSavedViews,
  type AppForgeField,
  type AppForgeSavedView,
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

  it("validates rating field values and rejects out-of-range or non-integer ratings", () => {
    const ratingFields: AppForgeField[] = [
      { id: "score", name: "Score", type: "rating" },
      { id: "hot", name: "Hotness", type: "rating", ratingMax: 10, ratingIcon: "flame" },
    ];

    const ok = validateAppForgeRecordValues(ratingFields, {
      score: 4,
      hot: "9",
    });
    expect(ok.ok).toBe(true);
    expect(ok.values).toEqual({ score: 4, hot: 9 });

    const empty = validateAppForgeRecordValues(ratingFields, {
      score: "",
      hot: null,
    });
    expect(empty.ok).toBe(true);
    expect(empty.values).toEqual({ score: 0, hot: 0 });

    const tooHigh = validateAppForgeRecordValues(ratingFields, {
      score: 6,
      hot: 11,
    });
    expect(tooHigh.ok).toBe(false);
    expect(tooHigh.errors.map((error) => error.code)).toEqual(["invalid_rating", "invalid_rating"]);

    const negative = validateAppForgeRecordValues(ratingFields, { score: -1, hot: -2 });
    expect(negative.ok).toBe(false);
    expect(negative.errors.every((error) => error.code === "invalid_rating")).toBe(true);

    const nonNumeric = validateAppForgeRecordValues(ratingFields, {
      score: "five",
      hot: { stars: 3 },
    });
    expect(nonNumeric.ok).toBe(false);
    expect(nonNumeric.errors.every((error) => error.code === "invalid_rating")).toBe(true);
  });

  it("rejects rating fields whose ratingMax falls outside the supported range", () => {
    const result = validateAppForgeFieldDefinitions([
      { id: "tiny", name: "Tiny", type: "rating", ratingMax: 2 },
      { id: "huge", name: "Huge", type: "rating", ratingMax: 99 },
      { id: "frac", name: "Frac", type: "rating", ratingMax: 4.5 },
      { id: "ok", name: "OK", type: "rating", ratingMax: 5 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      "invalid_rating_max",
      "invalid_rating_max",
      "invalid_rating_max",
    ]);
  });

  it("resolveAppForgeRatingMax clamps + falls back to the default for garbage input", () => {
    expect(resolveAppForgeRatingMax({})).toBe(APP_FORGE_DEFAULT_RATING_MAX);
    expect(resolveAppForgeRatingMax({ ratingMax: 5 })).toBe(5);
    expect(resolveAppForgeRatingMax({ ratingMax: 0 })).toBe(APP_FORGE_MIN_RATING_MAX);
    expect(resolveAppForgeRatingMax({ ratingMax: 999 })).toBe(APP_FORGE_MAX_RATING_MAX);
    expect(resolveAppForgeRatingMax({ ratingMax: Number.NaN })).toBe(APP_FORGE_DEFAULT_RATING_MAX);
    expect(resolveAppForgeRatingMax({ ratingMax: 7.6 })).toBe(7);
  });

  it("coerceAppForgeRatingValue rounds, clamps null on invalid, and returns 0 on empty", () => {
    const field = { ratingMax: 5 };
    expect(coerceAppForgeRatingValue(field, 3.49)).toBe(3);
    expect(coerceAppForgeRatingValue(field, "4")).toBe(4);
    expect(coerceAppForgeRatingValue(field, "")).toBe(0);
    expect(coerceAppForgeRatingValue(field, null)).toBe(0);
    expect(coerceAppForgeRatingValue(field, 6)).toBeNull();
    expect(coerceAppForgeRatingValue(field, -1)).toBeNull();
    expect(coerceAppForgeRatingValue(field, "not-a-rating")).toBeNull();
  });

  it("coerceAppForgeRatingValue snaps to 0.5 increments when allowHalf is enabled", () => {
    const field = { ratingMax: 5, allowHalf: true };
    expect(coerceAppForgeRatingValue(field, 3.5)).toBe(3.5);
    expect(coerceAppForgeRatingValue(field, 3.74)).toBe(3.5);
    expect(coerceAppForgeRatingValue(field, 3.76)).toBe(4);
    expect(coerceAppForgeRatingValue(field, "4.25")).toBe(4.5);
    expect(coerceAppForgeRatingValue(field, 5.5)).toBeNull();
    expect(coerceAppForgeRatingValue(field, "")).toBe(0);
    // Existing integer-only path must remain bit-identical without allowHalf.
    expect(coerceAppForgeRatingValue({ ratingMax: 5 }, 3.5)).toBe(4);
    expect(coerceAppForgeRatingValue({ ratingMax: 5, allowHalf: false }, 3.5)).toBe(4);
  });

  it("validates half-rating record values only when the field opts in", () => {
    const halfFields: AppForgeField[] = [
      { id: "score", name: "Score", type: "rating", allowHalf: true },
      { id: "intFlame", name: "Heat", type: "rating", ratingMax: 10, ratingIcon: "flame" },
    ];

    // Half-step values flow through unchanged when allowHalf is on.
    const ok = validateAppForgeRecordValues(halfFields, { score: 3.5, intFlame: 7 });
    expect(ok.ok).toBe(true);
    expect(ok.values).toEqual({ score: 3.5, intFlame: 7 });

    // Quarter / arbitrary fractional input is gracefully snapped: 3.25 → 3.5
    // when allowHalf is on, 4.5 → 5 when allowHalf is off. This mirrors the
    // existing integer-only behavior where half input silently rounded to int,
    // and matches the AirTable UX (type 4.7, get 4.5 — never an error toast).
    const snapped = validateAppForgeRecordValues(halfFields, { score: 3.25, intFlame: 4.5 });
    expect(snapped.ok).toBe(true);
    expect(snapped.values).toEqual({ score: 3.5, intFlame: 5 });
  });

  it("preserves rating metadata when projecting legacy bases", () => {
    const base = projectLegacyAppForgeBase({
      id: "app-rating",
      name: "Inbound",
      metadata: {
        appForge: {
          structured: {
            baseId: "base-rating",
            activeTableId: "table-rating",
            tables: [
              {
                id: "table-rating",
                name: "Leads",
                fields: [
                  { id: "name", name: "Name", type: "text", required: true },
                  {
                    id: "score",
                    name: "Score",
                    type: "rating",
                    ratingMax: 7,
                    ratingIcon: "heart",
                  },
                ],
                records: [
                  { id: "row-1", values: { name: "Lead A", score: "4.6" } },
                  { id: "row-2", values: { name: "Lead B", score: 9 } },
                ],
              },
            ],
          },
        },
      },
    });
    expect(base.tables[0]?.fields[1]).toMatchObject({
      type: "rating",
      ratingMax: 7,
      ratingIcon: "heart",
    });
    expect(base.tables[0]?.records[0]?.values.score).toBe(5);
    // Out-of-range value falls back to null per coerceAppForgeRatingValue.
    expect(base.tables[0]?.records[1]?.values.score).toBeNull();
  });

  it("round-trips allowHalf metadata + half-step values through the legacy projection", () => {
    const base = projectLegacyAppForgeBase({
      id: "app-half-rating",
      name: "Reviews",
      metadata: {
        appForge: {
          structured: {
            baseId: "base-half",
            activeTableId: "table-half",
            tables: [
              {
                id: "table-half",
                name: "Movies",
                fields: [
                  { id: "name", name: "Name", type: "text", required: true },
                  {
                    id: "score",
                    name: "Score",
                    type: "rating",
                    ratingMax: 5,
                    ratingIcon: "star",
                    allowHalf: true,
                  },
                ],
                records: [
                  { id: "row-1", values: { name: "Movie A", score: "4.5" } },
                  // Quarter-step input is snapped to nearest 0.5 by the coercer.
                  { id: "row-2", values: { name: "Movie B", score: "3.74" } },
                ],
              },
            ],
          },
        },
      },
    });
    expect(base.tables[0]?.fields[1]).toMatchObject({
      type: "rating",
      ratingMax: 5,
      ratingIcon: "star",
      allowHalf: true,
    });
    expect(base.tables[0]?.records[0]?.values.score).toBe(4.5);
    expect(base.tables[0]?.records[1]?.values.score).toBe(3.5);
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

describe("AppForge durable saved views (Phase 4 gap #1)", () => {
  it("exposes the full set of Airtable-parity view kinds", () => {
    expect(APP_FORGE_SAVED_VIEW_TYPES).toEqual(["grid", "kanban", "form", "review", "calendar"]);
  });

  it("normalizes a candidate into a typed saved view, defaulting unknown types to grid", () => {
    const view = normalizeAppForgeSavedView({
      id: "view-pipeline",
      name: "Pipeline",
      type: "calendar",
      filterText: "Open",
      sortFieldId: "close_date",
      sortDirection: "desc",
      groupFieldId: "stage",
      visibleFieldIds: ["name", "stage", "close_date"],
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:05:00.000Z",
    });
    expect(view).toEqual({
      id: "view-pipeline",
      name: "Pipeline",
      type: "calendar",
      filterText: "Open",
      sortFieldId: "close_date",
      sortDirection: "desc",
      groupFieldId: "stage",
      visibleFieldIds: ["name", "stage", "close_date"],
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:05:00.000Z",
    });

    // Unknown / missing type folds to "grid" rather than dropping the view —
    // we want the operator's named view to survive an upstream schema bump.
    expect(normalizeAppForgeSavedView({ id: "v", name: "Untyped", type: "gantt" })).toMatchObject({
      id: "v",
      name: "Untyped",
      type: "grid",
    });
    expect(normalizeAppForgeSavedView({ id: "v", name: "No type" })).toMatchObject({
      type: "grid",
    });

    // sortDirection that isn't asc/desc must NOT round-trip — otherwise a
    // legacy "none" entry would leak back out of the durable store.
    expect(
      normalizeAppForgeSavedView({
        id: "v",
        name: "Bad sort",
        type: "grid",
        sortDirection: "none",
      }),
    ).not.toHaveProperty("sortDirection");
  });

  it("drops candidates that are missing required identity fields", () => {
    expect(normalizeAppForgeSavedView(null)).toBeNull();
    expect(normalizeAppForgeSavedView("not an object")).toBeNull();
    expect(normalizeAppForgeSavedView({ name: "No id", type: "grid" })).toBeNull();
    expect(normalizeAppForgeSavedView({ id: "v", type: "grid" })).toBeNull();
    expect(normalizeAppForgeSavedView({ id: "  ", name: "Whitespace", type: "grid" })).toBeNull();
  });

  it("normalizes an array of views and drops invalid entries silently", () => {
    expect(
      normalizeAppForgeSavedViews([
        { id: "view-1", name: "All", type: "grid" },
        null,
        { name: "No id", type: "grid" },
        { id: "view-2", name: "Kanban", type: "kanban", visibleFieldIds: ["a", "b"] },
        "not-an-object",
      ]),
    ).toEqual([
      expect.objectContaining({ id: "view-1", name: "All", type: "grid" }),
      expect.objectContaining({ id: "view-2", name: "Kanban", type: "kanban" }),
    ]);
    expect(normalizeAppForgeSavedViews(undefined)).toEqual([]);
    expect(normalizeAppForgeSavedViews("not an array")).toEqual([]);
  });

  it("validates saved views against the parent table fields", () => {
    const fields: Pick<AppForgeField, "id">[] = [{ id: "name" }, { id: "stage" }];
    const views: AppForgeSavedView[] = [
      { id: "v-1", name: "Pipeline", type: "kanban", groupFieldId: "stage" },
      { id: "v-1", name: "Duplicate Id", type: "grid" },
      { id: "v-2", name: "Pipeline", type: "grid" }, // duplicate name (case-insensitive)
      {
        id: "v-3",
        name: "Unknown Sort",
        type: "grid",
        sortFieldId: "ghost",
        sortDirection: "asc",
      },
      { id: "v-4", name: "Unknown Group", type: "kanban", groupFieldId: "ghost" },
      {
        id: "v-5",
        name: "Unknown Visible",
        type: "grid",
        visibleFieldIds: ["name", "ghost"],
      },
    ];
    const result = validateAppForgeSavedViews(views, fields);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      "duplicate_view_id",
      "duplicate_view_name",
      "unknown_sort_field",
      "unknown_group_field",
      "unknown_visible_field",
    ]);
  });

  it("only runs structural checks when fields are omitted (backward-compat for legacy callers)", () => {
    const result = validateAppForgeSavedViews([
      { id: "v-1", name: "Stage", type: "kanban", groupFieldId: "stage-that-does-not-exist" },
      { id: "v-2", name: "Default", type: "grid", visibleFieldIds: ["ghost"] },
    ]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects views with missing names or ids when running structural checks", () => {
    const result = validateAppForgeSavedViews([
      { id: "", name: "No id", type: "grid" },
      { id: "v-2", name: "  ", type: "grid" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(["missing_id", "missing_name"]);
  });

  it("migrates legacy localStorage view shapes into the durable model", () => {
    // The localStorage cache used "kind" before settling on "type". Confirm
    // legacy entries cross over cleanly so operators don't lose their views.
    expect(
      migrateLegacyLocalStorageSavedView({
        id: "view-leads",
        name: "Leads",
        kind: "kanban",
        groupFieldId: "stage",
      }),
    ).toMatchObject({ id: "view-leads", name: "Leads", type: "kanban", groupFieldId: "stage" });

    // The even-older AppForgeNamedView shape used "viewMode" — verify that
    // legacy shape also folds without losing data.
    expect(
      migrateLegacyLocalStorageSavedView({
        id: "view-review",
        name: "Needs Review",
        viewMode: "review",
        filterText: "urgent",
      }),
    ).toMatchObject({
      id: "view-review",
      name: "Needs Review",
      type: "review",
      filterText: "urgent",
    });

    // Modern entries continue to round-trip unchanged.
    expect(
      migrateLegacyLocalStorageSavedView({
        id: "view-grid",
        name: "All",
        type: "grid",
      }),
    ).toMatchObject({ id: "view-grid", name: "All", type: "grid" });
  });
});
