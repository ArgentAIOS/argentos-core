import { useMemo } from "react";
import {
  type ForgeStructuredField,
  type ForgeStructuredRecord,
  type ForgeStructuredRecordValue,
} from "../../hooks/useForgeStructuredData";

/**
 * AppForge List view (v1, read-only, MINIMAL).
 *
 * The simplest view mode in the parity series — a vertical scrollable
 * stack of records, one row each, with the record title on top and a
 * short caption of sub-field values underneath. No date math, no
 * thumbnail resolution, no grid axis. Just a list.
 *
 * **Explicitly out of scope for v1** (deferred to v1.1 follow-up PRs):
 *   - Drag-to-reorder rows
 *   - Inline edit
 *   - Bulk row operations
 *   - Avatar / icon rendering
 *
 * Sub-field selection precedence:
 *   1. If `preferredVisibleFieldIds` is non-empty, render those fields
 *      (in order, capped at `MAX_VISIBLE_SUBFIELDS`) below the title —
 *      minus the title field itself, which we never duplicate.
 *   2. Otherwise, render the first `MAX_VISIBLE_SUBFIELDS` non-title
 *      fields on the table.
 *
 * Grouping: when `preferredGroupFieldId` resolves to a real field on
 * the table, records are grouped under section headers keyed by that
 * field's value (or "—" for empties). When unset or pointing to a
 * missing field, the view falls back to a single flat list — no
 * header rendered. This mirrors the `groupFieldId` convention every
 * other view mode in the series uses.
 *
 * Pure helpers note: unlike Calendar (date math), Gallery (attachment
 * resolution), Timeline / Gantt (date axis + lane bucketing), List
 * has no comparable pure logic to factor out. Group-by happens inline
 * because it's trivial (Map<value, records>). No `list-bucket.ts` file
 * — keeps the diff to the bare minimum component + wiring shape.
 *
 * Clicking a row pops the record open via the parent's editor path
 * (matches Kanban / Calendar / Gallery / Timeline / Gantt).
 */

/** Cap visible sub-fields per row so cards stay scannable. */
const MAX_VISIBLE_SUBFIELDS = 4;

export type ListViewProps = {
  records: readonly ForgeStructuredRecord[];
  fields: readonly ForgeStructuredField[];
  /**
   * Field id used to split records into section-header groups. When
   * undefined or pointing to a field that's no longer on the table,
   * the view renders a flat list with no header. Reuses the saved
   * view's `groupFieldId` slot — same pattern Kanban / Timeline /
   * Gantt use.
   */
  preferredGroupFieldId?: string;
  /**
   * Ordered list of field ids the operator picked as visible sub-fields
   * for this view. Capped at `MAX_VISIBLE_SUBFIELDS` for display. When
   * empty, the component falls back to the first few non-title fields
   * on the table. Wired to `viewSettings.visibleFieldIds`.
   */
  preferredVisibleFieldIds?: readonly string[];
  /**
   * Lookup for the user-visible title of a record. Passed in so the
   * caller controls how name/title is resolved (matches
   * Kanban / Calendar / Gallery / Timeline / Gantt).
   */
  getRecordTitle: (record: ForgeStructuredRecord) => string;
  /**
   * Open the record-editor surface for `recordId`. v1 just hands this
   * off to the parent, which already routes form-style record edits.
   */
  onSelectRecord?: (recordId: string) => void;
};

function formatFieldValue(value: ForgeStructuredRecordValue | undefined): string {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== null && entry !== undefined && entry !== "")
      .join(", ");
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function groupKey(value: ForgeStructuredRecordValue | undefined): string {
  const formatted = formatFieldValue(value).trim();
  return formatted === "" ? "—" : formatted;
}

/**
 * Resolve which fields appear below the title on each row.
 *
 * The "title" field is conventionally the first field on the table
 * (or a field named `name`, resolved by the caller via
 * `recordTitle()`). We never render the title twice, so it's filtered
 * out of the sub-field list regardless of where it lands in
 * `preferredVisibleFieldIds`.
 */
function resolveVisibleSubFields(
  fields: readonly ForgeStructuredField[],
  preferredVisibleFieldIds: readonly string[] | undefined,
): readonly ForgeStructuredField[] {
  if (fields.length === 0) {
    return [];
  }
  // The conventional title field is the first table field (or a
  // "name"-named field, but `getRecordTitle` already abstracts that
  // from us — we just need to *not* render it twice in the caption).
  const titleFieldId = fields[0]?.id;
  const byId = new Map(fields.map((field) => [field.id, field] as const));

  if (preferredVisibleFieldIds && preferredVisibleFieldIds.length > 0) {
    const picked: ForgeStructuredField[] = [];
    for (const id of preferredVisibleFieldIds) {
      if (id === titleFieldId) {
        continue;
      }
      const field = byId.get(id);
      if (field && !picked.some((existing) => existing.id === field.id)) {
        picked.push(field);
      }
      if (picked.length >= MAX_VISIBLE_SUBFIELDS) {
        break;
      }
    }
    if (picked.length > 0) {
      return picked;
    }
    // Fall through to the default when the operator's picks resolve
    // to nothing renderable (e.g. they pinned a now-deleted field).
  }

  return fields.filter((field) => field.id !== titleFieldId).slice(0, MAX_VISIBLE_SUBFIELDS);
}

export function ListView({
  records,
  fields,
  preferredGroupFieldId,
  preferredVisibleFieldIds,
  getRecordTitle,
  onSelectRecord,
}: ListViewProps) {
  const groupField = useMemo(() => {
    if (!preferredGroupFieldId) {
      return null;
    }
    return fields.find((field) => field.id === preferredGroupFieldId) ?? null;
  }, [fields, preferredGroupFieldId]);

  const subFields = useMemo(
    () => resolveVisibleSubFields(fields, preferredVisibleFieldIds),
    [fields, preferredVisibleFieldIds],
  );

  // Bucket records by group value (insertion-ordered) when grouping is
  // active. The fallback ungrouped path uses a single bucket so render
  // can share a code path with the grouped one.
  const buckets = useMemo(() => {
    const out = new Map<string, ForgeStructuredRecord[]>();
    if (!groupField) {
      out.set("__flat__", records.slice());
      return out;
    }
    for (const record of records) {
      const key = groupKey(record.values[groupField.id]);
      const existing = out.get(key);
      if (existing) {
        existing.push(record);
      } else {
        out.set(key, [record]);
      }
    }
    return out;
  }, [groupField, records]);

  if (records.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-8 text-center">
        <div className="text-sm font-medium text-white/72">No records to display in this view.</div>
        <div className="max-w-md text-xs leading-5 text-white/45">
          Add a record to this table — or adjust this view&apos;s filter — and the list will
          populate automatically.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/18 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
          <span className="rounded-md border border-sky-300/25 bg-sky-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-sky-100/80">
            List v1 · read-only
          </span>
          {groupField ? (
            <span>
              Grouped by
              <span className="ml-1 rounded-md bg-white/[0.06] px-2 py-0.5 text-white/65">
                {groupField.name}
              </span>
            </span>
          ) : (
            <span className="text-white/35">Group by a field to split into sections.</span>
          )}
          <span className="text-white/35">
            {records.length} {records.length === 1 ? "record" : "records"}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {Array.from(buckets.entries()).map(([key, bucketRecords]) => (
          <div key={key} className="space-y-2">
            {groupField && (
              <div className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-[0.16em] text-white/40">
                <span>{key}</span>
                <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-white/55">
                  {bucketRecords.length}
                </span>
              </div>
            )}
            <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/10 bg-black/20">
              {bucketRecords.map((record) => {
                const title = getRecordTitle(record);
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      onClick={() => onSelectRecord?.(record.id)}
                      className="block w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.04] focus:bg-white/[0.06] focus:outline-none"
                    >
                      <div className="truncate text-sm font-medium text-white/82">{title}</div>
                      {subFields.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
                          {subFields.map((field) => {
                            const formatted = formatFieldValue(record.values[field.id]);
                            return (
                              <span key={field.id} className="inline-flex items-center gap-1">
                                <span className="text-white/35">{field.name}</span>
                                <span className="truncate text-white/65">
                                  {formatted === "" ? "—" : formatted}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
