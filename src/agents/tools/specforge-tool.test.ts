import { describe, expect, it } from "vitest";
import { createSpecforgeTool } from "./specforge-tool.js";

describe("specforge tool", () => {
  it("starts the strict guide workflow for project-build requests", async () => {
    const tool = createSpecforgeTool({
      agentSessionKey: "agent:argent:main:tool-test",
      agentId: "argent",
    });

    const result = await tool.execute("call-specforge", {
      action: "handle",
      message: "I want to build a project",
    });
    const details = result.details as {
      ok?: boolean;
      triggered?: boolean;
      started?: boolean;
      reason?: string;
      guidance?: string;
    };

    expect(details.ok).toBe(true);
    expect(details.triggered).toBe(true);
    expect(details.started).toBe(true);
    expect(details.reason).toBe("guide_mode_started_strict");
    expect(details.guidance).toContain("GREENFIELD");
    expect(details.guidance).toContain("BROWNFIELD");
  });

  it("returns status for the active SpecForge session", async () => {
    const tool = createSpecforgeTool({
      agentSessionKey: "agent:argent:main:tool-status-test",
      agentId: "argent",
    });

    await tool.execute("call-specforge", {
      action: "handle",
      message: "I need to build a new coding project",
    });
    const result = await tool.execute("call-specforge-status", {
      action: "status",
    });
    const details = result.details as {
      ok?: boolean;
      active?: boolean;
      stage?: string;
    };

    expect(details.ok).toBe(true);
    expect(details.active).toBe(true);
    expect(details.stage).toBe("project_type_gate");
  });
});
