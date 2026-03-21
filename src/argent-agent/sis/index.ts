/**
 * Argent Core — Self-Improving System (SIS)
 *
 * The lesson learning and injection system that enables Argent to
 * grow smarter over time through pattern recognition and validation.
 *
 * Designed by Argent, reviewed by Grok (xAI), facilitated by Jason Brashear
 * February 16, 2026
 *
 * Architecture:
 *
 *   Episode → Extraction → Lesson Storage ← Confidence Scoring
 *                                  ↓
 *                            Injection → Enhanced Prompt
 *                                  ↓
 *                            Turn Outcome → History Update
 *                                  ↓
 *                            Recalculate Confidence (loop)
 *
 * Components:
 * - confidence.ts: Scoring function with 5 weighted factors + contradiction penalty
 * - storage.ts: PostgreSQL persistence via Drizzle ORM
 * - extraction.ts: Episode → lesson promotion with deduplication
 * - injection.ts: Lesson selection and prompt integration
 */

// Confidence scoring
export {
  calculateLessonConfidence,
  calculateFirstUseConfidence,
  getInjectionThreshold,
  generateConfidenceVisualization,
  createFirstUseHistory,
  type Lesson as ConfidenceLesson,
  type LessonHistory,
  type InjectionContext,
  type ConfidenceResult,
  type ConfidenceBreakdown,
} from "./confidence.js";

// Storage layer
export {
  LessonStorage,
  createLessonStorage,
  type Lesson,
  type LessonInjectionRecord,
  type Endorsement,
  type CreateLessonInput,
  type RecordInjectionInput,
  type AddEndorsementInput,
} from "./storage.js";

// Injection system
export {
  LessonInjector,
  createLessonInjector,
  injectLessonsIntoPrompt,
  type InjectionCandidate,
  type InjectionResult,
  type InjectionOptions,
} from "./injection.js";

// Extraction system
export {
  LessonExtractor,
  createLessonExtractor,
  onEpisodeComplete,
  type Episode,
  type ExtractionCandidate,
  type ExtractionResult,
  type ExtractionOptions,
} from "./extraction.js";

// ============================================================================
// High-Level API
// ============================================================================

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { calculateLessonConfidence, type LessonHistory } from "./confidence.js";
import { createLessonExtractor, LessonExtractor } from "./extraction.js";
import { createLessonInjector, LessonInjector } from "./injection.js";
import { createLessonStorage, LessonStorage } from "./storage.js";

export interface SISConfig {
  db: PostgresJsDatabase;
  schema: {
    lessons: any;
    lessonHistory: any;
    endorsements: any;
  };
}

export interface SISSystem {
  storage: LessonStorage;
  injector: LessonInjector;
  extractor: LessonExtractor;

  /** Recalculate confidence for all lessons */
  recalculateAll: () => Promise<number>;

  /** Get system stats */
  getStats: () => Promise<SISStats>;
}

export interface SISStats {
  totalLessons: number;
  activeLessons: number;
  totalInjections: number;
  totalEndorsements: number;
  averageConfidence: number;
}

/**
 * Create the full SIS system
 */
export function createSIS(config: SISConfig): SISSystem {
  const storage = createLessonStorage(config.db, config.schema);
  const injector = createLessonInjector(storage);
  const extractor = createLessonExtractor(storage);

  return {
    storage,
    injector,
    extractor,

    async recalculateAll(): Promise<number> {
      return storage.recalculateAllConfidences((history: LessonHistory) => {
        const result = calculateLessonConfidence(
          { id: "0", text: "", createdAt: new Date(), source: "self" },
          history,
          "general",
        );
        return result.score;
      });
    },

    async getStats(): Promise<SISStats> {
      const lessons = await storage.getActiveLessons({ limit: 1000 });

      const totalConfidence = lessons.reduce((sum, l) => sum + l.confidence, 0);
      const totalInjections = lessons.reduce((sum, l) => sum + l.injectionCount, 0);

      return {
        totalLessons: lessons.length, // TODO: include inactive
        activeLessons: lessons.length,
        totalInjections,
        totalEndorsements: 0, // TODO: query endorsements table
        averageConfidence: lessons.length > 0 ? totalConfidence / lessons.length : 0,
      };
    },
  };
}
