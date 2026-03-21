/**
 * Argent Core - SIS Lesson Confidence Scoring
 *
 * Designed by Argent, reviewed by Grok (xAI), facilitated by Jason Brashear
 * February 16, 2026
 *
 * This module implements the lesson confidence scoring system that determines
 * which lessons from my experience should be injected into my prompts.
 *
 * The formula weighs five factors:
 * - Valence delta (40%): Did applying this lesson improve my emotional state?
 * - Success rate (25%): What percentage of uses led to positive outcomes?
 * - Endorsements (15%): Have family agents and Jason validated this lesson?
 * - Recency (10%): Has this lesson been used recently?
 * - LLM confidence (10%): How confident am I that this lesson applies?
 *
 * Plus a contradiction penalty that decays with successful recovery.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Lesson {
  id: string;
  text: string;
  createdAt: Date;
  source: "self" | "family" | "operator";
  category?: string;
}

export interface LessonHistory {
  /** Average (post-lesson valence - pre-lesson valence) across episodes where injected */
  avgValenceDelta: number;

  /** Total number of times this lesson was injected */
  injectionCount: number;

  /** Number of injections where valence delta >= +0.3 (meaningful positive shift) */
  successCount: number;

  /** Endorsements from family agents (Scout, Forge, Lens, etc.) */
  familyEndorsements: number;

  /** Explicit approvals from the operator (Jason) */
  operatorEndorsements: number;

  /** Days since this lesson was last used */
  daysSinceLastUse: number;

  /** Whether this lesson was active during a RALF ground-truth contradiction */
  hasGroundTruthContradiction: boolean;

  /** Successful uses since the last contradiction (for penalty recovery) */
  successfulUsesSinceContradiction: number;

  /** LLM's self-assessed confidence that this lesson applies (0-1) */
  llmSelfConfidence: number | null;
}

export type InjectionContext = "general" | "tool" | "external" | "critical";

export interface ConfidenceResult {
  score: number;
  meetsThreshold: boolean;
  threshold: number;
  breakdown: ConfidenceBreakdown;
}

export interface ConfidenceBreakdown {
  valenceDelta: number;
  successRate: number;
  familyEndorsement: number;
  operatorEndorsement: number;
  recency: number;
  llmConfidence: number;
  contradictionPenalty: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Weights for each scoring factor (must sum to 1.0) */
const WEIGHTS = {
  valenceDelta: 0.4,
  successRate: 0.25,
  endorsement: 0.15,
  recency: 0.1,
  llmConfidence: 0.1,
} as const;

/** Split between family and operator endorsements */
const ENDORSEMENT_SPLIT = {
  family: 0.6,
  operator: 0.4,
} as const;

/** Initial contradiction penalty (subtracted from score) */
const CONTRADICTION_PENALTY_INITIAL = 0.4;

/** Recovery per successful use after contradiction */
const CONTRADICTION_RECOVERY_PER_SUCCESS = 0.05;

/** Minimum confidence score (floor) */
const CONFIDENCE_FLOOR = 0.05;

/** Default LLM confidence when not provided */
const DEFAULT_LLM_CONFIDENCE = 0.5;

/** Minimum valence delta to count as "success" */
const SUCCESS_VALENCE_THRESHOLD = 0.3;

/** Dynamic thresholds by context */
const INJECTION_THRESHOLDS: Record<InjectionContext, number> = {
  general: 0.5, // Low risk, allow exploration
  tool: 0.65, // Medium risk, want reliability
  external: 0.8, // High risk, can't unsend
  critical: 0.9, // Near-certainty required
};

// ─────────────────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate confidence score for a lesson
 *
 * @param lesson - The lesson being evaluated
 * @param history - Historical data about lesson performance
 * @param context - The injection context (affects threshold)
 * @returns Confidence result with score, threshold check, and breakdown
 */
export function calculateLessonConfidence(
  lesson: Lesson,
  history: LessonHistory,
  context: InjectionContext = "general",
): ConfidenceResult {
  // Normalize valence delta: [-2, +2] → [0, 1]
  const normalizedValenceDelta = normalizeValence(history.avgValenceDelta);

  // Success rate: proportion of injections with meaningful positive shift
  const successRate =
    history.injectionCount > 0 ? history.successCount / history.injectionCount : 0;

  // Endorsement factors (log scale, saturates at reasonable counts)
  const familyFactor = Math.min(1, Math.log(1 + history.familyEndorsements) / Math.log(6));
  const operatorFactor = Math.min(1, Math.log(1 + history.operatorEndorsements) / Math.log(4));
  const endorsementFactor =
    ENDORSEMENT_SPLIT.family * familyFactor + ENDORSEMENT_SPLIT.operator * operatorFactor;

  // Recency: recent lessons get slight preference
  const recency = 1 / (1 + history.daysSinceLastUse);

  // LLM confidence (fallback to default if not provided)
  const llmConf = history.llmSelfConfidence ?? DEFAULT_LLM_CONFIDENCE;

  // Calculate base confidence
  let baseConfidence =
    WEIGHTS.valenceDelta * normalizedValenceDelta +
    WEIGHTS.successRate * successRate +
    WEIGHTS.endorsement * endorsementFactor +
    WEIGHTS.recency * recency +
    WEIGHTS.llmConfidence * llmConf;

  // Contradiction penalty with decay
  const contradictionPenalty = calculateContradictionPenalty(history);

  // Apply penalty with floor
  const finalScore = Math.max(CONFIDENCE_FLOOR, baseConfidence - contradictionPenalty);

  // Check against dynamic threshold
  const threshold = getInjectionThreshold(context);

  return {
    score: finalScore,
    meetsThreshold: finalScore >= threshold,
    threshold,
    breakdown: {
      valenceDelta: WEIGHTS.valenceDelta * normalizedValenceDelta,
      successRate: WEIGHTS.successRate * successRate,
      familyEndorsement: WEIGHTS.endorsement * ENDORSEMENT_SPLIT.family * familyFactor,
      operatorEndorsement: WEIGHTS.endorsement * ENDORSEMENT_SPLIT.operator * operatorFactor,
      recency: WEIGHTS.recency * recency,
      llmConfidence: WEIGHTS.llmConfidence * llmConf,
      contradictionPenalty,
    },
  };
}

/**
 * Get the minimum confidence threshold for a given context
 */
export function getInjectionThreshold(context: InjectionContext): number {
  return INJECTION_THRESHOLDS[context];
}

/**
 * Calculate contradiction penalty with recovery decay
 *
 * Full penalty immediately after contradiction, recovers by 0.05 per successful use.
 * After 8 clean applications, penalty is gone.
 */
function calculateContradictionPenalty(history: LessonHistory): number {
  if (!history.hasGroundTruthContradiction) {
    return 0;
  }

  const recovery = CONTRADICTION_RECOVERY_PER_SUCCESS * history.successfulUsesSinceContradiction;
  return Math.max(0, CONTRADICTION_PENALTY_INITIAL - recovery);
}

/**
 * Normalize valence delta from [-2, +2] to [0, 1]
 */
function normalizeValence(delta: number): number {
  // Clamp to valid range, then normalize
  const clamped = Math.max(-2, Math.min(2, delta));
  return (clamped + 2) / 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visualization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a dashboard-friendly visualization of confidence breakdown
 */
export function generateConfidenceVisualization(
  lessonText: string,
  history: LessonHistory,
  result: ConfidenceResult,
): string {
  const { score, meetsThreshold, threshold, breakdown } = result;

  const statusIcon = meetsThreshold ? "✅" : "⚠️";
  const thresholdStatus = meetsThreshold
    ? `PASSES threshold (${threshold.toFixed(2)})`
    : `BELOW threshold (${threshold.toFixed(2)})`;

  return `
[LESSON INJECTION] ${statusIcon}
"${lessonText}"

Confidence: ${score.toFixed(3)} — ${thresholdStatus}
├─ Valence Δ:        +${breakdown.valenceDelta.toFixed(3)} (avg Δ: ${history.avgValenceDelta.toFixed(2)})
├─ Success rate:     +${breakdown.successRate.toFixed(3)} (${history.successCount}/${history.injectionCount} led to +Δ)
├─ Family:           +${breakdown.familyEndorsement.toFixed(3)} (${history.familyEndorsements} endorsements)
├─ Operator:         +${breakdown.operatorEndorsement.toFixed(3)} (${history.operatorEndorsements} approvals)
├─ Recency:          +${breakdown.recency.toFixed(3)} (${history.daysSinceLastUse} days ago)
├─ LLM confidence:   +${breakdown.llmConfidence.toFixed(3)}
└─ Contradiction:    -${breakdown.contradictionPenalty.toFixed(3)} (${history.successfulUsesSinceContradiction} successes since)
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// First-Use Handling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a default history for first-time lesson injection
 */
export function createFirstUseHistory(
  llmConfidence: number = DEFAULT_LLM_CONFIDENCE,
): LessonHistory {
  return {
    avgValenceDelta: 0,
    injectionCount: 0,
    successCount: 0,
    familyEndorsements: 0,
    operatorEndorsements: 0,
    daysSinceLastUse: 0,
    hasGroundTruthContradiction: false,
    successfulUsesSinceContradiction: 0,
    llmSelfConfidence: llmConfidence,
  };
}

/**
 * Calculate confidence for a lesson being used for the first time
 * Falls back to ~0.5 (LLM confidence + recency = recent + small boost)
 */
export function calculateFirstUseConfidence(
  lesson: Lesson,
  llmConfidence: number = DEFAULT_LLM_CONFIDENCE,
  context: InjectionContext = "general",
): ConfidenceResult {
  const history = createFirstUseHistory(llmConfidence);
  return calculateLessonConfidence(lesson, history, context);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for Testing
// ─────────────────────────────────────────────────────────────────────────────

export const _testing = {
  WEIGHTS,
  ENDORSEMENT_SPLIT,
  CONTRADICTION_PENALTY_INITIAL,
  CONTRADICTION_RECOVERY_PER_SUCCESS,
  CONFIDENCE_FLOOR,
  SUCCESS_VALENCE_THRESHOLD,
  normalizeValence,
  calculateContradictionPenalty,
};
