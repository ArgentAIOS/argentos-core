/**
 * Pure helpers for the AppForge Gantt view.
 *
 * Substrate-style: pure functions, no React. Tested independently of the
 * dashboard so the date math + hierarchy resolution + dependency-edge
 * geometry can be exercised without standing up a render.
 *
 * Relationship to Timeline
 * ------------------------
 * Gantt is a horizontal date-axis view (same coordinate model as
 * Timeline), so most of the date math (`buildDayAxis`, `positionEntry`,
 * `parseTimelineDate`, etc.) is imported from `timeline-bucket.ts` as-is.
 * This file ONLY adds the Gantt-specific extensions:
 *
 * - parent / child resolution via a self-referential `linked_record` field
 *   (auto-detected; configurable). Returns an indented order suitable for
 *   the renderer's lane label column.
 *
 * - dependency-edge geometry — predecessor → successor arrows. v1 detects
 *   the first non-self-referential `linked_record` field as the
 *   "depends on" column; the renderer overlays SVG arrows from each
 *   predecessor's right edge to its successor's left edge.
 *
 * - critical-path identification — longest-by-day chain of dependencies
 *   from earliest start to latest end. v1 is a simple DFS over the DAG.
 *
 * Per the v1 scope, the bars-on-axis renderer is the must-have; the
 * dependency-line + hierarchy + critical-path features are wired into
 * this helper as pure functions even though the v1 renderer may not yet
 * consume all of them (so a v1.1 PR can add the overlay rendering
 * without re-doing the math).
 */

import type { ForgeStructuredField } from "../../hooks/useForgeStructuredData";
import {
  type TimelineEntry,
  buildDayAxis,
  buildTimelineEntries,
  groupEntriesByLane,
  parseTimelineDate,
  positionEntry,
  resolveTimelineDateFields,
  resolveTimelineLaneField,
  shiftDays,
  startOfDay,
} from "./timeline-bucket";

// Re-export the Timeline date helpers under aliased names so GanttView
// imports cleanly from gantt-bucket without dragging in timeline-bucket
// explicitly — keeps the per-view bundle self-contained.
export {
  TIMELINE_DEFAULT_RANGE_DAYS as GANTT_DEFAULT_RANGE_DAYS,
  TIMELINE_MIN_RANGE_DAYS as GANTT_MIN_RANGE_DAYS,
  TIMELINE_MAX_RANGE_DAYS as GANTT_MAX_RANGE_DAYS,
  buildDayAxis,
  buildTimelineEntries as buildGanttEntries,
  groupEntriesByLane as groupGanttEntriesByLane,
  parseTimelineDate as parseGanttDate,
  positionEntry as positionGanttEntry,
  resolveTimelineDateFields as resolveGanttDateFields,
  resolveTimelineLaneField as resolveGanttLaneField,
  shiftDays,
  startOfDay,
  type TimelineDayCell as GanttDayCell,
  type TimelineEntry as GanttEntry,
} from "./timeline-bucket";

/**
 * Resolve the parent-record field for hierarchical grouping.
 *
 * A parent field is a `linked_record` field whose `linkedTableId` equals
 * the current table's id (self-referential). v1 auto-detects the FIRST
 * such field; callers can override with `preferredId`.
 *
 * Returns `null` if no self-referential link field exists or the named
 * preference doesn't point to one.
 */
export function resolveParentField(
  fields: readonly ForgeStructuredField[],
  currentTableId: string,
  preferredId?: string,
): ForgeStructuredField | null {
  if (preferredId) {
    const named = fields.find(
      (field) =>
        field.id === preferredId &&
        field.type === "linked_record" &&
        field.linkedTableId === currentTableId,
    );
    if (named) {
      return named;
    }
  }
  return (
    fields.find(
      (field) => field.type === "linked_record" && field.linkedTableId === currentTableId,
    ) ?? null
  );
}

/**
 * Resolve the dependency field for arrow rendering.
 *
 * v1 picks the FIRST `linked_record` field that ISN'T the parent field
 * (i.e. a dependency-style "depends on" link, not the hierarchy link).
 * Callers can override with `preferredId`. Returns `null` if no
 * non-parent link field exists.
 *
 * The link can be same-table or cross-table — same-table is the typical
 * "this task depends on that task"; cross-table is unusual but allowed
 * (the renderer will silently skip arrows it can't resolve to a visible
 * entry).
 */
export function resolveDependencyField(
  fields: readonly ForgeStructuredField[],
  parentFieldId: string | null,
  preferredId?: string,
): ForgeStructuredField | null {
  if (preferredId) {
    const named = fields.find(
      (field) => field.id === preferredId && field.type === "linked_record",
    );
    if (named) {
      return named;
    }
  }
  return (
    fields.find((field) => field.type === "linked_record" && field.id !== parentFieldId) ?? null
  );
}

/**
 * Normalize a `linked_record` cell value into a deduplicated list of
 * record ids. Accepts string | string[] | null | undefined. Trims
 * whitespace, drops empties.
 */
export function normalizeLinkValue(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  const raw: unknown[] = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Compute the indented display order of records, given an optional
 * parent field. When `parentField` is null, returns records in input
 * order with depth 0.
 *
 * Cycles are broken by demoting back-references to depth 0 (i.e. if A
 * lists B as parent and B lists A as parent, B reverts to a root). The
 * algorithm is deterministic and stable: roots first in input order,
 * children appended in input order under each parent.
 *
 * Records whose parent id doesn't match any record in the input set are
 * treated as roots (orphans surface, don't disappear).
 */
export function computeHierarchyOrder<
  TRecord extends { id: string; values: Record<string, unknown> },
>(
  records: readonly TRecord[],
  parentField: ForgeStructuredField | null,
): Array<{ record: TRecord; depth: number }> {
  if (!parentField) {
    return records.map((record) => ({ record, depth: 0 }));
  }
  const byId = new Map<string, TRecord>();
  for (const record of records) {
    byId.set(record.id, record);
  }
  const childrenByParent = new Map<string, string[]>();
  const parentByChild = new Map<string, string>();
  const inputOrder = records.map((record) => record.id);

  for (const record of records) {
    const parentLinks = normalizeLinkValue(record.values[parentField.id]);
    // v1: a record has AT MOST one parent. If the linked_record cell
    // carries multiple ids, the first that resolves to a sibling record
    // wins; the rest are ignored.
    const parent = parentLinks.find((parentId) => byId.has(parentId) && parentId !== record.id);
    if (parent && !wouldCreateCycle(parent, record.id, parentByChild)) {
      parentByChild.set(record.id, parent);
      const bucket = childrenByParent.get(parent) ?? [];
      bucket.push(record.id);
      childrenByParent.set(parent, bucket);
    }
  }

  const roots = inputOrder.filter((id) => !parentByChild.has(id));
  const out: Array<{ record: TRecord; depth: number }> = [];
  const visited = new Set<string>();
  function visit(id: string, depth: number): void {
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    const record = byId.get(id);
    if (!record) {
      return;
    }
    out.push({ record, depth });
    const children = childrenByParent.get(id) ?? [];
    for (const childId of children) {
      visit(childId, depth + 1);
    }
  }
  for (const rootId of roots) {
    visit(rootId, 0);
  }
  // Sweep any remaining unvisited (defensive — could happen if a cycle
  // slipped past the guard). Append at depth 0.
  for (const id of inputOrder) {
    if (!visited.has(id)) {
      const record = byId.get(id);
      if (record) {
        out.push({ record, depth: 0 });
        visited.add(id);
      }
    }
  }
  return out;
}

function wouldCreateCycle(
  parentId: string,
  childId: string,
  parentByChild: Map<string, string>,
): boolean {
  let cursor: string | undefined = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === childId) {
      return true;
    }
    if (seen.has(cursor)) {
      return true;
    }
    seen.add(cursor);
    cursor = parentByChild.get(cursor);
  }
  return false;
}

/**
 * Build the predecessor-graph (`recordId → predecessorIds[]`) from a
 * dependency field. Only edges where BOTH endpoints exist in the input
 * record set are emitted; cross-table or stale links are dropped.
 */
export function buildDependencyGraph<
  TRecord extends { id: string; values: Record<string, unknown> },
>(
  records: readonly TRecord[],
  dependencyField: ForgeStructuredField | null,
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  if (!dependencyField) {
    return graph;
  }
  const known = new Set(records.map((record) => record.id));
  for (const record of records) {
    const links = normalizeLinkValue(record.values[dependencyField.id]).filter(
      (id) => known.has(id) && id !== record.id,
    );
    if (links.length > 0) {
      graph.set(record.id, links);
    }
  }
  return graph;
}

/**
 * Identify the critical path through the dependency graph — the chain
 * of dependent records with the latest cumulative end-date. v1 uses a
 * memoized DFS scoring each node by `max(predecessorScore) + ownDuration`.
 *
 * Returns the set of record ids that lie on the longest such chain, or
 * an empty set if the graph has no edges.
 *
 * Cycles are broken implicitly by memoization: a node returns its cached
 * score on re-entry. The result is deterministic but not necessarily a
 * true CPM optimum on pathological inputs — adequate for v1 visual cue.
 */
export function findCriticalPath<TRecord extends { id: string }>(
  entries: ReadonlyArray<TimelineEntry<TRecord>>,
  graph: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  if (graph.size === 0) {
    return new Set();
  }
  const entryById = new Map<string, TimelineEntry<TRecord>>();
  for (const entry of entries) {
    entryById.set(entry.record.id, entry);
  }
  const msPerDay = 86_400_000;
  function duration(id: string): number {
    const entry = entryById.get(id);
    if (!entry) {
      return 0;
    }
    return Math.max(
      1,
      Math.round((entry.endDate.getTime() - entry.startDate.getTime()) / msPerDay) + 1,
    );
  }

  type Score = { length: number; chain: string[] };
  const cache = new Map<string, Score>();
  const visiting = new Set<string>();
  function score(id: string): Score {
    const cached = cache.get(id);
    if (cached) {
      return cached;
    }
    if (visiting.has(id)) {
      // Cycle guard — break recursion at length 0.
      return { length: 0, chain: [] };
    }
    visiting.add(id);
    const preds = graph.get(id) ?? [];
    let best: Score = { length: duration(id), chain: [id] };
    for (const predId of preds) {
      const predScore = score(predId);
      const combined: Score = {
        length: predScore.length + duration(id),
        chain: [...predScore.chain, id],
      };
      if (combined.length > best.length) {
        best = combined;
      }
    }
    visiting.delete(id);
    cache.set(id, best);
    return best;
  }
  let bestOverall: Score = { length: 0, chain: [] };
  for (const id of entryById.keys()) {
    const s = score(id);
    if (s.length > bestOverall.length) {
      bestOverall = s;
    }
  }
  return new Set(bestOverall.chain);
}

/**
 * Build the SVG-overlay coordinates for one dependency arrow.
 *
 * Each entry has a known (laneIndex, rowIndex, startIndex, spanDays) on
 * the rendered axis. The arrow leaves the right edge of the predecessor
 * bar and enters the left edge of the successor bar at the bar's
 * vertical midline. Caller is responsible for skipping arrows whose
 * predecessor or successor isn't visible.
 *
 * Coordinate convention: x = day-cell-index * `dayCellPx` (caller adds
 * the lane-label column's pixel offset). y is measured top-down within
 * the gantt body in lane-row units of `laneRowPx`.
 */
export function dependencyEdge(
  predecessor: {
    laneRowTop: number;
    rowTop: number;
    barLeft: number;
    barWidth: number;
    barHeight: number;
  },
  successor: {
    laneRowTop: number;
    rowTop: number;
    barLeft: number;
    barWidth: number;
    barHeight: number;
  },
): { x1: number; y1: number; x2: number; y2: number } {
  const x1 = predecessor.barLeft + predecessor.barWidth;
  const y1 = predecessor.laneRowTop + predecessor.rowTop + predecessor.barHeight / 2;
  const x2 = successor.barLeft;
  const y2 = successor.laneRowTop + successor.rowTop + successor.barHeight / 2;
  return { x1, y1, x2, y2 };
}
