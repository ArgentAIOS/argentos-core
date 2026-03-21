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
