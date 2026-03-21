import { describe, expect, it } from "vitest";
import * as coding from "./coding.js";

describe("agent-core/coding export surface", () => {
  it("exports required Pi-compat symbols", () => {
    expect(typeof coding.createAgentSession).toBe("function");
    expect(typeof coding.SessionManager).toBe("function");
    expect(typeof coding.SettingsManager).toBe("function");
    expect(typeof coding.CURRENT_SESSION_VERSION).toBe("number");

    expect(typeof coding.createReadTool).toBe("function");
    expect(typeof coding.createWriteTool).toBe("function");
    expect(typeof coding.createEditTool).toBe("function");
    expect(typeof coding.codingTools).toBe("object");
    expect(typeof coding.readTool).toBe("object");

    expect(typeof coding.loadSkillsFromDir).toBe("function");
    expect(typeof coding.formatSkillsForPrompt).toBe("function");
    expect(typeof coding.estimateTokens).toBe("function");
    expect(typeof coding.generateSummary).toBe("function");
  });

  it("exports required Argent-native symbols", () => {
    expect(typeof coding.ArgentSessionManager).toBe("function");
    expect(typeof coding.ArgentSettingsManager).toBe("function");
    expect(typeof coding.createArgentAgentSession).toBe("function");
    expect(typeof coding.argentCreateReadTool).toBe("function");
    expect(typeof coding.argentLoadSkillsFromDir).toBe("function");
  });
});
