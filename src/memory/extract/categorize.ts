/**
 * MemU Categorization
 *
 * Auto-assigns extracted facts to categories.
 * Creates new categories as needed and generates embeddings.
 */

import type { MemoryAdapter } from "../../data/adapter.js";
import type { MemuEmbedder } from "../memu-embed.js";
import type { ExtractedFact, MemoryCategory, MemoryItem, Significance } from "../memu-types.js";

export interface CategorizeResult {
  /** Items created from the new facts */
  items: MemoryItem[];
  /** New categories that were created */
  newCategories: MemoryCategory[];
  /** Existing categories that received new items */
  updatedCategories: MemoryCategory[];
}

const OPERATIONAL_RESOURCE_PREFIXES = ["heartbeat://", "cron://"] as const;
const HIGH_SIGNAL_SUMMARY_PATTERNS: RegExp[] = [
  /\b(decided|decision|committed|commitment|approved|approval|agreed|promised?)\b/i,
  /\b(failed|failure|blocked|incident|outage|escalat(?:e|ed|ion))\b/i,
  /\b(deadline|contract|launch|customer impact)\b/i,
];
const CATEGORY_CANONICAL_RULES: Array<{ pattern: RegExp; canonical: string | null }> = [
  {
    pattern:
      /^(cron|cron job|cron jobs|schedule|scheduling|automated scheduling|automated cron job)$/i,
    canonical: "Automated Scheduling",
  },
  { pattern: /^(automation|automated operations)$/i, canonical: "Automated Operations" },
  { pattern: /^(monitoring|heartbeat|automated alerting|alerts?)$/i, canonical: "Monitoring" },
  { pattern: /^(atera integration)$/i, canonical: "Atera" },
  { pattern: /^(vip email)$/i, canonical: "VIP Email" },
  { pattern: /^20\d{2}$/, canonical: null },
];

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeExtractedCategoryName(name: string): string | null {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  for (const rule of CATEGORY_CANONICAL_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.canonical;
    }
  }
  if (/^[\d\W_]+$/.test(normalized)) {
    return null;
  }
  return toTitleCase(normalized);
}

function inferExtractedFactSignificance(params: {
  fact: ExtractedFact;
  resourceUrl?: string | null;
}): Significance {
  const summary = params.fact.summary.trim();
  const resourceUrl = params.resourceUrl ?? "";
  const isOperationalResource = OPERATIONAL_RESOURCE_PREFIXES.some((prefix) =>
    resourceUrl.startsWith(prefix),
  );

  if (isOperationalResource) {
    return params.fact.memoryType === "knowledge" ? "noteworthy" : "routine";
  }

  if (HIGH_SIGNAL_SUMMARY_PATTERNS.some((pattern) => pattern.test(summary))) {
    return "important";
  }

  switch (params.fact.memoryType) {
    case "knowledge":
    case "profile":
    case "self":
      return "noteworthy";
    case "event":
    case "episode":
      return summary.length >= 140 ? "noteworthy" : "routine";
    case "behavior":
      return summary.length >= 160 ? "noteworthy" : "routine";
    case "skill":
    case "tool":
    default:
      return "routine";
  }
}

/**
 * Categorize extracted facts: create items, assign to categories, generate embeddings.
 *
 * For each fact:
 * 1. Create a MemoryItem in the store
 * 2. For each category name on the fact:
 *    - Get or create the category
 *    - Link the item to the category
 * 3. Generate embeddings for the new items (batch)
 * 4. Generate embeddings for new categories (batch)
 */
export async function categorizeFacts(params: {
  store: MemoryAdapter;
  embedder: MemuEmbedder | null;
  facts: ExtractedFact[];
  resourceId: string;
}): Promise<CategorizeResult> {
  const { store, embedder, facts, resourceId } = params;
  const items: MemoryItem[] = [];
  const newCategoryNames = new Set<string>();
  const touchedCategoryNames = new Set<string>();
  const resource = await store.getResource(resourceId);

  // Track which categories existed before
  const existingCategoryNames = new Set((await store.listCategories()).map((c) => c.name));

  // 1. Create items and link to categories
  for (const fact of facts) {
    const item = await store.createItem({
      resourceId,
      memoryType: fact.memoryType,
      summary: fact.summary,
      happenedAt: fact.happenedAt,
      significance: inferExtractedFactSignificance({
        fact,
        resourceUrl: resource?.url ?? null,
      }),
    });
    items.push(item);

    // Assign to categories
    for (const catName of fact.categoryNames) {
      const normalizedName = normalizeExtractedCategoryName(catName);
      if (!normalizedName) continue;

      const category = await store.getOrCreateCategory(normalizedName);
      await store.linkItemToCategory(item.id, category.id);
      touchedCategoryNames.add(normalizedName);

      if (!existingCategoryNames.has(normalizedName)) {
        newCategoryNames.add(normalizedName);
      }
    }
  }

  // 2. Generate embeddings for new items (batch)
  if (embedder && items.length > 0) {
    try {
      const summaries = items.map((item) => item.summary);
      const embeddings = await embedder.embedBatch(summaries);
      for (let i = 0; i < items.length; i++) {
        if (embeddings[i]) {
          await store.updateItemEmbedding(items[i].id, embeddings[i]);
        }
      }
    } catch (err) {
      console.error("[MemU] Failed to generate item embeddings:", err);
      // Continue without embeddings — keyword search still works
    }
  }

  // 3. Generate embeddings for new categories
  // Note: MemoryAdapter does not expose updateCategoryEmbedding — PG handles
  // category embeddings at the schema level. We still collect new categories
  // so callers can refresh summaries.
  const newCategories: MemoryCategory[] = [];
  if (newCategoryNames.size > 0) {
    for (const catName of newCategoryNames) {
      const cat = await store.getCategoryByName(catName);
      if (cat) {
        newCategories.push(cat);
      }
    }
  }

  // 4. Collect updated (existing) categories
  const updatedCategories: MemoryCategory[] = [];
  for (const name of touchedCategoryNames) {
    if (!newCategoryNames.has(name)) {
      const cat = await store.getCategoryByName(name);
      if (cat) updatedCategories.push(cat);
    }
  }

  return { items, newCategories, updatedCategories };
}

export const __testing = {
  inferExtractedFactSignificance,
  normalizeExtractedCategoryName,
};
