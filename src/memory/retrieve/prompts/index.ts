/**
 * MemU Retrieval Prompts
 *
 * Prompts for sufficiency checking and LLM-based re-ranking.
 */

/** Check if retrieved results sufficiently answer the query */
export const SUFFICIENCY_PROMPT = `You are evaluating whether retrieved memory items sufficiently answer a query.

Query: {query}

Retrieved items:
{items}

Does this set of items provide enough context to answer the query?
Reply with exactly one word: YES or NO`;

/** Re-rank items by relevance to the query */
export const RERANK_PROMPT = `You are ranking memory items by relevance to a query.

Query: {query}

Items (numbered):
{items}

Ranking guidelines:
- If an item directly states the answer to the query, it MUST be ranked first.
- Property questions ("what is my favorite X", "where do I live", "who is my Y")
  are answered by items that explicitly contain that property and its value.
  An item like "<entity>'s favorite color is <value>" answers "favorite color"
  and ranks above broad identity facts like preferred name, pronouns, profession,
  or unrelated likes/interests about the same entity.
- Topical co-mention ("the entity likes X") is NOT an answer to a property
  question unless the item explicitly states that X is the property's value.
- Recency and reinforcement are inputs to the prior score, not signals to demote
  a direct answer in favor of a more frequently mentioned but less relevant fact.

Return ONLY the item numbers in order of relevance (most relevant first).
Format: comma-separated numbers, e.g.: 3, 1, 5, 2, 4
If none are relevant, return: NONE`;

export function buildSufficiencyPrompt(query: string, items: string[]): string {
  const itemsText = items.map((item, i) => `${i + 1}. ${item}`).join("\n");
  return SUFFICIENCY_PROMPT.replace("{query}", query).replace("{items}", itemsText);
}

export function buildRerankPrompt(query: string, items: string[]): string {
  const itemsText = items.map((item, i) => `${i + 1}. ${item}`).join("\n");
  return RERANK_PROMPT.replace("{query}", query).replace("{items}", itemsText);
}
