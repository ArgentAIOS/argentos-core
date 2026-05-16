/**
 * Pure helpers for the AppForge Gallery view.
 *
 * Substrate-style: pure functions, no React. Tested independently so the
 * thumbnail-extraction + body-field selection rules can be verified
 * without standing up the dashboard.
 *
 * Attachment cell encoding
 * ------------------------
 * Attachment cells are stored either as comma-separated `name|url` pairs
 * (mirrors the operator-visible form input at AppForge.tsx — see the
 * "Comma-separated URLs (name|url optional)" hint) or as plain URLs. The
 * helper accepts both shapes and yields the first usable URL, or `null`
 * when the cell is empty / unparseable. Gallery never crashes on dirty
 * input — it just falls back to a text-only card.
 *
 * Body-field selection
 * --------------------
 * `selectGalleryBodyFields` returns the fields that should appear on a
 * card below the title, excluding (a) the thumbnail field itself and
 * (b) any explicit title field if known. v1 caps at four fields to keep
 * cards compact; the renderer can choose to show fewer.
 */

import type { ForgeStructuredField } from "../../hooks/useForgeStructuredData";

export const GALLERY_DEFAULT_BODY_FIELD_LIMIT = 4;

/**
 * Resolve the field that should drive card thumbnails.
 *
 * Precedence:
 *   1. `preferredThumbnailFieldId` if it names a real `type === "attachment"`
 *      field on the table.
 *   2. The first `type === "attachment"` field on the table.
 *   3. `null` — no thumbnail; card is text-only.
 */
export function resolveThumbnailField(
  fields: readonly ForgeStructuredField[],
  preferredThumbnailFieldId?: string,
): ForgeStructuredField | null {
  if (preferredThumbnailFieldId) {
    const preferred = fields.find(
      (field) => field.id === preferredThumbnailFieldId && field.type === "attachment",
    );
    if (preferred) {
      return preferred;
    }
  }
  return fields.find((field) => field.type === "attachment") ?? null;
}

/**
 * Extract a list of attachment URLs from a raw cell value.
 *
 * Accepts:
 *   - `string` — comma- or newline-separated. Each entry may be a plain
 *     URL or `name|url` (only the URL part is returned).
 *   - `string[]` — already-split list, same per-entry semantics.
 *   - anything else — returns `[]`.
 *
 * Trims whitespace, drops empty entries, and rejects entries whose URL
 * part is empty after splitting on `|`.
 */
export function extractAttachmentUrls(value: unknown): string[] {
  const rawEntries: string[] = (() => {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
    if (typeof value === "string") {
      return value.split(/[\n,]/);
    }
    return [];
  })();
  const urls: string[] = [];
  for (const entry of rawEntries) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    // `name|url` pairs — split on the FIRST pipe and take the right side.
    // Falls back to the whole string when there is no pipe (plain URL).
    const pipeIndex = trimmed.indexOf("|");
    const url = pipeIndex >= 0 ? trimmed.slice(pipeIndex + 1).trim() : trimmed;
    if (url) {
      urls.push(url);
    }
  }
  return urls;
}

/**
 * The first usable attachment URL on a record, or `null` if none.
 *
 * Wraps `extractAttachmentUrls` for the common "show one thumbnail per
 * card" path. v1 deliberately ignores all but the first attachment to
 * keep card layout predictable.
 */
export function pickThumbnailUrl(value: unknown): string | null {
  const urls = extractAttachmentUrls(value);
  return urls[0] ?? null;
}

/**
 * Return the fields that should appear on a card body, in display order.
 *
 * - Excludes the thumbnail field (its content is the image, not body
 *   text).
 * - Skips long-text fields by default to keep cards compact (the form
 *   view is the right surface for long content).
 * - Caps to `limit` entries (default 4).
 */
export function selectGalleryBodyFields(
  fields: readonly ForgeStructuredField[],
  options: {
    thumbnailFieldId?: string | null;
    limit?: number;
  } = {},
): ForgeStructuredField[] {
  const thumbnailFieldId = options.thumbnailFieldId ?? null;
  const limit = Math.max(0, options.limit ?? GALLERY_DEFAULT_BODY_FIELD_LIMIT);
  if (limit === 0) {
    return [];
  }
  const body: ForgeStructuredField[] = [];
  for (const field of fields) {
    if (field.id === thumbnailFieldId) {
      continue;
    }
    if (field.type === "long_text") {
      continue;
    }
    body.push(field);
    if (body.length >= limit) {
      break;
    }
  }
  return body;
}
