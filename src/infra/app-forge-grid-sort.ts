/**
 * Pure helpers for AppForge grid header click-to-sort behavior.
 *
 * Exposed as substrate so the dashboard column-header sort UI shares its
 * cycle/indicator rules with tests and any future server-side replay path.
 *
 * Click-to-sort cycle (mirrors AirTable + Notion):
 *   - Click a column with no sort     -> sort that column ascending
 *   - Click the active asc column     -> flip to descending
 *   - Click the active desc column    -> clear the sort
 *   - Click any other column          -> sort that column ascending
 */

import type { AppForgeViewSortDirection } from "./app-forge-views.js";

export type GridSortState = {
  sortFieldId: string;
  sortDirection: AppForgeViewSortDirection;
};

export type GridSortIndicator = "asc" | "desc" | "none";

/**
 * Compute the next sort state when a grid column header is clicked.
 *
 * The empty string is the "no sort" sentinel for sortFieldId (consistent with
 * `DEFAULT_VIEW_SETTINGS.sortFieldId`). When the active column is clicked
 * while descending, the sort is cleared and direction resets to "asc" so the
 * next click on any column starts ascending again.
 */
export function cycleGridSort(current: GridSortState, clickedFieldId: string): GridSortState {
  const normalized = clickedFieldId.trim();
  if (!normalized) {
    return current;
  }
  if (current.sortFieldId !== normalized) {
    return { sortFieldId: normalized, sortDirection: "asc" };
  }
  if (current.sortDirection === "asc") {
    return { sortFieldId: normalized, sortDirection: "desc" };
  }
  // Active column already descending — clear the sort.
  return { sortFieldId: "", sortDirection: "asc" };
}

/**
 * Resolve the indicator (arrow) to render next to a column header label.
 */
export function gridSortIndicator(current: GridSortState, fieldId: string): GridSortIndicator {
  if (!fieldId || current.sortFieldId !== fieldId) {
    return "none";
  }
  return current.sortDirection === "desc" ? "desc" : "asc";
}
