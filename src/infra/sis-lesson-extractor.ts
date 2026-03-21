/**
 * SIS Lesson Extractor — Rule-based extraction of lessons from tool outcomes.
 *
 * Two extraction paths:
 * 1. Inline detection (no model call): detect retry patterns and repeated failures
 * 2. Batch extraction (via Haiku): parse tool_lessons from consolidation response
 *
 * Extracted lessons are deduplicated against the MemU lesson store before storage.
 */

import type { ToolOutcome } from "../agents/pi-embedded-subscribe.handlers.types.js";
import type { MemoryAdapter } from "../data/adapter.js";
import type { LessonType } from "../memory/memu-types.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExtractedLesson {
  type: LessonType;
  context: string;
  action: string;
  outcome: string;
  lesson: string;
  correction?: string;
  tags: string[];
  relatedTools: string[];
  confidence: number;
}

// ── Retry Pattern Detection ────────────────────────────────────────────────

/**
 * Find consecutive calls to the same tool where the first fails and the
 * second succeeds. These indicate a workaround was discovered.
 */
export function detectRetryPatterns(outcomes: ToolOutcome[]): ExtractedLesson[] {
  const lessons: ExtractedLesson[] = [];
  if (outcomes.length < 2) return lessons;

  for (let i = 0; i < outcomes.length - 1; i++) {
    const current = outcomes[i];
    const next = outcomes[i + 1];

    if (current.toolName === next.toolName && current.isError && !next.isError) {
      lessons.push({
        type: "workaround",
        context: `Tool "${current.toolName}" failed then succeeded on retry`,
        action: `Called ${current.toolName}`,
        outcome: `First call failed: ${current.errorMessage ?? "unknown error"}. Retry succeeded.`,
        lesson: `${current.toolName} may fail transiently; retrying can resolve the issue`,
        correction: `Retry ${current.toolName} when it fails with: ${current.errorMessage ?? "error"}`,
        tags: ["retry-pattern", "transient-failure"],
        relatedTools: [current.toolName],
        confidence: 0.5,
      });
      // Skip the next outcome since we consumed it as the "success" half
      i++;
    }
  }

  return lessons;
}

// ── Repeated Failure Detection ─────────────────────────────────────────────

/**
 * Find tools that fail 3+ times across the outcome list.
 * These indicate a persistent problem worth recording as a mistake lesson.
 */
export function detectRepeatedFailures(outcomes: ToolOutcome[]): ExtractedLesson[] {
  const lessons: ExtractedLesson[] = [];

  // Group failures by tool name
  const failuresByTool = new Map<string, ToolOutcome[]>();
  for (const o of outcomes) {
    if (!o.isError) continue;
    const existing = failuresByTool.get(o.toolName);
    if (existing) {
      existing.push(o);
    } else {
      failuresByTool.set(o.toolName, [o]);
    }
  }

  for (const [toolName, failures] of failuresByTool) {
    if (failures.length < 3) continue;

    // Collect unique error messages for context
    const uniqueErrors = [...new Set(failures.map((f) => f.errorMessage ?? "unknown"))];
    const errorSummary = uniqueErrors.slice(0, 3).join("; ");

    lessons.push({
      type: "mistake",
      context: `Tool "${toolName}" failed ${failures.length} times`,
      action: `Repeatedly called ${toolName}`,
      outcome: `Failed ${failures.length} times. Errors: ${errorSummary}`,
      lesson: `${toolName} has a recurring failure pattern that needs investigation`,
      tags: ["repeated-failure", "reliability"],
      relatedTools: [toolName],
      confidence: 0.6,
    });
  }

  return lessons;
}

// ── Deduplication ──────────────────────────────────────────────────────────

/**
 * Check each extracted lesson against existing lessons in the store.
 * If a similar lesson exists (same tool, similar context), reinforce the
 * existing lesson instead of returning the new one.
 *
 * Returns only genuinely new lessons that should be stored.
 */
export async function deduplicateAgainstExisting(
  lessons: ExtractedLesson[],
  store: MemoryAdapter,
): Promise<ExtractedLesson[]> {
  const newLessons: ExtractedLesson[] = [];

  for (const lesson of lessons) {
    // Search by tool name first (most specific)
    const toolName = lesson.relatedTools[0];
    let isDuplicate = false;

    if (toolName) {
      const existing = await store.getLessonsByTool(toolName, 10);
      for (const existingLesson of existing) {
        if (hasKeywordOverlap(lesson, existingLesson)) {
          // Reinforce the existing lesson instead of creating a new one
          await store.reinforceLesson(existingLesson.id);
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      // Also check by keyword search on the lesson text
      const kwResults = await store.searchLessonsByKeyword(lesson.lesson, 5);
      for (const existingLesson of kwResults) {
        if (hasKeywordOverlap(lesson, existingLesson)) {
          await store.reinforceLesson(existingLesson.id);
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      newLessons.push(lesson);
    }
  }

  return newLessons;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check if an extracted lesson overlaps >80% with an existing lesson
 * by comparing keyword sets from context + action + outcome fields.
 */
function hasKeywordOverlap(
  extracted: ExtractedLesson,
  existing: { context: string; action: string; outcome: string; relatedTools: string[] },
): boolean {
  const extractedTokens = tokenize(`${extracted.context} ${extracted.action} ${extracted.outcome}`);
  const existingTokens = tokenize(`${existing.context} ${existing.action} ${existing.outcome}`);

  if (extractedTokens.size === 0 || existingTokens.size === 0) return false;

  // Check tool overlap first — if different tools, not a duplicate
  const extractedTool = extracted.relatedTools[0];
  const existingTool = existing.relatedTools[0];
  if (extractedTool && existingTool && extractedTool !== existingTool) {
    return false;
  }

  let overlapCount = 0;
  for (const token of extractedTokens) {
    if (existingTokens.has(token)) overlapCount++;
  }

  const overlapRatio = overlapCount / extractedTokens.size;
  return overlapRatio > 0.8;
}

/** Extract meaningful tokens from text (lowercase, 3+ chars) */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

// ── Tool Outcome Summary Builder ───────────────────────────────────────────

/**
 * Build a summary of tool outcomes suitable for inclusion in the
 * consolidation prompt. Only includes failures and retries.
 */
export function buildToolOutcomeSummary(outcomes: ToolOutcome[]): string | null {
  const failures = outcomes.filter((o) => o.isError);
  if (failures.length === 0) return null;

  const lines: string[] = [];
  lines.push(`Total tool calls: ${outcomes.length}, Failures: ${failures.length}`);
  lines.push("");

  // Group by tool
  const byTool = new Map<string, ToolOutcome[]>();
  for (const f of failures) {
    const existing = byTool.get(f.toolName);
    if (existing) {
      existing.push(f);
    } else {
      byTool.set(f.toolName, [f]);
    }
  }

  for (const [toolName, toolFailures] of byTool) {
    const uniqueErrors = [...new Set(toolFailures.map((f) => f.errorMessage ?? "unknown"))];
    lines.push(`- **${toolName}**: ${toolFailures.length} failure(s)`);
    for (const err of uniqueErrors.slice(0, 3)) {
      lines.push(`  - ${err.slice(0, 150)}`);
    }
  }

  return lines.join("\n");
}

// ── Parse Tool Lessons from Consolidation Response ─────────────────────────

/**
 * Parse tool_lessons array from a consolidation response JSON.
 * Expected format from Haiku:
 * {
 *   "tool_lessons": [
 *     { "type": "mistake", "tool": "...", "context": "...", "lesson": "...", ... }
 *   ]
 * }
 */
export function parseToolLessonsFromResponse(raw: Record<string, unknown>): ExtractedLesson[] {
  const toolLessons = raw.tool_lessons;
  if (!Array.isArray(toolLessons)) return [];

  return toolLessons
    .map((tl: Record<string, unknown>): ExtractedLesson | null => {
      const type = tl.type as string;
      if (!isValidLessonType(type)) return null;

      const tool = (tl.tool as string) ?? "";
      return {
        type: type as LessonType,
        context: (tl.context as string) ?? "",
        action: (tl.action as string) ?? `Used ${tool}`,
        outcome: (tl.outcome as string) ?? "",
        lesson: (tl.lesson as string) ?? "",
        correction: (tl.correction as string) ?? undefined,
        tags: Array.isArray(tl.tags) ? (tl.tags as string[]) : ["model-extracted"],
        relatedTools: tool ? [tool] : [],
        confidence: typeof tl.confidence === "number" ? tl.confidence : 0.5,
      };
    })
    .filter((l): l is ExtractedLesson => l !== null && l.lesson.length > 0);
}

function isValidLessonType(type: string): boolean {
  return ["mistake", "success", "workaround", "discovery"].includes(type);
}
