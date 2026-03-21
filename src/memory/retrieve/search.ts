/**
 * MemU Retrieval — Orchestrated memory search with optional LLM re-ranking.
 *
 * Flow:
 * 1. Embed query (if embedder available)
 * 2. Category-first search: find relevant categories, then boost items from them
 * 3. Hybrid search: combine vector + keyword results (via MemuStore.searchItems)
 * 4. Optionally: LLM sufficiency check — are results good enough?
 * 5. Optionally: LLM re-rank — reorder by semantic relevance
 * 6. Reinforce accessed items (bump salience on retrieval)
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type { MemoryAdapter } from "../../data/adapter.js";
import type { MemuEmbedder } from "../memu-embed.js";
import type { MemuStore } from "../memu-store.js";
import type { MemorySearchOptions, MemorySearchResult, MemoryType } from "../memu-types.js";
import {
  resolveDefaultAgentId,
  resolveAgentWorkspaceDir,
  resolveAgentDir,
} from "../../agents/agent-scope.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import { getMemoryAdapter, getStorageAdapter } from "../../data/storage-factory.js";
import { buildMemuLlmRunAttempts } from "../llm-config.js";
import { getMemuEmbedder } from "../memu-embed.js";
import { buildRerankPrompt, buildSufficiencyPrompt } from "./prompts/index.js";

// ── Types ──

export interface RetrievalOptions extends MemorySearchOptions {
  /** Enable LLM sufficiency check after initial search */
  sufficiencyCheck?: boolean;
  /** Enable LLM re-ranking of results */
  rerank?: boolean;
  /** Reinforce (bump salience of) accessed items */
  reinforceOnAccess?: boolean;
  /** Weight for vector similarity vs keyword (0–1, default 0.7) */
  vectorWeight?: number;
  /** Config needed for LLM calls (sufficiency/rerank) */
  config?: ArgentConfig;
  /** External embedder (skips lazy init if provided) */
  embedder?: MemuEmbedder | null;
  /** External store (skips singleton if provided) */
  store?: MemuStore;
}

export interface RetrievalResult {
  /** Final ordered results */
  results: MemorySearchResult[];
  /** Whether the LLM judged results sufficient (null if check not run) */
  sufficient: boolean | null;
  /** Whether re-ranking was applied */
  reranked: boolean;
  /** Number of items reinforced */
  reinforcedCount: number;
  /** Query embedding used (null if embedding failed) */
  queryEmbedding: number[] | null;
}

// ── Main Entry ──

/**
 * Retrieve memory items for a query with optional LLM enhancement.
 *
 * This is the primary retrieval API. For simple cases (no LLM), it's
 * essentially a wrapper around MemuStore.searchItems() with category
 * boosting and reinforcement. For richer retrieval, enable sufficiency
 * checks and re-ranking.
 */
export async function retrieveMemory(options: RetrievalOptions): Promise<RetrievalResult> {
  const memoryAdapter = options.store ? null : await resolveMemoryAdapter(options.config);
  const store = options.store ?? null;
  const limit = options.limit ?? 20;
  const minScore = options.minScore ?? 0;
  const reinforceOnAccess = options.reinforceOnAccess ?? true;

  // Step 1: Embed the query
  let queryVec: number[] | null = null;
  let embedder = options.embedder ?? null;

  if (!embedder && options.config) {
    try {
      embedder = await getMemuEmbedder(options.config);
    } catch {
      // Continue without embeddings — keyword search still works
    }
  }

  if (embedder) {
    try {
      queryVec = await embedder.embed(options.query);
    } catch (err) {
      console.warn("[MemU] Failed to embed query, falling back to keyword-only:", String(err));
    }
  }

  // Step 2: Category-boosted search
  // Find relevant categories first, then search within them + globally
  let categoryBoostIds: string[] = [];
  if (memoryAdapter && options.categoryIds === undefined) {
    const catResults = await memoryAdapter.listCategories({ query: options.query, limit: 5 });
    categoryBoostIds = catResults.map((c) => c.id);
  } else if (store && queryVec && options.categoryIds === undefined) {
    // Auto-discover relevant categories
    const catResults = store.searchCategoriesByVector(queryVec, 5);
    categoryBoostIds = catResults.filter((c) => c.score > 0.3).map((c) => c.category.id);
  } else if (options.categoryIds) {
    categoryBoostIds = options.categoryIds;
  }

  // Step 3: Hybrid search
  const rawResults =
    memoryAdapter !== null
      ? await searchHybridViaAdapter(memoryAdapter, {
          query: options.query,
          queryVec,
          limit: limit * 2,
          memoryTypes: options.memoryTypes,
        })
      : (store?.searchItems(queryVec, options.query, {
          memoryTypes: options.memoryTypes,
          limit: limit * 2, // Fetch more for re-ranking
          scoring: options.scoring ?? "salience",
          halfLifeDays: options.recencyDecayDays ?? 30,
          vectorWeight: options.vectorWeight ?? 0.7,
        }) ?? []);

  // Apply category boost: items in relevant categories get a score bump
  if (categoryBoostIds.length > 0) {
    const categoryItemIds = new Set<string>();
    for (const catId of categoryBoostIds) {
      const items =
        memoryAdapter !== null
          ? await memoryAdapter.getCategoryItems(catId, 200)
          : (store?.getCategoryItems(catId, 200) ?? []);
      for (const item of items) {
        categoryItemIds.add(item.id);
      }
    }

    for (const result of rawResults) {
      if (categoryItemIds.has(result.item.id)) {
        result.score *= 1.2; // 20% boost for category-relevant items
      }
    }

    // Re-sort after boost
    rawResults.sort((a, b) => b.score - a.score);
  }

  // Apply minScore filter
  let filtered = rawResults.filter((r) => r.score >= minScore);

  // Enrich with category names
  let results: MemorySearchResult[] = await Promise.all(
    filtered.slice(0, limit).map(async (r) => {
      const categories =
        memoryAdapter !== null
          ? await memoryAdapter.getItemCategories(r.item.id)
          : (store?.getItemCategories(r.item.id) ?? []);
      return {
        item: r.item,
        score: r.score,
        categories: categories.map((c) => c.name),
      };
    }),
  );

  // Step 4: Optional LLM sufficiency check
  let sufficient: boolean | null = null;
  if (options.sufficiencyCheck && options.config && results.length > 0) {
    try {
      sufficient = await checkSufficiency(options.query, results, options.config);
    } catch (err) {
      console.warn("[MemU] Sufficiency check failed:", String(err));
    }
  }

  // Step 5: Optional LLM re-ranking
  let reranked = false;
  if (options.rerank && options.config && results.length > 1) {
    try {
      const rerankedResults = await rerankResults(options.query, results, options.config);
      if (rerankedResults) {
        results = rerankedResults;
        reranked = true;
      }
    } catch (err) {
      console.warn("[MemU] Re-ranking failed:", String(err));
    }
  }

  // Step 6: Reinforce accessed items
  let reinforcedCount = 0;
  if (reinforceOnAccess && results.length > 0) {
    for (const r of results) {
      try {
        if (memoryAdapter !== null) {
          await memoryAdapter.reinforceItem(r.item.id);
        } else {
          store?.reinforceItem(r.item.id);
        }
        reinforcedCount++;
      } catch {
        // Non-fatal
      }
    }
  }

  return {
    results,
    sufficient,
    reranked,
    reinforcedCount,
    queryEmbedding: queryVec,
  };
}

async function resolveMemoryAdapter(config?: ArgentConfig): Promise<MemoryAdapter | null> {
  try {
    const adapter = await getStorageAdapter();
    const memory = adapter.memory;
    if (config && memory.withAgentId) {
      return memory.withAgentId(resolveDefaultAgentId(config));
    }
    return memory;
  } catch {
    // Fall back to getMemoryAdapter() which initializes storage if needed
    try {
      return await getMemoryAdapter();
    } catch {
      return null;
    }
  }
}

async function searchHybridViaAdapter(
  memory: MemoryAdapter,
  input: {
    query: string;
    queryVec: number[] | null;
    memoryTypes?: MemoryType[];
    limit: number;
  },
): Promise<MemorySearchResult[]> {
  const merged = new Map<string, MemorySearchResult>();
  const vectorLimit = input.limit;
  const keywordLimit = input.limit;

  if (input.queryVec && input.queryVec.length > 0) {
    const vectorHits = await memory.searchByVector(Float32Array.from(input.queryVec), vectorLimit);
    for (const hit of vectorHits) {
      merged.set(hit.item.id, hit);
    }
  }

  const keywordHits = await memory.searchByKeyword(input.query, keywordLimit);
  for (const hit of keywordHits) {
    const existing = merged.get(hit.item.id);
    if (!existing || hit.score > existing.score) {
      merged.set(hit.item.id, hit);
    }
  }

  let results = Array.from(merged.values());
  if (input.memoryTypes && input.memoryTypes.length > 0) {
    const allowed = new Set(input.memoryTypes);
    results = results.filter((r) => allowed.has(r.item.memoryType));
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ── LLM Helpers ──

/** Call LLM to check if results sufficiently answer the query */
async function checkSufficiency(
  query: string,
  results: MemorySearchResult[],
  config: ArgentConfig,
): Promise<boolean> {
  const summaries = results.map((r) => r.item.summary);
  const prompt = buildSufficiencyPrompt(query, summaries);
  const response = await callLlm(prompt, "memu-sufficiency", config);
  return response.trim().toUpperCase().startsWith("YES");
}

/** Call LLM to re-rank results by semantic relevance */
async function rerankResults(
  query: string,
  results: MemorySearchResult[],
  config: ArgentConfig,
): Promise<MemorySearchResult[] | null> {
  const summaries = results.map((r) => r.item.summary);
  const prompt = buildRerankPrompt(query, summaries);
  const response = await callLlm(prompt, "memu-rerank", config);

  const trimmed = response.trim();
  if (trimmed === "NONE") {
    return null; // LLM says nothing is relevant — keep original results rather than nuking them
  }

  // Parse comma-separated indices
  const indices = trimmed
    .split(",")
    .map((s) => parseInt(s.trim(), 10) - 1) // Convert 1-based to 0-based
    .filter((i) => !isNaN(i) && i >= 0 && i < results.length);

  if (indices.length === 0) {
    return null; // Parse failed, keep original order
  }

  // Rebuild array in LLM-specified order
  const reordered: MemorySearchResult[] = [];
  const seen = new Set<number>();
  for (const idx of indices) {
    if (!seen.has(idx)) {
      reordered.push(results[idx]);
      seen.add(idx);
    }
  }

  // Append any items the LLM didn't mention (preserve them at end)
  for (let i = 0; i < results.length; i++) {
    if (!seen.has(i)) {
      reordered.push(results[i]);
    }
  }

  return reordered;
}

/** Generic LLM call using runEmbeddedPiAgent (same pattern as extraction) */
async function callLlm(prompt: string, purpose: string, config: ArgentConfig): Promise<string> {
  const agentId = resolveDefaultAgentId(config);
  const workspaceDir = resolveAgentWorkspaceDir(config, agentId);
  const agentDir = resolveAgentDir(config, agentId);
  const llmAttempts = buildMemuLlmRunAttempts(config, { timeoutMs: 15_000 });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `memu-${purpose}-`));
  const sessionFile = path.join(tempDir, "session.jsonl");

  try {
    let lastError: unknown;
    for (const llm of llmAttempts) {
      try {
        const result = await runEmbeddedPiAgent({
          sessionId: `memu-${purpose}-${Date.now()}`,
          sessionKey: `temp:memu:${purpose}`,
          sessionFile,
          workspaceDir,
          agentDir,
          config,
          prompt,
          disableTools: true,
          provider: llm.provider,
          model: llm.model,
          respectProvidedModel: llm.respectProvidedModel,
          thinkLevel: llm.thinkLevel,
          timeoutMs: llm.timeoutMs,
          runId: `memu-${purpose}-${Date.now()}`,
        });

        return result.payloads?.[0]?.text ?? "";
      } catch (err) {
        lastError = err;
        if (llm.label === "primary") {
          console.warn(
            `[MemU] Primary ${purpose} model failed, retrying with Ollama fallback: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    throw lastError;
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ── Convenience Functions ──

/**
 * Quick memory recall — simple search without LLM enhancement.
 * For use in hot paths where latency matters (e.g., system prompt injection).
 */
export async function quickRecall(params: {
  query: string;
  store?: MemuStore;
  embedder?: MemuEmbedder | null;
  config?: ArgentConfig;
  memoryTypes?: MemoryType[];
  limit?: number;
  scoring?: "similarity" | "salience" | "identity";
  recencyDecayDays?: number;
}): Promise<MemorySearchResult[]> {
  const result = await retrieveMemory({
    query: params.query,
    store: params.store,
    embedder: params.embedder,
    config: params.config,
    memoryTypes: params.memoryTypes,
    limit: params.limit ?? 10,
    scoring: params.scoring ?? "salience",
    recencyDecayDays: params.recencyDecayDays,
    sufficiencyCheck: false,
    rerank: false,
    reinforceOnAccess: true,
  });
  return result.results;
}

/**
 * Deep memory search — full search with sufficiency check and re-ranking.
 * For use in explicit memory recall tools where quality matters over speed.
 */
export async function deepRecall(params: {
  query: string;
  config: ArgentConfig;
  store?: MemuStore;
  embedder?: MemuEmbedder | null;
  memoryTypes?: MemoryType[];
  limit?: number;
  scoring?: "similarity" | "salience" | "identity";
}): Promise<RetrievalResult> {
  return retrieveMemory({
    query: params.query,
    config: params.config,
    store: params.store,
    embedder: params.embedder,
    memoryTypes: params.memoryTypes,
    limit: params.limit ?? 20,
    scoring: params.scoring ?? "identity",
    sufficiencyCheck: true,
    rerank: true,
    reinforceOnAccess: true,
  });
}
