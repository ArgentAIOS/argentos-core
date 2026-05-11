import { describe, expect, it } from "vitest";
import {
  buildRelationPickerCandidates,
  filterRelationPickerCandidates,
  isValidEmailInput,
  isValidNumberInput,
  isValidUrlInput,
  parseLinkedRecordValue,
  parseMultiSelectValue,
  parseRatingDraftValue,
  pickRelationTitleField,
  resolveRelationLabel,
  serializeLinkedRecordValue,
  serializeMultiSelectValue,
  serializeRatingDraftValue,
  type RelationPickerCandidate,
  type RelationPickerSourceField,
  type RelationPickerSourceRecord,
} from "./app-forge-cell-editing.js";

describe("app-forge cell editing — multi-select helpers", () => {
  it("parses comma- and newline-separated input into a deduped trimmed list", () => {
    expect(parseMultiSelectValue("VIP, Investor\nVIP, Partner ")).toEqual([
      "VIP",
      "Investor",
      "Partner",
    ]);
  });

  it("returns an empty array for empty or whitespace input", () => {
    expect(parseMultiSelectValue("")).toEqual([]);
    expect(parseMultiSelectValue("   ")).toEqual([]);
  });

  it("serializes a list of selected labels with comma separators and dedupes", () => {
    expect(serializeMultiSelectValue(["A", "B", "A", ""])).toBe("A, B");
  });

  it("round-trips parse/serialize idempotently", () => {
    const initial = "Strategic, Quick win, Renewal";
    const round = serializeMultiSelectValue(parseMultiSelectValue(initial));
    expect(round).toBe(initial);
  });
});

describe("app-forge cell editing — URL validation", () => {
  it("treats empty input as valid (clears the cell)", () => {
    expect(isValidUrlInput("")).toBe(true);
    expect(isValidUrlInput("   ")).toBe(true);
  });

  it("accepts well-formed URLs", () => {
    expect(isValidUrlInput("https://example.com")).toBe(true);
    expect(isValidUrlInput("http://localhost:8092/path?x=1")).toBe(true);
    expect(isValidUrlInput("mailto:test@example.com")).toBe(true);
  });

  it("rejects malformed URL input", () => {
    expect(isValidUrlInput("not a url")).toBe(false);
    expect(isValidUrlInput("just-a-bare-word")).toBe(false);
  });
});

describe("app-forge cell editing — number validation", () => {
  it("treats empty input as valid (clears the cell)", () => {
    expect(isValidNumberInput("")).toBe(true);
    expect(isValidNumberInput("   ")).toBe(true);
  });

  it("accepts numeric input including signed, decimal, and exponent forms", () => {
    expect(isValidNumberInput("0")).toBe(true);
    expect(isValidNumberInput("42")).toBe(true);
    expect(isValidNumberInput("-3.14")).toBe(true);
    expect(isValidNumberInput("1e3")).toBe(true);
    expect(isValidNumberInput("  7 ")).toBe(true);
  });

  it("rejects non-numeric and ambiguous input", () => {
    expect(isValidNumberInput("abc")).toBe(false);
    expect(isValidNumberInput("12 dogs")).toBe(false);
    expect(isValidNumberInput("1.2.3")).toBe(false);
    expect(isValidNumberInput("Infinity")).toBe(false);
    expect(isValidNumberInput("NaN")).toBe(false);
  });
});

describe("app-forge cell editing — email validation", () => {
  it("treats empty input as valid (clears the cell)", () => {
    expect(isValidEmailInput("")).toBe(true);
    expect(isValidEmailInput("   ")).toBe(true);
  });

  it("accepts well-formed addresses", () => {
    expect(isValidEmailInput("ada@example.com")).toBe(true);
    expect(isValidEmailInput("ada+tag@example.co")).toBe(true);
    expect(isValidEmailInput(" ada@example.com ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmailInput("ada")).toBe(false);
    expect(isValidEmailInput("ada@")).toBe(false);
    expect(isValidEmailInput("ada@localhost")).toBe(false);
    expect(isValidEmailInput("ada @example.com")).toBe(false);
  });
});

describe("app-forge cell editing — linked-record value parsing", () => {
  it("parses comma-separated record IDs and dedupes", () => {
    expect(parseLinkedRecordValue("rec-1, rec-2, rec-1")).toEqual(["rec-1", "rec-2"]);
  });

  it("parses array-shaped values (gateway-mirrored shape)", () => {
    expect(parseLinkedRecordValue(["rec-1", " rec-2 ", "", "rec-1"])).toEqual(["rec-1", "rec-2"]);
  });

  it("returns empty list for null/undefined/empty input", () => {
    expect(parseLinkedRecordValue("")).toEqual([]);
    expect(parseLinkedRecordValue("   ")).toEqual([]);
    expect(parseLinkedRecordValue(null)).toEqual([]);
    expect(parseLinkedRecordValue(undefined)).toEqual([]);
  });

  it("serializes selected IDs into the canonical comma-separated form", () => {
    expect(serializeLinkedRecordValue(["rec-1", "rec-2"])).toBe("rec-1, rec-2");
  });

  it("round-trips parse/serialize without drift", () => {
    const stored = "rec-1, rec-2, rec-3";
    expect(serializeLinkedRecordValue(parseLinkedRecordValue(stored))).toBe(stored);
  });
});

describe("app-forge cell editing — relation picker title field", () => {
  it("prefers a literal name field when present", () => {
    const fields: RelationPickerSourceField[] = [
      { id: "id", name: "ID" },
      { id: "name", name: "Name" },
      { id: "status", name: "Status" },
    ];
    expect(pickRelationTitleField(fields)).toEqual({ id: "name", name: "Name" });
  });

  it("matches the name field case-insensitively", () => {
    const fields: RelationPickerSourceField[] = [
      { id: "id", name: "ID" },
      { id: "name", name: "name" },
    ];
    expect(pickRelationTitleField(fields)).toEqual({ id: "name", name: "name" });
  });

  it("falls back to the first field when no name field exists", () => {
    const fields: RelationPickerSourceField[] = [
      { id: "title", name: "Title" },
      { id: "owner", name: "Owner" },
    ];
    expect(pickRelationTitleField(fields)).toEqual({ id: "title", name: "Title" });
  });

  it("returns null for an empty field list", () => {
    expect(pickRelationTitleField([])).toBeNull();
  });
});

describe("app-forge cell editing — relation picker candidates", () => {
  const fields: RelationPickerSourceField[] = [
    { id: "name", name: "Name" },
    { id: "status", name: "Status" },
  ];
  const records: RelationPickerSourceRecord[] = [
    { id: "rec-1", values: { name: "Acme Corp", status: "Active" } },
    { id: "rec-2", values: { name: "Globex", status: "Active" } },
    { id: "rec-3", values: { name: "Initech", status: "Archived" } },
  ];

  it("builds candidates with labels resolved from the title field", () => {
    expect(buildRelationPickerCandidates(fields, records)).toEqual([
      { id: "rec-1", label: "Acme Corp" },
      { id: "rec-2", label: "Globex" },
      { id: "rec-3", label: "Initech" },
    ]);
  });

  it("falls back to the record ID when the title cell is empty", () => {
    const sparseRecords: RelationPickerSourceRecord[] = [
      { id: "rec-1", values: {} },
      { id: "rec-2", values: { name: "" } },
      { id: "rec-3", values: { name: "Globex" } },
    ];
    expect(buildRelationPickerCandidates(fields, sparseRecords)).toEqual([
      { id: "rec-1", label: "rec-1" },
      { id: "rec-2", label: "rec-2" },
      { id: "rec-3", label: "Globex" },
    ]);
  });

  it("flattens array-shaped title values (e.g. multi_select used as title)", () => {
    const arrayRecords: RelationPickerSourceRecord[] = [
      { id: "rec-1", values: { name: ["Acme", "Corp"] } },
    ];
    expect(buildRelationPickerCandidates(fields, arrayRecords)).toEqual([
      { id: "rec-1", label: "Acme, Corp" },
    ]);
  });

  it("uses the first field when no `name` field exists", () => {
    const altFields: RelationPickerSourceField[] = [
      { id: "title", name: "Title" },
      { id: "summary", name: "Summary" },
    ];
    const altRecords: RelationPickerSourceRecord[] = [
      { id: "rec-1", values: { title: "Press release" } },
    ];
    expect(buildRelationPickerCandidates(altFields, altRecords)).toEqual([
      { id: "rec-1", label: "Press release" },
    ]);
  });
});

describe("app-forge cell editing — relation picker filter", () => {
  const candidates: RelationPickerCandidate[] = [
    { id: "rec-acme", label: "Acme Corp" },
    { id: "rec-globex", label: "Globex" },
    { id: "rec-initech", label: "Initech" },
    { id: "rec-soylent", label: "Soylent" },
  ];

  it("returns all candidates when query is empty", () => {
    expect(filterRelationPickerCandidates(candidates, "", [])).toEqual(candidates);
  });

  it("filters candidates by case-insensitive label substring", () => {
    expect(filterRelationPickerCandidates(candidates, "GLO", [])).toEqual([
      { id: "rec-globex", label: "Globex" },
    ]);
  });

  it("matches against the candidate ID so users can paste a known record ID", () => {
    expect(filterRelationPickerCandidates(candidates, "soylent", [])).toEqual([
      { id: "rec-soylent", label: "Soylent" },
    ]);
    expect(filterRelationPickerCandidates(candidates, "rec-init", [])).toEqual([
      { id: "rec-initech", label: "Initech" },
    ]);
  });

  it("excludes already-selected IDs from the result", () => {
    expect(filterRelationPickerCandidates(candidates, "", ["rec-acme", "rec-soylent"])).toEqual([
      { id: "rec-globex", label: "Globex" },
      { id: "rec-initech", label: "Initech" },
    ]);
  });

  it("caps the result at the configured limit", () => {
    const big: RelationPickerCandidate[] = Array.from({ length: 200 }, (_, i) => ({
      id: `rec-${i}`,
      label: `Record ${i}`,
    }));
    expect(filterRelationPickerCandidates(big, "Record", [], 5)).toHaveLength(5);
  });

  it("returns an empty list when no candidate matches", () => {
    expect(filterRelationPickerCandidates(candidates, "xyz-no-match", [])).toEqual([]);
  });
});

describe("app-forge cell editing — relation label resolution", () => {
  const candidates: RelationPickerCandidate[] = [
    { id: "rec-1", label: "Acme Corp" },
    { id: "rec-2", label: "Globex" },
  ];

  it("resolves a known record ID to its display label", () => {
    expect(resolveRelationLabel("rec-1", candidates)).toBe("Acme Corp");
  });

  it("falls back to the raw ID for orphan / cross-base / deleted links", () => {
    expect(resolveRelationLabel("rec-deleted", candidates)).toBe("rec-deleted");
  });

  it("returns empty string for empty IDs", () => {
    expect(resolveRelationLabel("", candidates)).toBe("");
  });
});

describe("app-forge cell editing — rating draft helpers", () => {
  it("treats empty/whitespace input as a cleared cell (0)", () => {
    expect(parseRatingDraftValue("", 5)).toBe(0);
    expect(parseRatingDraftValue("   ", 5)).toBe(0);
  });

  it("rounds half-stars and parses valid string ratings", () => {
    expect(parseRatingDraftValue("3", 5)).toBe(3);
    expect(parseRatingDraftValue("3.4", 5)).toBe(3);
    expect(parseRatingDraftValue("3.6", 5)).toBe(4);
  });

  it("returns null for out-of-range or non-numeric drafts", () => {
    expect(parseRatingDraftValue("6", 5)).toBeNull();
    expect(parseRatingDraftValue("-1", 5)).toBeNull();
    expect(parseRatingDraftValue("garbage", 5)).toBeNull();
  });

  it("serializes a rating value, omitting zero so cleared cells render as empty drafts", () => {
    expect(serializeRatingDraftValue(0)).toBe("");
    expect(serializeRatingDraftValue(-1)).toBe("");
    expect(serializeRatingDraftValue(3)).toBe("3");
    expect(serializeRatingDraftValue(3.6)).toBe("4");
  });
});
