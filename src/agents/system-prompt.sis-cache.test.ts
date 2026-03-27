import { beforeEach, describe, expect, it, vi } from "vitest";

const listLessonsMock = vi.fn();

vi.mock("../data/storage-factory.js", () => ({
  getMemoryAdapter: async () => ({
    listLessons: listLessonsMock,
  }),
}));

describe("buildAgentSystemPrompt SIS cache", () => {
  beforeEach(() => {
    vi.resetModules();
    listLessonsMock.mockReset();
  });

  it("reuses cached SIS lesson lookups across prompt builds", async () => {
    listLessonsMock.mockResolvedValue([
      {
        id: "lesson-1",
        type: "success",
        lesson: "Be explicit about follow-up state.",
        confidence: 0.9,
        occurrences: 3,
        relatedTools: [],
      },
    ]);

    const mod = await import("./system-prompt.js");
    mod.clearPromptSisLessonsCache();

    const first = await mod.buildAgentSystemPrompt({
      workspaceDir: "/tmp/argent",
      sessionKey: "agent:argent:webchat",
    });
    const second = await mod.buildAgentSystemPrompt({
      workspaceDir: "/tmp/argent",
      sessionKey: "agent:argent:webchat",
    });

    expect(first).toContain("## Lessons from Experience");
    expect(second).toContain("Be explicit about follow-up state.");
    expect(listLessonsMock).toHaveBeenCalledTimes(1);
  });

  it("runs SIS lesson lookup again after cache clear", async () => {
    listLessonsMock.mockResolvedValue([
      {
        id: "lesson-1",
        type: "success",
        lesson: "Be explicit about follow-up state.",
        confidence: 0.9,
        occurrences: 3,
        relatedTools: [],
      },
    ]);

    const mod = await import("./system-prompt.js");
    mod.clearPromptSisLessonsCache();

    await mod.buildAgentSystemPrompt({
      workspaceDir: "/tmp/argent",
      sessionKey: "agent:argent:webchat",
    });
    mod.clearPromptSisLessonsCache();
    await mod.buildAgentSystemPrompt({
      workspaceDir: "/tmp/argent",
      sessionKey: "agent:argent:webchat",
    });

    expect(listLessonsMock).toHaveBeenCalledTimes(2);
  });
});
