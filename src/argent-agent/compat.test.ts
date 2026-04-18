import { describe, expect, it } from "vitest";
import { piContextToArgentRequest, piMessageToArgentResponse } from "./compat.js";

describe("piContextToArgentRequest", () => {
  it("tolerates tool results with missing content", () => {
    const request = piContextToArgentRequest({
      systemPrompt: "test",
      messages: [
        {
          role: "user",
          content: "Run a build",
        },
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tool-1",
              name: "exec",
              arguments: { command: "pnpm build", background: true },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "exec",
          timestamp: Date.now(),
        },
      ],
      tools: [],
    } as any);

    expect(request.messages).toEqual([
      { role: "user", content: "Run a build" },
      {
        role: "assistant",
        content: "",
        text: "",
        toolCalls: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "exec",
            arguments: { command: "pnpm build", background: true },
          },
        ],
      },
      {
        role: "tool",
        content: "",
        toolCallId: "tool-1",
      },
    ]);
  });
});

describe("piMessageToArgentResponse", () => {
  it("tolerates assistant messages with missing content", () => {
    const response = piMessageToArgentResponse({
      role: "assistant",
      content: undefined as any,
      api: "openai-completions",
      provider: "openai",
      model: "gpt-5.4",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: "provider exploded",
      timestamp: Date.now(),
    } as any);

    expect(response.text).toBe("");
    expect(response.thinking).toBeUndefined();
    expect(response.toolCalls).toEqual([]);
    expect(response.errorMessage).toBe("provider exploded");
  });
});
