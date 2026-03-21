import { describe, expect, test } from "vitest";
import {
  sanitizeAssistantDisplayText,
  sanitizeChatHistoryMessages,
  stripEnvelopeFromMessage,
} from "./chat-sanitize.js";

describe("stripEnvelopeFromMessage", () => {
  test("removes message_id hint lines from user messages", () => {
    const input = {
      role: "user",
      content: "[WhatsApp 2026-01-24 13:36] yolo\n[message_id: 7b8b]",
    };
    const result = stripEnvelopeFromMessage(input) as { content?: string };
    expect(result.content).toBe("yolo");
  });

  test("removes message_id hint lines from text content arrays", () => {
    const input = {
      role: "user",
      content: [{ type: "text", text: "hi\n[message_id: abc123]" }],
    };
    const result = stripEnvelopeFromMessage(input) as {
      content?: Array<{ type: string; text?: string }>;
    };
    expect(result.content?.[0]?.text).toBe("hi");
  });

  test("does not strip inline message_id text that is part of a line", () => {
    const input = {
      role: "user",
      content: "I typed [message_id: 123] on purpose",
    };
    const result = stripEnvelopeFromMessage(input) as { content?: string };
    expect(result.content).toBe("I typed [message_id: 123] on purpose");
  });

  test("does not strip assistant messages", () => {
    const input = {
      role: "assistant",
      content: "note\n[message_id: 123]",
    };
    const result = stripEnvelopeFromMessage(input) as { content?: string };
    expect(result.content).toBe("note\n[message_id: 123]");
  });
});

describe("sanitizeAssistantDisplayText", () => {
  test("removes raw tool-action json", () => {
    const input =
      '{"command":"sed -n \\"2440,2585p\\" /tmp/file","workdir":"/tmp","yieldMs":12000,"timeout":25}';
    expect(sanitizeAssistantDisplayText(input)).toBe("");
  });
});

describe("sanitizeChatHistoryMessages", () => {
  test("drops tool results and sanitizes assistant content", () => {
    const result = sanitizeChatHistoryMessages([
      {
        role: "user",
        content: [{ type: "text", text: "[WebChat 2026-03-16 18:00] hello" }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: '[Tool Call: exec (ID: toolu_1)]\nArguments: { "command": "git status" }',
          },
        ],
        timestamp: 2,
      },
      {
        role: "toolResult",
        content: [{ type: "text", text: "secret" }],
        timestamp: 3,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Actual reply." }],
        timestamp: 4,
      },
    ]) as Array<{ role?: string; content?: Array<{ text?: string }>; timestamp?: number }>;

    expect(result).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Actual reply." }],
        timestamp: 4,
      },
    ]);
  });
});
