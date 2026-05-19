import { useMemo, useState } from "react";
import {
  type ForgeStructuredField,
  type ForgeStructuredRecord,
  type ForgeStructuredRecordValue,
} from "../../hooks/useForgeStructuredData";
import {
  TIMELINE_DEFAULT_RANGE_DAYS,
  buildDayAxis,
  buildTimelineEntries,
  groupEntriesByLane,
  positionEntry,
  resolveTimelineDateFields,
  resolveTimelineLaneField,
  shiftDays,
} from "./timeline-bucket";

/**
 * AppForge Gantt view (v1, read-only, MINIMAL).
 *
 * Bars-on-axis ONLY. Renders a horizontal day axis at the top and one
 * row per swimlane below it. Each record draws as a horizontal bar
 * positioned by its (start, end) date pair. That's it.
 *
 * **Explicitly out of scope for v1** (deferred to v1.1 follow-up PRs):
 *   - Dependency lines (arrows between records)
 *   - Critical path highlighting
 *   - Hierarchical grouping with parent/child indent
 *   - Collapse chevrons
 *   - Linked-record traversal
 *
 * Date-field selection, swimlane resolution, axis math, and entry
 * positioning are all reused wholesale from the Timeline pure helpers
 * in `./timeline-bucket.ts` — Gantt v1 adds NO new bucket logic of its
 * own (per the consolidation pattern established in PR #365). When the
 * v1.1 follow-ups land, the parts genuinely unique to Gantt (dependency
 * graph traversal, critical path) will get their own `gantt-bucket.ts`.
 *
 * Date-field selection precedence (per Timeline spec):
 *   1. If the saved view supplies BOTH start + end date field ids and
 *      both name real date fields, use them.
 *   2. Otherwise, the first two date fields on the table by position.
 *   3. If only one date field exists, use it for both → single-day events.
 *   4. If zero date fields exist, render the empty state.
 *
 * Swimlane selection: `preferredLaneFieldId` (the saved view's
 * `groupFieldId` slot — same trick Calendar/Gallery/Timeline use). When
 * unset or pointing to a missing field, the Gantt renders a single
 * "All records" lane.
 *
 * v1 is read-only: no drag-to-rebase, no inline edit. Clicking a bar
 * pops the record open via the parent's editor path (mirrors
 * Calendar/Gallery/Timeline).
 */

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const RANGE_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Min cell width keeps the day labels legible on a horizontal scroll. */
const DAY_CELL_PX = 36;

const RANGE_DAYS = TIMELINE_DEFAULT_RANGE_DAYS;

export type GanttViewProps = {
  records: readonly ForgeStructuredRecord[];
  fields: readonly ForgeStructuredField[];
  /**
   * Field id of the start-date column. The durable saved-view shape
   * currently only carries one optional group field id, so for v1
   * callers typically leave this undefined and the component
   * auto-detects the first two date fields. Wired in now so a future
   * settings panel can pin start + end explicitly without renaming the
   * prop.
   */
  preferredStartFieldId?: string;
  /** Field id of the end-date column. See `preferredStartFieldId`. */
  preferredEndFieldId?: string;
  /**
   * Field id the operator picked on the saved view (the kanban
   * `groupFieldId` slot is reused for the swimlane field — same pattern
   * Calendar/Gallery/Timeline use). When undefined or pointing to a
   * missing field, the Gantt renders a single "All records" lane.
   */
  preferredLaneFieldId?: string;
  /**
   * Lookup for the user-visible title of a record. Passed in so the
   * caller controls how name/title is resolved (matches
   * Kanban/Calendar/Gallery/Timeline).
   */
  getRecordTitle: (record: ForgeStructuredRecord) => string;
  /**
   * Open the record-editor surface for `recordId`. v1 just hands this
   * off to the parent which already routes form-style record edits.
   */
  onSelectRecord?: (recordId: string) => void;
  /**
   * Allow the parent to control "today" in tests. Defaults to `new Date()`.
   */
  today?: Date;
};

function fieldValueAsRaw(value: ForgeStructuredRecordValue | undefined): unknown {
  // Mirrors CalendarView/TimelineView: collapse single-element arrays
  // to their value (some date inputs round-trip as `[value]`); leave
  // longer arrays for the parser to reject silently.
  if (Array.isArray(value)) {
    return value.length === 1 ? value[0] : null;
  }
  return value ?? null;
}

function laneValueAsRaw(value: ForgeStructuredRecordValue | undefined): unknown {
  return value ?? null;
}

export function GanttView({
  records,
  fields,
  preferredStartFieldId,
  preferredEndFieldId,
  preferredLaneFieldId,
  getRecordTitle,
  onSelectRecord,
  today,
}: GanttViewProps) {
  const { start: startField, end: endField } = useMemo(
    () => resolveTimelineDateFields(fields, preferredStartFieldId, preferredEndFieldId),
    [fields, preferredStartFieldId, preferredEndFieldId],
  );

  const laneField = useMemo(
    () => resolveTimelineLaneField(fields, preferredLaneFieldId),
    [fields, preferredLaneFieldId],
  );

  const todayDate = useMemo(() => today ?? new Date(), [today]);

  // Anchor the visible window to the week-before-today so "now" lands
  // ~25% in from the left of the axis — matches Asana / Linear timeline
  // ergonomics.
  const [rangeStart, setRangeStart] = useState<Date>(() => shiftDays(todayDate, -7));

  const dayAxis = useMemo(
    () => buildDayAxis(rangeStart, RANGE_DAYS, todayDate),
    [rangeStart, todayDate],
  );

  const entries = useMemo(() => {
    if (!startField || !endField) {
      return [];
    }
    return buildTimelineEntries(records, {
      extractStart: (record) => fieldValueAsRaw(record.values[startField.id]),
      extractEnd: (record) => fieldValueAsRaw(record.values[endField.id]),
      extractLane: laneField ? (record) => laneValueAsRaw(record.values[laneField.id]) : undefined,
    });
  }, [records, startField, endField, laneField]);

  const lanes = useMemo(() => groupEntriesByLane(entries), [entries]);

  if (!startField || !endField) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-sm font-medium text-white/72">
          Add a date field to enable Gantt view.
        </div>
        <div className="max-w-md text-xs leading-5 text-white/45">
          Gantt plots records as bars on a horizontal day axis. Add at least one date column in the
          field inspector — two columns (start + end) light up date-range bars; one column renders
          single-day events.
        </div>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-8 text-center">
        <div className="text-sm font-medium text-white/72">No records to display in this view.</div>
        <div className="max-w-md text-xs leading-5 text-white/45">
          Add a record to this table — or adjust this view&apos;s filter — and the Gantt chart will
          populate automatically.
        </div>
      </div>
    );
  }

  const axisLast = dayAxis[dayAxis.length - 1]?.date ?? rangeStart;
  const rangeLabel = `${RANGE_LABEL_FORMATTER.format(rangeStart)} – ${RANGE_LABEL_FORMATTER.format(
    axisLast,
  )}`;

  const visibleEntryCount = entries.filter(
    (entry) => positionEntry(entry, rangeStart, RANGE_DAYS).visible,
  ).length;

  const dateFieldLabel =
    startField.id === endField.id ? startField.name : `${startField.name} → ${endField.name}`;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/18 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRangeStart((current) => shiftDays(current, -RANGE_DAYS))}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Previous range"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setRangeStart(shiftDays(todayDate, -7))}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setRangeStart((current) => shiftDays(current, RANGE_DAYS))}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Next range"
          >
            ›
          </button>
          <div className="ml-2 text-sm font-medium text-white/78">{rangeLabel}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
          <span className="rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-amber-100/80">
            Gantt v1 · bars only
          </span>
          <span>
            Dates
            <span className="ml-1 rounded-md bg-white/[0.06] px-2 py-0.5 text-white/65">
              {dateFieldLabel}
            </span>
          </span>
          {laneField ? (
            <span>
              Lanes
              <span className="ml-1 rounded-md bg-white/[0.06] px-2 py-0.5 text-white/65">
                {laneField.name}
              </span>
            </span>
          ) : (
            <span className="text-white/35">Group by a field to split into swimlanes.</span>
          )}
          <span className="text-white/35">
            {visibleEntryCount} / {entries.length} in window
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
        <div
          style={{
            gridTemplateColumns: `minmax(140px, 200px) repeat(${dayAxis.length}, ${DAY_CELL_PX}px)`,
          }}
          className="grid"
        >
          {/* Header: top-left lane label slot + day axis labels. */}
          <div className="sticky left-0 z-10 border-b border-r border-white/10 bg-black/45 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-white/40">
            {laneField ? laneField.name : "All records"}
          </div>
          {dayAxis.map((cell) => (
            <div
              key={cell.key}
              className={`border-b border-l border-white/5 px-1 py-2 text-center text-[10px] uppercase tracking-[0.1em] ${
                cell.isToday
                  ? "bg-amber-300/15 text-amber-100"
                  : cell.weekday === 0 || cell.weekday === 6
                    ? "bg-white/[0.02] text-white/35"
                    : "text-white/45"
              }`}
            >
              {DAY_LABEL_FORMATTER.format(cell.date)}
            </div>
          ))}

          {/* Lane rows. */}
          {Array.from(lanes.entries()).map(([laneKey, lane]) => {
            const laneEntries = lane.entries;
            return (
              <GanttLaneRow
                key={laneKey || "__ungrouped__"}
                label={lane.label}
                entries={laneEntries}
                rangeStart={rangeStart}
                dayAxisLength={dayAxis.length}
                dayCellPx={DAY_CELL_PX}
                getRecordTitle={getRecordTitle}
                onSelectRecord={onSelectRecord}
              />
            );
          })}

          {lanes.size === 0 && (
            <div
              className="border-t border-white/10 bg-black/30 px-3 py-8 text-center text-xs text-white/40"
              style={{ gridColumn: `1 / span ${dayAxis.length + 1}` }}
            >
              No records fall in this date range. Try the prev/next buttons or extend a
              record&apos;s date field.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type GanttLaneRowProps = {
  label: string;
  entries: ReadonlyArray<{
    record: ForgeStructuredRecord;
    startDate: Date;
    endDate: Date;
  }>;
  rangeStart: Date;
  dayAxisLength: number;
  dayCellPx: number;
  getRecordTitle: (record: ForgeStructuredRecord) => string;
  onSelectRecord?: (recordId: string) => void;
};

function GanttLaneRow({
  label,
  entries,
  rangeStart,
  dayAxisLength,
  dayCellPx,
  getRecordTitle,
  onSelectRecord,
}: GanttLaneRowProps) {
  const visible = entries
    .map((entry) => ({
      entry,
      position: positionEntry(entry, rangeStart, dayAxisLength),
    }))
    .filter((row) => row.position.visible);

  const laneHeightPx = Math.max(56, 28 + visible.length * 28);

  return (
    <>
      <div
        className="sticky left-0 z-10 flex items-center border-t border-r border-white/10 bg-black/45 px-3 text-xs text-white/65"
        style={{ minHeight: `${laneHeightPx}px` }}
      >
        <span className="truncate" title={label}>
          {label}
        </span>
      </div>
      <div
        className="relative border-t border-white/10 bg-black/25"
        style={{
          gridColumn: `2 / span ${dayAxisLength}`,
          minHeight: `${laneHeightPx}px`,
        }}
      >
        {/* Day gridlines — purely cosmetic, painted as a CSS gradient so we
            don't need 30 extra DOM nodes per lane row. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 1px, transparent 1px)`,
            backgroundSize: `${dayCellPx}px 100%`,
          }}
        />
        {visible.map((row, rowIndex) => {
          const { startIndex, spanDays } = row.position;
          const left = startIndex * dayCellPx;
          const width = Math.max(dayCellPx - 2, spanDays * dayCellPx - 2);
          const top = 8 + rowIndex * 28;
          const title = getRecordTitle(row.entry.record);
          // Gantt visual signature: amber-tinted bars distinct from
          // Timeline's sky-blue. Same shape and click affordance, but
          // visually distinct so operators can tell at a glance which
          // view they're in when switching between them.
          return (
            <button
              key={row.entry.record.id}
              type="button"
              onClick={() => onSelectRecord?.(row.entry.record.id)}
              title={title}
              className="absolute truncate rounded-md border border-amber-300/40 bg-amber-400/25 px-2 py-1 text-left text-[11px] text-amber-50 transition-colors hover:border-amber-200/70 hover:bg-amber-400/40"
              style={{ left: `${left}px`, width: `${width}px`, top: `${top}px`, height: "22px" }}
            >
              {title}
            </button>
          );
        })}
      </div>
    </>
  );
}
