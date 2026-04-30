import { describe, expect, it } from "vitest";
import type { PersonalSkillCandidate } from "../../memory/memu-types.js";
import { buildWorkflowPersonalSkillCapabilitiesFromCandidates } from "./skills.js";

function candidate(overrides: Partial<PersonalSkillCandidate>): PersonalSkillCandidate {
  return {
    id: "skill-1",
    agentId: "main",
    operatorId: null,
    profileId: null,
    scope: "operator",
    title: "Post launch update",
    summary: "Draft and publish a launch update.",
    triggerPatterns: ["launch update"],
    procedureOutline: null,
    preconditions: ["Campaign brief exists"],
    executionSteps: ["Draft post", "Queue approval", "Publish"],
    expectedOutcomes: ["Launch post is ready"],
    relatedTools: ["social-post", "email-send"],
    sourceMemoryIds: [],
    sourceEpisodeIds: [],
    sourceTaskIds: [],
    sourceLessonIds: [],
    supersedesCandidateIds: [],
    supersededByCandidateId: null,
    conflictsWithCandidateIds: [],
    contradictionCount: 0,
    evidenceCount: 3,
    recurrenceCount: 2,
    confidence: 0.9,
    strength: 0.8,
    usageCount: 4,
    successCount: 4,
    failureCount: 0,
    state: "promoted",
    operatorNotes: null,
    lastReviewedAt: null,
    lastUsedAt: null,
    lastReinforcedAt: null,
    lastContradictedAt: null,
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-25T01:00:00.000Z",
    ...overrides,
  };
}

describe("buildWorkflowPersonalSkillCapabilitiesFromCandidates", () => {
  it("surfaces promoted personal skills and related tools for workflow capabilities", () => {
    const result = buildWorkflowPersonalSkillCapabilitiesFromCandidates("main", [
      candidate({ id: "skill-1" }),
      candidate({
        id: "skill-2",
        title: "Draft newsletter",
        relatedTools: ["email-send", "newsletter-cli"],
        updatedAt: "2026-04-25T02:00:00.000Z",
      }),
      candidate({
        id: "draft-only",
        state: "incubating",
        relatedTools: ["should-not-surface"],
      }),
      candidate({
        id: "visual-only",
        executionSteps: [],
        relatedTools: ["should-not-surface-either"],
      }),
    ]);

    expect(result.agentId).toBe("main");
    expect(result.personalSkills.map((skill) => skill.name)).toEqual([
      "skill:skill-2",
      "skill:skill-1",
    ]);
    expect(result.promotedTools.map((tool) => tool.name)).toEqual([
      "email-send",
      "newsletter-cli",
      "social-post",
    ]);
    expect(result.promotedTools.find((tool) => tool.name === "email-send")).toMatchObject({
      source: "promoted-cli",
      skillIds: ["skill-1", "skill-2"],
      governance: {
        mode: "ask",
        approvalBacked: false,
      },
    });
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "skill:skill-2",
      "skill:skill-1",
      "email-send",
      "newsletter-cli",
      "social-post",
    ]);
  });
});
