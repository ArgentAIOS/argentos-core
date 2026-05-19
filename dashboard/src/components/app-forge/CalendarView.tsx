import { useMemo, useState } from "react";
import {
  type ForgeStructuredField,
  type ForgeStructuredRecord,
  type ForgeStructuredRecordValue,
} from "../../hooks/useForgeStructuredData";
import {
  bucketRecordsByDate,
  buildMonthGrid,
  monthOf,
  shiftMonth,
  type CalendarMonth,
} from "./calendar-bucket";

/**
 * AppForge Calendar view (v1, read-only).
 *
 * Renders a 6×7 month grid keyed off a date field. Records on the same
 * local-day collapse into the same cell with a "+N more" pill when more
 * than three records share a day. v1 has no drag-to-reschedule —
 * clicking a chip simply pops the record open via the parent's editor
 * path (mirrors how Form view selects records).
 *
 * Date-field selection precedence (per spec):
 *   1. `preferredDateFieldId` (the saved view's `groupFieldId`) if it
 *      points to a real date field on the table.
 *   2. The first `type === "date"` field on the table.
 *   3. None — render the empty state asking the operator to add a date
 *      field.
 */

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

const MAX_VISIBLE_PER_CELL = 3;

export type CalendarViewProps = {
  records: readonly ForgeStructuredRecord[];
  fields: readonly ForgeStructuredField[];
  /**
   * Field id the operator picked on the saved view (the kanban groupField
   * slot is reused for the date field). When undefined or pointing to a
   * non-date field, the component falls back to the first date field on
   * the table.
   */
  preferredDateFieldId?: string;
  /**
   * Lookup for the user-visible title of a record. Passed in so the
   * caller controls how name/title is resolved (matches Kanban).
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
  // Arrays of strings (multi-select / linked records) are not date inputs;
  // bucketing helper will return null for them anyway, but we forward as-is
  // so the helper stays the single source of truth on parsing rules.
  if (Array.isArray(value)) {
    return value.length === 1 ? value[0] : null;
  }
  return value ?? null;
}

function resolveDateField(
  fields: readonly ForgeStructuredField[],
  preferredDateFieldId?: string,
): ForgeStructuredField | null {
  if (preferredDateFieldId) {
    const preferred = fields.find(
      (field) => field.id === preferredDateFieldId && field.type === "date",
    );
    if (preferred) {
      return preferred;
    }
  }
  return fields.find((field) => field.type === "date") ?? null;
}

export function CalendarView({
  records,
  fields,
  preferredDateFieldId,
  getRecordTitle,
  onSelectRecord,
  today,
}: CalendarViewProps) {
  const dateField = useMemo(
    () => resolveDateField(fields, preferredDateFieldId),
    [fields, preferredDateFieldId],
  );

  const todayDate = useMemo(() => today ?? new Date(), [today]);

  const [focalMonth, setFocalMonth] = useState<CalendarMonth>(() => monthOf(todayDate));

  const monthGrid = useMemo(() => buildMonthGrid(focalMonth, todayDate), [focalMonth, todayDate]);

  const buckets = useMemo(() => {
    if (!dateField) {
      return new Map<string, never>();
    }
    return bucketRecordsByDate(records, (record) => fieldValueAsRaw(record.values[dateField.id]));
  }, [dateField, records]);

  if (!dateField) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-sm font-medium text-white/72">
          Add a date field to enable Calendar view.
        </div>
        <div className="max-w-md text-xs leading-5 text-white/45">
          Calendar groups records by a date field. Add one in the field inspector — or change this
          view&apos;s grouping field to an existing date column — and the month grid will populate
          automatically.
        </div>
      </div>
    );
  }

  const monthLabel = MONTH_LABEL_FORMATTER.format(new Date(focalMonth.year, focalMonth.month, 1));

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/18 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFocalMonth((current) => shiftMonth(current, -1))}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setFocalMonth(monthOf(todayDate))}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setFocalMonth((current) => shiftMonth(current, 1))}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Next month"
          >
            ›
          </button>
          <div className="ml-2 text-sm font-medium text-white/78">{monthLabel}</div>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40">
          <span>
            Grouping by
            <span className="ml-1 rounded-md bg-white/[0.06] px-2 py-0.5 text-white/65">
              {dateField.name}
            </span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/5">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="bg-black/30 px-2 py-1.5 text-center text-[10px] uppercase tracking-[0.16em] text-white/40"
          >
            {label}
          </div>
        ))}

        {monthGrid.map((cell) => {
          const bucketEntries = buckets.get(cell.key) ?? [];
          const visible = bucketEntries.slice(0, MAX_VISIBLE_PER_CELL);
          const overflow = bucketEntries.length - visible.length;
          return (
            <div
              key={cell.key}
              className={`flex min-h-[96px] flex-col gap-1 bg-black/40 p-1.5 text-left transition-colors ${
                cell.inCurrentMonth ? "" : "opacity-50"
              }`}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 ${
                    cell.isToday
                      ? "bg-sky-400/30 text-sky-50"
                      : cell.inCurrentMonth
                        ? "text-white/65"
                        : "text-white/35"
                  }`}
                >
                  {cell.date.getDate()}
                </span>
                {bucketEntries.length > 0 && (
                  <span className="text-[10px] text-white/30">{bucketEntries.length}</span>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {visible.map((entry) => {
                  const title = getRecordTitle(entry.record);
                  return (
                    <button
                      key={entry.record.id}
                      type="button"
                      onClick={() => onSelectRecord?.(entry.record.id)}
                      title={title}
                      className="truncate rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-1 text-left text-[11px] text-white/75 transition-colors hover:bg-white/[0.12] hover:text-white"
                    >
                      {title}
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <span className="rounded-md border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-center text-[10px] text-white/45">
                    +{overflow} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
