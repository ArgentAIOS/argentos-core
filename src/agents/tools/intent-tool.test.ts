import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadConfig = vi.fn();
const mockWriteConfigFile = vi.fn();
const mockGetCopilotAccessMode = vi.fn();
const mockSetCopilotAccessMode = vi.fn();
const mockReadCopilotState = vi.fn();
const mockAppendIntentHistory = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: mockLoadConfig,
  writeConfigFile: mockWriteConfigFile,
}));

vi.mock("../copilot-state.js", () => ({
  getCopilotAccessMode: mockGetCopilotAccessMode,
  setCopilotAccessMode: mockSetCopilotAccessMode,
  readCopilotState: mockReadCopilotState,
  appendIntentHistory: mockAppendIntentHistory,
}));

describe("intent_tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({
      intent: {
        enabled: true,
        validationMode: "warn",
        runtimeMode: "advisory",
        global: { objective: "Protect trust." },
        departments: {},
        agents: {},
      },
    });
    mockReadCopilotState.mockResolvedValue({
      accessModes: { intent: "assist-draft" },
      intentHistory: [],
    });
    mockGetCopilotAccessMode.mockResolvedValue("assist-draft");
    mockSetCopilotAccessMode.mockResolvedValue({});
    mockAppendIntentHistory.mockResolvedValue({ id: "h1" });
  });

  it("returns overview with intent mode and issue counts", async () => {
    const { createIntentTool } = await import("./intent-tool.js");
    const tool = createIntentTool();
    const result = await tool.execute({ action: "overview" });
    expect(result.details).toMatchObject({
      accessMode: "assist-draft",
      intentEnabled: true,
      validationMode: "warn",
      runtimeMode: "advisory",
    });
  });

  it("updates and reads intent access mode", async () => {
    const { createIntentTool } = await import("./intent-tool.js");
    const tool = createIntentTool();
    const setResult = await tool.execute({
      action: "access_mode_set",
      mode: "assist-propose",
    });
    expect(mockSetCopilotAccessMode).toHaveBeenCalledWith("intent", "assist-propose");
    expect(setResult.details).toMatchObject({ mode: "assist-propose" });

    mockGetCopilotAccessMode.mockResolvedValueOnce("assist-propose");
    const getResult = await tool.execute({ action: "access_mode_get" });
    expect(getResult.details).toMatchObject({ mode: "assist-propose" });
  });

  it("blocks apply when access mode is draft-only", async () => {
    const { createIntentTool } = await import("./intent-tool.js");
    const tool = createIntentTool();
    await expect(
      tool.execute({
        action: "apply",
        proposedIntent: {
          enabled: true,
          global: { objective: "x" },
        },
      }),
    ).rejects.toThrow(/blocked by access mode/);
  });

  it("applies valid intent in assist-live-limited mode", async () => {
    mockGetCopilotAccessMode.mockResolvedValue("assist-live-limited");
    const { createIntentTool } = await import("./intent-tool.js");
    const tool = createIntentTool();
    const result = await tool.execute({
      action: "apply",
      actor: "ai-assisted",
      reason: "test",
      proposedIntent: {
        enabled: true,
        validationMode: "warn",
        runtimeMode: "advisory",
        global: { objective: "Keep trust." },
        departments: {},
        agents: {},
      },
    });
    expect(mockWriteConfigFile).toHaveBeenCalledTimes(1);
    expect(mockAppendIntentHistory).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({ applied: true });
  });
});
