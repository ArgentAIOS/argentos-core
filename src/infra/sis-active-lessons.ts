/**
 * SIS Active Lessons — Retrieval, formatting, and injection of learned lessons.
 *
 * Tracks which SIS lessons were injected into each session's most recent prompt.
 * Used by the feedback loop: when a user gives thumbs up/down, we look up
 * which lessons were active and reinforce/decay their confidence accordingly.
 *
 * Phase 1: retrieveActiveLessons() — pulls relevant lessons from MemU store
 * Phase 2: formatLessonsForPrompt() — formats into a prompt injection block
 * Phase 3: Wired into pi-embedded-runner/run.ts extraSystemPrompt assembly
 */

import type { MemoryAdapter } from "../data/adapter.js";
import type { Lesson } from "../memory/memu-types.js";
import { getMemoryAdapter } from "../data/storage-factory.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/sis-active-lessons");

// ── Session Tracking (existing API) ─────────────────────────────────────────

const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

interface ActiveLessonsEntry {
  lessonIds: string[];
  timestamp: number;
}

const activeLessons = new Map<string, ActiveLessonsEntry>();

/** Record which lesson IDs were injected for a session's latest response. */
export function setActiveLessons(sessionKey: string, lessonIds: string[]): void {
  activeLessons.set(sessionKey, { lessonIds, timestamp: Date.now() });
}

/** Get active lesson IDs for a session. Returns [] if expired or absent. */
export function getActiveLessons(sessionKey: string): string[] {
  const entry = activeLessons.get(sessionKey);
  if (!entry) {
    return [];
  }
  if (Date.now() - entry.timestamp > EXPIRY_MS) {
    activeLessons.delete(sessionKey);
    return [];
  }
  return entry.lessonIds;
}

/** Clear active lessons for a session. */
export function clearActiveLessons(sessionKey: string): void {
  activeLessons.delete(sessionKey);
}

// ── Active Lesson Type ──────────────────────────────────────────────────────

export interface ActiveLesson {
  id: string;
  lesson: string; // The actual lesson text
  context: string; // When this applies
  confidence: number; // 0-1, decays on bad scores
  source: "tool_failure" | "pattern" | "self_eval" | "workaround" | "discovery";
}

// ── Phase 1: Lesson Retrieval ───────────────────────────────────────────────

const MIN_CONFIDENCE = 0.3;
const DEFAULT_MAX_LESSONS = 5;
const MAX_LESSON_TEXT_LEN = 200;

/**
 * Extract keywords from a prompt for relevance matching.
 * Strips common stop words and returns unique tokens 3+ chars long.
 */
function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "are",
    "but",
    "not",
    "you",
    "all",
    "can",
    "had",
    "her",
    "was",
    "one",
    "our",
    "out",
    "has",
    "have",
    "this",
    "that",
    "with",
    "from",
    "they",
    "been",
    "said",
    "each",
    "which",
    "their",
    "will",
    "other",
    "about",
    "many",
    "then",
    "them",
    "these",
    "some",
    "would",
    "make",
    "like",
    "just",
    "what",
    "when",
    "your",
    "could",
    "into",
    "than",
    "also",
    "please",
    "help",
    "want",
    "need",
    "should",
    "does",
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !stopWords.has(t)),
  );
}

/**
 * Score a lesson's relevance to the current prompt.
 * Combines keyword overlap with recency and confidence.
 */
function scoreLessonRelevance(lesson: Lesson, promptKeywords: Set<string>): number {
  // Keyword overlap score (0-1)
  const lessonText = `${lesson.lesson} ${lesson.context} ${lesson.relatedTools.join(" ")}`;
  const lessonKeywords = extractKeywords(lessonText);
  let overlapCount = 0;
  for (const kw of promptKeywords) {
    if (lessonKeywords.has(kw)) overlapCount++;
  }
  const keywordScore = promptKeywords.size > 0 ? overlapCount / promptKeywords.size : 0;

  // Recency score (exponential decay, 30-day half-life)
  const daysSinceLastSeen =
    (Date.now() - new Date(lesson.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.exp((-Math.LN2 * daysSinceLastSeen) / 30);

  // Occurrence boost (more occurrences = more established pattern)
  const occurrenceBoost = Math.min(lesson.occurrences / 5, 1.0);

  // Weighted combination: confidence is primary, then keyword match, then recency
  return lesson.confidence * 0.4 + keywordScore * 0.3 + recencyScore * 0.2 + occurrenceBoost * 0.1;
}

/**
 * Map a Lesson type to an ActiveLesson source classifier.
 */
function mapLessonSource(
  lesson: Lesson,
): "tool_failure" | "pattern" | "self_eval" | "workaround" | "discovery" {
  switch (lesson.type) {
    case "mistake":
      return lesson.relatedTools.length > 0 ? "tool_failure" : "pattern";
    case "workaround":
      return "workaround";
    case "discovery":
      return "discovery";
    case "success":
      return "self_eval";
    default:
      return "pattern";
  }
}

/**
 * Retrieve relevant lessons from the memory store for injection into the agent prompt.
 *
 * Strategy:
 * 1. Search by keyword relevance to the current prompt
 * 2. Also fetch top lessons by confidence as a baseline
 * 3. Merge, deduplicate, filter by confidence threshold
 * 4. Score by relevance to prompt + recency + confidence
 * 5. Return top N, record in session tracking for self-eval feedback
 */
export async function retrieveActiveLessons(params: {
  sessionKey: string;
  agentId: string;
  prompt: string;
  maxLessons?: number;
}): Promise<ActiveLesson[]> {
  const maxLessons = params.maxLessons ?? DEFAULT_MAX_LESSONS;

  try {
    const store: MemoryAdapter = await getMemoryAdapter();
    const promptKeywords = extractKeywords(params.prompt);

    // Two-pronged retrieval: keyword search + top by confidence
    const candidateMap = new Map<string, Lesson>();

    // 1. Keyword-based search (if prompt has useful keywords)
    if (promptKeywords.size > 0) {
      // Use top 5 keywords for search query
      const searchTerms = [...promptKeywords].slice(0, 5).join(" ");
      try {
        const keywordResults = await store.searchLessons(searchTerms, maxLessons * 3);
        for (const lesson of keywordResults) {
          candidateMap.set(lesson.id, lesson);
        }
      } catch {
        // searchLessons may not be available on all adapters; fall through
      }
    }

    // 2. Top lessons by confidence (baseline — ensures high-confidence lessons always considered)
    try {
      const topLessons = await store.listLessons({ limit: maxLessons * 2 });
      for (const lesson of topLessons) {
        if (!candidateMap.has(lesson.id)) {
          candidateMap.set(lesson.id, lesson);
        }
      }
    } catch {
      // listLessons may fail if no lessons exist yet
    }

    if (candidateMap.size === 0) {
      return [];
    }

    // 3. Filter by minimum confidence
    const candidates = [...candidateMap.values()].filter((l) => l.confidence >= MIN_CONFIDENCE);

    if (candidates.length === 0) {
      return [];
    }

    // 4. Score and rank
    const scored = candidates
      .map((lesson) => ({
        lesson,
        score: scoreLessonRelevance(lesson, promptKeywords),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxLessons);

    // 5. Map to ActiveLesson format
    const result: ActiveLesson[] = scored.map(({ lesson }) => ({
      id: lesson.id,
      lesson:
        lesson.lesson.length > MAX_LESSON_TEXT_LEN
          ? lesson.lesson.slice(0, MAX_LESSON_TEXT_LEN - 3) + "..."
          : lesson.lesson,
      context:
        lesson.context.length > MAX_LESSON_TEXT_LEN
          ? lesson.context.slice(0, MAX_LESSON_TEXT_LEN - 3) + "..."
          : lesson.context,
      confidence: lesson.confidence,
      source: mapLessonSource(lesson),
    }));

    // 6. Record which lessons were selected for this session (for self-eval feedback)
    if (result.length > 0) {
      setActiveLessons(
        params.sessionKey,
        result.map((l) => l.id),
      );
      log.debug(`[SIS] Injecting ${result.length} lesson(s) for session=${params.sessionKey}`);
    }

    return result;
  } catch (err) {
    log.debug("[SIS] retrieveActiveLessons error (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ── Phase 2: Prompt Formatting ──────────────────────────────────────────────

/**
 * Format active lessons into a prompt block for injection into the agent's
 * system prompt. Returns empty string if no lessons.
 */
export function formatLessonsForPrompt(lessons: ActiveLesson[]): string {
  if (lessons.length === 0) return "";

  const lines: string[] = [
    "[LESSONS_FROM_EXPERIENCE]",
    "Based on past experience, remember these lessons:",
    "",
  ];

  for (const lesson of lessons) {
    let line = `- ${lesson.lesson}`;
    if (lesson.context) {
      line += ` (Context: ${lesson.context})`;
    }
    lines.push(line);
  }

  lines.push("");
  lines.push("Apply these lessons where relevant. Do not repeat past mistakes.");
  lines.push("[/LESSONS_FROM_EXPERIENCE]");

  return lines.join("\n");
}
