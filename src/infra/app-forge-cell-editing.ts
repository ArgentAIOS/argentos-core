/**
 * Pure helpers for AppForge grid cell editing.
 *
 * Exposed as substrate so the dashboard `GridCellEditor` can share parsing
 * rules with the gateway/import paths and so regressions are caught by the
 * substrate test suite.
 */

export function parseMultiSelectValue(value: string): string[] {
  if (!value) {
    return [];
  }
  const parsed = value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set(parsed));
}

export function serializeMultiSelectValue(values: ReadonlyArray<string>): string {
  return Array.from(new Set(values.filter(Boolean))).join(", ");
}

export function isValidUrlInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true; // empty = clear the cell
  }
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}
