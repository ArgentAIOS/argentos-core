import { describe, expect, it } from "vitest";
import type { ForgeStructuredField } from "../../hooks/useForgeStructuredData";
import {
  TIMELINE_DEFAULT_RANGE_DAYS,
  TIMELINE_MAX_RANGE_DAYS,
  TIMELINE_MIN_RANGE_DAYS,
  buildDayAxis,
  buildTimelineEntries,
  clampRangeDays,
  diffInDays,
  groupEntriesByLane,
  laneKeyForValue,
  parseTimelineDate,
  positionEntry,
  resolveTimelineDateFields,
  resolveTimelineLaneField,
  shiftDays,
  startOfDay,
} from "./timeline-bucket";

function field(id: string, type: ForgeStructuredField["type"]): ForgeStructuredField {
  return { id, name: id, type };
}

describe("parseTimelineDate", () => {
  it("delegates to the calendar parser contract for valid inputs", () => {
    expect(parseTimelineDate("2026-05-16")).toBeInstanceOf(Date);
    expect(parseTimelineDate(new Date("2026-05-16"))).toBeInstanceOf(Date);
    expect(parseTimelineDate(1_750_000_000_000)).toBeInstanceOf(Date);
  });

  it("returns null for missing / invalid / nonsensical inputs", () => {
    expect(parseTimelineDate(undefined)).toBeNull();
    expect(parseTimelineDate(null)).toBeNull();
    expect(parseTimelineDate("")).toBeNull();
    expect(parseTimelineDate("not a date")).toBeNull();
    expect(parseTimelineDate({})).toBeNull();
    expect(parseTimelineDate(Number.NaN)).toBeNull();
  });
});

describe("resolveTimelineDateFields", () => {
  it("prefers the (start, end) pair when both name real date fields", () => {
    const fields = [
      field("name", "text"),
      field("kicked_off", "date"),
      field("ships", "date"),
      field("retro", "date"),
    ];
    const { start, end } = resolveTimelineDateFields(fields, "kicked_off", "retro");
    expect(start?.id).toBe("kicked_off");
    expect(end?.id).toBe("retro");
  });

  it("falls back to the first two date fields when the preferred pair is wrong type", () => {
    const fields = [field("name", "text"), field("kicked_off", "date"), field("ships", "date")];
    // `name` is a text field — preference is rejected as half-valid.
    const { start, end } = resolveTimelineDateFields(fields, "name", "ships");
    expect(start?.id).toBe("kicked_off");
    expect(end?.id).toBe("ships");
  });

  it("uses the single date field for both slots when only one exists", () => {
    const fields = [field("name", "text"), field("ships", "date")];
    const { start, end } = resolveTimelineDateFields(fields);
    expect(start?.id).toBe("ships");
    expect(end?.id).toBe("ships");
  });

  it("returns nulls when the table has no date fields", () => {
    const fields = [field("name", "text"), field("notes", "long_text")];
    expect(resolveTimelineDateFields(fields)).toEqual({ start: null, end: null });
  });

  it("falls back when only the end preference is supplied (no half-picking)", () => {
    const fields = [field("name", "text"), field("kicked_off", "date"), field("ships", "date")];
    const { start, end } = resolveTimelineDateFields(fields, undefined, "ships");
    // Only `endId` named — preference fully rejected, falls back to first two.
    expect(start?.id).toBe("kicked_off");
    expect(end?.id).toBe("ships");
  });
});

describe("resolveTimelineLaneField", () => {
  it("returns null when no preference is supplied", () => {
    const fields = [field("name", "text"), field("status", "single_select")];
    expect(resolveTimelineLaneField(fields)).toBeNull();
  });

  it("returns the matching field by id (any field type is allowed)", () => {
    const fields = [field("name", "text"), field("status", "single_select")];
    expect(resolveTimelineLaneField(fields, "status")?.id).toBe("status");
    expect(resolveTimelineLaneField(fields, "name")?.id).toBe("name");
  });

  it("returns null when the named field doesn't exist", () => {
    const fields = [field("status", "single_select")];
    expect(resolveTimelineLaneField(fields, "missing")).toBeNull();
  });
});

describe("laneKeyForValue", () => {
  it("maps strings to themselves (trimmed)", () => {
    expect(laneKeyForValue("In Progress")).toEqual({ key: "In Progress", label: "In Progress" });
    expect(laneKeyForValue("  Planning  ")).toEqual({ key: "Planning", label: "Planning" });
  });

  it("maps arrays to their first non-empty entry", () => {
    expect(laneKeyForValue(["", "Design", "QA"])).toEqual({ key: "Design", label: "Design" });
  });

  it("maps booleans to Yes / No", () => {
    expect(laneKeyForValue(true)).toEqual({ key: "true", label: "Yes" });
    expect(laneKeyForValue(false)).toEqual({ key: "false", label: "No" });
  });

  it("maps null / undefined / empty / whitespace-only to the ungrouped lane", () => {
    expect(laneKeyForValue(null)).toEqual({ key: "", label: "Ungrouped" });
    expect(laneKeyForValue(undefined)).toEqual({ key: "", label: "Ungrouped" });
    expect(laneKeyForValue("")).toEqual({ key: "", label: "Ungrouped" });
    expect(laneKeyForValue("   ")).toEqual({ key: "", label: "Ungrouped" });
    expect(laneKeyForValue([])).toEqual({ key: "", label: "Ungrouped" });
  });
});

describe("buildTimelineEntries", () => {
  type Rec = { id: string; start: string; end?: string; lane?: string };
  const records: Rec[] = [
    { id: "r1", start: "2026-05-10", end: "2026-05-14", lane: "Design" },
    { id: "r2", start: "2026-05-12", end: "2026-05-13", lane: "Engineering" },
    { id: "r3", start: "2026-05-08", end: "2026-05-09" },
    { id: "r4", start: "not-a-date", end: "2026-05-10" },
    { id: "r5", start: "2026-05-20" },
    { id: "r6", start: "2026-05-25", end: "2026-05-20", lane: "Design" }, // swapped
  ];

  it("drops records with no valid start date and sorts the rest by start ascending", () => {
    const entries = buildTimelineEntries(records, {
      extractStart: (r) => r.start,
      extractEnd: (r) => r.end,
    });
    // r4 dropped (invalid start). Sorted by start ascending: r3, r1, r2, r5, r6.
    expect(entries.map((e) => e.record.id)).toEqual(["r3", "r1", "r2", "r5", "r6"]);
  });

  it("treats records missing a valid end as single-day events (end = start)", () => {
    const entries = buildTimelineEntries(records, {
      extractStart: (r) => r.start,
      extractEnd: (r) => r.end,
    });
    const r5 = entries.find((e) => e.record.id === "r5")!;
    expect(r5.startDate.toDateString()).toBe(r5.endDate.toDateString());
  });

  it("swaps inverted (end < start) date pairs so bars always render left-to-right", () => {
    const entries = buildTimelineEntries(records, {
      extractStart: (r) => r.start,
      extractEnd: (r) => r.end,
    });
    const r6 = entries.find((e) => e.record.id === "r6")!;
    expect(r6.startDate.getTime()).toBeLessThanOrEqual(r6.endDate.getTime());
  });

  it("assigns the All lane when no lane extractor is provided", () => {
    const entries = buildTimelineEntries(records, {
      extractStart: (r) => r.start,
      extractEnd: (r) => r.end,
    });
    for (const entry of entries) {
      expect(entry.laneKey).toBe("");
      expect(entry.laneLabel).toBe("All");
    }
  });

  it("assigns lanes derived from the extractor when one is provided", () => {
    const entries = buildTimelineEntries(records, {
      extractStart: (r) => r.start,
      extractEnd: (r) => r.end,
      extractLane: (r) => r.lane,
    });
    const r1 = entries.find((e) => e.record.id === "r1")!;
    const r2 = entries.find((e) => e.record.id === "r2")!;
    const r3 = entries.find((e) => e.record.id === "r3")!;
    expect(r1.laneKey).toBe("Design");
    expect(r2.laneKey).toBe("Engineering");
    // r3 has no lane value → ungrouped.
    expect(r3.laneKey).toBe("");
    expect(r3.laneLabel).toBe("Ungrouped");
  });
});

describe("groupEntriesByLane", () => {
  it("preserves insertion order of lane keys", () => {
    const entries = buildTimelineEntries(
      [
        { id: "r1", start: "2026-05-10", lane: "Design" },
        { id: "r2", start: "2026-05-11", lane: "Engineering" },
        { id: "r3", start: "2026-05-12", lane: "Design" },
      ],
      {
        extractStart: (r) => r.start,
        extractEnd: () => undefined,
        extractLane: (r) => r.lane,
      },
    );
    const lanes = groupEntriesByLane(entries);
    expect(Array.from(lanes.keys())).toEqual(["Design", "Engineering"]);
    expect(lanes.get("Design")?.entries.map((e) => e.record.id)).toEqual(["r1", "r3"]);
    expect(lanes.get("Engineering")?.entries.map((e) => e.record.id)).toEqual(["r2"]);
  });
});

describe("day math helpers", () => {
  it("startOfDay anchors a Date at 00:00 local on the same calendar day", () => {
    const noon = new Date(2026, 4, 16, 13, 45, 17);
    const anchored = startOfDay(noon);
    expect(anchored.getFullYear()).toBe(2026);
    expect(anchored.getMonth()).toBe(4);
    expect(anchored.getDate()).toBe(16);
    expect(anchored.getHours()).toBe(0);
    expect(anchored.getMinutes()).toBe(0);
    expect(anchored.getSeconds()).toBe(0);
  });

  it("shiftDays adds days correctly across month boundaries", () => {
    expect(shiftDays(new Date(2026, 4, 30), 3).toDateString()).toBe(
      new Date(2026, 5, 2).toDateString(),
    );
    expect(shiftDays(new Date(2026, 4, 1), -1).toDateString()).toBe(
      new Date(2026, 3, 30).toDateString(),
    );
  });

  it("diffInDays returns whole-day deltas regardless of time-of-day", () => {
    const a = new Date(2026, 4, 16, 23, 45);
    const b = new Date(2026, 4, 10, 0, 5);
    expect(diffInDays(a, b)).toBe(6);
    expect(diffInDays(b, a)).toBe(-6);
    expect(diffInDays(a, a)).toBe(0);
  });
});

describe("clampRangeDays", () => {
  it("clamps below the minimum and above the maximum", () => {
    expect(clampRangeDays(3)).toBe(TIMELINE_MIN_RANGE_DAYS);
    expect(clampRangeDays(9999)).toBe(TIMELINE_MAX_RANGE_DAYS);
    expect(clampRangeDays(45)).toBe(45);
  });

  it("falls back to the default for non-finite inputs", () => {
    expect(clampRangeDays(Number.NaN)).toBe(TIMELINE_DEFAULT_RANGE_DAYS);
    expect(clampRangeDays(Number.POSITIVE_INFINITY)).toBe(TIMELINE_DEFAULT_RANGE_DAYS);
  });
});

describe("buildDayAxis", () => {
  it("produces a contiguous run of day cells starting at rangeStart", () => {
    const start = new Date(2026, 4, 16); // May 16 2026
    // `10` is above the clamp floor; using a sub-floor value would fail
    // the clamp check below.
    const cells = buildDayAxis(start, 10, start);
    expect(cells).toHaveLength(10);
    expect(cells[0]?.date.toDateString()).toBe(new Date(2026, 4, 16).toDateString());
    expect(cells[9]?.date.toDateString()).toBe(new Date(2026, 4, 25).toDateString());
  });

  it("marks the cell matching `today`", () => {
    const start = new Date(2026, 4, 16);
    const cells = buildDayAxis(start, 7, new Date(2026, 4, 18));
    const todays = cells.filter((c) => c.isToday).map((c) => c.date.getDate());
    expect(todays).toEqual([18]);
  });

  it("clamps rangeDays to the supported window", () => {
    const start = new Date(2026, 4, 16);
    expect(buildDayAxis(start, 3, start)).toHaveLength(TIMELINE_MIN_RANGE_DAYS);
    expect(buildDayAxis(start, 9999, start)).toHaveLength(TIMELINE_MAX_RANGE_DAYS);
  });
});

describe("positionEntry", () => {
  const rangeStart = new Date(2026, 4, 16); // anchor day 0

  it("positions an entry fully inside the window", () => {
    const result = positionEntry(
      { startDate: new Date(2026, 4, 18), endDate: new Date(2026, 4, 20) },
      rangeStart,
      30,
    );
    expect(result).toEqual({ startIndex: 2, spanDays: 3, visible: true });
  });

  it("clamps a left-edge overhang to startIndex 0", () => {
    const result = positionEntry(
      { startDate: new Date(2026, 4, 10), endDate: new Date(2026, 4, 17) },
      rangeStart,
      30,
    );
    // Bar starts before rangeStart — clamp to 0; spans through index 1.
    expect(result.startIndex).toBe(0);
    expect(result.spanDays).toBe(2);
    expect(result.visible).toBe(true);
  });

  it("clamps a right-edge overhang to the window end", () => {
    const result = positionEntry(
      { startDate: new Date(2026, 4, 28), endDate: new Date(2026, 6, 10) },
      rangeStart,
      30, // window covers May 16..Jun 14
    );
    expect(result.startIndex).toBe(12); // May 28 = day 12
    expect(result.startIndex + result.spanDays).toBe(30);
    expect(result.visible).toBe(true);
  });

  it("returns visible:false for an entry entirely before the window", () => {
    const result = positionEntry(
      { startDate: new Date(2026, 3, 1), endDate: new Date(2026, 3, 10) },
      rangeStart,
      30,
    );
    expect(result.visible).toBe(false);
  });

  it("returns visible:false for an entry entirely after the window", () => {
    const result = positionEntry(
      { startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 10) },
      rangeStart,
      30,
    );
    expect(result.visible).toBe(false);
  });

  it("gives single-day events a span of 1, not 0", () => {
    const result = positionEntry(
      { startDate: new Date(2026, 4, 18), endDate: new Date(2026, 4, 18) },
      rangeStart,
      30,
    );
    expect(result).toEqual({ startIndex: 2, spanDays: 1, visible: true });
  });
});
