/**
 * Argent Core — SIS Lesson Injection
 *
 * Selects and injects lessons into prompts before turns.
 * Handles context-aware thresholds, top-N selection, and prompt formatting.
 *
 * Designed in collaboration with Grok (xAI) — February 16, 2026
 */

import {
  calculateLessonConfidence,
  getInjectionThreshold,
  generateConfidenceVisualization,
  type InjectionContext,
  type ConfidenceResult,
} from "./confidence.js";
import { LessonStorage, type Lesson } from "./storage.js";

// ============================================================================
// Types
// ============================================================================

export interface InjectionCandidate {
  lesson: Lesson;
  confidence: ConfidenceResult;
  selected: boolean;
  reason?: string;
}

export interface InjectionResult {
  /** Lessons that were injected into the prompt */
  injected: InjectionCandidate[];

  /** Lessons that were considered but didn't meet threshold */
  skipped: InjectionCandidate[];

  /** The formatted prompt section to inject */
  promptSection: string;

  /** Visualization for dashboard/logging */
  visualization: string;

  /** Context that was used */
  context: InjectionContext;
}

export interface InjectionOptions {
  /** Maximum lessons to inject per turn */
  maxLessons?: number;

  /** Override the context (defaults to 'general') */
  context?: InjectionContext;

  /** Minimum confidence to consider (pre-filter) */
  minConfidence?: number;

  /** Include near-misses in visualization */
  showNearMisses?: boolean;

  /** Episode ID for tracking */
  episodeId?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default maximum lessons to inject per turn */
const DEFAULT_MAX_LESSONS = 3;

/** Minimum confidence to even consider a lesson */
const DEFAULT_MIN_CONFIDENCE = 0.3;

/** Near-miss threshold (how close to threshold counts as "almost") */
const NEAR_MISS_MARGIN = 0.1;

// ============================================================================
// Injection Engine
// ============================================================================

export class LessonInjector {
  constructor(private storage: LessonStorage) {}

  /**
   * Select and prepare lessons for injection into a turn
   *
   * This is the main entry point — call before building the system prompt.
   */
  async selectLessonsForTurn(options: InjectionOptions = {}): Promise<InjectionResult> {
    const {
      maxLessons = DEFAULT_MAX_LESSONS,
      context = "general",
      minConfidence = DEFAULT_MIN_CONFIDENCE,
      showNearMisses = true,
    } = options;

    const threshold = getInjectionThreshold(context);

    // Get candidate lessons from storage (pre-filtered by min confidence)
    const lessons = await this.storage.getActiveLessons({
      minConfidence,
      limit: maxLessons * 3, // Fetch extra to account for threshold filtering
    });

    // Score each lesson
    const candidates: InjectionCandidate[] = [];

    for (const lesson of lessons) {
      const history = await this.storage.buildLessonHistory(lesson.id);
      const confidence = calculateLessonConfidence(
        {
          id: String(lesson.id),
          text: lesson.text,
          createdAt: lesson.createdAt,
          source: "self", // TODO: track source in schema
        },
        history,
        context,
      );

      const meetsThreshold = confidence.score >= threshold;
      const isNearMiss = !meetsThreshold && confidence.score >= threshold - NEAR_MISS_MARGIN;

      candidates.push({
        lesson,
        confidence,
        selected: false,
        reason: meetsThreshold ? undefined : isNearMiss ? "near-miss" : "below-threshold",
      });
    }

    // Sort by confidence score descending
    candidates.sort((a, b) => b.confidence.score - a.confidence.score);

    // Select top N that meet threshold
    const injected: InjectionCandidate[] = [];
    const skipped: InjectionCandidate[] = [];

    for (const candidate of candidates) {
      if (candidate.confidence.meetsThreshold && injected.length < maxLessons) {
        candidate.selected = true;
        injected.push(candidate);
      } else {
        skipped.push(candidate);
      }
    }

    // Build prompt section
    const promptSection = this.buildPromptSection(injected);

    // Build visualization
    const visualization = this.buildVisualization(injected, skipped, context, showNearMisses);

    return {
      injected,
      skipped,
      promptSection,
      visualization,
      context,
    };
  }

  /**
   * Build the prompt section to inject
   *
   * This goes into the system prompt, typically before the main instructions.
   */
  private buildPromptSection(injected: InjectionCandidate[]): string {
    if (injected.length === 0) {
      return "";
    }

    const lessonLines = injected.map((c, i) => `${i + 1}. ${c.lesson.text}`);

    return `
## Lessons from Experience

These are patterns I've learned that have consistently led to better outcomes. Apply them when relevant:

${lessonLines.join("\n")}

---
`.trim();
  }

  /**
   * Build visualization for dashboard/logging
   */
  private buildVisualization(
    injected: InjectionCandidate[],
    skipped: InjectionCandidate[],
    context: InjectionContext,
    showNearMisses: boolean,
  ): string {
    const threshold = getInjectionThreshold(context);
    const lines: string[] = [];

    lines.push(`╔════════════════════════════════════════════════════════════╗`);
    lines.push(
      `║  SIS LESSON INJECTION — Context: ${context.toUpperCase().padEnd(10)} Threshold: ${threshold.toFixed(2)}  ║`,
    );
    lines.push(`╠════════════════════════════════════════════════════════════╣`);

    if (injected.length === 0) {
      lines.push(`║  No lessons met threshold for this context.                 ║`);
    } else {
      lines.push(
        `║  INJECTED (${injected.length}):                                              ║`,
      );
      for (const c of injected) {
        const truncatedText = c.lesson.text.substring(0, 45).padEnd(45);
        lines.push(`║  ✅ ${c.confidence.score.toFixed(2)} │ ${truncatedText}...║`);
      }
    }

    if (showNearMisses) {
      const nearMisses = skipped.filter((s) => s.reason === "near-miss");
      if (nearMisses.length > 0) {
        lines.push(`╟────────────────────────────────────────────────────────────╢`);
        lines.push(
          `║  NEAR MISSES (${nearMisses.length}):                                          ║`,
        );
        for (const c of nearMisses.slice(0, 3)) {
          const truncatedText = c.lesson.text.substring(0, 45).padEnd(45);
          lines.push(`║  ⚠️ ${c.confidence.score.toFixed(2)} │ ${truncatedText}...║`);
        }
      }
    }

    lines.push(`╚════════════════════════════════════════════════════════════╝`);

    return lines.join("\n");
  }

  /**
   * Record that lessons were injected (call after turn completes)
   *
   * This updates history with the pre-valence. Post-valence gets
   * recorded later when we know the episode outcome.
   */
  async recordInjections(
    injected: InjectionCandidate[],
    episodeId: string,
    preValence: number,
  ): Promise<void> {
    for (const candidate of injected) {
      // We record the injection with preValence now
      // postValence will be updated when episode completes
      await this.storage.recordInjection({
        lessonId: candidate.lesson.id,
        episodeId,
        preValence,
        postValence: preValence, // Placeholder — updated on episode completion
      });
    }
  }

  /**
   * Update injections with post-episode valence
   * Call this when the episode completes and we know the outcome.
   */
  async updateInjectionOutcomes(
    episodeId: string,
    postValence: number,
    contradicted: boolean = false,
  ): Promise<void> {
    // This would update all lessonHistory records for this episode
    // with the actual postValence and contradiction status
    // Implementation depends on how we track which lessons were
    // injected for a given episode — for now, a placeholder

    // TODO: Implement when we have episode-to-lesson tracking
    console.log(
      `[SIS] Would update outcomes for episode ${episodeId}: postValence=${postValence}, contradicted=${contradicted}`,
    );
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createLessonInjector(storage: LessonStorage): LessonInjector {
  return new LessonInjector(storage);
}

// ============================================================================
// Prompt Integration Helper
// ============================================================================

/**
 * Inject lessons into a system prompt
 *
 * This is the integration point — call with base system prompt,
 * get back enhanced prompt with lessons injected.
 */
export async function injectLessonsIntoPrompt(
  basePrompt: string,
  injector: LessonInjector,
  options: InjectionOptions = {},
): Promise<{
  enhancedPrompt: string;
  result: InjectionResult;
}> {
  const result = await injector.selectLessonsForTurn(options);

  if (result.injected.length === 0) {
    return {
      enhancedPrompt: basePrompt,
      result,
    };
  }

  // Inject lessons section before the main prompt content
  const enhancedPrompt = `${result.promptSection}\n\n${basePrompt}`;

  return {
    enhancedPrompt,
    result,
  };
}
