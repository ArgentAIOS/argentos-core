/**
 * MemU Deduplication
 *
 * Uses content hashing to detect duplicate facts.
 * If a fact already exists, reinforce it instead of creating a duplicate.
 */

import type { MemoryAdapter } from "../../data/adapter.js";
import type { ExtractedFact, MemoryItem } from "../memu-types.js";
import { contentHash } from "../memu-store.js";

const HEX_OR_UUID_RE = /\b(?:[a-f0-9]{8,}|[a-f0-9]{8}-[a-f0-9-]{27,})\b/gi;
const NUMERIC_TOKEN_RE = /\b\d+(?:[.,]\d+)?%?\b/g;
const DATETIME_TOKEN_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:z)?\b/gi;
const REQUEST_TOKEN_RE = /\b(?:run|req|msg)-[a-z0-9-]+\b/gi;
const NUMERIC_TOKEN_TEST_RE = /\b\d+(?:[.,]\d+)?%?\b/;
const DATETIME_TOKEN_TEST_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:z)?\b/i;
const OPERATIONAL_PROFILE_HINT_RE =
  /\b(?:status|snapshot|health|metric|count|queue|uptime|latency|ticket|alert|cron|heartbeat|service|gateway|dashboard|api|provider|model)\b/i;

function semanticSignature(summary: string): string {
  return summary
    .toLowerCase()
    .replace(DATETIME_TOKEN_RE, " <datetime> ")
    .replace(REQUEST_TOKEN_RE, " <id> ")
    .replace(HEX_OR_UUID_RE, " <id> ")
    .replace(NUMERIC_TOKEN_RE, " <num> ")
    .replace(/[^\p{L}\p{N}<>\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOperationalProfileSnapshot(fact: ExtractedFact): boolean {
  if (fact.memoryType !== "profile") {
    return false;
  }
  if (!OPERATIONAL_PROFILE_HINT_RE.test(fact.summary)) {
    return false;
  }
  return NUMERIC_TOKEN_TEST_RE.test(fact.summary) || DATETIME_TOKEN_TEST_RE.test(fact.summary);
}

function findSemanticDuplicate(
  fact: ExtractedFact,
  candidates: MemoryItem[],
): MemoryItem | undefined {
  const factSignature = semanticSignature(fact.summary);
  if (!factSignature) {
    return undefined;
  }

  return candidates.find((item) => semanticSignature(item.summary) === factSignature);
}

export interface DedupeResult {
  /** New facts that don't exist yet */
  newFacts: ExtractedFact[];
  /** Existing items that were reinforced (duplicate facts) */
  reinforcedItems: MemoryItem[];
  /** Total facts processed */
  totalProcessed: number;
  /** Number of duplicates found */
  duplicateCount: number;
}

/**
 * Deduplicate extracted facts against the existing memory store.
 *
 * For each fact:
 * - Compute content hash of the summary
 * - Check if an item with that hash exists
 * - If yes: reinforce the existing item (increment count)
 * - If no: pass through as a new fact
 */
export async function deduplicateFacts(
  store: MemoryAdapter,
  facts: ExtractedFact[],
): Promise<DedupeResult> {
  const newFacts: ExtractedFact[] = [];
  const reinforcedItems: MemoryItem[] = [];
  const recentByType = new Map<string, MemoryItem[]>();

  for (const fact of facts) {
    const hash = contentHash(fact.summary);
    const existing = await store.findItemByHash(hash);

    if (existing) {
      // Duplicate — reinforce the existing item
      await store.reinforceItem(existing.id);
      reinforcedItems.push(existing);
    } else {
      let semanticDuplicate: MemoryItem | undefined;

      // Low-signal operational profile snapshots should collapse to canonical facts
      // even when counters/IDs/timestamps differ.
      if (isOperationalProfileSnapshot(fact)) {
        const cacheKey = fact.memoryType;
        let candidates = recentByType.get(cacheKey);
        if (!candidates) {
          candidates = await store.listItems({
            memoryType: fact.memoryType,
            limit: 250,
          });
          recentByType.set(cacheKey, candidates);
        }
        semanticDuplicate = findSemanticDuplicate(fact, candidates);
      }

      if (semanticDuplicate) {
        await store.reinforceItem(semanticDuplicate.id);
        reinforcedItems.push(semanticDuplicate);
      } else {
        // New fact — pass through
        newFacts.push(fact);
      }
    }
  }

  return {
    newFacts,
    reinforcedItems,
    totalProcessed: facts.length,
    duplicateCount: reinforcedItems.length,
  };
}
