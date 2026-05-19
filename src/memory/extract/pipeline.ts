/**
 * MemU Extraction Pipeline
 *
 * Orchestrates the full extraction workflow:
 * 1. Load resource text
 * 2. Extract facts per memory type (LLM)
 * 3. Deduplicate against existing items
 * 4. Categorize and create items + categories
 * 5. Generate embeddings
 *
 * Runs asynchronously and non-blocking — called from Memo hooks.
 */

import type { ArgentConfig } from "../../config/config.js";
import type { MemoryAdapter } from "../../data/adapter.js";
import type { MemuEmbedder } from "../memu-embed.js";
import type { ExtractionResult, MemoryType } from "../memu-types.js";
import { getMemoryAdapter } from "../../data/storage-factory.js";
import { refreshTouchedCategorySummaries } from "../categories/index.js";
import { autoLinkEntities } from "../identity/entities.js";
import { getMemuEmbedder } from "../memu-embed.js";
import { MEMORY_TYPES } from "../memu-types.js";
import { categorizeFacts } from "./categorize.js";
import { deduplicateFacts } from "./dedupe.js";
import { extractFacts } from "./extract-items.js";

/** Minimum text length to attempt extraction (skip tiny resources) */
const MIN_TEXT_LENGTH = 50;

/** Maximum text length sent to LLM (truncate very long resources) */
const MAX_TEXT_LENGTH = 8000;
const CRON_JOURNAL_TEXT_RE = /^Cron job "/;
const LOW_VALUE_CRON_FACT_RE =
  /\b(?:status(?: is)? ok|no new vip email(?:s)?|finished checking(?: for vip emails)?|completed successfully|next run|scheduled (?:its )?next run|duration|unique id|active and connected|integrated with|is a vip email check|configured for next run|cron job action|action was vip email check|performing a vip email check|via vip_email|check_pending)\b/i;
const MEANINGFUL_CRON_FACT_RE =
  /\b(?:new vip email(?:s)?|pending vip email(?:s)?|alerts sent|task(?:s)? created|actionable mention(?:s)?|setup required|cooldown active|failed|error|warning|blocked|escalat(?:e|ion)|incident)\b/i;

function isCronJournalResourceText(text: string): boolean {
  return CRON_JOURNAL_TEXT_RE.test(text.trim());
}

function filterOperationalJournalFacts(params: {
  facts: ExtractionResult["facts"];
  resourceText: string;
}): ExtractionResult["facts"] {
  if (!isCronJournalResourceText(params.resourceText)) {
    return params.facts;
  }
  return params.facts.filter((fact) => {
    const summary = fact.summary.trim();
    if (!summary) return false;
    if (LOW_VALUE_CRON_FACT_RE.test(summary)) return false;
    if (MEANINGFUL_CRON_FACT_RE.test(summary)) return true;
    if (
      /\b(?:cron job|vip email(?: check| scan)?|scheduled run|next run|atera rmm\/psa)\b/i.test(
        summary,
      )
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Run the extraction pipeline on a resource.
 *
 * This is the main entry point. Call it after creating a Resource in the store.
 * It will extract facts, deduplicate, categorize, and generate embeddings.
 */
export async function runExtractionPipeline(params: {
  resourceId: string;
  text: string;
  config: ArgentConfig;
  store?: MemoryAdapter;
  embedder?: MemuEmbedder | null;
  memoryTypes?: MemoryType[];
}): Promise<ExtractionResult> {
  const store = params.store ?? (await getMemoryAdapter());
  const text = params.text.trim();

  // Skip very short texts
  if (text.length < MIN_TEXT_LENGTH) {
    return {
      resourceId: params.resourceId,
      facts: [],
      newItems: [],
      reinforcedItems: [],
      newCategories: [],
    };
  }

  // Truncate very long texts
  const truncatedText =
    text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) + "\n\n[truncated]" : text;

  // Get existing categories for context
  const existingCategories = (await store.listCategories()).map((c) => c.name);

  // Step 1: Extract facts via LLM
  const extractedFacts = await extractFacts({
    conversationText: truncatedText,
    existingCategories,
    config: params.config,
    memoryTypes: params.memoryTypes ?? [...MEMORY_TYPES],
  });
  const facts = filterOperationalJournalFacts({
    facts: extractedFacts,
    resourceText: truncatedText,
  });

  if (facts.length === 0) {
    return {
      resourceId: params.resourceId,
      facts: [],
      newItems: [],
      reinforcedItems: [],
      newCategories: [],
    };
  }

  // Step 2: Deduplicate against existing items
  const deduped = await deduplicateFacts(store, facts);

  if (deduped.newFacts.length === 0) {
    return {
      resourceId: params.resourceId,
      facts,
      newItems: [],
      reinforcedItems: deduped.reinforcedItems,
      newCategories: [],
    };
  }

  // Step 3: Initialize embedder (lazy, cached)
  let embedder = params.embedder ?? null;
  if (!embedder) {
    try {
      embedder = await getMemuEmbedder(params.config);
    } catch (err) {
      console.warn("[MemU] Embedder not available, continuing without embeddings:", String(err));
    }
  }

  // Step 4: Categorize — create items, assign categories, generate embeddings
  const categorized = await categorizeFacts({
    store,
    embedder,
    facts: deduped.newFacts,
    resourceId: params.resourceId,
  });

  const result: ExtractionResult = {
    resourceId: params.resourceId,
    facts,
    newItems: categorized.items,
    reinforcedItems: deduped.reinforcedItems,
    newCategories: categorized.newCategories,
  };

  console.log(
    `[MemU] Extraction complete: ${facts.length} facts extracted, ${deduped.newFacts.length} new, ${deduped.duplicateCount} reinforced, ${categorized.newCategories.length} new categories`,
  );

  // Step 5: Refresh category summaries (background, non-blocking)
  const touchedCategoryIds = [
    ...categorized.newCategories.map((c) => c.id),
    ...categorized.updatedCategories.map((c) => c.id),
  ];
  if (touchedCategoryIds.length > 0) {
    void refreshTouchedCategorySummaries({
      categoryIds: touchedCategoryIds,
      config: params.config,
      store,
    }).catch((err) => {
      console.warn("[MemU] Category summary refresh failed:", String(err));
    });
  }

  // Step 6: Auto-link entities (background, non-blocking)
  if (categorized.items.length > 0) {
    void (async () => {
      for (const item of categorized.items) {
        try {
          await autoLinkEntities(store, item, params.config);
        } catch (err) {
          console.warn(`[MemU] Entity linking failed for item ${item.id}:`, String(err));
        }
      }
    })().catch((err) => {
      console.warn("[MemU] Entity auto-linking batch failed:", String(err));
    });
  }

  return result;
}

// ── Async Queue ──

/** Pending extraction tasks */
const extractionQueue: Array<{
  resourceId: string;
  text: string;
  config: ArgentConfig;
  memoryTypes?: MemoryType[];
}> = [];

let extractionRunning = false;

/**
 * Queue a resource for async extraction.
 *
 * Called from Memo hooks — non-blocking, runs in background.
 * Extractions are processed sequentially to avoid overwhelming the LLM.
 */
export function queueExtraction(params: {
  resourceId: string;
  text: string;
  config: ArgentConfig;
  memoryTypes?: MemoryType[];
}): void {
  extractionQueue.push(params);
  void drainExtractionQueue();
}

export const __testing = {
  isCronJournalResourceText,
  filterOperationalJournalFacts,
};

async function drainExtractionQueue(): Promise<void> {
  if (extractionRunning) return;
  extractionRunning = true;

  try {
    while (extractionQueue.length > 0) {
      const task = extractionQueue.shift()!;
      try {
        await runExtractionPipeline({
          resourceId: task.resourceId,
          text: task.text,
          config: task.config,
          memoryTypes: task.memoryTypes,
        });
      } catch (err) {
        console.error(`[MemU] Extraction failed for resource ${task.resourceId}:`, err);
      }
    }
  } finally {
    extractionRunning = false;
  }
}
