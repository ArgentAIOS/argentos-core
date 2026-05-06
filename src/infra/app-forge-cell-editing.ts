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

/**
 * Mirrors `validateAppForgeRecordValues` for the `number` field type so the
 * cell editor can surface the same error inline. Empty input is treated as
 * "clear the cell" and accepted.
 */
export function isValidNumberInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  // `Number()` parses an unambiguous numeric string into a finite number.
  // `Number("abc")` and `Number("1.2.3")` are NaN; `Number("1e2")` is 100.
  const parsed = Number(trimmed);
  return Number.isFinite(parsed);
}

/**
 * Mirrors the email regex in `validateAppForgeRecordValues`. Empty input is
 * accepted (clears the cell).
 */
export function isValidEmailInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
