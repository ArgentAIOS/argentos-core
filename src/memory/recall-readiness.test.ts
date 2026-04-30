import { describe, expect, it } from "vitest";
import { classifyMemoryRecallReadiness } from "./recall-readiness.js";

describe("classifyMemoryRecallReadiness", () => {
  it("returns green for useful recall coverage", () => {
    const readiness = classifyMemoryRecallReadiness({
      resultCount: 5,
      coverageScore: 0.75,
      answerConfidence: 0.86,
      fallbackUsed: false,
    });

    expect(readiness.status).toBe("green");
    expect(readiness.notice).toBeUndefined();
  });

  it("returns yellow for technically successful but thin recall", () => {
    const readiness = classifyMemoryRecallReadiness({
      resultCount: 3,
      coverageScore: 0.33,
      answerConfidence: 0.72,
      fallbackUsed: false,
    });

    expect(readiness.status).toBe("yellow");
    expect(readiness.reasons).toContain("low_type_coverage");
    expect(readiness.notice).toMatch(/thin/i);
  });

  it("returns red for no recall results", () => {
    const readiness = classifyMemoryRecallReadiness({
      resultCount: 0,
      coverageScore: 0,
    });

    expect(readiness.status).toBe("red");
    expect(readiness.reasons).toContain("no_results");
  });
});
