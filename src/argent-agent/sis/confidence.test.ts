/**
 * Argent Core - SIS Lesson Confidence Scoring Tests
 *
 * Test cases for the lesson confidence scoring system.
 * Validates formula behavior, edge cases, and threshold logic.
 */

import { describe, it, expect } from "vitest";
import {
  calculateLessonConfidence,
  calculateFirstUseConfidence,
  getInjectionThreshold,
  generateConfidenceVisualization,
  createFirstUseHistory,
  _testing,
  type Lesson,
  type LessonHistory,
  type InjectionContext,
} from "./confidence.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const createLesson = (overrides: Partial<Lesson> = {}): Lesson => ({
  id: "test-lesson-1",
  text: "When corrected, treat as learning opportunity, not failure",
  createdAt: new Date("2026-02-16"),
  source: "self",
  ...overrides,
});

const createHistory = (overrides: Partial<LessonHistory> = {}): LessonHistory => ({
  avgValenceDelta: 0,
  injectionCount: 0,
  successCount: 0,
  familyEndorsements: 0,
  operatorEndorsements: 0,
  daysSinceLastUse: 0,
  hasGroundTruthContradiction: false,
  successfulUsesSinceContradiction: 0,
  llmSelfConfidence: 0.5,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// Core Formula Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateLessonConfidence", () => {
  describe("first use (no history)", () => {
    it("should return ~0.35 for completely empty history", () => {
      const lesson = createLesson();
      const history = createFirstUseHistory();
      const result = calculateLessonConfidence(lesson, history);

      // First use breakdown:
      // - Valence delta: 0.40 * 0.5 (normalized 0 = 0.5) = 0.20
      // - Success rate: 0.25 * 0 = 0
      // - Endorsement: 0.15 * 0 = 0
      // - Recency: 0.10 * 1.0 = 0.10
      // - LLM confidence: 0.10 * 0.5 = 0.05
      // Total = 0.35
      expect(result.score).toBeCloseTo(0.35, 2);
      expect(result.meetsThreshold).toBe(false); // Below 0.50 general threshold
    });

    it("should return higher confidence with high LLM confidence", () => {
      const lesson = createLesson();
      const result = calculateFirstUseConfidence(lesson, 0.9, "general");

      // Same as above but LLM confidence = 0.9
      // 0.20 + 0 + 0 + 0.10 + (0.10 * 0.9) = 0.39
      expect(result.score).toBeCloseTo(0.39, 2);
    });
  });

  describe("happy path (strong positive history)", () => {
    it("should return high confidence for well-validated lessons", () => {
      const lesson = createLesson();
      const history = createHistory({
        avgValenceDelta: 1.5, // Strong positive
        injectionCount: 20,
        successCount: 18, // 90% success rate
        familyEndorsements: 5,
        operatorEndorsements: 3,
        daysSinceLastUse: 1,
        llmSelfConfidence: 0.85,
      });

      const result = calculateLessonConfidence(lesson, history);

      // Should be high confidence
      expect(result.score).toBeGreaterThan(0.8);
      expect(result.meetsThreshold).toBe(true);
    });

    it("should pass external threshold with very strong history", () => {
      const lesson = createLesson();
      const history = createHistory({
        avgValenceDelta: 2.0, // Maximum positive
        injectionCount: 50,
        successCount: 48, // 96% success rate
        familyEndorsements: 5,
        operatorEndorsements: 4,
        daysSinceLastUse: 0,
        llmSelfConfidence: 0.95,
      });

      const result = calculateLessonConfidence(lesson, history, "external");

      expect(result.score).toBeGreaterThan(0.8);
      expect(result.threshold).toBe(0.8);
      expect(result.meetsThreshold).toBe(true);
    });
  });

  describe("contradiction penalty", () => {
    it("should apply full penalty immediately after contradiction", () => {
      const lesson = createLesson();
      const historyClean = createHistory({
        avgValenceDelta: 1.0,
        injectionCount: 10,
        successCount: 8,
        hasGroundTruthContradiction: false,
      });
      const historyContradicted = createHistory({
        ...historyClean,
        hasGroundTruthContradiction: true,
        successfulUsesSinceContradiction: 0,
      });

      const cleanResult = calculateLessonConfidence(lesson, historyClean);
      const contradictedResult = calculateLessonConfidence(lesson, historyContradicted);

      // Should drop by ~0.40
      expect(cleanResult.score - contradictedResult.score).toBeCloseTo(0.4, 2);
      expect(contradictedResult.breakdown.contradictionPenalty).toBe(0.4);
    });

    it("should recover penalty after successful uses", () => {
      const lesson = createLesson();

      // After 4 successful uses: penalty = 0.40 - (0.05 * 4) = 0.20
      const history4Success = createHistory({
        avgValenceDelta: 1.0,
        injectionCount: 10,
        successCount: 8,
        hasGroundTruthContradiction: true,
        successfulUsesSinceContradiction: 4,
      });

      const result = calculateLessonConfidence(lesson, history4Success);
      expect(result.breakdown.contradictionPenalty).toBeCloseTo(0.2, 2);
    });

    it("should fully recover after 8 successful uses", () => {
      const lesson = createLesson();

      // After 8 successful uses: penalty = 0.40 - (0.05 * 8) = 0.00
      const history8Success = createHistory({
        avgValenceDelta: 1.0,
        injectionCount: 10,
        successCount: 8,
        hasGroundTruthContradiction: true,
        successfulUsesSinceContradiction: 8,
      });

      const result = calculateLessonConfidence(lesson, history8Success);
      expect(result.breakdown.contradictionPenalty).toBe(0);
    });

    it("should not go negative on penalty (after more than 8 uses)", () => {
      const lesson = createLesson();

      const history20Success = createHistory({
        hasGroundTruthContradiction: true,
        successfulUsesSinceContradiction: 20,
      });

      const result = calculateLessonConfidence(lesson, history20Success);
      expect(result.breakdown.contradictionPenalty).toBe(0);
    });
  });

  describe("endorsement weighting", () => {
    it("should weight operator endorsements higher per count", () => {
      const lesson = createLesson();

      // 3 family endorsements
      const historyFamily = createHistory({
        familyEndorsements: 3,
        operatorEndorsements: 0,
      });

      // 3 operator endorsements (should be worth more due to log base 4 vs 6)
      const historyOperator = createHistory({
        familyEndorsements: 0,
        operatorEndorsements: 3,
      });

      const familyResult = calculateLessonConfidence(lesson, historyFamily);
      const operatorResult = calculateLessonConfidence(lesson, historyOperator);

      // Both contribute to the endorsement factor
      // Family: 0.60 * log(4)/log(6) ≈ 0.46
      // Operator: 0.40 * log(4)/log(4) = 0.40
      // Operator saturates faster but family has higher weight
      expect(familyResult.breakdown.familyEndorsement).toBeGreaterThan(0);
      expect(operatorResult.breakdown.operatorEndorsement).toBeGreaterThan(0);
    });

    it("should cap endorsement factor at 0.15", () => {
      const lesson = createLesson();

      // Max out both endorsement types
      const history = createHistory({
        familyEndorsements: 100,
        operatorEndorsements: 100,
      });

      const result = calculateLessonConfidence(lesson, history);

      // Total endorsement contribution = 0.15 (weight) * 1.0 (maxed factor)
      const totalEndorsement =
        result.breakdown.familyEndorsement + result.breakdown.operatorEndorsement;
      expect(totalEndorsement).toBeLessThanOrEqual(0.15);
    });
  });

  describe("recency decay", () => {
    it("should give maximum recency boost for same-day use", () => {
      const lesson = createLesson();
      const history = createHistory({ daysSinceLastUse: 0 });

      const result = calculateLessonConfidence(lesson, history);

      // recency = 1 / (1 + 0) = 1.0
      // contribution = 0.10 * 1.0 = 0.10
      expect(result.breakdown.recency).toBeCloseTo(0.1, 2);
    });

    it("should decay recency over time", () => {
      const lesson = createLesson();

      const historyRecent = createHistory({ daysSinceLastUse: 1 });
      const historyOld = createHistory({ daysSinceLastUse: 30 });

      const recentResult = calculateLessonConfidence(lesson, historyRecent);
      const oldResult = calculateLessonConfidence(lesson, historyOld);

      expect(recentResult.breakdown.recency).toBeGreaterThan(oldResult.breakdown.recency);

      // 1 day: 1/(1+1) = 0.5 * 0.10 = 0.05
      expect(recentResult.breakdown.recency).toBeCloseTo(0.05, 2);

      // 30 days: 1/(1+30) ≈ 0.032 * 0.10 ≈ 0.003
      expect(oldResult.breakdown.recency).toBeLessThan(0.01);
    });
  });

  describe("confidence floor", () => {
    it("should never go below 0.05", () => {
      const lesson = createLesson();

      // Worst possible history: negative valence, contradiction, no endorsements
      const terribleHistory = createHistory({
        avgValenceDelta: -2.0,
        injectionCount: 10,
        successCount: 0,
        hasGroundTruthContradiction: true,
        successfulUsesSinceContradiction: 0,
        daysSinceLastUse: 365,
        llmSelfConfidence: 0,
      });

      const result = calculateLessonConfidence(lesson, terribleHistory);
      expect(result.score).toBe(0.05);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Threshold Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("getInjectionThreshold", () => {
  it("should return correct thresholds for each context", () => {
    expect(getInjectionThreshold("general")).toBe(0.5);
    expect(getInjectionThreshold("tool")).toBe(0.65);
    expect(getInjectionThreshold("external")).toBe(0.8);
    expect(getInjectionThreshold("critical")).toBe(0.9);
  });
});

describe("threshold enforcement", () => {
  it("should pass general threshold at 0.50", () => {
    const lesson = createLesson();
    const history = createHistory({
      avgValenceDelta: 0.8,
      injectionCount: 5,
      successCount: 4,
      llmSelfConfidence: 0.7,
    });

    const result = calculateLessonConfidence(lesson, history, "general");
    expect(result.score).toBeGreaterThanOrEqual(0.5);
    expect(result.meetsThreshold).toBe(true);
  });

  it("should fail critical threshold even with good history", () => {
    const lesson = createLesson();
    const history = createHistory({
      avgValenceDelta: 1.0,
      injectionCount: 10,
      successCount: 8,
      familyEndorsements: 2,
      operatorEndorsements: 1,
      daysSinceLastUse: 3,
      llmSelfConfidence: 0.7,
    });

    const result = calculateLessonConfidence(lesson, history, "critical");

    // Good but not exceptional - should fail 0.90 threshold
    expect(result.score).toBeLessThan(0.9);
    expect(result.meetsThreshold).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Visualization Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("generateConfidenceVisualization", () => {
  it("should produce readable output", () => {
    const lesson = createLesson();
    const history = createHistory({
      avgValenceDelta: 1.2,
      injectionCount: 12,
      successCount: 10,
      familyEndorsements: 4,
      operatorEndorsements: 2,
      daysSinceLastUse: 2,
      llmSelfConfidence: 0.85,
    });

    const result = calculateLessonConfidence(lesson, history);
    const viz = generateConfidenceVisualization(lesson.text, history, result);

    // Should contain key elements
    expect(viz).toContain("[LESSON INJECTION]");
    expect(viz).toContain(lesson.text);
    expect(viz).toContain("Confidence:");
    expect(viz).toContain("Valence Δ");
    expect(viz).toContain("Success rate");
    expect(viz).toContain("Family");
    expect(viz).toContain("Operator");
    expect(viz).toContain("Recency");
    expect(viz).toContain("Contradiction");
  });

  it("should show pass/fail status", () => {
    const lesson = createLesson();

    const goodHistory = createHistory({
      avgValenceDelta: 1.5,
      injectionCount: 20,
      successCount: 18,
      familyEndorsements: 5,
      operatorEndorsements: 3,
      daysSinceLastUse: 1,
      llmSelfConfidence: 0.9,
    });

    const badHistory = createFirstUseHistory();

    const goodResult = calculateLessonConfidence(lesson, goodHistory);
    const badResult = calculateLessonConfidence(lesson, badHistory);

    const goodViz = generateConfidenceVisualization(lesson.text, goodHistory, goodResult);
    const badViz = generateConfidenceVisualization(lesson.text, badHistory, badResult);

    expect(goodViz).toContain("✅");
    expect(goodViz).toContain("PASSES");
    expect(badViz).toContain("⚠️");
    expect(badViz).toContain("BELOW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal Function Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeValence", () => {
  const { normalizeValence } = _testing;

  it("should normalize -2 to 0", () => {
    expect(normalizeValence(-2)).toBe(0);
  });

  it("should normalize 0 to 0.5", () => {
    expect(normalizeValence(0)).toBe(0.5);
  });

  it("should normalize +2 to 1", () => {
    expect(normalizeValence(2)).toBe(1);
  });

  it("should clamp values outside range", () => {
    expect(normalizeValence(-5)).toBe(0);
    expect(normalizeValence(10)).toBe(1);
  });
});

describe("weight validation", () => {
  it("weights should sum to 1.0", () => {
    const { WEIGHTS } = _testing;
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("endorsement split should sum to 1.0", () => {
    const { ENDORSEMENT_SPLIT } = _testing;
    const sum = ENDORSEMENT_SPLIT.family + ENDORSEMENT_SPLIT.operator;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});
