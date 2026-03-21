/**
 * MemU Category Manager — Higher-level category operations.
 *
 * Wraps MemuStore category CRUD with:
 * - LLM-driven summary generation and evolution
 * - Category cleanup (remove empty categories)
 * - Batch summary refresh after extraction
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type { MemoryAdapter } from "../../data/adapter.js";
import {
  resolveDefaultAgentId,
  resolveAgentWorkspaceDir,
  resolveAgentDir,
} from "../../agents/agent-scope.js";
import { FailoverError } from "../../agents/failover-error.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import { getMemoryAdapter } from "../../data/storage-factory.js";
import { CommandLane } from "../../process/lanes.js";
import { buildMemuLlmRunAttempts } from "../llm-config.js";
import { buildCategorySummaryPrompt } from "./prompts.js";
import { sanitizeCategorySummary } from "./sanitize.js";

// ── Circuit breaker ──
// Skip LLM calls when the provider is in cooldown to avoid rapid-fire FailoverErrors.
let memuCircuitOpen = false;
let memuCircuitResetAt = 0;
const MEMU_CIRCUIT_COOLDOWN_MS = 30_000;

// ── Summary Generation ──

/**
 * Generate or refresh a category's LLM summary based on its items.
 * Skips categories with no items.
 */
export async function refreshCategorySummary(params: {
  categoryId: string;
  config: ArgentConfig;
  store?: MemoryAdapter;
  maxItems?: number;
}): Promise<string | null> {
  const store = params.store ?? (await getMemoryAdapter());
  const maxItems = params.maxItems ?? 30;

  const category = await store.getCategory(params.categoryId);
  if (!category) {
    return null;
  }

  const items = await store.getCategoryItems(params.categoryId, maxItems);
  if (items.length === 0) {
    return null;
  }

  // Sort by reinforcement count (most reinforced = most important)
  items.sort((a, b) => b.reinforcementCount - a.reinforcementCount);

  const prompt = buildCategorySummaryPrompt({
    name: category.name,
    description: category.description,
    itemSummaries: items.map((item) => item.summary),
  });

  const summary = await callLlm(prompt, "category-summary", params.config);
  const sanitized = sanitizeCategorySummary(summary);

  if (sanitized) {
    await store.updateCategorySummary(params.categoryId, sanitized);
  }

  return sanitized;
}

/**
 * Refresh summaries for all categories that were touched during extraction.
 * Runs in background — non-blocking.
 */
export async function refreshTouchedCategorySummaries(params: {
  categoryIds: string[];
  config: ArgentConfig;
  store?: MemoryAdapter;
}): Promise<{ updated: number; errors: number }> {
  const store = params.store ?? (await getMemoryAdapter());
  let updated = 0;
  let errors = 0;

  for (const catId of params.categoryIds) {
    try {
      const summary = await refreshCategorySummary({
        categoryId: catId,
        config: params.config,
        store,
      });
      if (summary) {
        updated++;
      }
    } catch (err) {
      console.error(`[MemU] Failed to refresh summary for category ${catId}:`, err);
      errors++;
    }
  }

  return { updated, errors };
}

// ── Cleanup ──

/**
 * Remove categories with zero items (orphaned after deletions).
 */
export async function cleanupEmptyCategories(
  store?: MemoryAdapter,
): Promise<{ removed: string[] }> {
  const s = store ?? (await getMemoryAdapter());
  const allCategories = await s.listCategories();
  const removed: string[] = [];

  for (const cat of allCategories) {
    const count = await s.getCategoryItemCount(cat.id);
    if (count === 0) {
      await s.deleteCategory(cat.id);
      removed.push(cat.name);
    }
  }

  return { removed };
}

// ── LLM Helper ──

async function callLlm(prompt: string, purpose: string, config: ArgentConfig): Promise<string> {
  // Circuit breaker: skip during cooldown
  if (memuCircuitOpen) {
    if (Date.now() < memuCircuitResetAt) {
      return "";
    }
    memuCircuitOpen = false;
  }

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
          lane: CommandLane.Background,
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
  } catch (err) {
    if (err instanceof FailoverError) {
      memuCircuitOpen = true;
      memuCircuitResetAt = Date.now() + MEMU_CIRCUIT_COOLDOWN_MS;
      console.warn(
        `[MemU] Circuit breaker opened for ${MEMU_CIRCUIT_COOLDOWN_MS / 1000}s after FailoverError (${purpose})`,
      );
    }
    throw err;
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
