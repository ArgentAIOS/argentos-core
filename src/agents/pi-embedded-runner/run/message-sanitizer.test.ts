import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../../agent-core/core.js";
import { sanitizeMessagesForModelAdapter } from "./message-sanitizer.js";

describe("sanitizeMessagesForModelAdapter", () => {
  it("repairs malformed tool results before provider adapters see them", () => {
    const result = sanitizeMessagesForModelAdapter([
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_1",
            name: "exec",
            arguments: { command: "ls" },
          },
        ],
        stopReason: "toolUse",
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "exec",
        details: { status: "completed" },
        isError: false,
        timestamp: Date.now(),
      },
    ] as AgentMessage[]);

    expect(result.changed).toBe(true);
    expect(result.repairs).toContain("repaired tool result with missing content");
    expect(result.messages[1]).toMatchObject({
      role: "toolResult",
      content: [{ type: "text", text: '{"status":"completed"}' }],
    });
  });

  it("drops invalid tool results that cannot be matched to a tool call", () => {
    const result = sanitizeMessagesForModelAdapter([
      {
        role: "toolResult",
        toolName: "exec",
        content: [{ type: "text", text: "done" }],
        isError: false,
        timestamp: Date.now(),
      },
    ] as AgentMessage[]);

    expect(result.changed).toBe(true);
    expect(result.messages).toHaveLength(0);
    expect(result.repairs).toContain("dropped tool result with missing toolCallId");
  });

  it("normalizes compaction summaries into user context messages", () => {
    const result = sanitizeMessagesForModelAdapter([
      {
        role: "compactionSummary",
        summary: "The operator configured Telegram and needs the final verification step.",
      },
    ] as unknown as AgentMessage[]);

    expect(result.changed).toBe(true);
    expect(result.repairs).toContain("normalized summary message role: compactionSummary");
    expect(result.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Previous conversation summary:\n\n" +
              "The operator configured Telegram and needs the final verification step.",
          },
        ],
      },
    ]);
  });
});
