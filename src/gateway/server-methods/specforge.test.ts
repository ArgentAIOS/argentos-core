import { describe, expect, it, vi, beforeEach } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { specforgeHandlers } from "./specforge.js";

// Mock dependencies
vi.mock("../../infra/specforge-conductor.js", () => ({
  maybeKickoffSpecforgeFromMessage: vi.fn(),
}));

vi.mock("../../agent-core/ai.js", () => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(),
}));

vi.mock("../../models/router.js", () => ({
  routeModel: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    agents: { defaults: { modelRouter: {} } },
  })),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveSessionAgentIds: vi.fn(() => ({
    sessionAgentId: "test-agent",
    activeTargetId: "test-agent",
  })),
}));

describe("specforge gateway handlers", () => {
  let respond: any;

  beforeEach(() => {
    vi.clearAllMocks();
    respond = vi.fn();
  });

  describe("specforge.suggest", () => {
    it("should return an error if field is missing", async () => {
      const handler = specforgeHandlers["specforge.suggest"];
      if (!handler) throw new Error("Handler not found");

      await handler({ params: {}, respond } as any);

      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
      );
    });

    it("should call completeSimple and return suggestion", async () => {
      const handler = specforgeHandlers["specforge.suggest"];
      if (!handler) throw new Error("Handler not found");

      const { routeModel } = await import("../../models/router.js");
      const { getModel, completeSimple } = await import("../../agent-core/ai.js");

      vi.mocked(routeModel).mockReturnValue({
        provider: "anthropic",
        model: "claude-3-5-haiku-latest",
        tier: "fast",
        score: 0.1,
      });
      vi.mocked(getModel).mockReturnValue({} as any);
      vi.mocked(completeSimple).mockResolvedValue({
        content: [{ type: "text", text: "This is a great suggestion." }],
      } as any);

      await handler({
        params: { field: "problem", currentData: { title: "Test Project" } },
        respond,
      } as any);

      expect(completeSimple).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith(
        true,
        { suggestion: "This is a great suggestion." },
        undefined,
      );
    });
  });

  describe("specforge.kickoff", () => {
    it("should return an error if title is missing", async () => {
      const handler = specforgeHandlers["specforge.kickoff"];
      if (!handler) throw new Error("Handler not found");

      await handler({ params: { data: {} }, respond } as any);

      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
      );
    });

    it("should trigger kickoff and return result", async () => {
      const handler = specforgeHandlers["specforge.kickoff"];
      if (!handler) throw new Error("Handler not found");

      const { maybeKickoffSpecforgeFromMessage } =
        await import("../../infra/specforge-conductor.js");
      vi.mocked(maybeKickoffSpecforgeFromMessage).mockResolvedValue({
        triggered: true,
        started: true,
        reused: false,
        summary: "Project kicked off.",
      } as any);

      await handler({
        params: { data: { title: "New Project", problem: "Issue" }, sessionKey: "test-session" },
        respond,
      } as any);

      expect(maybeKickoffSpecforgeFromMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKey: "test-session",
          agentId: "test-agent",
        }),
      );
      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({ started: true }),
        undefined,
      );
    });
  });
});
