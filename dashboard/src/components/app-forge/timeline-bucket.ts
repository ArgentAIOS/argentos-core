/**
 * Pure helpers for the AppForge Timeline view.
 *
 * Substrate-style: pure functions, no React. Tested independently so the
 * date-range bucketing + horizontal-axis position math can be verified
 * without standing up the dashboard.
 *
 * Reuses `parseCalendarDate` + `dateBucketKey` from calendar-bucket so
 * the two views share a single date-parsing contract (timezone-local,
 * silently drops invalid dates). Per the next-slice constraint we do
 * NOT refactor calendar-bucket.ts itself — we just import as-is.
 *
 * Date-field detection
 * --------------------
 * Timeline needs TWO date fields (start + end) instead of Calendar's one
 * date field. `resolveTimelineDateFields` prefers a caller-supplied pair
 * if both name real date fields, otherwise falls back to the first two
 * date fields on the table (by position). If only one date field exists,
 * it is used for BOTH start and end (single-day events). If zero date
 * fields exist, both slots resolve to `null` and the renderer shows the
 * empty state.
 *
 * Axis math
 * ---------
 * `buildDayAxis` produces a contiguous run of day cells starting at
 * `rangeStart` and lasting `rangeDays` days. `positionEntry` computes the
 * `(startIndex, spanDays)` of an entry within that window, clamped to
 * the visible range. Entries that don't intersect the window get
 * `visible: false` so the renderer can drop them.
 */

import type { ForgeStructuredField } from "../../hooks/useForgeStructuredData";
import { dateBucketKey, parseCalendarDate } from "./calendar-bucket";

export const TIMELINE_DEFAULT_RANGE_DAYS = 30;
export const TIMELINE_MIN_RANGE_DAYS = 7;
export const TIMELINE_MAX_RANGE_DAYS = 180;

/** A single record's resolved start/end + optional swimlane key. */
export type TimelineEntry<TRecord> = {
  record: TRecord;
  startDate: Date;
  endDate: Date;
  laneKey: string;
  laneLabel: string;
};

/** A single day cell on the horizontal axis. */
export type TimelineDayCell = {
  date: Date;
  key: string;
  isToday: boolean;
  /** Day-of-week 0-6 (Sun=0). Useful for weekend striping. */
  weekday: number;
};

/**
 * Re-export the calendar parser so callers don't have to know which
 * helper module owns the date-parsing contract. Both views must agree
 * on what "a valid date" means — currently calendar-bucket is the
 * source of truth.
 */
export function parseTimelineDate(value: unknown): Date | null {
  return parseCalendarDate(value);
}

/**
 * Resolve the (start, end) field pair that drives the timeline.
 *
 * Precedence:
 *   1. `preferredStartId` + `preferredEndId` if BOTH name real
 *      `type === "date"` fields. Mixed validity is treated as "no
 *      preference" so we don't half-pick — falls through to (2).
 *   2. The first two date fields on the table by position. If only one
 *      exists, `end = start` (single-day events).
 *   3. `{ start: null, end: null }` when the table has no date fields.
 */
export function resolveTimelineDateFields(
  fields: readonly ForgeStructuredField[],
  preferredStartId?: string,
  preferredEndId?: string,
): { start: ForgeStructuredField | null; end: ForgeStructuredField | null } {
  if (preferredStartId && preferredEndId) {
    const start = fields.find((field) => field.id === preferredStartId && field.type === "date");
    const end = fields.find((field) => field.id === preferredEndId && field.type === "date");
    if (start && end) {
      return { start, end };
    }
  }
  const dateFields = fields.filter((field) => field.type === "date");
  if (dateFields.length === 0) {
    return { start: null, end: null };
  }
  if (dateFields.length === 1) {
    const only = dateFields[0]!;
    return { start: only, end: only };
  }
  return { start: dateFields[0]!, end: dateFields[1]! };
}

/**
 * Resolve the (optional) swimlane field. Returns `null` when the caller
 * doesn't supply a preference or the named field doesn't exist on the
 * table. Any field type is allowed — `single_select`, `text`, `number`,
 * etc. all serialize cleanly to a lane key.
 */
export function resolveTimelineLaneField(
  fields: readonly ForgeStructuredField[],
  preferredLaneFieldId?: string,
): ForgeStructuredField | null {
  if (!preferredLaneFieldId) {
    return null;
  }
  return fields.find((field) => field.id === preferredLaneFieldId) ?? null;
}

/**
 * Normalize an arbitrary record value into a swimlane key. Arrays
 * collapse to their first non-empty entry (mirrors how kanban groups by
 * single-select). Empty / missing values become the "ungrouped" lane.
 */
export function laneKeyForValue(value: unknown): { key: string; label: string } {
  if (value === null || value === undefined) {
    return { key: "", label: "Ungrouped" };
  }
  if (Array.isArray(value)) {
    const first = value.find(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
    if (!first) {
      return { key: "", label: "Ungrouped" };
    }
    const label = first.trim();
    return { key: label, label };
  }
  if (typeof value === "boolean") {
    return value ? { key: "true", label: "Yes" } : { key: "false", label: "No" };
  }
  const stringified = String(value).trim();
  if (!stringified) {
    return { key: "", label: "Ungrouped" };
  }
  return { key: stringified, label: stringified };
}

/**
 * Build the typed entry list for a timeline.
 *
 * - Records with no valid start date are silently dropped (calendar
 *   contract — timeline must never crash on dirty input).
 * - Records with a valid start but no valid end fall back to a
 *   single-day event (end = start). This lets a table with one date
 *   column still render meaningfully.
 * - If `endDate < startDate` we swap them so the bar always renders
 *   left-to-right. (Operator-visible date inversion is a data-quality
 *   bug worth surfacing later; for v1 we just stay rendering.)
 * - Within each lane, entries are sorted by start-time ascending so the
 *   visual sweep reads left-to-right.
 */
export function buildTimelineEntries<TRecord>(
  records: readonly TRecord[],
  options: {
    extractStart: (record: TRecord) => unknown;
    extractEnd: (record: TRecord) => unknown;
    extractLane?: (record: TRecord) => unknown;
  },
): TimelineEntry<TRecord>[] {
  const entries: TimelineEntry<TRecord>[] = [];
  for (const record of records) {
    const startParsed = parseTimelineDate(options.extractStart(record));
    if (!startParsed) {
      continue;
    }
    const endParsed = parseTimelineDate(options.extractEnd(record));
    let startDate = startParsed;
    let endDate = endParsed ?? startParsed;
    if (endDate.getTime() < startDate.getTime()) {
      [startDate, endDate] = [endDate, startDate];
    }
    const laneRaw = options.extractLane?.(record);
    const lane = options.extractLane ? laneKeyForValue(laneRaw) : { key: "", label: "All" };
    entries.push({ record, startDate, endDate, laneKey: lane.key, laneLabel: lane.label });
  }
  entries.sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
  return entries;
}

/**
 * Group entries into a stable lane order. Returns `Map<laneKey,
 * { label, entries }>` so the renderer can stride lanes in insertion
 * order (= first-occurrence order in the input record list).
 */
export function groupEntriesByLane<TRecord>(
  entries: readonly TimelineEntry<TRecord>[],
): Map<string, { label: string; entries: TimelineEntry<TRecord>[] }> {
  const lanes = new Map<string, { label: string; entries: TimelineEntry<TRecord>[] }>();
  for (const entry of entries) {
    const existing = lanes.get(entry.laneKey);
    if (existing) {
      existing.entries.push(entry);
    } else {
      lanes.set(entry.laneKey, { label: entry.laneLabel, entries: [entry] });
    }
  }
  return lanes;
}

/**
 * Return a Date at 00:00 local time on the same calendar day as `date`.
 * Used so range math doesn't drift across DST or time-of-day.
 */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Add `delta` days to `date`, returning a new Date anchored at 00:00
 * local time on the resulting day.
 */
export function shiftDays(date: Date, delta: number): Date {
  const base = startOfDay(date);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
}

/**
 * Whole-day diff between two Dates, anchored at 00:00 local. Always
 * returns an integer >= 0 when `later >= earlier`, otherwise negative.
 */
export function diffInDays(later: Date, earlier: Date): number {
  const msPerDay = 86_400_000;
  const a = startOfDay(later).getTime();
  const b = startOfDay(earlier).getTime();
  return Math.round((a - b) / msPerDay);
}

/**
 * Clamp `rangeDays` to a sane window so the renderer can't accidentally
 * paint 10,000 day cells.
 */
export function clampRangeDays(rangeDays: number): number {
  if (!Number.isFinite(rangeDays)) {
    return TIMELINE_DEFAULT_RANGE_DAYS;
  }
  const rounded = Math.round(rangeDays);
  if (rounded < TIMELINE_MIN_RANGE_DAYS) {
    return TIMELINE_MIN_RANGE_DAYS;
  }
  if (rounded > TIMELINE_MAX_RANGE_DAYS) {
    return TIMELINE_MAX_RANGE_DAYS;
  }
  return rounded;
}

/**
 * Build the day-cell array that anchors the horizontal axis. The first
 * cell is `startOfDay(rangeStart)` and subsequent cells step by one
 * local day. `rangeDays` is clamped before use.
 */
export function buildDayAxis(
  rangeStart: Date,
  rangeDays: number,
  today: Date = new Date(),
): TimelineDayCell[] {
  const safeDays = clampRangeDays(rangeDays);
  const anchor = startOfDay(rangeStart);
  const todayKey = dateBucketKey(today);
  const cells: TimelineDayCell[] = [];
  for (let offset = 0; offset < safeDays; offset += 1) {
    const cellDate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + offset);
    const key = dateBucketKey(cellDate);
    cells.push({
      date: cellDate,
      key,
      isToday: key === todayKey,
      weekday: cellDate.getDay(),
    });
  }
  return cells;
}

/**
 * Compute the visible position of a timeline entry within a window.
 *
 * - `startIndex` is the day-cell index where the bar begins (>= 0,
 *   clamped to 0 when the entry starts before the window).
 * - `spanDays` is the number of day cells the bar covers (>= 1,
 *   inclusive of both start and end days).
 * - `visible` is true when ANY part of [startDate, endDate] intersects
 *   the window. When false, `startIndex` / `spanDays` are still numbers
 *   for ease-of-use but the renderer should drop the bar entirely.
 */
export function positionEntry(
  entry: { startDate: Date; endDate: Date },
  rangeStart: Date,
  rangeDays: number,
): { startIndex: number; spanDays: number; visible: boolean } {
  const safeDays = clampRangeDays(rangeDays);
  const rawStart = diffInDays(entry.startDate, rangeStart);
  // Bar spans (endDay - startDay) + 1 to cover both endpoints inclusively
  // (a single-day event has span 1, not 0).
  const rawEnd = diffInDays(entry.endDate, rangeStart);
  const windowEnd = safeDays - 1;
  if (rawEnd < 0 || rawStart > windowEnd) {
    return { startIndex: 0, spanDays: 0, visible: false };
  }
  const startIndex = Math.max(0, rawStart);
  const endIndex = Math.min(windowEnd, rawEnd);
  const spanDays = Math.max(1, endIndex - startIndex + 1);
  return { startIndex, spanDays, visible: true };
}
