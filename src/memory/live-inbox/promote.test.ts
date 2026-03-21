import { describe, expect, it } from "vitest";
import type { LiveCandidate } from "../memu-types.js";
import { buildCandidateReviewPrompt, parsePromotionDecisions } from "./promote.js";

describe("buildCandidateReviewPrompt", () => {
  it("returns empty string for no candidates", () => {
    expect(buildCandidateReviewPrompt([])).toBe("");
  });

  it("builds prompt with candidates", () => {
    const candidates: LiveCandidate[] = [
      {
        id: "abc-123",
        sessionKey: "test",
        messageId: null,
        role: "user",
        candidateType: "preference",
        factText: "I prefer dark mode in my editor",
        factHash: "hash1",
        confidence: 0.85,
        triggerFlags: ["preference"],
        entities: ["VS Code"],
        memoryTypeHint: "behavior",
        significanceHint: "noteworthy",
        sourceTs: "2026-02-21T00:00:00Z",
        expiresAt: "2026-02-22T00:00:00Z",
        status: "pending",
        promotedItemId: null,
        promotionReason: null,
        createdAt: "2026-02-21T00:00:00Z",
        updatedAt: "2026-02-21T00:00:00Z",
      },
    ];

    const prompt = buildCandidateReviewPrompt(candidates);
    expect(prompt).toContain("Recent Unreviewed Observations");
    expect(prompt).toContain("abc-123");
    expect(prompt).toContain("preference");
    expect(prompt).toContain("dark mode");
    expect(prompt).toContain("PROMOTE:");
    expect(prompt).toContain("REJECT:");
    expect(prompt).toContain("MERGE:");
  });

  it("includes entities in candidate lines", () => {
    const candidates: LiveCandidate[] = [
      {
        id: "def-456",
        sessionKey: "test",
        messageId: null,
        role: "user",
        candidateType: "relationship",
        factText: "My partner Richard handles the billing",
        factHash: "hash2",
        confidence: 0.5,
        triggerFlags: ["relationship"],
        entities: ["Richard"],
        memoryTypeHint: "profile",
        significanceHint: "noteworthy",
        sourceTs: "2026-02-21T00:00:00Z",
        expiresAt: "2026-02-22T00:00:00Z",
        status: "pending",
        promotedItemId: null,
        promotionReason: null,
        createdAt: "2026-02-21T00:00:00Z",
        updatedAt: "2026-02-21T00:00:00Z",
      },
    ];

    const prompt = buildCandidateReviewPrompt(candidates);
    expect(prompt).toContain("Richard");
  });
});

describe("parsePromotionDecisions", () => {
  it("parses PROMOTE decision", () => {
    const text = `
I'll review these observations:
PROMOTE:abc-123
The preference about dark mode is worth keeping.
    `;
    const decisions = parsePromotionDecisions(text);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("promote");
    expect(decisions[0].candidateId).toBe("abc-123");
  });

  it("parses REJECT decision with reason", () => {
    const text = "REJECT:def-456:too vague to be useful";
    const decisions = parsePromotionDecisions(text);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("reject");
    expect(decisions[0].candidateId).toBe("def-456");
    expect(decisions[0].reason).toBe("too vague to be useful");
  });

  it("parses MERGE decision", () => {
    const text = "MERGE:ghi-789:already know about dark mode preference";
    const decisions = parsePromotionDecisions(text);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("merge");
    expect(decisions[0].candidateId).toBe("ghi-789");
    expect(decisions[0].reason).toBe("already know about dark mode preference");
  });

  it("parses multiple decisions", () => {
    const text = `
Here are my decisions:
PROMOTE:aaa-111
REJECT:bbb-222:not useful
MERGE:ccc-333:existing memory about TypeScript
PROMOTE:ddd-444
    `;
    const decisions = parsePromotionDecisions(text);
    expect(decisions).toHaveLength(4);
    expect(decisions[0].action).toBe("promote");
    expect(decisions[1].action).toBe("reject");
    expect(decisions[2].action).toBe("merge");
    expect(decisions[3].action).toBe("promote");
  });

  it("returns empty array for no decisions", () => {
    const text = "I thought about these but nothing stood out.";
    const decisions = parsePromotionDecisions(text);
    expect(decisions).toHaveLength(0);
  });

  it("handles case-insensitive matching", () => {
    const text = "promote:abc-123\nreject:def-456:reason\nmerge:ghi-789:reason";
    const decisions = parsePromotionDecisions(text);
    expect(decisions).toHaveLength(3);
  });
});
