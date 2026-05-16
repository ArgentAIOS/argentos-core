/**
 * Canonical AppForge view-mode registry — single source of truth for the
 * set of view modes a table can render.
 *
 * BEFORE this file existed, every new view mode (Calendar PR #358, Gallery
 * PR #362, Timeline PR #364) had to be added to FIVE+ unrelated sites that
 * each maintained their own copy of the same union:
 *
 *   1. `src/infra/app-forge-model.ts`        — `APP_FORGE_SAVED_VIEW_TYPES`
 *   2. `src/infra/app-forge-views.ts`        — `APP_FORGE_VIEW_MODES`
 *   3. `dashboard/.../useForgeStructuredData.ts` — `ForgeStructuredViewType`
 *      + `isViewType` + `defaultViewName`
 *   4. `dashboard/.../AppForge.tsx`          — inline `ForgeViewMode` union
 *   5. `dashboard/.../AppForge.tsx`          — `FORGE_VIEW_MODES` UI registry
 *   6. `src/infra/app-forge-structured-data.test.ts` — "bogus value" probe
 *      that kept having to migrate to whichever view mode wasn't shipped yet
 *
 * Three consecutive view-mode workers flagged this drift on meta-issue #360
 * (audit item #31). This file consolidates the enum + per-mode metadata so
 * every other site imports from here.
 *
 * NOTE on `APP_FORGE_SAVED_VIEW_TYPES` vs `APP_FORGE_VIEW_MODES`: those two
 * names previously lived in different files and described the same set of
 * values from two angles ("type of a durable saved view" vs "mode of an
 * active named view"). They have always been identical and were kept in
 * lockstep manually. This refactor collapses them onto this single list;
 * the original names are still re-exported from their original files for
 * call-site backward compatibility and to preserve self-documenting names
 * at each consumption point.
 *
 * ---------------------------------------------------------------------------
 * HOW TO ADD A NEW VIEW MODE
 * ---------------------------------------------------------------------------
 *
 *   1. Add an entry to `APP_FORGE_VIEW_MODE_REGISTRY` below with the new
 *      `id`, `label`, and `defaultViewName`. If the mode has a sensible
 *      seed for `groupFieldId` on a freshly-created view (e.g. Calendar
 *      auto-picks the first date field), set `defaultGroupFieldHint`.
 *
 *   2. Create the new component in `dashboard/src/components/app-forge/`
 *      (mirroring `CalendarView.tsx` / `GalleryView.tsx` / `TimelineView.tsx`).
 *
 *   3. Mount the new component in `AppForge.tsx` — find the block guarded
 *      by `activeViewMode === "calendar"` and add a parallel block for the
 *      new mode. (Making the dispatch fully registry-driven would require
 *      standardizing the per-view component props; that's a separate
 *      refactor and out of scope here.)
 *
 * Down from 5+ sites to 2-3. The TypeScript compiler now enforces that
 * every consumer agrees on the canonical id set: if a site hardcodes a
 * stale list it becomes a typecheck failure rather than a runtime drift.
 *
 * Reviewers: there is a deliberately-narrower template view-mode union in
 * `src/infra/app-forge-templates/index.ts` (`AppForgeTemplateViewType`)
 * that only includes the 4 modes shipping as starter templates. That is
 * an intentional subset, NOT drift, and is intentionally NOT collapsed
 * into this registry.
 */

import type { AppForgeFieldType } from "./app-forge-model.js";

/**
 * Per-mode hint used by the dashboard to pick a sensible default
 * `groupFieldId` when a brand-new view of this mode is created on a table.
 *
 * - `none` — no auto-seed; user picks the field manually.
 * - `fieldType` — first field of this type (e.g. `"date"` for Calendar).
 * - `fieldName` — first field whose case-insensitive name matches (e.g.
 *   `"status"` for Kanban/Timeline). Acts on the *display name*, not the id.
 */
export type AppForgeViewModeGroupFieldHint =
  | { kind: "none" }
  | { kind: "fieldType"; value: AppForgeFieldType }
  | { kind: "fieldName"; value: string };

export type AppForgeViewModeRegistryEntry = {
  /** Canonical id stored in saved-view `type` and active named-view `viewMode`. */
  readonly id: string;
  /** Human-readable label shown in the view picker. */
  readonly label: string;
  /**
   * Default name for a freshly-created view of this mode. Used both when
   * seeding the table's first view and when the user clicks "+ New view"
   * without typing a name.
   */
  readonly defaultViewName: string;
  /**
   * Optional hint for seeding `groupFieldId` on a brand-new view of this
   * mode. Defaults to `{ kind: "none" }`. See the dashboard's
   * `defaultViewSettings` for the lookup semantics.
   */
  readonly defaultGroupFieldHint?: AppForgeViewModeGroupFieldHint;
};

/**
 * Canonical ordered registry of every supported view mode. The order here
 * IS the order shown in the view-picker dropdown.
 *
 * IMPORTANT: this list is the single source of truth. The legacy constants
 * `APP_FORGE_SAVED_VIEW_TYPES` (in `app-forge-model.ts`) and
 * `APP_FORGE_VIEW_MODES` (in `app-forge-views.ts`) are derived from this.
 */
export const APP_FORGE_VIEW_MODE_REGISTRY = [
  {
    id: "grid",
    label: "Grid",
    defaultViewName: "All records",
  },
  {
    id: "kanban",
    label: "Kanban",
    defaultViewName: "By status",
    defaultGroupFieldHint: { kind: "fieldName", value: "status" },
  },
  {
    id: "form",
    label: "Form",
    defaultViewName: "Intake form",
  },
  {
    id: "review",
    label: "Review",
    defaultViewName: "Review queue",
  },
  {
    id: "calendar",
    label: "Calendar",
    defaultViewName: "Calendar",
    defaultGroupFieldHint: { kind: "fieldType", value: "date" },
  },
  {
    id: "gallery",
    label: "Gallery",
    defaultViewName: "Gallery",
    defaultGroupFieldHint: { kind: "fieldType", value: "attachment" },
  },
  {
    id: "timeline",
    label: "Timeline",
    defaultViewName: "Timeline",
    defaultGroupFieldHint: { kind: "fieldName", value: "status" },
  },
  {
    id: "gantt",
    label: "Gantt",
    defaultViewName: "Gantt",
    // Same swimlane convention as Timeline — operators typically split
    // Gantt rows by status. Gantt v1 is otherwise a thin bars-on-axis
    // renderer that reuses Timeline's date-math helpers wholesale; see
    // dashboard/src/components/app-forge/GanttView.tsx.
    defaultGroupFieldHint: { kind: "fieldName", value: "status" },
  },
] as const satisfies readonly AppForgeViewModeRegistryEntry[];

/**
 * Canonical tuple of view-mode ids, derived from the registry. Use this
 * (or the type alias `AppForgeViewMode`) anywhere you previously hardcoded
 * a `"grid" | "kanban" | ...` union.
 */
export const APP_FORGE_VIEW_MODES = APP_FORGE_VIEW_MODE_REGISTRY.map(
  (entry) => entry.id,
) as unknown as readonly [
  (typeof APP_FORGE_VIEW_MODE_REGISTRY)[number]["id"],
  ...(typeof APP_FORGE_VIEW_MODE_REGISTRY)[number]["id"][],
];

/**
 * The canonical view-mode union — a literal string union of every id in
 * the registry. Sites that used to declare their own copy of this union
 * (e.g. `ForgeStructuredViewType`, `ForgeViewMode`) now alias to it.
 */
export type AppForgeViewMode = (typeof APP_FORGE_VIEW_MODE_REGISTRY)[number]["id"];

/** Type guard for an unknown value being a canonical view-mode id. */
export function isAppForgeViewMode(value: unknown): value is AppForgeViewMode {
  return (
    typeof value === "string" && APP_FORGE_VIEW_MODE_REGISTRY.some((entry) => entry.id === value)
  );
}

/** Look up the registry entry for a view mode. Returns `undefined` if unknown. */
export function getAppForgeViewModeEntry(
  id: AppForgeViewMode,
): (typeof APP_FORGE_VIEW_MODE_REGISTRY)[number] {
  // Safe by construction: the parameter type restricts `id` to a known
  // registry id, so `find` will always hit.
  const entry = APP_FORGE_VIEW_MODE_REGISTRY.find((candidate) => candidate.id === id);
  if (!entry) {
    // Defensive: only reachable if a caller bypasses the type system.
    throw new Error(`Unknown AppForge view mode "${String(id)}".`);
  }
  return entry;
}

/** Human-readable label for a view mode (used by the view-picker). */
export function getAppForgeViewModeLabel(id: AppForgeViewMode): string {
  return getAppForgeViewModeEntry(id).label;
}

/** Default name applied to a freshly-created view of this mode. */
export function getAppForgeViewModeDefaultName(id: AppForgeViewMode): string {
  return getAppForgeViewModeEntry(id).defaultViewName;
}

/**
 * Default group-field hint used when seeding a freshly-created view of this
 * mode. Returns `{ kind: "none" }` when the mode declares no hint, matching
 * the pre-registry behavior where unhinted modes left `groupFieldId` empty.
 */
export function getAppForgeViewModeGroupFieldHint(
  id: AppForgeViewMode,
): AppForgeViewModeGroupFieldHint {
  const entry = getAppForgeViewModeEntry(id);
  return "defaultGroupFieldHint" in entry ? entry.defaultGroupFieldHint : { kind: "none" };
}
