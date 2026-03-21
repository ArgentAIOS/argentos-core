/**
 * MemU Item Extraction
 *
 * Uses LLM to extract structured facts from conversation text.
 * Each memory type is extracted independently with its own prompt.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type { ExtractedFact, MemoryType } from "../memu-types.js";
import {
  resolveDefaultAgentId,
  resolveAgentWorkspaceDir,
  resolveAgentDir,
} from "../../agents/agent-scope.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import { CommandLane } from "../../process/lanes.js";
import { buildMemuLlmRunAttempts } from "../llm-config.js";
import { MEMORY_TYPES } from "../memu-types.js";
import { buildExtractionPrompt } from "./prompts/index.js";

/** Parse LLM output into structured facts */
function parseExtractionResponse(response: string, memoryType: MemoryType): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  if (!response || response.trim() === "NONE") {
    return facts;
  }

  const lines = response.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("FACT:")) {
      continue;
    }

    // Parse: FACT: [text] | CATEGORIES: [cat1, cat2]
    const pipeIdx = trimmed.indexOf("| CATEGORIES:");
    if (pipeIdx === -1) {
      // No categories specified — use memory type as default category
      const factText = trimmed.slice(5).trim();
      if (factText && factText !== "NONE") {
        facts.push({
          memoryType,
          summary: factText,
          categoryNames: [memoryType],
        });
      }
      continue;
    }

    const factText = trimmed.slice(5, pipeIdx).trim();
    const categoriesStr = trimmed.slice(pipeIdx + 13).trim();
    const categoryNames = categoriesStr
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (factText && factText !== "NONE") {
      facts.push({
        memoryType,
        summary: factText,
        categoryNames: categoryNames.length > 0 ? categoryNames : [memoryType],
      });
    }
  }

  return facts;
}

/** Call LLM to extract facts for a single memory type */
async function extractForType(params: {
  memoryType: MemoryType;
  conversationText: string;
  existingCategories: string[];
  config: ArgentConfig;
}): Promise<ExtractedFact[]> {
  const { memoryType, conversationText, existingCategories, config } = params;

  const agentId = resolveDefaultAgentId(config);
  const workspaceDir = resolveAgentWorkspaceDir(config, agentId);
  const agentDir = resolveAgentDir(config, agentId);

  const prompt = buildExtractionPrompt(memoryType, conversationText, existingCategories);
  const llmAttempts = buildMemuLlmRunAttempts(config, { timeoutMs: 30_000 });

  // Create temp session file
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memu-extract-"));
  const sessionFile = path.join(tempDir, "session.jsonl");

  try {
    let lastError: unknown;
    for (const llm of llmAttempts) {
      try {
        const result = await runEmbeddedPiAgent({
          sessionId: `memu-extract-${memoryType}-${Date.now()}`,
          sessionKey: `temp:memu-extract:${memoryType}`,
          sessionFile,
          workspaceDir,
          agentDir,
          config,
          prompt,
          disableTools: true, // Pure LLM call, no tools needed
          provider: llm.provider,
          model: llm.model,
          respectProvidedModel: llm.respectProvidedModel,
          thinkLevel: llm.thinkLevel,
          timeoutMs: llm.timeoutMs,
          runId: `memu-extract-${memoryType}-${Date.now()}`,
          lane: CommandLane.Background,
        });

        // Extract text from payloads
        const responseText = result.payloads?.[0]?.text ?? "";
        return parseExtractionResponse(responseText, memoryType);
      } catch (err) {
        lastError = err;
        if (llm.label === "primary") {
          console.warn(
            `[MemU] Primary extraction model failed for type "${memoryType}", retrying with Ollama fallback: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    throw lastError;
  } catch (err) {
    console.error(`[MemU] Extraction failed for type "${memoryType}":`, err);
    return [];
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Extract facts from conversation text across all memory types.
 *
 * Runs extraction for each memory type sequentially (to limit LLM load).
 * Returns all extracted facts combined.
 */
export async function extractFacts(params: {
  conversationText: string;
  existingCategories: string[];
  config: ArgentConfig;
  memoryTypes?: MemoryType[];
}): Promise<ExtractedFact[]> {
  const types = params.memoryTypes ?? [...MEMORY_TYPES];
  const allFacts: ExtractedFact[] = [];

  // Run extractions sequentially to avoid overwhelming the LLM
  for (const memoryType of types) {
    const facts = await extractForType({
      memoryType,
      conversationText: params.conversationText,
      existingCategories: params.existingCategories,
      config: params.config,
    });
    allFacts.push(...facts);
  }

  return allFacts;
}
