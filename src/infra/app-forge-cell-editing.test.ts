import { describe, expect, it } from "vitest";
import {
  buildRelationPickerCandidates,
  filterRelationPickerCandidates,
  isImageAttachment,
  isValidAttachmentUrl,
  isValidEmailInput,
  isValidNumberInput,
  isValidUrlInput,
  parseAttachmentEntry,
  parseAttachmentValue,
  parseLinkedRecordValue,
  parseMultiSelectValue,
  parseRatingDraftValue,
  pickRelationTitleField,
  resolveRelationLabel,
  serializeAttachmentEntry,
  serializeAttachmentValue,
  serializeLinkedRecordValue,
  serializeMultiSelectValue,
  serializeRatingDraftValue,
  type AttachmentEntry,
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

  describe("with allowHalf enabled", () => {
    it("snaps drafts to the nearest 0.5 increment", () => {
      expect(parseRatingDraftValue("3", 5, true)).toBe(3);
      expect(parseRatingDraftValue("3.5", 5, true)).toBe(3.5);
      expect(parseRatingDraftValue("3.74", 5, true)).toBe(3.5);
      expect(parseRatingDraftValue("3.76", 5, true)).toBe(4);
      expect(parseRatingDraftValue("4.25", 5, true)).toBe(4.5);
    });

    it("still rejects out-of-range half drafts", () => {
      expect(parseRatingDraftValue("5.5", 5, true)).toBeNull();
      expect(parseRatingDraftValue("-0.5", 5, true)).toBeNull();
    });

    it("serializes half ratings without losing precision", () => {
      expect(serializeRatingDraftValue(3.5, true)).toBe("3.5");
      expect(serializeRatingDraftValue(4, true)).toBe("4");
      expect(serializeRatingDraftValue(2.74, true)).toBe("2.5");
    });

    it("treats empty/zero as a cleared cell even with allowHalf on", () => {
      expect(parseRatingDraftValue("", 5, true)).toBe(0);
      expect(serializeRatingDraftValue(0, true)).toBe("");
    });
  });
});

describe("app-forge cell editing — attachment helpers", () => {
  describe("isValidAttachmentUrl", () => {
    it("rejects empty input (attachment entries are positive — empty cells are an empty list)", () => {
      expect(isValidAttachmentUrl("")).toBe(false);
      expect(isValidAttachmentUrl("   ")).toBe(false);
    });

    it("accepts http(s), data:, blob:, and path URLs", () => {
      expect(isValidAttachmentUrl("https://example.com/file.png")).toBe(true);
      expect(isValidAttachmentUrl("http://example.com/file.png")).toBe(true);
      expect(isValidAttachmentUrl("data:image/png;base64,abc")).toBe(true);
      expect(isValidAttachmentUrl("blob:https://app.example.com/abc-123")).toBe(true);
      expect(isValidAttachmentUrl("/uploads/file.pdf")).toBe(true);
    });

    it("rejects malformed input and non-http(s) protocols", () => {
      expect(isValidAttachmentUrl("not a url")).toBe(false);
      expect(isValidAttachmentUrl("ftp://example.com/file.png")).toBe(false);
      expect(isValidAttachmentUrl("javascript:alert(1)")).toBe(false);
    });
  });

  describe("parseAttachmentEntry", () => {
    it("parses bare URLs and derives a filename from the path", () => {
      expect(parseAttachmentEntry("https://example.com/path/photo.jpg")).toEqual({
        name: "photo.jpg",
        url: "https://example.com/path/photo.jpg",
      });
    });

    it("parses the pipe-delimited name|url form", () => {
      expect(parseAttachmentEntry("Receipt.pdf|https://files.example.com/abc.pdf")).toEqual({
        name: "Receipt.pdf",
        url: "https://files.example.com/abc.pdf",
      });
    });

    it("strips whitespace around both sides of the delimiter", () => {
      expect(parseAttachmentEntry("  My Photo  |  https://example.com/p.png  ")).toEqual({
        name: "My Photo",
        url: "https://example.com/p.png",
      });
    });

    it("returns null for unparseable entries", () => {
      expect(parseAttachmentEntry("")).toBeNull();
      expect(parseAttachmentEntry("garbage")).toBeNull();
      expect(parseAttachmentEntry("name only|")).toBeNull();
    });

    it("falls back to a generic label for data: URLs", () => {
      const entry = parseAttachmentEntry("data:image/png;base64,iVBORw0KGgo");
      expect(entry).not.toBeNull();
      expect(entry?.url).toBe("data:image/png;base64,iVBORw0KGgo");
      expect(entry?.name).toBe("Attachment (image/png)");
    });

    it("preserves an explicit name even when the URL has its own filename", () => {
      expect(parseAttachmentEntry("Receipt|https://example.com/path/raw-token.pdf")).toEqual({
        name: "Receipt",
        url: "https://example.com/path/raw-token.pdf",
      });
    });
  });

  describe("serializeAttachmentEntry", () => {
    it("emits the bare URL when the name matches the derived filename", () => {
      expect(
        serializeAttachmentEntry({
          name: "photo.jpg",
          url: "https://example.com/path/photo.jpg",
        }),
      ).toBe("https://example.com/path/photo.jpg");
    });

    it("emits the name|url form when the name is custom", () => {
      expect(
        serializeAttachmentEntry({
          name: "Receipt",
          url: "https://example.com/path/raw-token.pdf",
        }),
      ).toBe("Receipt|https://example.com/path/raw-token.pdf");
    });

    it("collapses pipes inside the name field so the form stays parseable", () => {
      expect(
        serializeAttachmentEntry({
          name: "A|B|C",
          url: "https://example.com/x.pdf",
        }),
      ).toBe("A B C|https://example.com/x.pdf");
    });

    it("returns an empty string for entries with no URL (will be dropped on serialize)", () => {
      expect(serializeAttachmentEntry({ name: "Orphan", url: "" })).toBe("");
    });
  });

  describe("parseAttachmentValue / serializeAttachmentValue", () => {
    it("parses comma-separated stored values into structured entries", () => {
      expect(
        parseAttachmentValue("Receipt|https://example.com/r.pdf, https://example.com/photo.jpg"),
      ).toEqual([
        { name: "Receipt", url: "https://example.com/r.pdf" },
        { name: "photo.jpg", url: "https://example.com/photo.jpg" },
      ]);
    });

    it("parses array-shaped values (gateway-mirrored)", () => {
      expect(
        parseAttachmentValue(["https://example.com/a.png", "Receipt|https://example.com/r.pdf"]),
      ).toEqual([
        { name: "a.png", url: "https://example.com/a.png" },
        { name: "Receipt", url: "https://example.com/r.pdf" },
      ]);
    });

    it("dedupes by URL so two entries pointing at the same file collapse", () => {
      const result = parseAttachmentValue(
        "https://example.com/dup.png, Renamed|https://example.com/dup.png",
      );
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://example.com/dup.png");
    });

    it("drops unparseable entries silently", () => {
      expect(parseAttachmentValue("garbage, https://example.com/ok.png, ftp://bad/no")).toEqual([
        { name: "ok.png", url: "https://example.com/ok.png" },
      ]);
    });

    it("returns an empty list for null / undefined / empty input", () => {
      expect(parseAttachmentValue(null)).toEqual([]);
      expect(parseAttachmentValue(undefined)).toEqual([]);
      expect(parseAttachmentValue("")).toEqual([]);
      expect(parseAttachmentValue([])).toEqual([]);
    });

    it("round-trips parse/serialize without drift on a canonical value", () => {
      const stored = "https://example.com/photo.jpg, Receipt|https://example.com/raw-token.pdf";
      expect(serializeAttachmentValue(parseAttachmentValue(stored))).toBe(stored);
    });

    it("dedupes on serialize as well so a malformed in-memory list cleans up", () => {
      const entries: AttachmentEntry[] = [
        { name: "photo.jpg", url: "https://example.com/photo.jpg" },
        { name: "Same file", url: "https://example.com/photo.jpg" },
      ];
      expect(serializeAttachmentValue(entries)).toBe("https://example.com/photo.jpg");
    });
  });

  describe("isImageAttachment", () => {
    it("returns true for common image extensions", () => {
      for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]) {
        expect(isImageAttachment({ name: `pic.${ext}`, url: `https://example.com/p.${ext}` })).toBe(
          true,
        );
      }
    });

    it("ignores casing and query strings when sniffing the extension", () => {
      expect(
        isImageAttachment({
          name: "p.PNG",
          url: "https://example.com/p.PNG?signature=abc",
        }),
      ).toBe(true);
    });

    it("returns true for data:image/* URLs", () => {
      expect(isImageAttachment({ name: "screenshot", url: "data:image/png;base64,abc" })).toBe(
        true,
      );
    });

    it("returns false for non-image extensions and unknown shapes", () => {
      expect(isImageAttachment({ name: "r.pdf", url: "https://example.com/r.pdf" })).toBe(false);
      expect(isImageAttachment({ name: "", url: "https://example.com/no-ext" })).toBe(false);
      expect(isImageAttachment({ name: "", url: "" })).toBe(false);
    });
  });
});
