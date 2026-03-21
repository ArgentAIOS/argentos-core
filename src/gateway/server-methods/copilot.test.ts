import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStorageAdapter: vi.fn(),
  getAgentFamily: vi.fn(),
  readCopilotState: vi.fn(),
  getCopilotAccessMode: vi.fn(),
  setCopilotAccessMode: vi.fn(),
}));

vi.mock("../../data/storage-factory.js", () => ({
  getStorageAdapter: mocks.getStorageAdapter,
}));

vi.mock("../../data/agent-family.js", () => ({
  getAgentFamily: mocks.getAgentFamily,
}));

vi.mock("../../agents/copilot-state.js", () => ({
  readCopilotState: mocks.readCopilotState,
  getCopilotAccessMode: mocks.getCopilotAccessMode,
  setCopilotAccessMode: mocks.setCopilotAccessMode,
}));

import { copilotHandlers } from "./copilot.js";

describe("copilotHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCopilotState.mockResolvedValue({
      accessModes: { intent: "assist-draft", workforce: "assist-propose" },
      intentHistory: [{ id: "h1" }],
    });
    mocks.getCopilotAccessMode.mockResolvedValue("assist-draft");
    mocks.setCopilotAccessMode.mockResolvedValue({});
    mocks.getAgentFamily.mockResolvedValue({
      listMembers: vi.fn().mockResolvedValue([{ id: "relay" }]),
    });
    mocks.getStorageAdapter.mockResolvedValue({
      jobs: {
        listTemplates: vi.fn().mockResolvedValue([{ id: "t1" }]),
        listAssignments: vi.fn().mockResolvedValue([{ id: "a1", enabled: true }]),
        listRuns: vi
          .fn()
          .mockResolvedValue([{ id: "r1", status: "completed", startedAt: Date.now() }]),
        getAssignment: vi.fn().mockResolvedValue({ id: "a1" }),
        getTemplate: vi.fn().mockResolvedValue({ id: "t1" }),
        getContextForTask: vi.fn().mockResolvedValue({ task: { id: "task-1", status: "running" } }),
        listEvents: vi.fn().mockResolvedValue([]),
      },
    });
  });

  it("returns copilot overview", async () => {
    const respond = vi.fn();
    await copilotHandlers["copilot.overview"]({
      params: {},
      respond,
      req: { type: "req", id: "1", method: "copilot.overview" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        intentHistoryCount: 1,
        domains: expect.any(Array),
      }),
      undefined,
    );
  });

  it("sets domain mode", async () => {
    const respond = vi.fn();
    await copilotHandlers["copilot.mode.set"]({
      params: { domain: "workforce", mode: "assist-live-limited" },
      respond,
      req: { type: "req", id: "2", method: "copilot.mode.set" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(mocks.setCopilotAccessMode).toHaveBeenCalledWith("workforce", "assist-live-limited");
    expect(respond).toHaveBeenCalledWith(
      true,
      { domain: "workforce", mode: "assist-live-limited" },
      undefined,
    );
  });

  it("returns workforce overview", async () => {
    const respond = vi.fn();
    await copilotHandlers["copilot.workforce.overview"]({
      params: {},
      respond,
      req: { type: "req", id: "3", method: "copilot.workforce.overview" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        templatesCount: 1,
        assignmentsCount: 1,
      }),
      undefined,
    );
  });
});
