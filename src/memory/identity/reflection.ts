/**
 * Identity System — Reflection Pipeline
 *
 * Runs structured reflection cycles triggered by heartbeats, crons, or events.
 * Produces Reflection records with extracted lessons, entity insights, and self-observations.
 */

import type { ArgentConfig } from "../../config/config.js";
import type { MemuStore } from "../memu-store.js";
import type { Reflection, Significance } from "../memu-types.js";
import { callIdentityLlm } from "./llm.js";
import { buildReflectionPrompt } from "./prompts.js";

// ── Types ──

export interface ReflectionParams {
  triggerType: string; // "heartbeat", "evening_cron", "significant_event", "manual"
  store: MemuStore;
  config: ArgentConfig;
  periodStart?: string; // ISO 8601
  periodEnd?: string; // ISO 8601
  /** Max memories to review (default 20) */
  memoryLimit?: number;
}

interface ParsedReflection {
  summary: string;
  lessons: string[];
  entityInsights: Array<{ name: string; insight: string }>;
  selfInsights: string[];
  mood: string | null;
}

// ── Reflection Runner ──

/**
 * Run a reflection cycle:
 * 1. Gather recent memories (within period or last N)
 * 2. Gather recent lessons and entity names for context
 * 3. Call LLM with buildReflectionPrompt
 * 4. Parse structured output
 * 5. Store as Reflection record
 */
export async function runReflection(params: ReflectionParams): Promise<Reflection> {
  const { triggerType, store, config, periodStart, periodEnd } = params;
  const memoryLimit = params.memoryLimit ?? 20;

  // Gather recent memories
  const allRecent = store.listItems({ limit: memoryLimit });
  const memories = periodStart
    ? allRecent.filter((m) => {
        const t = new Date(m.createdAt).getTime();
        const start = new Date(periodStart).getTime();
        const end = periodEnd ? new Date(periodEnd).getTime() : Date.now();
        return t >= start && t <= end;
      })
    : allRecent;

  if (memories.length === 0) {
    // Nothing to reflect on — store a minimal reflection
    return store.createReflection({
      triggerType,
      periodStart,
      periodEnd,
      content: "No new memories to reflect on during this period.",
      mood: "neutral",
    });
  }

  // Gather recent lessons for context
  const recentLessons: string[] = [];
  const selfMemories = store.listItems({ memoryType: "self", limit: 10 });
  for (const m of selfMemories) {
    if (m.lesson) recentLessons.push(m.lesson);
  }

  // Gather entity names for context
  const entityNames = store.listEntities({ limit: 10 }).map((e) => e.name);

  // Build prompt and call LLM
  const memorySummaries = memories.map(
    (m) =>
      `[${m.memoryType}${m.significance !== "routine" ? `, ${m.significance}` : ""}] ${m.summary}`,
  );
  const prompt = buildReflectionPrompt({
    triggerType,
    memories: memorySummaries,
    recentLessons: recentLessons.length > 0 ? recentLessons : undefined,
    entityNames: entityNames.length > 0 ? entityNames : undefined,
  });

  const response = await callIdentityLlm(prompt, "reflection", config);
  const parsed = parseReflectionOutput(response);

  // Store the reflection
  const reflection = store.createReflection({
    triggerType,
    periodStart,
    periodEnd,
    content: parsed.summary,
    lessonsExtracted: parsed.lessons,
    entitiesInvolved: parsed.entityInsights.map((e) => e.name),
    selfInsights: parsed.selfInsights,
    mood: parsed.mood,
  });

  return reflection;
}

// ── Reflection Output Processing ──

/**
 * Process a completed reflection: store lessons as self-type memories,
 * update entity insights, and update significance on referenced items.
 */
export async function processReflectionOutput(
  reflection: Reflection,
  store: MemuStore,
): Promise<{ lessonsStored: number; entitiesUpdated: number }> {
  let lessonsStored = 0;
  let entitiesUpdated = 0;

  // Store each lesson as a self-type memory
  for (const lesson of reflection.lessonsExtracted) {
    if (!lesson.trim()) continue;

    store.createItem({
      memoryType: "self",
      summary: lesson,
      significance: "noteworthy" as Significance,
      lesson,
    });
    lessonsStored++;
  }

  // Store self-insights as self-type memories
  for (const insight of reflection.selfInsights) {
    if (!insight.trim()) continue;

    store.createItem({
      memoryType: "self",
      summary: insight,
      significance: "noteworthy" as Significance,
      reflection: `From ${reflection.triggerType} reflection`,
    });
    lessonsStored++;
  }

  // Update entity emotional textures from entity insights
  for (const entityName of reflection.entitiesInvolved) {
    const entity = store.getEntityByName(entityName);
    if (entity) {
      // Refresh last-mentioned timestamp
      store.updateEntity(entity.id, {});
      entitiesUpdated++;
    }
  }

  return { lessonsStored, entitiesUpdated };
}

// ── Output Parser ──

/**
 * Parse the structured LLM reflection output.
 *
 * Expected format:
 * 1. SUMMARY: ...
 * 2. LESSON: ...
 * 3. ENTITY_INSIGHT: Name — insight
 * 4. SELF: ...
 * 5. MOOD: ...
 */
function parseReflectionOutput(response: string): ParsedReflection {
  const result: ParsedReflection = {
    summary: "",
    lessons: [],
    entityInsights: [],
    selfInsights: [],
    mood: null,
  };

  if (!response || !response.trim()) {
    result.summary = "Reflection produced no output.";
    return result;
  }

  const lines = response.split("\n");
  const summaryLines: string[] = [];
  let inSummary = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for structured prefixes
    if (trimmed.startsWith("SUMMARY:")) {
      inSummary = true;
      const text = trimmed.slice("SUMMARY:".length).trim();
      if (text) summaryLines.push(text);
      continue;
    }

    if (trimmed.startsWith("LESSON:")) {
      inSummary = false;
      const text = trimmed.slice("LESSON:".length).trim();
      if (text) result.lessons.push(text);
      continue;
    }

    if (trimmed.startsWith("ENTITY_INSIGHT:")) {
      inSummary = false;
      const text = trimmed.slice("ENTITY_INSIGHT:".length).trim();
      const dashIdx = text.indexOf("—");
      const hyphenIdx = text.indexOf(" - ");
      if (dashIdx > 0) {
        result.entityInsights.push({
          name: text.slice(0, dashIdx).trim(),
          insight: text.slice(dashIdx + 1).trim(),
        });
      } else if (hyphenIdx > 0) {
        result.entityInsights.push({
          name: text.slice(0, hyphenIdx).trim(),
          insight: text.slice(hyphenIdx + 3).trim(),
        });
      }
      continue;
    }

    if (trimmed.startsWith("SELF:")) {
      inSummary = false;
      const text = trimmed.slice("SELF:".length).trim();
      if (text) result.selfInsights.push(text);
      continue;
    }

    if (trimmed.startsWith("MOOD:")) {
      inSummary = false;
      result.mood = trimmed.slice("MOOD:".length).trim().toLowerCase() || null;
      continue;
    }

    // Continuation of summary section
    if (inSummary) {
      summaryLines.push(trimmed);
    }
  }

  result.summary = summaryLines.join(" ").trim() || response.trim().slice(0, 500);

  return result;
}
