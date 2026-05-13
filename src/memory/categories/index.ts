/**
 * MemU Categories — Public exports
 */

export {
  refreshCategorySummary,
  refreshTouchedCategorySummaries,
  cleanupEmptyCategories,
} from "./manager.js";

export {
  CATEGORY_SUMMARY_PROMPT,
  CATEGORY_SUMMARY_WITH_REFS_PROMPT,
  buildCategorySummaryPrompt,
  buildCategorySummaryWithRefsPrompt,
  deriveItemRefId,
} from "./prompts.js";
export type { CategorySummaryWithRefsItem } from "./prompts.js";
export {
  sanitizeCategorySummary,
  stripCategorySummaryRefs,
  extractCategorySummaryRefs,
  META_SUMMARY_PATTERNS,
  REF_TOKEN_PATTERN,
} from "./sanitize.js";
