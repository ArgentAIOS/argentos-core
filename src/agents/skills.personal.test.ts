import { describe, expect, it } from "vitest";
import type { MemoryAdapter } from "../data/adapter.js";
import type { PersonalSkillCandidate } from "../memory/memu-types.js";
import {
  buildExecutablePersonalSkillContextBlock,
  buildMatchedPersonalSkillsContextBlock,
  matchPersonalSkillCandidatesForPrompt,
  mergeMatchedSkills,
  recordPersonalSkillUsage,
  reviewPersonalSkillCandidates,
  selectExecutablePersonalSkill,
} from "./skills.js";

function makeCandidate(
  overrides: Partial<PersonalSkillCandidate> &
    Pick<PersonalSkillCandidate, "id" | "title" | "summary">,
): PersonalSkillCandidate {
  return {
    agentId: "main",
    operatorId: "jason",
    profileId: null,
    scope: "operator",
    triggerPatterns: [],
    procedureOutline: null,
    preconditions: [],
    executionSteps: [],
    expectedOutcomes: [],
    relatedTools: [],
    sourceMemoryIds: [],
    sourceEpisodeIds: [],
    sourceTaskIds: [],
    sourceLessonIds: [],
    supersedesCandidateIds: [],
    supersededByCandidateId: null,
    conflictsWithCandidateIds: [],
    contradictionCount: 0,
    evidenceCount: 0,
    recurrenceCount: 1,
    confidence: 0.5,
    strength: 0.5,
    usageCount: 0,
    successCount: 0,
    failureCount: 0,
    state: "candidate",
    lastReviewedAt: null,
    lastUsedAt: null,
    lastReinforcedAt: null,
    lastContradictedAt: null,
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("personal skills", () => {
  it("reviews candidates into promoted and incubating states", async () => {
    const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const candidates = [
      makeCandidate({
        id: "ps-1",
        title: "Use the podcast publish checklist",
        summary: "Use the publish checklist before recording final podcast payload evidence.",
        triggerPatterns: ["podcast", "publish"],
        relatedTools: ["doc_panel"],
        sourceLessonIds: ["lesson-1"],
        sourceTaskIds: ["task-1"],
        evidenceCount: 2,
        recurrenceCount: 2,
        confidence: 0.86,
      }),
      makeCandidate({
        id: "ps-2",
        title: "Verify the deployment before replying",
        summary: "Before replying, verify the deployment status and capture evidence.",
        sourceMemoryIds: ["memory-1"],
        recurrenceCount: 1,
        confidence: 0.6,
      }),
    ];
    const memory = {
      listPersonalSkillCandidates: async () => candidates,
      updatePersonalSkillCandidate: async (id: string, fields: Record<string, unknown>) => {
        updates.push({ id, fields });
        return candidates.find((candidate) => candidate.id === id) ?? null;
      },
      createPersonalSkillReviewEvent: async () => ({
        id: "review-1",
        candidateId: "ps-1",
        agentId: "main",
        actorType: "system" as const,
        action: "promoted" as const,
        reason: null,
        details: {},
        createdAt: "2026-04-15T12:00:00.000Z",
      }),
    } as unknown as MemoryAdapter;

    const result = await reviewPersonalSkillCandidates({ memory, now: "2026-04-15T12:00:00.000Z" });

    expect(result.reviewed).toBe(2);
    expect(result.changed).toBe(2);
    expect(updates.find((entry) => entry.id === "ps-1")?.fields.state).toBe("promoted");
    expect(updates.find((entry) => entry.id === "ps-2")?.fields.state).toBe("incubating");
    expect(
      String(updates.find((entry) => entry.id === "ps-1")?.fields.procedureOutline ?? ""),
    ).toContain("Use when:");
    expect(updates.find((entry) => entry.id === "ps-1")?.fields.preconditions).toEqual([
      "When podcast",
      "When publish",
    ]);
  });

  it("deprecates an older promoted skill when a stronger overlapping one supersedes it", async () => {
    const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const candidates = [
      makeCandidate({
        id: "old-skill",
        title: "Podcast publish checklist",
        summary: "Use the old checklist before publishing podcast evidence.",
        triggerPatterns: ["podcast", "publish", "checklist"],
        sourceTaskIds: ["task-old"],
        evidenceCount: 1,
        recurrenceCount: 2,
        confidence: 0.74,
        state: "promoted",
        procedureOutline: "1. Check payload.\n2. Publish.",
        updatedAt: "2026-04-14T00:00:00.000Z",
      }),
      makeCandidate({
        id: "new-skill",
        title: "Podcast publish checklist",
        summary: "Use the verified checklist before publishing podcast evidence.",
        triggerPatterns: ["podcast", "publish", "checklist"],
        sourceTaskIds: ["task-new"],
        sourceLessonIds: ["lesson-new"],
        evidenceCount: 2,
        recurrenceCount: 3,
        confidence: 0.9,
        state: "candidate",
        procedureOutline: "1. Check payload.\n2. Capture evidence.\n3. Publish.",
        updatedAt: "2026-04-15T00:00:00.000Z",
      }),
    ];
    const memory = {
      listPersonalSkillCandidates: async () => candidates,
      updatePersonalSkillCandidate: async (id: string, fields: Record<string, unknown>) => {
        updates.push({ id, fields });
        return candidates.find((candidate) => candidate.id === id) ?? null;
      },
      createPersonalSkillReviewEvent: async () => ({
        id: "review-2",
        candidateId: "old-skill",
        agentId: "main",
        actorType: "system" as const,
        action: "conflict_resolved" as const,
        reason: null,
        details: {},
        createdAt: "2026-04-15T12:00:00.000Z",
      }),
    } as unknown as MemoryAdapter;

    await reviewPersonalSkillCandidates({ memory, now: "2026-04-15T12:00:00.000Z" });

    expect(
      updates.find(
        (entry) => entry.id === "new-skill" && Array.isArray(entry.fields.supersedesCandidateIds),
      )?.fields.supersedesCandidateIds,
    ).toEqual(["old-skill"]);
    expect(
      updates.find(
        (entry) => entry.id === "old-skill" && entry.fields.supersededByCandidateId === "new-skill",
      )?.fields.state,
    ).toBe("deprecated");
    expect(
      updates.find(
        (entry) => entry.id === "old-skill" && entry.fields.supersededByCandidateId === "new-skill",
      )?.fields.supersededByCandidateId,
    ).toBe("new-skill");
  });

  it("matches promoted personal skills ahead of generic skills", () => {
    const personalMatches = matchPersonalSkillCandidatesForPrompt({
      prompt: "Help me with the podcast publish pipeline and evidence checklist",
      candidates: [
        makeCandidate({
          id: "ps-1",
          title: "Podcast publish checklist",
          summary: "Use the publish checklist before finalizing podcast evidence.",
          triggerPatterns: ["podcast", "publish", "checklist"],
          relatedTools: ["doc_panel"],
          sourceTaskIds: ["task-1"],
          sourceLessonIds: ["lesson-1"],
          evidenceCount: 2,
          recurrenceCount: 2,
          confidence: 0.84,
          state: "promoted",
          procedureOutline: "1. Verify the payload.\n2. Capture evidence.\n3. Publish.",
        }),
      ],
    });

    const merged = mergeMatchedSkills({
      personal: personalMatches,
      generic: [
        {
          name: "podcast-production",
          source: "workspace",
          kind: "generic",
          score: 4.2,
          reasons: ["name:podcast"],
        },
      ],
      limit: 3,
    });

    expect(personalMatches[0]?.kind).toBe("personal");
    expect(merged[0]?.kind).toBe("personal");
    expect(merged[0]?.name).toBe("Podcast publish checklist");
  });

  it("matches incubating personal skills as lower-authority preflight hints", () => {
    const matches = matchPersonalSkillCandidatesForPrompt({
      prompt: "Check whether the gateway is working and verify the newest logs first",
      candidates: [
        makeCandidate({
          id: "ps-incubating",
          title: "Verify whether something is working",
          summary: "Verify process state, endpoint health, and newest logs before answering.",
          triggerPatterns: ["working", "verify", "logs"],
          relatedTools: ["exec"],
          sourceMemoryIds: ["mem-1"],
          evidenceCount: 1,
          recurrenceCount: 1,
          confidence: 0.8,
          state: "incubating",
          procedureOutline:
            "1. Check process state.\n2. Check the endpoint.\n3. Read the newest logs.",
        }),
      ],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe("personal");
    expect(matches[0]?.id).toBe("ps-incubating");
  });

  it("reinforces a matched personal skill when the run succeeds with related tools", async () => {
    const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const candidate = makeCandidate({
      id: "ps-1",
      title: "Verify deployment before reporting",
      summary: "Check the deployment and capture evidence before replying.",
      relatedTools: ["doc_panel", "vercel_deploy"],
      confidence: 0.7,
      strength: 0.55,
      state: "promoted",
    });
    const memory = {
      listPersonalSkillCandidates: async () => [candidate],
      updatePersonalSkillCandidate: async (id: string, fields: Record<string, unknown>) => {
        updates.push({ id, fields });
        return candidate;
      },
      createPersonalSkillReviewEvent: async () => ({
        id: "review-3",
        candidateId: "ps-1",
        agentId: "main",
        actorType: "system" as const,
        action: "usage_reinforced" as const,
        reason: null,
        details: {},
        createdAt: "2026-04-15T12:00:00.000Z",
      }),
    } as unknown as MemoryAdapter;

    await recordPersonalSkillUsage({
      memory,
      matches: [
        {
          id: "ps-1",
          name: candidate.title,
          source: "personal",
          kind: "personal",
          score: 8,
          reasons: ["name:deploy"],
        },
      ],
      executedTools: ["vercel_deploy"],
      runSucceeded: true,
      now: "2026-04-15T12:00:00.000Z",
    });

    expect(updates[0]?.fields.successCount).toBe(1);
    expect(updates[0]?.fields.usageCount).toBe(1);
    expect(Number(updates[0]?.fields.confidence)).toBeGreaterThan(candidate.confidence);
    expect(Number(updates[0]?.fields.strength)).toBeGreaterThan(candidate.strength);
    expect(updates[0]?.fields.lastReinforcedAt).toBe("2026-04-15T12:00:00.000Z");
  });

  it("builds a prompt block for matched personal skills", () => {
    const candidate = makeCandidate({
      id: "ps-1",
      title: "Verify deployment before reporting",
      summary: "Check the deployment and capture evidence before replying.",
      triggerPatterns: ["deploy", "deployment", "report"],
      relatedTools: ["vercel_deploy", "doc_panel"],
      sourceTaskIds: ["task-1"],
      evidenceCount: 1,
      recurrenceCount: 2,
      confidence: 0.79,
      state: "promoted",
      procedureOutline:
        "1. Check the deployment.\n2. Capture evidence.\n3. Report only verified state.",
    });

    const block = buildMatchedPersonalSkillsContextBlock({
      matches: [
        {
          id: "ps-1",
          name: candidate.title,
          source: "personal",
          kind: "personal",
          score: 8.4,
          confidence: candidate.confidence,
          provenanceCount: 1,
          reasons: ["name:deploy"],
        },
      ],
      candidates: [candidate],
    });

    expect(block).toContain("## Active Personal Skills");
    expect(block).toContain(candidate.title);
    expect(block).toContain("Check them before improvising");
    expect(block).toContain("State: promoted");
  });

  it("selects an executable personal skill when steps and preconditions fit the prompt", () => {
    const candidate = makeCandidate({
      id: "ps-1",
      title: "Deploy landing page",
      summary: "Deploy the landing page using the verified sequence.",
      triggerPatterns: ["deploy", "landing page"],
      preconditions: ["deploy landing page"],
      executionSteps: ["Run the deploy command", "Verify the deployment", "Capture evidence"],
      state: "promoted",
    });

    const selected = selectExecutablePersonalSkill({
      prompt: "Please deploy the landing page and verify it.",
      matches: [
        {
          id: "ps-1",
          name: candidate.title,
          source: "personal",
          kind: "personal",
          score: 9.1,
          reasons: ["name:deploy"],
        },
      ],
      candidates: [candidate],
    });

    const block = buildExecutablePersonalSkillContextBlock(selected);
    expect(selected?.id).toBe("ps-1");
    expect(block).toContain("## Personal Skill Procedure Mode");
    expect(block).toContain("Execution steps:");
    expect(block).toContain("Run the deploy command");
  });

  it("flags contradictory promoted skills for reevaluation", async () => {
    const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const candidates = [
      makeCandidate({
        id: "skill-a",
        title: "Deploy landing page",
        summary: "Use Vercel to deploy the landing page.",
        triggerPatterns: ["deploy", "landing page"],
        relatedTools: ["vercel_deploy"],
        expectedOutcomes: ["Landing page is deployed through Vercel"],
        sourceTaskIds: ["task-a"],
        evidenceCount: 1,
        recurrenceCount: 2,
        confidence: 0.84,
        strength: 0.7,
        state: "promoted",
      }),
      makeCandidate({
        id: "skill-b",
        title: "Deploy landing page",
        summary: "Do not use Vercel; deploy the landing page through Railway.",
        triggerPatterns: ["deploy", "landing page"],
        relatedTools: ["railway_deploy"],
        expectedOutcomes: ["Landing page is deployed through Railway"],
        sourceTaskIds: ["task-b"],
        evidenceCount: 1,
        recurrenceCount: 2,
        confidence: 0.81,
        strength: 0.68,
        state: "promoted",
      }),
    ];
    const memory = {
      listPersonalSkillCandidates: async () => candidates,
      updatePersonalSkillCandidate: async (id: string, fields: Record<string, unknown>) => {
        updates.push({ id, fields });
        return candidates.find((candidate) => candidate.id === id) ?? null;
      },
      createPersonalSkillReviewEvent: async () => ({
        id: "review-4",
        candidateId: "skill-a",
        agentId: "main",
        actorType: "system" as const,
        action: "conflict_detected" as const,
        reason: null,
        details: {},
        createdAt: "2026-04-15T12:00:00.000Z",
      }),
    } as unknown as MemoryAdapter;

    const result = await reviewPersonalSkillCandidates({ memory, now: "2026-04-15T12:00:00.000Z" });

    expect(result.contradictions).toBeGreaterThan(0);
    const contradictionUpdate = updates.find(
      (entry) => entry.id === "skill-a" && Array.isArray(entry.fields.conflictsWithCandidateIds),
    );
    expect(contradictionUpdate?.fields.conflictsWithCandidateIds).toContain("skill-b");
    expect(contradictionUpdate?.fields.lastContradictedAt).toBe("2026-04-15T12:00:00.000Z");
  });

  it("does not immediately demote an intentionally incubating procedural skill during review", async () => {
    const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const candidate = makeCandidate({
      id: "ps-authored",
      title: "Verify Service Health Before Answering",
      summary: "Verify process state, endpoint health, and newest logs before answering.",
      executionSteps: [
        "Identify the specific service being asked about.",
        "Check live process state.",
        "Probe the relevant health endpoint.",
        "Read the newest logs.",
      ],
      expectedOutcomes: ["Evidence-backed service-health answer."],
      confidence: 0.75,
      strength: 0.55,
      state: "incubating",
      evidenceCount: 1,
      recurrenceCount: 1,
    });

    const memory = {
      listPersonalSkillCandidates: async () => [candidate],
      updatePersonalSkillCandidate: async (id: string, fields: Record<string, unknown>) => {
        updates.push({ id, fields });
        return { ...candidate, ...fields };
      },
      createPersonalSkillReviewEvent: async () => ({
        id: "review-authored",
        candidateId: "ps-authored",
        agentId: "main",
        actorType: "system" as const,
        action: "demoted" as const,
        reason: null,
        details: {},
        createdAt: "2026-04-18T01:05:20.000Z",
      }),
    } as unknown as MemoryAdapter;

    await reviewPersonalSkillCandidates({
      memory,
      now: "2026-04-18T01:05:20.000Z",
    });

    expect(
      updates.find((entry) => entry.id === "ps-authored" && entry.fields.state === "candidate"),
    ).toBeUndefined();
  });

  it("rehabilitates an authored procedural candidate back to incubating", async () => {
    const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const candidate = makeCandidate({
      id: "ps-recover",
      title: "Verify Service Health Before Answering",
      summary: "Verify process state, endpoint health, and newest logs before answering.",
      executionSteps: [
        "Identify the specific service being asked about.",
        "Check live process state.",
        "Probe the relevant health endpoint.",
        "Read the newest logs.",
      ],
      expectedOutcomes: ["Evidence-backed service-health answer."],
      confidence: 0.75,
      strength: 0.55,
      state: "candidate",
      evidenceCount: 1,
      recurrenceCount: 1,
    });

    const memory = {
      listPersonalSkillCandidates: async () => [candidate],
      listPersonalSkillReviewEvents: async () => [
        {
          id: "review-authored",
          candidateId: "ps-recover",
          agentId: "main",
          actorType: "system" as const,
          action: "authored" as const,
          reason: "created intentionally",
          details: {},
          createdAt: "2026-04-18T01:04:35.000Z",
        },
      ],
      updatePersonalSkillCandidate: async (id: string, fields: Record<string, unknown>) => {
        updates.push({ id, fields });
        return { ...candidate, ...fields };
      },
      createPersonalSkillReviewEvent: async () => ({
        id: "review-recovered",
        candidateId: "ps-recover",
        agentId: "main",
        actorType: "system" as const,
        action: "demoted" as const,
        reason: null,
        details: {},
        createdAt: "2026-04-18T01:15:00.000Z",
      }),
    } as unknown as MemoryAdapter;

    await reviewPersonalSkillCandidates({
      memory,
      now: "2026-04-18T01:15:00.000Z",
    });

    expect(
      updates.find((entry) => entry.id === "ps-recover" && entry.fields.state === "incubating"),
    ).toBeDefined();
  });
});
