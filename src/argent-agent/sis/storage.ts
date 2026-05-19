/**
 * Argent Core — SIS Lesson Storage
 *
 * CRUD operations for lessons, injection history, and endorsements.
 * Built on Drizzle ORM, targeting PostgreSQL.
 *
 * Designed in collaboration with Grok (xAI) — February 16, 2026
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import type { LessonHistory } from "./confidence.js";

// ============================================================================
// Types
// ============================================================================

export interface Lesson {
  id: number;
  text: string;
  sourceEpisodeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  confidence: number;
  injectionCount: number;
  successCount: number;
  avgValenceDelta: number;
  lastUsedAt: Date | null;
  isActive: boolean;
}

export interface LessonInjectionRecord {
  id: number;
  lessonId: number;
  episodeId: string;
  preValence: number;
  postValence: number;
  delta: number;
  injectedAt: Date;
  contradicted: boolean;
  successful: boolean;
}

export interface Endorsement {
  id: number;
  lessonId: number;
  endorserType: "family" | "operator";
  endorserId: string;
  strength: number;
  endorsedAt: Date;
  comment: string | null;
}

export interface CreateLessonInput {
  text: string;
  sourceEpisodeId?: string;
  initialConfidence?: number;
}

export interface RecordInjectionInput {
  lessonId: number;
  episodeId: string;
  preValence: number;
  postValence: number;
  contradicted?: boolean;
}

export interface AddEndorsementInput {
  lessonId: number;
  endorserType: "family" | "operator";
  endorserId: string;
  strength?: number;
  comment?: string;
}

// ============================================================================
// Storage Class
// ============================================================================

export class LessonStorage {
  constructor(
    private db: PostgresJsDatabase,
    private schema: {
      lessons: any;
      lessonHistory: any;
      endorsements: any;
    },
  ) {}

  // --------------------------------------------------------------------------
  // Lesson CRUD
  // --------------------------------------------------------------------------

  /**
   * Create a new lesson from an episode reflection
   */
  async createLesson(input: CreateLessonInput): Promise<Lesson> {
    const [lesson] = await this.db
      .insert(this.schema.lessons)
      .values({
        text: input.text,
        sourceEpisodeId: input.sourceEpisodeId ?? null,
        confidence: input.initialConfidence ?? 0.5,
        injectionCount: 0,
        successCount: 0,
        avgValenceDelta: 0,
        isActive: true,
      })
      .returning();

    return lesson;
  }

  /**
   * Get a lesson by ID
   */
  async getLesson(id: number): Promise<Lesson | null> {
    const [lesson] = await this.db
      .select()
      .from(this.schema.lessons)
      .where(eq(this.schema.lessons.id, id))
      .limit(1);

    return lesson ?? null;
  }

  /**
   * Find an existing lesson by exact text match (for deduplication)
   */
  async findLessonByText(text: string): Promise<Lesson | null> {
    const [lesson] = await this.db
      .select()
      .from(this.schema.lessons)
      .where(eq(this.schema.lessons.text, text))
      .limit(1);

    return lesson ?? null;
  }

  /**
   * Get active lessons sorted by confidence (for injection candidates)
   */
  async getActiveLessons(
    options: {
      minConfidence?: number;
      limit?: number;
    } = {},
  ): Promise<Lesson[]> {
    const { minConfidence = 0, limit = 50 } = options;

    return this.db
      .select()
      .from(this.schema.lessons)
      .where(
        and(
          eq(this.schema.lessons.isActive, true),
          gte(this.schema.lessons.confidence, minConfidence),
        ),
      )
      .orderBy(desc(this.schema.lessons.confidence))
      .limit(limit);
  }

  /**
   * Update lesson confidence score
   */
  async updateLessonConfidence(id: number, confidence: number): Promise<void> {
    await this.db
      .update(this.schema.lessons)
      .set({
        confidence,
        updatedAt: new Date(),
      })
      .where(eq(this.schema.lessons.id, id));
  }

  /**
   * Deactivate a lesson (soft delete)
   */
  async deactivateLesson(id: number): Promise<void> {
    await this.db
      .update(this.schema.lessons)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(this.schema.lessons.id, id));
  }

  // --------------------------------------------------------------------------
  // Injection History
  // --------------------------------------------------------------------------

  /**
   * Record that a lesson was injected into a turn
   */
  async recordInjection(input: RecordInjectionInput): Promise<LessonInjectionRecord> {
    const delta = input.postValence - input.preValence;
    const successful = delta >= 0.3; // Success threshold from Grok collab

    const [record] = await this.db
      .insert(this.schema.lessonHistory)
      .values({
        lessonId: input.lessonId,
        episodeId: input.episodeId,
        preValence: input.preValence,
        postValence: input.postValence,
        contradicted: input.contradicted ?? false,
        successful,
      })
      .returning();

    // Update lesson aggregate stats
    await this.updateLessonStats(input.lessonId);

    return record;
  }

  /**
   * Mark an injection as contradicted (RALF caught ground truth violation)
   */
  async markContradiction(lessonId: number, episodeId: string): Promise<void> {
    await this.db
      .update(this.schema.lessonHistory)
      .set({ contradicted: true })
      .where(
        and(
          eq(this.schema.lessonHistory.lessonId, lessonId),
          eq(this.schema.lessonHistory.episodeId, episodeId),
        ),
      );

    // Recalculate lesson stats
    await this.updateLessonStats(lessonId);
  }

  /**
   * Get injection history for a lesson
   */
  async getInjectionHistory(lessonId: number, limit = 100): Promise<LessonInjectionRecord[]> {
    return this.db
      .select()
      .from(this.schema.lessonHistory)
      .where(eq(this.schema.lessonHistory.lessonId, lessonId))
      .orderBy(desc(this.schema.lessonHistory.injectedAt))
      .limit(limit);
  }

  // --------------------------------------------------------------------------
  // Endorsements
  // --------------------------------------------------------------------------

  /**
   * Add an endorsement to a lesson
   */
  async addEndorsement(input: AddEndorsementInput): Promise<Endorsement> {
    const [endorsement] = await this.db
      .insert(this.schema.endorsements)
      .values({
        lessonId: input.lessonId,
        endorserType: input.endorserType,
        endorserId: input.endorserId,
        strength: input.strength ?? 1.0,
        comment: input.comment ?? null,
      })
      .returning();

    return endorsement;
  }

  /**
   * Get endorsements for a lesson, split by type
   */
  async getEndorsements(lessonId: number): Promise<{
    family: Endorsement[];
    operator: Endorsement[];
  }> {
    const endorsements = await this.db
      .select()
      .from(this.schema.endorsements)
      .where(eq(this.schema.endorsements.lessonId, lessonId));

    return {
      family: endorsements.filter((e) => e.endorserType === "family"),
      operator: endorsements.filter((e) => e.endorserType === "operator"),
    };
  }

  // --------------------------------------------------------------------------
  // Aggregate Stats & History Building
  // --------------------------------------------------------------------------

  /**
   * Update lesson's aggregate statistics from history
   */
  private async updateLessonStats(lessonId: number): Promise<void> {
    const history = await this.getInjectionHistory(lessonId, 1000);

    if (history.length === 0) return;

    const injectionCount = history.length;
    const successCount = history.filter((h) => h.successful).length;
    const avgValenceDelta = history.reduce((sum, h) => sum + h.delta, 0) / history.length;
    const lastUsedAt = history[0]?.injectedAt ?? null;

    await this.db
      .update(this.schema.lessons)
      .set({
        injectionCount,
        successCount,
        avgValenceDelta,
        lastUsedAt,
        updatedAt: new Date(),
      })
      .where(eq(this.schema.lessons.id, lessonId));
  }

  /**
   * Build a LessonHistory object for confidence scoring
   * This is the bridge between storage and the scoring function
   */
  async buildLessonHistory(lessonId: number): Promise<LessonHistory> {
    const lesson = await this.getLesson(lessonId);
    if (!lesson) {
      throw new Error(`Lesson ${lessonId} not found`);
    }

    const injectionHistory = await this.getInjectionHistory(lessonId);
    const endorsements = await this.getEndorsements(lessonId);

    // Calculate days since last use
    const daysSinceLastUse = lesson.lastUsedAt
      ? Math.floor((Date.now() - lesson.lastUsedAt.getTime()) / (24 * 60 * 60 * 1000))
      : 999; // Never used = very old

    // Check for contradictions and count successes since
    const hasContradiction = injectionHistory.some((h) => h.contradicted);
    let successesSinceContradiction = 0;

    if (hasContradiction) {
      // Find last contradiction, count successful uses after it
      const lastContradictionIdx = injectionHistory.findIndex((h) => h.contradicted);
      if (lastContradictionIdx > 0) {
        // History is sorted desc, so indices before the contradiction are more recent
        successesSinceContradiction = injectionHistory
          .slice(0, lastContradictionIdx)
          .filter((h) => h.successful).length;
      }
    }

    // Sum endorsement weights with recency factor
    const calculateEndorsementCount = (endorsementList: Endorsement[]): number => {
      return endorsementList.reduce((sum, e) => {
        const daysSince = Math.floor((Date.now() - e.endorsedAt.getTime()) / (24 * 60 * 60 * 1000));
        const recencyFactor = 0.5 + 0.5 * (1 / (1 + daysSince / 30)); // 30-day half-life
        return sum + e.strength * recencyFactor;
      }, 0);
    };

    return {
      avgValenceDelta: lesson.avgValenceDelta,
      injectionCount: lesson.injectionCount,
      successCount: lesson.successCount,
      familyEndorsements: calculateEndorsementCount(endorsements.family),
      operatorEndorsements: calculateEndorsementCount(endorsements.operator),
      daysSinceLastUse,
      hasGroundTruthContradiction: hasContradiction,
      successfulUsesSinceContradiction: successesSinceContradiction,
      llmSelfConfidence: 0.5, // Default until we implement LLM self-rating
    };
  }

  // --------------------------------------------------------------------------
  // Maintenance & Cleanup
  // --------------------------------------------------------------------------

  /**
   * Find lessons that should be demoted (low confidence, repeated failures)
   */
  async findLessonsForDemotion(
    options: {
      maxConfidence?: number;
      minAge?: number; // days
    } = {},
  ): Promise<Lesson[]> {
    const { maxConfidence = 0.3, minAge = 30 } = options;
    const cutoffDate = new Date(Date.now() - minAge * 24 * 60 * 60 * 1000);

    return this.db
      .select()
      .from(this.schema.lessons)
      .where(
        and(
          eq(this.schema.lessons.isActive, true),
          lte(this.schema.lessons.confidence, maxConfidence),
          lte(this.schema.lessons.createdAt, cutoffDate),
        ),
      );
  }

  /**
   * Recalculate confidence for all active lessons
   * Call this periodically (e.g., daily maintenance)
   */
  async recalculateAllConfidences(scoreFn: (history: LessonHistory) => number): Promise<number> {
    const lessons = await this.getActiveLessons({ limit: 1000 });
    let updated = 0;

    for (const lesson of lessons) {
      try {
        const history = await this.buildLessonHistory(lesson.id);
        const newConfidence = scoreFn(history);

        if (Math.abs(newConfidence - lesson.confidence) > 0.01) {
          await this.updateLessonConfidence(lesson.id, newConfidence);
          updated++;
        }
      } catch (error) {
        console.error(`Failed to recalculate confidence for lesson ${lesson.id}:`, error);
      }
    }

    return updated;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createLessonStorage(
  db: PostgresJsDatabase,
  schema: {
    lessons: any;
    lessonHistory: any;
    endorsements: any;
  },
): LessonStorage {
  return new LessonStorage(db, schema);
}
