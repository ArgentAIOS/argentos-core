/**
 * Category summary hygiene helpers.
 *
 * Rejects obvious meta-reasoning output so category summaries stay factual.
 *
 * Also exposes ref-token helpers for the `category_with_refs` summary variant
 * (see prompts.ts → buildCategorySummaryWithRefsPrompt). Those tokens look
 * like `[ref:abc1234]` and must survive `sanitizeCategorySummary` so callers
 * that opt-in to refs can keep their item-traceable output.
 */

export const META_SUMMARY_PATTERNS: RegExp[] = [
  /\bthe user is asking me\b/i,
  /\buser is asking me\b/i,
  /\blet me\b/i,
  /\bi should\b/i,
  /\bi need to\b/i,
  /\bi will\b/i,
  /\b(as an ai|assistant)\b/i,
  /\b(based on|from) (the|this|provided) (context|prompt|input|conversation)\b/i,
  /\blooking at (the|this) (context|prompt|conversation)\b/i,
];

/**
 * Matches a single `[ref:<id>]` token. The id is restricted to alphanumerics,
 * dashes, and underscores so it does not collide with real prose punctuation.
 */
export const REF_TOKEN_PATTERN = /\[ref:[A-Za-z0-9_-]+\]/g;

/**
 * Normalize category summary output and reject obvious meta-text.
 * Returns null when text should not be persisted.
 *
 * Preserves `[ref:...]` tokens verbatim — META_SUMMARY_PATTERNS do not match
 * inside them (token characters are letters/digits/dashes/underscores only),
 * and whitespace collapsing keeps the bracket-delimited shape intact.
 */
export function sanitizeCategorySummary(text: string): string | null {
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!normalized) {
    return null;
  }
  if (/^(none|n\/a|null|unknown)$/i.test(normalized)) {
    return null;
  }
  if (META_SUMMARY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }
  return normalized;
}

/**
 * Strip `[ref:...]` tokens out of a summary string and tidy up the resulting
 * whitespace/punctuation. Use this when a caller asked for the with-refs
 * variant but needs a plain-text rendering (e.g. for UI display or downstream
 * consumers that don't speak ref tokens).
 *
 * Returns an empty string if the input is empty after stripping.
 */
export function stripCategorySummaryRefs(text: string): string {
  if (!text) {
    return "";
  }
  // Remove the tokens themselves.
  let out = text.replace(REF_TOKEN_PATTERN, "");
  // Tighten any space-before-punctuation artefacts left by token removal,
  // e.g. "dark mode ." → "dark mode.".
  out = out.replace(/\s+([.,;:!?])/g, "$1");
  // Collapse runs of whitespace introduced by removal back to single spaces.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

/**
 * Extract the unique ref ids referenced in a summary, in the order they
 * appear. Useful for callers that want to resolve refs back to source items.
 */
export function extractCategorySummaryRefs(text: string): string[] {
  if (!text) {
    return [];
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  const matches = text.match(REF_TOKEN_PATTERN);
  if (!matches) {
    return ordered;
  }
  for (const match of matches) {
    // match is `[ref:<id>]`; the slice between index 5 and -1 is the id.
    const id = match.slice(5, -1);
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}
