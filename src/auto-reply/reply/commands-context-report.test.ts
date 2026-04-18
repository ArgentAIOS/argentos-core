import { describe, expect, it } from "vitest";
import type { SessionSystemPromptReport } from "../../config/sessions/types.js";
import type { HandleCommandsParams } from "./commands-types.js";
import { buildContextReply } from "./commands-context-report.js";

function makeParams(
  commandBodyNormalized: string,
  report: Partial<SessionSystemPromptReport>,
): HandleCommandsParams {
  return {
    ctx: {} as HandleCommandsParams["ctx"],
    cfg: {} as HandleCommandsParams["cfg"],
    command: {
      surface: "webchat",
      channel: "webchat",
      ownerList: [],
      senderIsOwner: true,
      isAuthorizedSender: true,
      rawBodyNormalized: commandBodyNormalized,
      commandBodyNormalized,
    },
    directives: {},
    elevated: { enabled: false, allowed: false, failures: [] },
    sessionEntry: {
      sessionId: "session-1",
      updatedAt: Date.now(),
      systemPromptReport: {
        source: "run",
        generatedAt: Date.now(),
        systemPrompt: {
          chars: 10,
          projectContextChars: 0,
          nonProjectContextChars: 10,
        },
        injectedWorkspaceFiles: [],
        skills: {
          promptChars: 0,
          entries: [],
        },
        tools: {
          listChars: 0,
          schemaChars: 0,
          entries: [],
        },
        ...report,
      },
    },
    sessionKey: "agent:argent:main",
    workspaceDir: "/tmp",
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "test",
    model: "test-model",
    contextTokens: 0,
    isGroup: false,
  };
}

describe("buildContextReply", () => {
  it("tolerates sparse tool and skill entries in stored reports", async () => {
    const params = makeParams("/context detail", {
      skills: {
        promptChars: 12,
        entries: [] as never[],
      },
      tools: {
        listChars: 24,
        schemaChars: 48,
      } as SessionSystemPromptReport["tools"],
    });

    const result = await buildContextReply(params);

    expect(result.text).toContain("Context breakdown (detailed)");
    expect(result.text).toContain("Tools: (none)");
    expect(result.text).not.toContain("undefined");
  });
});
