/**
 * MemU Category Prompts — LLM-based summary generation for categories.
 */

/** Generate a summary for a category based on its memory items */
export const CATEGORY_SUMMARY_PROMPT = `You are summarizing a memory category for a personal AI assistant.

Category name: {name}
Current description: {description}

Memory items in this category:
{items}

Write a concise 1-3 sentence summary of what this category contains. The summary should:
- Capture the key themes and facts
- Be written in third person ("The user prefers...", "Contains info about...")
- Focus on the most important/reinforced items
- Be useful for quickly understanding what this category covers
- Never describe your own reasoning or actions (no "the user is asking me", "I should", "let me")
- Never mention prompts, context windows, or assistant behavior

Reply with ONLY the summary text, no labels or formatting.`;

export function buildCategorySummaryPrompt(params: {
  name: string;
  description: string | null;
  itemSummaries: string[];
}): string {
  const itemsText = params.itemSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return CATEGORY_SUMMARY_PROMPT.replace("{name}", params.name)
    .replace("{description}", params.description ?? "(none)")
    .replace("{items}", itemsText);
}

// ── category_with_refs variant ──
// Ported from upstream MemU v1.4.0 PR #202 (src/memu/prompts/category_summary/
// category_with_refs.py). Lets a category summary stay traceable to the items
// that produced it by attaching a synthetic [ref:<short-id>] token after each
// input item and asking the LLM to keep those tokens in the output.

/** Generate a summary that includes inline [ref:...] tokens pointing at items */
export const CATEGORY_SUMMARY_WITH_REFS_PROMPT = `You are summarizing a memory category for a personal AI assistant.

Category name: {name}
Current description: {description}

Memory items in this category (each followed by an inline [ref:<id>] token):
{items}

Write a concise 1-3 sentence summary of what this category contains. The summary MUST:
- Keep every [ref:<id>] token from the inputs you actually use, placed directly after the clause it supports (e.g. The user prefers dark mode [ref:<id>].)
- Never invent a [ref:<id>] token that did not appear in the inputs
- Never alter the contents of a token (do not translate, reformat, or strip the id)
- Capture the key themes and facts
- Be written in third person ("The user prefers...", "Contains info about...")
- Focus on the most important/reinforced items
- Never describe your own reasoning or actions (no "the user is asking me", "I should", "let me")
- Never mention prompts, context windows, or assistant behavior

Reply with ONLY the summary text (including its [ref:...] tokens), no labels or formatting.`;

/**
 * Short, stable ref id for a memory item.
 *
 * Prefers a 7-char hex slice of the SHA-256 content hash when available so the
 * id is content-derived and resistant to db churn. Falls back to the first
 * 8 chars of the item id (UUID-style) so every item still gets a token.
 */
export function deriveItemRefId(item: { id: string; contentHash?: string | null }): string {
  const hash = item.contentHash;
  if (hash && typeof hash === "string") {
    // SHA-256 hashes are 64 hex chars; first 7 give us ~28 bits — plenty for
    // local disambiguation across the at-most-30 items we pass in.
    const slice = hash
      .replace(/[^0-9a-fA-F]/g, "")
      .slice(0, 7)
      .toLowerCase();
    if (slice.length === 7) {
      return slice;
    }
  }
  // Strip dashes from a UUID and take the first 8 chars; this keeps the token
  // visually distinct from a hash-derived one (8 chars vs 7).
  return item.id.replace(/-/g, "").slice(0, 8).toLowerCase();
}

export interface CategorySummaryWithRefsItem {
  id: string;
  summary: string;
  contentHash?: string | null;
}

/**
 * Build the with-refs prompt. Each item gets a `[ref:<id>]` token appended to
 * its summary line. The LLM is instructed to preserve those tokens verbatim in
 * the output so the resulting summary is item-traceable.
 */
export function buildCategorySummaryWithRefsPrompt(params: {
  name: string;
  description: string | null;
  items: CategorySummaryWithRefsItem[];
}): string {
  const itemsText = params.items
    .map((item, i) => {
      const ref = deriveItemRefId(item);
      // Strip any pre-existing newlines from the item summary so each input
      // stays on a single numbered line; the [ref:...] token always lives at
      // the end of the line.
      const oneLine = item.summary.replace(/\s+/g, " ").trim();
      return `${i + 1}. ${oneLine} [ref:${ref}]`;
    })
    .join("\n");
  return CATEGORY_SUMMARY_WITH_REFS_PROMPT.replace("{name}", params.name)
    .replace("{description}", params.description ?? "(none)")
    .replace("{items}", itemsText);
}
