import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPersonalSkillTool } from "./personal-skill-tool.js";

const scopedMemory = {
  listPersonalSkillCandidates: vi.fn(),
  createPersonalSkillCandidate: vi.fn(),
  updatePersonalSkillCandidate: vi.fn(),
  createPersonalSkillReviewEvent: vi.fn(),
};

const getMemoryAdapterMock = vi.fn();

vi.mock("../../data/storage-factory.js", () => ({
  getMemoryAdapter: () => getMemoryAdapterMock(),
}));

describe("personal_skill tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMemoryAdapterMock.mockResolvedValue({
      withAgentId: vi.fn(() => scopedMemory),
    });
    scopedMemory.listPersonalSkillCandidates.mockResolvedValue([]);
    scopedMemory.createPersonalSkillCandidate.mockResolvedValue(null);
    scopedMemory.updatePersonalSkillCandidate.mockResolvedValue(null);
    scopedMemory.createPersonalSkillReviewEvent.mockResolvedValue(null);
  });

  it("lists personal skills for the scoped agent", async () => {
    scopedMemory.listPersonalSkillCandidates.mockResolvedValue([
      {
        id: "ps-1",
        title: "Verify whether something is working",
        summary: "Check process state, endpoint health, and newest logs.",
        state: "promoted",
        confidence: 1,
        strength: 1,
        usageCount: 3,
        successCount: 3,
        failureCount: 0,
      },
    ]);

    const tool = createPersonalSkillTool({ agentId: "argent" });
    const result = await tool.execute("call-1", { action: "list", limit: 5 }, undefined, undefined);
    const text = result.content.find((block) => block.type === "text")?.text ?? "";

    expect(text).toContain("Verify whether something is working");
    expect(scopedMemory.listPersonalSkillCandidates).toHaveBeenCalledWith({
      state: undefined,
      limit: 5,
    });
  });

  it("creates an incubating personal skill with a review event", async () => {
    scopedMemory.createPersonalSkillCandidate.mockResolvedValue({
      id: "ps-2",
      title: "Gateway verification procedure",
      summary: "Verify process, port, and logs before answering.",
      state: "incubating",
    });

    const tool = createPersonalSkillTool({ agentId: "argent" });
    await tool.execute(
      "call-2",
      {
        action: "create",
        title: "Gateway verification procedure",
        summary: "Verify process, port, and logs before answering.",
        executionSteps: ["Check process state", "Check canonical port", "Read newest logs"],
        expectedOutcomes: ["Correct live service status"],
      },
      undefined,
      undefined,
    );

    expect(scopedMemory.createPersonalSkillCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Gateway verification procedure",
        state: "incubating",
        confidence: 0.75,
        strength: 0.55,
        executionSteps: ["Check process state", "Check canonical port", "Read newest logs"],
      }),
    );
    expect(scopedMemory.createPersonalSkillReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: "ps-2",
        actorType: "system",
        action: "authored",
      }),
    );
  });

  it("patches an existing personal skill and records the patch", async () => {
    scopedMemory.updatePersonalSkillCandidate.mockResolvedValue({
      id: "ps-3",
      title: "Gateway verification procedure",
      summary: "Verify the right service before answering.",
      state: "incubating",
    });

    const tool = createPersonalSkillTool({ agentId: "argent" });
    await tool.execute(
      "call-3",
      {
        action: "patch",
        id: "ps-3",
        summary: "Verify the right service before answering.",
        relatedTools: ["exec"],
      },
      undefined,
      undefined,
    );

    expect(scopedMemory.updatePersonalSkillCandidate).toHaveBeenCalledWith(
      "ps-3",
      expect.objectContaining({
        summary: "Verify the right service before answering.",
        relatedTools: ["exec"],
      }),
    );
    expect(scopedMemory.createPersonalSkillReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: "ps-3",
        actorType: "system",
        action: "patched",
      }),
    );
  });
});
