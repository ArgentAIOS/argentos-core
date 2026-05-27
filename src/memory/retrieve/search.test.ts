import { describe, expect, it } from "vitest";
import type { MemoryItem, MemorySearchResult } from "../memu-types.js";
import { applyRerankGuardrail, RERANK_DOMINANCE_THRESHOLD } from "./search.js";

/**
 * Coverage for the rerank dominance guardrail (issue #418, 2026-05-25 repro:
 * "What's my favorite color?" returned "silver" / broad profile facts even
 * though "mossy oak green" was the dominant pre-rerank top at 2.672 vs the
 * next candidate at 1.616).
 *
 * The LLM reranker has no per-call knowledge of the pre-rerank score gap and
 * can demote a clear winner in favor of items that *sound* topically related.
 * The guardrail restores the dominant top when the LLM displaces it AND the
 * score ratio against the next candidate clears RERANK_DOMINANCE_THRESHOLD.
 */

function makeResult(id: string, summary: string, score: number): MemorySearchResult {
  // Minimal MemoryItem shape — only fields the guardrail actually touches.
  const item: MemoryItem = {
    id,
    resourceId: null,
    memoryType: "profile",
    summary,
    embedding: [],
    happenedAt: null,
    contentHash: null,
    reinforcementCount: 1,
    lastReinforcedAt: null,
    extra: {},
    emotionalValence: 0,
    emotionalArousal: 0,
    moodAtCapture: null,
    significance: "routine",
    reflection: null,
    lesson: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as MemoryItem;
  return { item, score, categories: [] };
}

describe("applyRerankGuardrail", () => {
  it("does not activate when the LLM keeps the pre-rerank top in position 0", () => {
    const preRerank = [
      makeResult("a", "exact answer", 2.672),
      makeResult("b", "broad fact", 1.616),
      makeResult("c", "broad fact", 1.6),
    ];
    // LLM agrees with pre-rerank order.
    const llmReordered = [...preRerank];
    const decision = applyRerankGuardrail(preRerank, llmReordered);
    expect(decision.restored).toBe(false);
    expect(decision.results[0].item.id).toBe("a");
    expect(decision.results).toEqual(llmReordered);
  });

  it("restores the pre-rerank top when the LLM displaces a dominant winner", () => {
    // The exact favorite-color repro: 2.672 vs 1.616 → 1.65× ratio,
    // comfortably above the 1.5× threshold.
    const preRerank = [
      makeResult("favorite-color", "Jason's favorite color is mossy oak green", 2.672),
      makeResult("favorite-number", "Jason's favorite number is 42", 1.616),
      makeResult("background", "Jason has a CCIE background", 1.6),
    ];
    // LLM buries the dominant top under broad identity facts.
    const llmReordered = [
      makeResult("preferred-address", "Jason's preferred address is 'Jason'", 1.666),
      makeResult("warmth", "Jason prefers warmth over theater", 1.658),
      makeResult("favorite-color", "Jason's favorite color is mossy oak green", 2.672),
    ];
    const decision = applyRerankGuardrail(preRerank, llmReordered);
    expect(decision.restored).toBe(true);
    expect(decision.results[0].item.id).toBe("favorite-color");
    // Rest of the LLM's order is preserved, with the restored top removed from
    // its post-rerank slot (it should not appear twice).
    expect(decision.results.map((r) => r.item.id)).toEqual([
      "favorite-color",
      "preferred-address",
      "warmth",
    ]);
    expect(decision.dominanceRatio).toBeCloseTo(2.672 / 1.616, 3);
  });

  it("does not activate when pre-rerank scores are too flat to claim dominance", () => {
    // Ratio of 1.3× — under threshold, trust the LLM.
    const preRerank = [
      makeResult("a", "candidate A", 1.3),
      makeResult("b", "candidate B", 1.0),
      makeResult("c", "candidate C", 0.9),
    ];
    const llmReordered = [
      makeResult("b", "candidate B", 1.0),
      makeResult("a", "candidate A", 1.3),
      makeResult("c", "candidate C", 0.9),
    ];
    const decision = applyRerankGuardrail(preRerank, llmReordered);
    expect(decision.restored).toBe(false);
    expect(decision.results[0].item.id).toBe("b");
    expect(decision.dominanceRatio).toBeLessThan(RERANK_DOMINANCE_THRESHOLD);
  });

  it("does activate exactly at the dominance threshold (>= boundary check)", () => {
    // Construct a case where ratio == threshold. Threshold check is strict <,
    // so equality should restore.
    const second = 1.0;
    const top = RERANK_DOMINANCE_THRESHOLD * second; // 1.5
    const preRerank = [
      makeResult("dominant", "exact match", top),
      makeResult("second", "broad", second),
    ];
    const llmReordered = [
      makeResult("second", "broad", second),
      makeResult("dominant", "exact match", top),
    ];
    const decision = applyRerankGuardrail(preRerank, llmReordered);
    expect(decision.restored).toBe(true);
    expect(decision.results[0].item.id).toBe("dominant");
  });

  it("treats a single result as a no-op (no second candidate to compare against)", () => {
    const preRerank = [makeResult("only", "only result", 0.5)];
    const llmReordered = [...preRerank];
    const decision = applyRerankGuardrail(preRerank, llmReordered);
    expect(decision.restored).toBe(false);
    expect(decision.results).toEqual(llmReordered);
    expect(decision.dominanceRatio).toBe(Number.POSITIVE_INFINITY);
  });

  it("does not duplicate the restored top when it also appears later in the LLM's order", () => {
    const preRerank = [
      makeResult("dom", "exact", 3.0),
      makeResult("x", "other", 1.0),
      makeResult("y", "other", 0.9),
    ];
    const llmReordered = [
      makeResult("x", "other", 1.0),
      makeResult("dom", "exact", 3.0),
      makeResult("y", "other", 0.9),
    ];
    const decision = applyRerankGuardrail(preRerank, llmReordered);
    expect(decision.restored).toBe(true);
    expect(decision.results.map((r) => r.item.id)).toEqual(["dom", "x", "y"]);
    // Explicitly check that "dom" only appears once.
    expect(decision.results.filter((r) => r.item.id === "dom")).toHaveLength(1);
  });

  it("surfaces the LLM's chosen top in telemetry even when restored", () => {
    const preRerank = [makeResult("dom", "exact", 3.0), makeResult("other", "broad", 1.0)];
    const llmReordered = [makeResult("other", "broad", 1.0), makeResult("dom", "exact", 3.0)];
    const decision = applyRerankGuardrail(preRerank, llmReordered);
    expect(decision.preRerankTopId).toBe("dom");
    expect(decision.llmTopId).toBe("other");
    expect(decision.restored).toBe(true);
  });
});
