import { describe, expect, it } from "vitest";
import {
  bucketRecordsByDate,
  buildMonthGrid,
  dateBucketKey,
  monthOf,
  parseCalendarDate,
  shiftMonth,
} from "./calendar-bucket";

describe("dateBucketKey", () => {
  it("returns YYYY-MM-DD in local time and ignores time-of-day", () => {
    // Two timestamps on the same local day must collide. Use a midnight
    // and a near-midnight to keep the assertion robust under any TZ.
    const morning = new Date(2026, 4, 16, 0, 5, 0); // May 16 2026 00:05 local
    const evening = new Date(2026, 4, 16, 23, 55, 0); // May 16 2026 23:55 local
    const morningKey = dateBucketKey(morning);
    expect(morningKey).toBe("2026-05-16");
    expect(dateBucketKey(evening)).toBe(morningKey);
  });

  it("pads month and day with leading zeros", () => {
    const date = new Date(2026, 0, 3); // Jan 3 2026
    expect(dateBucketKey(date)).toBe("2026-01-03");
  });
});

describe("parseCalendarDate", () => {
  it("accepts Date, string, and number inputs", () => {
    const fromDate = parseCalendarDate(new Date(2026, 4, 16));
    const fromString = parseCalendarDate("2026-05-16T18:00:00.000Z");
    const fromNumber = parseCalendarDate(new Date(2026, 4, 16).getTime());
    expect(fromDate).toBeInstanceOf(Date);
    expect(fromString).toBeInstanceOf(Date);
    expect(fromNumber).toBeInstanceOf(Date);
  });

  it("returns null for empty, whitespace, or unparseable input", () => {
    expect(parseCalendarDate(undefined)).toBeNull();
    expect(parseCalendarDate(null)).toBeNull();
    expect(parseCalendarDate("")).toBeNull();
    expect(parseCalendarDate("   ")).toBeNull();
    expect(parseCalendarDate("not a real date")).toBeNull();
    expect(parseCalendarDate(Number.NaN)).toBeNull();
    expect(parseCalendarDate({ when: "2026-05-16" })).toBeNull();
    expect(parseCalendarDate(["2026-05-16"])).toBeNull();
  });

  it("rejects an Invalid Date instance", () => {
    expect(parseCalendarDate(new Date("nope"))).toBeNull();
  });
});

describe("bucketRecordsByDate", () => {
  type Row = { id: string; when: unknown };

  it("groups same-day records into one bucket and silently drops invalid dates", () => {
    const rows: Row[] = [
      { id: "a", when: new Date(2026, 4, 16, 9, 0) },
      { id: "b", when: new Date(2026, 4, 16, 14, 30) },
      { id: "c", when: new Date(2026, 4, 17, 9, 0) },
      { id: "skip-empty", when: "" },
      { id: "skip-null", when: null },
      { id: "skip-bad", when: "not a date" },
    ];
    const buckets = bucketRecordsByDate(rows, (row) => row.when);
    expect(buckets.size).toBe(2);
    expect(buckets.get("2026-05-16")?.map((entry) => entry.record.id)).toEqual(["a", "b"]);
    expect(buckets.get("2026-05-17")?.map((entry) => entry.record.id)).toEqual(["c"]);
  });

  it("sorts records within a bucket by parsed timestamp ascending", () => {
    const rows: Row[] = [
      { id: "late", when: new Date(2026, 4, 16, 20, 0) },
      { id: "early", when: new Date(2026, 4, 16, 6, 0) },
      { id: "mid", when: new Date(2026, 4, 16, 12, 0) },
    ];
    const buckets = bucketRecordsByDate(rows, (row) => row.when);
    expect(buckets.get("2026-05-16")?.map((entry) => entry.record.id)).toEqual([
      "early",
      "mid",
      "late",
    ]);
  });

  it("returns an empty map when given no records", () => {
    expect(bucketRecordsByDate<Row>([], (row) => row.when).size).toBe(0);
  });
});

describe("buildMonthGrid", () => {
  it("produces exactly 42 cells starting on the Sunday on/before the 1st", () => {
    // May 1 2026 is a Friday; the grid should start on Sunday Apr 26 2026.
    const grid = buildMonthGrid({ year: 2026, month: 4 }, new Date(2026, 4, 16));
    expect(grid).toHaveLength(42);
    expect(grid[0]?.date.getDay()).toBe(0); // Sunday
    expect(grid[0]?.key).toBe("2026-04-26");
    expect(grid[6]?.date.getDay()).toBe(6); // Saturday
    // First in-month cell is May 1.
    const firstInMonth = grid.find((cell) => cell.inCurrentMonth);
    expect(firstInMonth?.key).toBe("2026-05-01");
  });

  it("flags today and in-month cells correctly", () => {
    const today = new Date(2026, 4, 16);
    const grid = buildMonthGrid({ year: 2026, month: 4 }, today);
    const todayCell = grid.find((cell) => cell.key === "2026-05-16");
    expect(todayCell?.isToday).toBe(true);
    expect(todayCell?.inCurrentMonth).toBe(true);
    const aprilCell = grid.find((cell) => cell.key === "2026-04-30");
    expect(aprilCell?.inCurrentMonth).toBe(false);
    expect(aprilCell?.isToday).toBe(false);
  });

  it("starts on the 1st when the 1st falls on a Sunday", () => {
    // Feb 1 2026 is a Sunday.
    const grid = buildMonthGrid({ year: 2026, month: 1 }, new Date(2026, 1, 1));
    expect(grid[0]?.key).toBe("2026-02-01");
    expect(grid[0]?.inCurrentMonth).toBe(true);
  });
});

describe("shiftMonth + monthOf", () => {
  it("shifts forward and wraps across year boundaries", () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, 12)).toEqual({ year: 2027, month: 0 });
  });

  it("shifts backward and wraps across year boundaries", () => {
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth({ year: 2026, month: 0 }, -13)).toEqual({ year: 2024, month: 11 });
  });

  it("monthOf extracts year+month from a Date", () => {
    expect(monthOf(new Date(2026, 4, 16))).toEqual({ year: 2026, month: 4 });
  });
});
