import { describe, expect, it } from "vitest";
import type { MemoryAdapter } from "../../data/adapter.js";
import type {
  CreatePersonalSkillCandidateInput,
  CreatePersonalSkillReviewEventInput,
  PersonalSkillCandidate,
  PersonalSkillCandidateState,
  PersonalSkillReviewEvent,
} from "../memu-types.js";
import { reviewPersonalSkillCandidates } from "../../agents/skills/personal.js";
import {
  buildPersonalSkillCandidateInputFromLiveInboxCandidate,
  captureFromMessage,
  isAudioTranscriptPollutedSkill,
  isAudioTranscriptPollution,
  reinforceOrCreatePersonalSkillCandidateFromLiveInbox,
  type CandidateInput,
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

describe("audio-transcript pollution filter", () => {
  describe("isAudioTranscriptPollution", () => {
    it("flags [AUDIO_ENABLED] dictation markers", () => {
      expect(
        isAudioTranscriptPollution(
          "[AUDIO_ENABLED] so you didn't actually use the marketplace tool or use your tool search to find it.",
        ),
      ).toBe(true);
    });

    it("flags compound voice markers like [DEEP_THINK] [AUDIO_ENABLED]", () => {
      expect(
        isAudioTranscriptPollution(
          "[DEEP_THINK] [AUDIO_ENABLED] I don't know if you meant to type out the tool call here in chat...",
        ),
      ).toBe(true);
    });

    it("flags questions, which are not durable procedures", () => {
      expect(
        isAudioTranscriptPollution("did you actually check the marketplace before answering?"),
      ).toBe(true);
      expect(isAudioTranscriptPollution("are you sure that file even exists?")).toBe(true);
    });

    it("flags single-turn meta-corrections about THIS response", () => {
      expect(isAudioTranscriptPollution("you didn't actually run the test")).toBe(true);
      expect(isAudioTranscriptPollution("I don't know if you meant to type that out in chat")).toBe(
        true,
      );
    });

    it("does NOT flag explicit Learn-this-as-Personal-Skill opt-ins", () => {
      // Even if the dictation marker is present, the explicit directive wins.
      expect(
        isAudioTranscriptPollution(
          "[AUDIO_ENABLED] Learn this as a Personal Skill: always verify process state before reporting status.",
        ),
      ).toBe(false);
    });

    it("does NOT flag genuine procedural corrections", () => {
      expect(
        isAudioTranscriptPollution(
          "always run the test suite before pushing — that should be a personal skill.",
        ),
      ).toBe(false);
      expect(
        isAudioTranscriptPollution(
          "no, that's wrong — always check memory_recall before you answer that kind of question.",
        ),
      ).toBe(false);
    });
  });

  describe("isAudioTranscriptPollutedSkill (stored row detection)", () => {
    it("flags titles containing [AUDIO_ENABLED]", () => {
      expect(
        isAudioTranscriptPollutedSkill({
          title:
            "operator correction: [AUDIO_ENABLED] so you didn't actually use the marketplace tool",
          summary: "raw voice quote",
        }),
      ).toBe(true);
    });

    it("flags 'operator correction:' titles whose body is a question", () => {
      expect(
        isAudioTranscriptPollutedSkill({
          title: "operator correction: did you actually verify?",
          summary: "did you actually verify?",
        }),
      ).toBe(true);
    });

    it("does NOT flag clean procedural skills", () => {
      expect(
        isAudioTranscriptPollutedSkill({
          title: "Use the podcast publish checklist",
          summary:
            "Before recording the final podcast payload evidence, run the publish checklist.",
        }),
      ).toBe(false);
      expect(
        isAudioTranscriptPollutedSkill({
          title: "Keep the Task Board Clean",
          summary: "Archive completed tasks before starting a new session.",
        }),
      ).toBe(false);
    });
  });

  describe("buildPersonalSkillCandidateInputFromLiveInboxCandidate respects the filter", () => {
    it("returns null when factText is a raw [AUDIO_ENABLED] transcript", () => {
      const result = buildPersonalSkillCandidateInputFromLiveInboxCandidate({
        candidate: {
          sessionKey: "s",
          messageId: "m",
          role: "user",
          candidateType: "correction",
          factText:
            "[AUDIO_ENABLED] so you didn't actually use the marketplace tool or use your tool search to find it.",
          confidence: 0.9,
          triggerFlags: ["correction"],
          entities: [],
          isHard: true,
          matchedPattern: "correction",
        },
        promotedMemoryItemId: "mem-audio-1",
      });
      expect(result).toBeNull();
    });

    it("still distills explicit Learn-this directives even if they ride on audio", () => {
      const result = buildPersonalSkillCandidateInputFromLiveInboxCandidate({
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
        promotedMemoryItemId: "mem-audio-2",
      });
      expect(result).not.toBeNull();
      expect(result?.summary).toContain("verify process state");
    });

    it("still distills a clean operator correction (no audio markers)", () => {
      const result = buildPersonalSkillCandidateInputFromLiveInboxCandidate({
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
        promotedMemoryItemId: "mem-audio-3",
      });
      expect(result).not.toBeNull();
      expect(result?.title.toLowerCase()).toContain("operator correction");
    });
  });
});

// ── Regression: GH #210 — dedup-skip must bump recurrenceCount ──
//
// Before #210 the dedup-skip path in `promoteCandidate` silently dropped
// repeat observations on the floor. Because the SQL store always seeds new
// candidates with `recurrenceCount = 1` and there was no path that touched
// it again, passive distillation could never satisfy `classifyReviewState`'s
// graduation gate
//   `recurrenceCount >= 2 || evidenceCount >= 2 ||
//    (sourceLessonIds && sourceTaskIds) ||
//    (confidence >= 0.9 && provenanceCount >= 1)`
// — leaving 23 candidates frozen in `incubating` even when several had
// 0.88+ confidence. These tests pin the fix in place.
describe("reinforceOrCreatePersonalSkillCandidateFromLiveInbox (regression: GH #210)", () => {
  function makeInMemoryAdapter(initialRows: PersonalSkillCandidate[] = []) {
    const rows: PersonalSkillCandidate[] = [...initialRows];
    const reviewEvents: PersonalSkillReviewEvent[] = [];
    const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const created: PersonalSkillCandidate[] = [];

    const adapter = {
      listPersonalSkillCandidates: async (filter?: {
        state?: PersonalSkillCandidateState;
        limit?: number;
      }) => {
        let result = rows.slice();
        if (filter?.state) {
          result = result.filter((row) => row.state === filter.state);
        }
        if (typeof filter?.limit === "number") {
          result = result.slice(0, filter.limit);
        }
        return result;
      },
      createPersonalSkillCandidate: async (input: CreatePersonalSkillCandidateInput) => {
        const row: PersonalSkillCandidate = {
          id: `psc-${rows.length + 1}`,
          agentId: input.agentId ?? "main",
          operatorId: input.operatorId ?? null,
          profileId: input.profileId ?? null,
          scope: input.scope ?? "operator",
          title: input.title,
          summary: input.summary,
          triggerPatterns: input.triggerPatterns ?? [],
          procedureOutline: input.procedureOutline ?? null,
          preconditions: input.preconditions ?? [],
          executionSteps: input.executionSteps ?? [],
          expectedOutcomes: input.expectedOutcomes ?? [],
          relatedTools: input.relatedTools ?? [],
          sourceMemoryIds: input.sourceMemoryIds ?? [],
          sourceEpisodeIds: input.sourceEpisodeIds ?? [],
          sourceTaskIds: input.sourceTaskIds ?? [],
          sourceLessonIds: input.sourceLessonIds ?? [],
          supersedesCandidateIds: input.supersedesCandidateIds ?? [],
          supersededByCandidateId: input.supersededByCandidateId ?? null,
          conflictsWithCandidateIds: input.conflictsWithCandidateIds ?? [],
          contradictionCount: input.contradictionCount ?? 0,
          evidenceCount: input.evidenceCount ?? 0,
          recurrenceCount: input.recurrenceCount ?? 1,
          confidence: input.confidence ?? 0.5,
          strength: input.strength ?? 0.5,
          usageCount: input.usageCount ?? 0,
          successCount: input.successCount ?? 0,
          failureCount: input.failureCount ?? 0,
          state: input.state ?? "candidate",
          operatorNotes: input.operatorNotes ?? null,
          lastReviewedAt: null,
          lastUsedAt: null,
          lastReinforcedAt: null,
          lastContradictedAt: null,
          createdAt: "2026-05-11T00:00:00.000Z",
          updatedAt: "2026-05-11T00:00:00.000Z",
        };
        rows.push(row);
        created.push(row);
        return row;
      },
      updatePersonalSkillCandidate: async (id: string, fields: Record<string, unknown>) => {
        updates.push({ id, fields });
        const idx = rows.findIndex((row) => row.id === id);
        if (idx < 0) {
          return null;
        }
        const merged: PersonalSkillCandidate = {
          ...rows[idx],
          ...fields,
          updatedAt: "2026-05-11T00:00:01.000Z",
        };
        rows[idx] = merged;
        return merged;
      },
      listPersonalSkillReviewEvents: async () => reviewEvents.slice(),
      createPersonalSkillReviewEvent: async (input: CreatePersonalSkillReviewEventInput) => {
        const ev: PersonalSkillReviewEvent = {
          id: `ev-${reviewEvents.length + 1}`,
          candidateId: input.candidateId,
          agentId: input.agentId ?? "main",
          actorType: input.actorType,
          action: input.action,
          reason: input.reason ?? null,
          details: input.details ?? {},
          createdAt: "2026-05-11T00:00:02.000Z",
        };
        reviewEvents.push(ev);
        return ev;
      },
    } as unknown as MemoryAdapter;

    return { adapter, rows, created, updates, reviewEvents };
  }

  function makeOperatorCorrectionInput(overrides: Partial<CandidateInput> = {}): CandidateInput {
    return {
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
      ...overrides,
    };
  }

  it("creates a new Personal Skill candidate on first observation (recurrenceCount=1)", async () => {
    const { adapter, rows, created, updates } = makeInMemoryAdapter();
    const candidate = makeOperatorCorrectionInput();

    const result = await reinforceOrCreatePersonalSkillCandidateFromLiveInbox({
      store: adapter,
      candidate,
      promotedMemoryItemId: "mem-A",
    });

    expect(result.action).toBe("created");
    expect(created).toHaveLength(1);
    expect(updates).toHaveLength(0);
    expect(rows[0]?.recurrenceCount).toBe(1);
    expect(rows[0]?.sourceMemoryIds).toEqual(["mem-A"]);
  });

  it("bumps recurrenceCount and merges provenance on dedup-skip (the GH #210 fix)", async () => {
    const { adapter, rows, created, updates } = makeInMemoryAdapter();
    const candidate = makeOperatorCorrectionInput();

    // First observation → create
    await reinforceOrCreatePersonalSkillCandidateFromLiveInbox({
      store: adapter,
      candidate,
      promotedMemoryItemId: "mem-A",
    });

    // Second observation, different memory item id (operator restated the
    // fact in a slightly different turn so it didn't hash-dedupe upstream).
    const result = await reinforceOrCreatePersonalSkillCandidateFromLiveInbox({
      store: adapter,
      candidate,
      promotedMemoryItemId: "mem-B",
    });

    expect(result).toMatchObject({ action: "reinforced", recurrenceCount: 2 });
    // Still only one underlying row — dedup held.
    expect(created).toHaveLength(1);
    expect(rows).toHaveLength(1);
    // The increment landed on the live row.
    expect(rows[0]?.recurrenceCount).toBe(2);
    expect(rows[0]?.sourceMemoryIds).toEqual(["mem-A", "mem-B"]);
    // And we did flow through updatePersonalSkillCandidate (the actual
    // behaviour broken before #210).
    expect(updates).toHaveLength(1);
    expect(updates[0]?.fields.recurrenceCount).toBe(2);
    expect(updates[0]?.fields.lastReinforcedAt).toBeTypeOf("string");
  });

  it("re-observation with the same memory id still increments (idempotent provenance, not idempotent counter)", async () => {
    const { adapter, rows } = makeInMemoryAdapter();
    const candidate = makeOperatorCorrectionInput();

    await reinforceOrCreatePersonalSkillCandidateFromLiveInbox({
      store: adapter,
      candidate,
      promotedMemoryItemId: "mem-same",
    });
    const second = await reinforceOrCreatePersonalSkillCandidateFromLiveInbox({
      store: adapter,
      candidate,
      promotedMemoryItemId: "mem-same",
    });

    expect(second).toMatchObject({ action: "reinforced", recurrenceCount: 2 });
    // Memory id already in the array — do not duplicate it, but still count
    // the re-observation toward recurrence.
    expect(rows[0]?.sourceMemoryIds).toEqual(["mem-same"]);
    expect(rows[0]?.recurrenceCount).toBe(2);
  });

  it("a never-before-seen fact still creates a fresh candidate at recurrence=1", async () => {
    const { adapter, rows, updates } = makeInMemoryAdapter();

    // Seed an unrelated candidate so listPersonalSkillCandidates returns
    // something — the dedup must NOT false-positive across distinct facts.
    await reinforceOrCreatePersonalSkillCandidateFromLiveInbox({
      store: adapter,
      candidate: makeOperatorCorrectionInput({
        factText: "No, that's wrong — always run the test suite before pushing to dev.",
      }),
      promotedMemoryItemId: "mem-existing",
    });

    const result = await reinforceOrCreatePersonalSkillCandidateFromLiveInbox({
      store: adapter,
      candidate: makeOperatorCorrectionInput({
        factText:
          "No, that's wrong — always check memory_recall before you answer that kind of question.",
      }),
      promotedMemoryItemId: "mem-new",
    });

    expect(result.action).toBe("created");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.recurrenceCount).toBe(1);
    expect(rows[1]?.sourceMemoryIds).toEqual(["mem-new"]);
    // No update path on first observation of a brand-new fact.
    expect(updates).toHaveLength(0);
  });

  it("returns 'skipped' for audio-transcript pollution (never touches storage)", async () => {
    const { adapter, rows, created, updates } = makeInMemoryAdapter();
    const result = await reinforceOrCreatePersonalSkillCandidateFromLiveInbox({
      store: adapter,
      candidate: makeOperatorCorrectionInput({
        factText:
          "[AUDIO_ENABLED] so you didn't actually use the marketplace tool or use your tool search to find it.",
      }),
      promotedMemoryItemId: "mem-audio",
    });
    expect(result).toEqual({ action: "skipped" });
    expect(rows).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("threshold-eligible candidates graduate via reviewPersonalSkillCandidates after the dedup-skip bump", async () => {
    const { adapter, rows } = makeInMemoryAdapter();
    const candidate = makeOperatorCorrectionInput();

    // Two distinct observations of the same procedural operator correction.
    // After the second, recurrenceCount=2 — which is exactly the
    // classifyReviewState gate that #210 unblocks.
    await reinforceOrCreatePersonalSkillCandidateFromLiveInbox({
      store: adapter,
      candidate,
      promotedMemoryItemId: "mem-A",
    });
    await reinforceOrCreatePersonalSkillCandidateFromLiveInbox({
      store: adapter,
      candidate,
      promotedMemoryItemId: "mem-B",
    });

    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.recurrenceCount).toBe(2);
    expect(row?.confidence).toBeGreaterThanOrEqual(0.72);

    const result = await reviewPersonalSkillCandidates({
      memory: adapter,
      now: "2026-05-11T01:00:00.000Z",
    });

    // The whole point of the issue: this row graduates to "promoted"
    // because recurrenceCount finally satisfies the `repeated` branch of
    // `classifyReviewState`. Pre-fix, recurrenceCount stayed pinned at 1
    // and the row stalled in `incubating` forever.
    expect(rows[0]?.state).toBe("promoted");
    expect(result.promoted).toBeGreaterThanOrEqual(1);
  });
});
