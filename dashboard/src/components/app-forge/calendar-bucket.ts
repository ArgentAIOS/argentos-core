/**
 * Pure helpers for the AppForge Calendar view.
 *
 * Substrate-style: pure functions, no React. Tested independently so the
 * date-bucketing rules can be verified without standing up the dashboard.
 *
 * Timezone contract
 * -----------------
 * All bucketing uses the **local timezone**, not UTC. Operators perceive
 * "today" relative to their wall clock, so a record with timestamp
 * 2026-05-16T23:30:00-05:00 must land in the May 16 bucket for an operator
 * in America/Chicago — not the May 17 UTC day. Bucket keys derive from
 * `Date.toLocaleDateString("en-CA")` which yields a sortable `YYYY-MM-DD`
 * string anchored to the runtime's local timezone.
 *
 * Invalid / missing dates
 * -----------------------
 * `bucketRecordsByDate` silently skips records whose date field is missing,
 * empty, or unparseable. Calendars must never crash on dirty input.
 */

export type CalendarBucketRecord<TRecord> = {
  key: string;
  date: Date;
  record: TRecord;
};

export type CalendarBucketMap<TRecord> = Map<string, CalendarBucketRecord<TRecord>[]>;

export type CalendarMonth = {
  year: number;
  month: number; // 0-11 (matches JS Date.getMonth)
};

export type CalendarDayCell = {
  date: Date;
  key: string;
  inCurrentMonth: boolean;
  isToday: boolean;
};

const ISO_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Stable bucket key for a Date in the runtime's local timezone.
 *
 * Returns YYYY-MM-DD. Equal local-day Dates produce equal keys regardless
 * of time-of-day, so two records on the same local day collide into the
 * same calendar cell.
 */
export function dateBucketKey(date: Date): string {
  return ISO_DATE_FORMATTER.format(date);
}

/**
 * Parse a raw cell value into a Date for bucketing.
 *
 * Returns `null` for any value that can't be turned into a finite Date.
 * Accepts:
 *   - Date instances (passed through, validity checked).
 *   - ISO 8601 strings / any string that the native `Date` constructor can
 *     parse to a finite time.
 *   - Finite numbers (milliseconds since epoch).
 *
 * Anything else (null, undefined, arrays, objects, NaN, Invalid Date) yields
 * `null` so the caller can drop the record silently.
 */
export function parseCalendarDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Group records into bucket keys keyed by local-day.
 *
 * - `extractValue(record)` returns the raw value of the chosen date field.
 * - Records with missing / invalid dates are silently dropped.
 * - Within each bucket records are sorted by parsed time, ascending, so
 *   the renderer can show stable per-day ordering.
 */
export function bucketRecordsByDate<TRecord>(
  records: readonly TRecord[],
  extractValue: (record: TRecord) => unknown,
): CalendarBucketMap<TRecord> {
  const buckets: CalendarBucketMap<TRecord> = new Map();
  for (const record of records) {
    const parsed = parseCalendarDate(extractValue(record));
    if (!parsed) {
      continue;
    }
    const key = dateBucketKey(parsed);
    const bucket = buckets.get(key);
    const entry: CalendarBucketRecord<TRecord> = { key, date: parsed, record };
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(key, [entry]);
    }
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => left.date.getTime() - right.date.getTime());
  }
  return buckets;
}

/**
 * Build the 6×7 day grid that anchors the month at `month` in the year
 * `year`. The grid always contains 42 cells starting on Sunday so the
 * renderer can lay it out as a fixed CSS grid regardless of which day the
 * month begins on.
 *
 * Days outside the focal month are marked `inCurrentMonth: false` so the
 * renderer can de-emphasize them.
 */
export function buildMonthGrid(
  { year, month }: CalendarMonth,
  today: Date = new Date(),
): CalendarDayCell[] {
  const firstOfMonth = new Date(year, month, 1);
  const startDayOfWeek = firstOfMonth.getDay(); // 0 = Sunday
  // Anchor the grid to the Sunday on/before the 1st of the month.
  const gridStart = new Date(year, month, 1 - startDayOfWeek);
  const todayKey = dateBucketKey(today);
  const cells: CalendarDayCell[] = [];
  for (let offset = 0; offset < 42; offset += 1) {
    const cellDate = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + offset,
    );
    const key = dateBucketKey(cellDate);
    cells.push({
      date: cellDate,
      key,
      inCurrentMonth: cellDate.getMonth() === month,
      isToday: key === todayKey,
    });
  }
  return cells;
}

/**
 * Step a {year, month} by `delta` months, wrapping correctly across year
 * boundaries.
 */
export function shiftMonth({ year, month }: CalendarMonth, delta: number): CalendarMonth {
  const totalMonths = year * 12 + month + delta;
  // JS modulo can be negative; coerce into [0,11].
  const normalizedMonth = ((totalMonths % 12) + 12) % 12;
  const normalizedYear = Math.floor(totalMonths / 12);
  return { year: normalizedYear, month: normalizedMonth };
}

/**
 * The CalendarMonth that contains `date`.
 */
export function monthOf(date: Date): CalendarMonth {
  return { year: date.getFullYear(), month: date.getMonth() };
}
