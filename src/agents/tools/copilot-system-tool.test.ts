import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetStorageAdapter = vi.fn();
const mockGetAgentFamily = vi.fn();
const mockReadCopilotState = vi.fn();
const mockGetCopilotAccessMode = vi.fn();
const mockSetCopilotAccessMode = vi.fn();

vi.mock("../../data/storage-factory.js", () => ({
  getStorageAdapter: mockGetStorageAdapter,
}));

vi.mock("../../data/agent-family.js", () => ({
  getAgentFamily: mockGetAgentFamily,
}));

vi.mock("../copilot-state.js", () => ({
  readCopilotState: mockReadCopilotState,
  getCopilotAccessMode: mockGetCopilotAccessMode,
  setCopilotAccessMode: mockSetCopilotAccessMode,
}));

describe("copilot_system_tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadCopilotState.mockResolvedValue({
      accessModes: {
        intent: "assist-draft",
        workforce: "assist-propose",
      },
    });
    mockGetCopilotAccessMode.mockResolvedValue("assist-draft");
    mockSetCopilotAccessMode.mockResolvedValue({});
    mockGetAgentFamily.mockResolvedValue({
      listMembers: vi.fn().mockResolvedValue([{ id: "relay", name: "Relay", role: "tier1" }]),
    });
    mockGetStorageAdapter.mockResolvedValue({
      jobs: {
        listTemplates: vi.fn().mockResolvedValue([{ id: "t1", defaultMode: "simulate" }]),
        listAssignments: vi
          .fn()
          .mockResolvedValue([{ id: "a1", enabled: true, nextRunAt: Date.now() + 60000 }]),
        listRuns: vi
          .fn()
          .mockResolvedValue([{ id: "r1", status: "running", startedAt: Date.now() }]),
        getAssignment: vi.fn().mockResolvedValue(null),
        getTemplate: vi.fn().mockResolvedValue(null),
        getContextForTask: vi.fn().mockResolvedValue(null),
        listEvents: vi.fn().mockResolvedValue([]),
        resolveSessionToolPolicyForAssignment: vi.fn().mockResolvedValue({}),
      },
    });
  });

  it("returns system overview", async () => {
    const { createCopilotSystemTool } = await import("./copilot-system-tool.js");
    const tool = createCopilotSystemTool();
    const result = await tool.execute({ action: "overview" });
    expect(
      (result.details as { domains: Array<{ domain: string }> }).domains.length,
    ).toBeGreaterThan(4);
  });

  it("returns workforce overview", async () => {
    const { createCopilotSystemTool } = await import("./copilot-system-tool.js");
    const tool = createCopilotSystemTool();
    const result = await tool.execute({ action: "workforce_overview" });
    expect(result.details).toMatchObject({
      templatesCount: 1,
      assignmentsCount: 1,
      runningCount: 1,
      workersCount: 1,
    });
  });

  it("sets domain access mode", async () => {
    const { createCopilotSystemTool } = await import("./copilot-system-tool.js");
    const tool = createCopilotSystemTool();
    const result = await tool.execute({
      action: "access_mode_set",
      domain: "workforce",
      mode: "assist-live-limited",
    });
    expect(mockSetCopilotAccessMode).toHaveBeenCalledWith("workforce", "assist-live-limited");
    expect(result.details).toMatchObject({
      domain: "workforce",
      mode: "assist-live-limited",
    });
  });
});
