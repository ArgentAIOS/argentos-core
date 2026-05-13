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
 * Parse a serialized rating cell draft (the grid uses string-typed drafts) to
 * a value in [0, max]. Returns `null` for invalid input so the editor can
 * keep the prior value rather than silently writing garbage.
 *
 * Pass `allowHalf: true` to opt the field into 0.5 increments — the draft is
 * snapped to the nearest 0.5 instead of the nearest integer. Default (false)
 * preserves the existing integer-only behavior so rating columns without
 * `allowHalf` set are unchanged.
 */
export function parseRatingDraftValue(
  value: string,
  max: number,
  allowHalf: boolean = false,
): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const snapped = allowHalf ? Math.round(parsed * 2) / 2 : Math.round(parsed);
  if (snapped < 0 || snapped > max) {
    return null;
  }
  return snapped;
}

/**
 * Serialize a rating value (0 = unrated) for storage in the string-typed
 * draft. With `allowHalf: true` the value is snapped to the nearest 0.5; the
 * default integer-only mode matches pre-half-rating behavior so existing
 * persisted drafts deserialize identically.
 */
export function serializeRatingDraftValue(value: number, allowHalf: boolean = false): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  const snapped = allowHalf ? Math.round(value * 2) / 2 : Math.round(value);
  return String(snapped);
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

/**
 * Helpers for the AppForge linked-record relation picker. The picker UI
 * lives in the dashboard (`GridCellEditor.tsx`) but it shares parsing,
 * filtering, and label-resolution rules with the substrate so the gateway
 * import path and the dashboard agree on what a "linked record" cell looks
 * like.
 *
 * Linked-record cell values are stored on the wire as comma-separated record
 * IDs (the same shape as `multi_select`). The picker renders human-readable
 * labels by looking up each ID against the target table's records, falling
 * back to the raw ID when the target table cannot resolve it (orphan link,
 * cross-base reference, or missing target table).
 */

/** Minimal field shape needed by the relation picker. */
export type RelationPickerSourceField = {
  id: string;
  name: string;
};

/** Minimal record shape needed by the relation picker. */
export type RelationPickerSourceRecord = {
  id: string;
  values: Record<string, unknown>;
};

/** A pickable record candidate with a stable display label. */
export type RelationPickerCandidate = {
  id: string;
  label: string;
};

const DEFAULT_RELATION_PICKER_LIMIT = 50;

function relationLabelFromValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * Pick a "title" field for a linked target table — the field whose value the
 * picker displays as a record label. We prefer a literal `name` field
 * (case-insensitive) so that AirTable-style "Name" columns Just Work, then
 * fall back to the first field of the table.
 */
export function pickRelationTitleField(
  fields: ReadonlyArray<RelationPickerSourceField>,
): RelationPickerSourceField | null {
  if (fields.length === 0) {
    return null;
  }
  const named = fields.find((field) => field.name.trim().toLowerCase() === "name");
  return named ?? fields[0] ?? null;
}

/**
 * Build the static list of selectable candidates from a target table. Labels
 * are resolved up-front so the picker can filter purely by string match.
 */
export function buildRelationPickerCandidates(
  fields: ReadonlyArray<RelationPickerSourceField>,
  records: ReadonlyArray<RelationPickerSourceRecord>,
): RelationPickerCandidate[] {
  const titleField = pickRelationTitleField(fields);
  return records.map((record) => {
    const raw = titleField ? record.values[titleField.id] : undefined;
    const label = relationLabelFromValue(raw);
    return {
      id: record.id,
      label: label || record.id,
    };
  });
}

/**
 * Resolve a single record ID into a display label using a candidate list.
 * Falls back to the raw ID when the target record cannot be found (orphan
 * link, deleted record, cross-base reference). The picker's chip rows call
 * this so users see "Acme Corp" rather than `rec-2026-04-25-abc123` once a
 * link is set.
 */
export function resolveRelationLabel(
  id: string,
  candidates: ReadonlyArray<RelationPickerCandidate>,
): string {
  if (!id) {
    return "";
  }
  return candidates.find((candidate) => candidate.id === id)?.label ?? id;
}

/**
 * Filter relation-picker candidates by query string, excluding any IDs
 * already selected. The query is matched against both the candidate label
 * and the candidate ID so users can paste a known record ID.
 *
 * Returns at most `limit` matches (default 50) so a 10k-record target table
 * doesn't blow up the picker dropdown.
 */
export function filterRelationPickerCandidates(
  candidates: ReadonlyArray<RelationPickerCandidate>,
  query: string,
  excludeIds: ReadonlyArray<string>,
  limit: number = DEFAULT_RELATION_PICKER_LIMIT,
): RelationPickerCandidate[] {
  const lowered = query.trim().toLowerCase();
  const exclude = new Set(excludeIds);
  const matches: RelationPickerCandidate[] = [];
  for (const candidate of candidates) {
    if (exclude.has(candidate.id)) {
      continue;
    }
    if (lowered) {
      const matchesLabel = candidate.label.toLowerCase().includes(lowered);
      const matchesId = candidate.id.toLowerCase().includes(lowered);
      if (!matchesLabel && !matchesId) {
        continue;
      }
    }
    matches.push(candidate);
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

/**
 * Parse a stored linked-record cell value (string or array form, mirroring
 * `multi_select`) into a deduped list of record IDs. Empty/whitespace input
 * yields an empty list so a cleared cell is round-trippable.
 */
export function parseLinkedRecordValue(
  value: string | ReadonlyArray<string> | null | undefined,
): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    const trimmed = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return Array.from(new Set(trimmed));
  }
  if (typeof value === "string") {
    return parseMultiSelectValue(value);
  }
  return [];
}

/**
 * Serialize a list of selected record IDs into the stored cell format. The
 * dashboard editor passes this string back through `onChange` so persistence
 * matches the existing comma-separated text storage.
 */
export function serializeLinkedRecordValue(ids: ReadonlyArray<string>): string {
  return serializeMultiSelectValue(ids);
}

/**
 * Helpers for AppForge attachment cells.
 *
 * Attachment cells store an array of entries on the wire (sharing the array
 * shape with `multi_select` and `linked_record`). Each entry is either a bare
 * URL — `"https://example.com/img.png"` — or a pipe-delimited `"name|url"`
 * pair — `"Receipt.pdf|https://files.example.com/receipt.pdf"`. The pipe form
 * lets the cell display a friendly name when the URL alone would be a long
 * opaque token (e.g. signed-storage URLs). Both forms round-trip through the
 * dashboard editor without data loss.
 *
 * Empty input clears the cell. Unparseable entries are dropped on serialize
 * so a corrupt cell can't crash the editor.
 */

/** Single attachment entry as displayed/edited in the grid. */
export type AttachmentEntry = {
  /** Friendly name shown on the chip (file name, image alt, etc.). */
  name: string;
  /** Resolvable URL — http(s), data:, blob:, or mailto:. Empty entries are invalid. */
  url: string;
};

const ATTACHMENT_DELIMITER = "|";

/** Image extensions the display path renders as inline thumbnails. */
const ATTACHMENT_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
]);

function stripDelimiter(value: string): string {
  // The on-the-wire form is `name|url`; collapse pipes inside the user-typed
  // name field so we never round-trip into a corrupt 3-part entry.
  return value.replace(/\|/g, " ");
}

function deriveAttachmentName(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  // data: / blob: URLs have no meaningful filename — surface a generic label.
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    const mime = trimmed.startsWith("data:") ? trimmed.slice(5).split(/[;,]/)[0] : "";
    return mime ? `Attachment (${mime})` : "Attachment";
  }
  try {
    const parsed = new URL(trimmed);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const tail = segments.length ? decodeURIComponent(segments[segments.length - 1]) : "";
    if (tail) {
      return tail;
    }
    return parsed.hostname || trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Parse a single entry from the stored `name|url` (or bare `url`) form into a
 * structured {@link AttachmentEntry}. Returns `null` for unparseable input so
 * the caller can drop it cleanly.
 */
export function parseAttachmentEntry(raw: string): AttachmentEntry | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const delimiterIndex = trimmed.indexOf(ATTACHMENT_DELIMITER);
  if (delimiterIndex === -1) {
    // Bare URL form — derive a friendly name from the path.
    const url = trimmed;
    if (!isValidAttachmentUrl(url)) {
      return null;
    }
    return { name: deriveAttachmentName(url), url };
  }
  const name = trimmed.slice(0, delimiterIndex).trim();
  const url = trimmed.slice(delimiterIndex + 1).trim();
  if (!url || !isValidAttachmentUrl(url)) {
    return null;
  }
  return { name: name || deriveAttachmentName(url), url };
}

/**
 * Serialize a single entry into the stored `name|url` form. When the name is
 * empty or equals the derived name, the entry is emitted as a bare URL so the
 * stored form stays compact.
 */
export function serializeAttachmentEntry(entry: AttachmentEntry): string {
  const url = entry.url.trim();
  if (!url) {
    return "";
  }
  const name = stripDelimiter(entry.name.trim());
  if (!name || name === deriveAttachmentName(url)) {
    return url;
  }
  return `${name}${ATTACHMENT_DELIMITER}${url}`;
}

/**
 * Parse a stored attachment cell value (string or array form) into a deduped
 * list of attachment entries. Dedupe is by URL so two entries pointing at the
 * same file collapse to one. Unparseable entries are dropped silently.
 */
export function parseAttachmentValue(
  value: string | ReadonlyArray<string> | null | undefined,
): AttachmentEntry[] {
  if (value === null || value === undefined) {
    return [];
  }
  const rawEntries = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : [];
  const seenUrls = new Set<string>();
  const result: AttachmentEntry[] = [];
  for (const raw of rawEntries) {
    const parsed = parseAttachmentEntry(raw);
    if (!parsed) {
      continue;
    }
    if (seenUrls.has(parsed.url)) {
      continue;
    }
    seenUrls.add(parsed.url);
    result.push(parsed);
  }
  return result;
}

/**
 * Serialize a list of attachment entries into the canonical comma-separated
 * form for storage. Invalid / empty entries are dropped.
 */
export function serializeAttachmentValue(entries: ReadonlyArray<AttachmentEntry>): string {
  const seenUrls = new Set<string>();
  const parts: string[] = [];
  for (const entry of entries) {
    const serialized = serializeAttachmentEntry(entry);
    if (!serialized) {
      continue;
    }
    const url = entry.url.trim();
    if (seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);
    parts.push(serialized);
  }
  return parts.join(", ");
}

/**
 * True iff `value` parses as an attachment URL. Accepts http(s), data:, blob:,
 * and protocol-relative paths starting with `/`. Empty input is rejected
 * (different from the URL field's "empty = cleared" rule because attachment
 * entries are individually positive — emptiness is represented by an empty
 * list).
 */
export function isValidAttachmentUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:") || trimmed.startsWith("/")) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True iff this attachment renders as an inline thumbnail. We sniff by either
 * the URL extension (after stripping query/hash) or the data: MIME prefix so
 * pasted screenshots get thumbnails too.
 */
export function isImageAttachment(entry: AttachmentEntry): boolean {
  const url = entry.url.trim();
  if (!url) {
    return false;
  }
  if (url.startsWith("data:image/") || url.startsWith("data:application/svg")) {
    return true;
  }
  // Match the last extension before any query / fragment. Avoid `new URL`
  // here so we still detect images on protocol-relative / bare paths.
  const withoutQuery = url.split(/[?#]/)[0];
  const lastDot = withoutQuery.lastIndexOf(".");
  if (lastDot === -1 || lastDot < withoutQuery.lastIndexOf("/")) {
    return false;
  }
  const ext = withoutQuery.slice(lastDot + 1).toLowerCase();
  return ATTACHMENT_IMAGE_EXTENSIONS.has(ext);
}
