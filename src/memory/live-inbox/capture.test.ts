import { describe, expect, it } from "vitest";
import {
  buildPersonalSkillCandidateInputFromLiveInboxCandidate,
  captureFromMessage,
  type CaptureResult,
} from "./capture.js";

describe("captureFromMessage", () => {
  const baseParams = { sessionKey: "test-session", role: "user" as const };

  describe("hard triggers", () => {
    it("detects 'remember this' directive", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "Hey, remember this: I always use dark mode in my editor.",
      });
      expect(result.hardTriggers.length).toBeGreaterThanOrEqual(1);
      const directive = result.hardTriggers.find((c) => c.candidateType === "directive");
      expect(directive).toBeDefined();
      expect(directive!.confidence).toBeGreaterThanOrEqual(0.9);
      expect(directive!.isHard).toBe(true);
    });

    it("detects 'don't forget' directive", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "Don't forget that the API key rotates every Monday.",
      });
      expect(result.hardTriggers.length).toBeGreaterThanOrEqual(1);
      expect(result.hardTriggers[0].candidateType).toBe("directive");
    });

    it("detects identity statements", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "I am a software engineer at Google.",
      });
      expect(result.hardTriggers.length).toBeGreaterThanOrEqual(1);
      const identity = result.hardTriggers.find((c) => c.candidateType === "identity");
      expect(identity).toBeDefined();
      expect(identity!.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("detects 'my name is' identity", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "My name is Jason and I run an MSP.",
      });
      expect(result.hardTriggers.length).toBeGreaterThanOrEqual(1);
    });

    it("detects preference statements", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "I prefer TypeScript over JavaScript for everything.",
      });
      expect(result.hardTriggers.length).toBeGreaterThanOrEqual(1);
      const pref = result.hardTriggers.find((c) => c.candidateType === "preference");
      expect(pref).toBeDefined();
    });

    it("detects 'I always' preference", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "I always use Vim keybindings in VS Code.",
      });
      expect(result.hardTriggers.length).toBeGreaterThanOrEqual(1);
    });

    it("detects corrections", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "No, that's wrong — the config file lives in ~/.argentos, not ~/.config.",
      });
      expect(result.hardTriggers.length).toBeGreaterThanOrEqual(1);
      const correction = result.hardTriggers.find((c) => c.candidateType === "correction");
      expect(correction).toBeDefined();
      expect(correction!.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("detects commitments", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "Going forward, we should always run tests before committing.",
      });
      expect(result.hardTriggers.length).toBeGreaterThanOrEqual(1);
      const commit = result.hardTriggers.find((c) => c.candidateType === "commitment");
      expect(commit).toBeDefined();
    });
  });

  describe("deferred candidates", () => {
    it("detects decision language", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "I've decided to use PostgreSQL instead of MySQL for this project.",
      });
      const decision = result.candidates.find((c) => c.candidateType === "decision");
      expect(decision).toBeDefined();
      expect(decision!.isHard).toBe(false);
      expect(decision!.confidence).toBeLessThan(0.8);
    });

    it("detects emotional markers", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "THIS IS AMAZING!! I can't believe it worked!!!",
      });
      const emotion = result.candidates.find((c) => c.candidateType === "emotion");
      expect(emotion).toBeDefined();
      expect(emotion!.isHard).toBe(false);
    });

    it("detects work planning and website build conversations", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "We're brainstorming a simple resume portfolio website for a woman client and using Namecheap, Cloudflare, and Coolify for the domain and hosting setup.",
      });
      const decision = result.candidates.find(
        (c) => c.candidateType === "decision" && c.matchedPattern === "contextual:work-planning",
      );
      expect(decision).toBeDefined();
      expect(decision!.memoryTypeHint).toBe("knowledge");
      expect(decision!.significanceHint).toBe("important");
    });
  });

  describe("edge cases", () => {
    it("returns empty for short text", () => {
      const result = captureFromMessage({ ...baseParams, text: "hi" });
      expect(result.candidates).toHaveLength(0);
      expect(result.hardTriggers).toHaveLength(0);
    });

    it("returns empty for empty text", () => {
      const result = captureFromMessage({ ...baseParams, text: "" });
      expect(result.candidates).toHaveLength(0);
    });

    it("skips nudge messages", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "[NUDGE] This is a contemplation prompt with I always use dark mode.",
      });
      expect(result.candidates).toHaveLength(0);
    });

    it("skips heartbeat messages", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "Heartbeat: checking in, I prefer quick updates.",
      });
      expect(result.candidates).toHaveLength(0);
    });

    it("deduplicates same pattern type in one message", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "I prefer dark mode. I always use dark mode.",
      });
      // Should have candidates but deduped
      expect(result.candidates.length).toBeGreaterThan(0);
    });

    it("extracts entities from message", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "Remember this: Richard Doe always handles the billing.",
      });
      expect(result.hardTriggers.length).toBeGreaterThanOrEqual(1);
      const trigger = result.hardTriggers[0];
      expect(trigger.entities).toBeDefined();
      // "Richard Doe" should be detected as an entity
      expect(trigger.entities!.some((e) => e.includes("Richard"))).toBe(true);
    });

    it("works with assistant role", () => {
      const result = captureFromMessage({
        sessionKey: "test",
        text: "I've decided to use the PostgreSQL adapter for this migration.",
        role: "assistant",
      });
      const decision = result.candidates.find((c) => c.candidateType === "decision");
      if (decision) {
        expect(decision.role).toBe("assistant");
      }
    });

    it("captures explicit project approvals as hard commitment triggers", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "You have permission to work on this client website project with the family dev team.",
      });
      const commitment = result.hardTriggers.find(
        (c) => c.candidateType === "commitment" && c.matchedPattern === "contextual:work-approval",
      );
      expect(commitment).toBeDefined();
      expect(commitment!.significanceHint).toBe("important");
    });

    it("captures explicit personal skill directives as hard commitments", () => {
      const result = captureFromMessage({
        ...baseParams,
        text: "Learn this as a Personal Skill: When I ask you to verify a claim, check the live source directly, separate fact from inference, and call out ambiguity.",
      });
      const commitment = result.hardTriggers.find(
        (c) => c.candidateType === "commitment" && c.matchedPattern.includes("personal\\s+skill"),
      );
      expect(commitment).toBeDefined();
      expect(commitment!.confidence).toBeGreaterThanOrEqual(0.95);
      expect(commitment!.isHard).toBe(true);
    });
  });
});

describe("personal skill candidates from live inbox hard triggers", () => {
  it("builds an incubating personal skill candidate from procedural user corrections", () => {
    const input = buildPersonalSkillCandidateInputFromLiveInboxCandidate({
      candidate: {
        sessionKey: "s",
        messageId: "m",
        role: "user",
        candidateType: "correction",
        factText:
          "No, that's wrong — always check memory_recall before you answer that kind of question.",
        confidence: 0.9,
        triggerFlags: ["correction"],
        entities: [],
        isHard: true,
        matchedPattern: "correction",
      },
      promotedMemoryItemId: "mem-1",
    });

    expect(input).not.toBeNull();
    expect(input?.state).toBe("incubating");
    expect(input?.sourceMemoryIds).toEqual(["mem-1"]);
    expect(input?.title.toLowerCase()).toContain("operator correction");
  });

  it("ignores non-procedural or non-user corrections", () => {
    expect(
      buildPersonalSkillCandidateInputFromLiveInboxCandidate({
        candidate: {
          sessionKey: "s",
          messageId: "m",
          role: "assistant",
          candidateType: "correction",
          factText: "No, that's wrong.",
          confidence: 0.9,
          triggerFlags: ["correction"],
          entities: [],
          isHard: true,
          matchedPattern: "correction",
        },
        promotedMemoryItemId: "mem-2",
      }),
    ).toBeNull();

    expect(
      buildPersonalSkillCandidateInputFromLiveInboxCandidate({
        candidate: {
          sessionKey: "s",
          messageId: "m",
          role: "user",
          candidateType: "correction",
          factText: "No, that's wrong.",
          confidence: 0.9,
          triggerFlags: ["correction"],
          entities: [],
          isHard: true,
          matchedPattern: "correction",
        },
        promotedMemoryItemId: "mem-3",
      }),
    ).toBeNull();
  });

  it("builds an incubating personal skill candidate from explicit personal skill directives", () => {
    const input = buildPersonalSkillCandidateInputFromLiveInboxCandidate({
      candidate: {
        sessionKey: "s",
        messageId: "m",
        role: "user",
        candidateType: "commitment",
        factText:
          "Learn this as a Personal Skill: When I ask whether something is working, verify process state, endpoint health, and the newest logs before answering.",
        confidence: 0.98,
        triggerFlags: ["commitment"],
        entities: [],
        isHard: true,
        matchedPattern: "learn-this-as-personal-skill",
      },
      promotedMemoryItemId: "mem-4",
    });

    expect(input).not.toBeNull();
    expect(input?.state).toBe("incubating");
    expect(input?.summary).toContain("Learn this as a Personal Skill");
  });
});
