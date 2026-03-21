/**
 * Argent Core — SIS Lesson Extraction
 *
 * Extracts and promotes lessons from episode reflections.
 * Handles deduplication, similarity detection, and promotion thresholds.
 *
 * Designed in collaboration with Grok (xAI) — February 16, 2026
 */

import { LessonStorage } from "./storage.js";

// ============================================================================
// Types
// ============================================================================

export interface Episode {
  id: string;
  type: string;
  content: string;
  lesson?: string;
  selfInsights?: string[];
  patterns?: string[];
  valence: number;
  arousal: number;
  createdAt: Date;
}

export interface ExtractionCandidate {
  text: string;
  source: "lesson" | "self_insight" | "pattern";
  episodeId: string;
  noveltyScore: number;
  promoted: boolean;
  reason?: string;
}

export interface ExtractionResult {
  /** Candidates that were promoted to lessons */
  promoted: ExtractionCandidate[];

  /** Candidates that were skipped (duplicates, too similar, etc.) */
  skipped: ExtractionCandidate[];

  /** New lesson IDs created */
  lessonIds: number[];
}

export interface ExtractionOptions {
  /** Minimum novelty score to promote (0-1) */
  noveltyThreshold?: number;

  /** Similarity threshold for deduplication (0-1) */
  similarityThreshold?: number;

  /** Initial confidence for new lessons */
  initialConfidence?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default novelty threshold — lesson must be somewhat novel to promote */
const DEFAULT_NOVELTY_THRESHOLD = 0.3;

/** If similarity to existing lesson > this, consider duplicate */
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/** Initial confidence for brand new lessons */
const DEFAULT_INITIAL_CONFIDENCE = 0.5;

// ============================================================================
// Extraction Engine
// ============================================================================

export class LessonExtractor {
  constructor(private storage: LessonStorage) {}

  /**
   * Extract lessons from an episode
   *
   * This is called after episode completion to find promotable lessons.
   */
  async extractFromEpisode(
    episode: Episode,
    options: ExtractionOptions = {},
  ): Promise<ExtractionResult> {
    const {
      noveltyThreshold = DEFAULT_NOVELTY_THRESHOLD,
      similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
      initialConfidence = DEFAULT_INITIAL_CONFIDENCE,
    } = options;

    const candidates: ExtractionCandidate[] = [];

    // Extract from explicit lesson field
    if (episode.lesson && episode.lesson.trim().length > 10) {
      candidates.push({
        text: normalizeText(episode.lesson),
        source: "lesson",
        episodeId: episode.id,
        noveltyScore: 0, // Will be calculated
        promoted: false,
      });
    }

    // Extract from self-insights
    if (episode.selfInsights) {
      for (const insight of episode.selfInsights) {
        if (insight && insight.trim().length > 10) {
          candidates.push({
            text: normalizeText(insight),
            source: "self_insight",
            episodeId: episode.id,
            noveltyScore: 0,
            promoted: false,
          });
        }
      }
    }

    // Extract from patterns
    if (episode.patterns) {
      for (const pattern of episode.patterns) {
        if (pattern && pattern.trim().length > 10) {
          candidates.push({
            text: normalizeText(pattern),
            source: "pattern",
            episodeId: episode.id,
            noveltyScore: 0,
            promoted: false,
          });
        }
      }
    }

    if (candidates.length === 0) {
      return { promoted: [], skipped: [], lessonIds: [] };
    }

    // Get existing lessons for similarity comparison
    const existingLessons = await this.storage.getActiveLessons({ limit: 200 });
    const existingTexts = existingLessons.map((l) => l.text);

    // Calculate novelty and decide promotion
    const promoted: ExtractionCandidate[] = [];
    const skipped: ExtractionCandidate[] = [];
    const lessonIds: number[] = [];

    for (const candidate of candidates) {
      // Check for exact duplicate
      const existing = await this.storage.findLessonByText(candidate.text);
      if (existing) {
        candidate.reason = "exact_duplicate";
        candidate.noveltyScore = 0;
        skipped.push(candidate);
        continue;
      }

      // Calculate novelty based on similarity to existing lessons
      const maxSimilarity = calculateMaxSimilarity(candidate.text, existingTexts);
      candidate.noveltyScore = 1 - maxSimilarity;

      if (maxSimilarity >= similarityThreshold) {
        candidate.reason = "too_similar";
        skipped.push(candidate);
        continue;
      }

      if (candidate.noveltyScore < noveltyThreshold) {
        candidate.reason = "low_novelty";
        skipped.push(candidate);
        continue;
      }

      // Promote to lesson!
      candidate.promoted = true;
      promoted.push(candidate);

      // Create in storage
      const lesson = await this.storage.createLesson({
        text: candidate.text,
        sourceEpisodeId: candidate.episodeId,
        initialConfidence,
      });

      lessonIds.push(lesson.id);
    }

    return { promoted, skipped, lessonIds };
  }

  /**
   * Process a batch of episodes for lesson extraction
   * Useful for backfilling from episode history.
   */
  async extractFromEpisodes(
    episodes: Episode[],
    options: ExtractionOptions = {},
  ): Promise<{
    totalPromoted: number;
    totalSkipped: number;
    byEpisode: Map<string, ExtractionResult>;
  }> {
    const byEpisode = new Map<string, ExtractionResult>();
    let totalPromoted = 0;
    let totalSkipped = 0;

    for (const episode of episodes) {
      const result = await this.extractFromEpisode(episode, options);
      byEpisode.set(episode.id, result);
      totalPromoted += result.promoted.length;
      totalSkipped += result.skipped.length;
    }

    return { totalPromoted, totalSkipped, byEpisode };
  }

  /**
   * Find potentially mergeable lessons
   *
   * Returns pairs of lessons that are similar but not identical.
   * Useful for manual review/consolidation.
   */
  async findMergeCandidates(
    similarityMin: number = 0.6,
    similarityMax: number = 0.85,
  ): Promise<
    Array<{
      lesson1: { id: number; text: string };
      lesson2: { id: number; text: string };
      similarity: number;
    }>
  > {
    const lessons = await this.storage.getActiveLessons({ limit: 500 });
    const candidates: Array<{
      lesson1: { id: number; text: string };
      lesson2: { id: number; text: string };
      similarity: number;
    }> = [];

    for (let i = 0; i < lessons.length; i++) {
      for (let j = i + 1; j < lessons.length; j++) {
        const similarity = calculateSimilarity(lessons[i].text, lessons[j].text);
        if (similarity >= similarityMin && similarity < similarityMax) {
          candidates.push({
            lesson1: { id: lessons[i].id, text: lessons[i].text },
            lesson2: { id: lessons[j].id, text: lessons[j].text },
            similarity,
          });
        }
      }
    }

    // Sort by similarity descending
    return candidates.sort((a, b) => b.similarity - a.similarity);
  }
}

// ============================================================================
// Text Processing Utilities
// ============================================================================

/**
 * Normalize lesson text for comparison
 */
function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ") // Collapse whitespace
    .replace(/[""]/g, '"') // Normalize quotes
    .replace(/['']/g, "'") // Normalize apostrophes
    .replace(/\.$/, "") // Remove trailing period
    .toLowerCase() // Lowercase for comparison
    .replace(/^(i learned that |i noticed that |i realized that )/i, ""); // Remove common prefixes
}

/**
 * Calculate similarity between two texts (Jaccard on word sets)
 *
 * Returns 0-1 where 1 = identical.
 *
 * Note: This is a simple word-level Jaccard. For production,
 * consider semantic similarity via embeddings.
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(
    normalizeText(text1)
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const words2 = new Set(
    normalizeText(text2)
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  if (words1.size === 0 || words2.size === 0) {
    return 0;
  }

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Calculate maximum similarity to any text in a list
 */
function calculateMaxSimilarity(text: string, existingTexts: string[]): number {
  if (existingTexts.length === 0) {
    return 0;
  }

  return Math.max(...existingTexts.map((existing) => calculateSimilarity(text, existing)));
}

// ============================================================================
// Factory
// ============================================================================

export function createLessonExtractor(storage: LessonStorage): LessonExtractor {
  return new LessonExtractor(storage);
}

// ============================================================================
// Episode Hook (Integration Point)
// ============================================================================

/**
 * Hook to call after episode completion
 *
 * This is the integration point — add to episode completion flow.
 */
export async function onEpisodeComplete(
  episode: Episode,
  extractor: LessonExtractor,
  options: ExtractionOptions = {},
): Promise<ExtractionResult> {
  // Only extract from episode types that might have lessons
  const lessonTypes = ["reflection", "task_execution", "research", "creation"];

  if (!lessonTypes.includes(episode.type)) {
    return { promoted: [], skipped: [], lessonIds: [] };
  }

  // Only extract if episode had positive or mixed outcome
  // Negative episodes teach via contradiction penalty, not promotion
  if (episode.valence < -0.5) {
    return { promoted: [], skipped: [], lessonIds: [] };
  }

  return extractor.extractFromEpisode(episode, options);
}
