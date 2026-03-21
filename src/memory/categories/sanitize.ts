/**
 * Category summary hygiene helpers.
 *
 * Rejects obvious meta-reasoning output so category summaries stay factual.
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
 * Normalize category summary output and reject obvious meta-text.
 * Returns null when text should not be persisted.
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
