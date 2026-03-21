import { describe, expect, it } from "vitest";
import * as core from "./core.js";

describe("agent-core/core export surface", () => {
  it("exports required runtime symbols", () => {
    expect(typeof core.Agent).toBe("function");
    expect(typeof core.createAgent).toBe("function");
    expect(typeof core.agentLoop).toBe("function");
    expect(typeof core.streamProxy).toBe("function");

    expect(typeof core.ToolRegistry).toBe("function");
    expect(typeof core.executeToolCall).toBe("function");

    expect(typeof core.Session).toBe("function");
    expect(typeof core.SessionStore).toBe("function");
    expect(typeof core.compactMessages).toBe("function");
    expect(typeof core.needsCompaction).toBe("function");
    expect(typeof core.estimateTextTokens).toBe("function");
    expect(typeof core.estimateMessageTokens).toBe("function");
  });
});
