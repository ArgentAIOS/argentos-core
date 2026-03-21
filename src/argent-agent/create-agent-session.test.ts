import { Type } from "@sinclair/typebox";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentMessage, AgentTool } from "./pi-types.js";
import { createArgentAgentSession } from "./create-agent-session.js";
import { ArgentSessionManager } from "./session-manager.js";
import { ArgentSettingsManager } from "./settings-manager.js";

const visionFallbackMocks = vi.hoisted(() => ({
  applyVisionFallbackToMessages: vi.fn(async (messages: Array<Record<string, unknown>>) =>
    messages.map((message) => {
      const content = Array.isArray(message.content) ? message.content : undefined;
      if (!content) {
        return message;
      }
      return {
        ...message,
        content: content.map((block) =>
          block &&
          typeof block === "object" &&
          "type" in block &&
          (block as { type?: string }).type === "image"
            ? { type: "text", text: "[Vision fallback]" }
            : block,
        ),
      };
    }),
  ),
}));

vi.mock("../agents/pi-embedded-runner/run/vision-fallback.js", () => ({
  applyVisionFallbackToMessages: visionFallbackMocks.applyVisionFallbackToMessages,
}));

describe("createArgentAgentSession", () => {
  beforeEach(() => {
    visionFallbackMocks.applyVisionFallbackToMessages.mockClear();
  });

  it("creates a session with defaults", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session, extensionsResult } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
    });

    expect(session).toBeDefined();
    expect(session.agent).toBeDefined();
    expect(session.sessionId).toBeTruthy();
    expect(session.thinkingLevel).toBe("medium");
    expect(session.isStreaming).toBe(false);
    expect(session.messages).toEqual([]);
    expect(extensionsResult.loaded).toEqual([]);
  });

  it("respects provided thinking level", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
      thinkingLevel: "high",
    });

    expect(session.thinkingLevel).toBe("high");
  });

  it("loads existing messages from session manager", async () => {
    const sm = ArgentSessionManager.inMemory();
    sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    } as unknown as AgentMessage);
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "world" }],
    } as unknown as AgentMessage);

    const settings = ArgentSettingsManager.inMemory();
    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
    });

    expect(session.messages.length).toBe(2);
  });

  it("agent.streamFn is replaceable", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
    });

    let called = false;
    session.agent.streamFn = async function* () {
      called = true;
      yield { type: "text", text: "test" };
    };

    // The streamFn was replaced
    const gen = session.agent.streamFn({}, {});
    for await (const _ of gen) {
      /* consume */
    }
    expect(called).toBe(true);
  });

  it("agent.replaceMessages works", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
    });

    const newMessages = [
      { role: "user", content: [{ type: "text", text: "replaced" }] } as unknown as AgentMessage,
    ];
    session.agent.replaceMessages(newMessages);
    expect(session.messages.length).toBe(1);
  });

  it("agent.setSystemPrompt works", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
    });

    session.agent.setSystemPrompt("You are a test agent.");
    expect(session.systemPrompt).toBe("You are a test agent.");
  });

  it("subscribe returns unsubscribe function", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
    });

    const events: unknown[] = [];
    const unsub = session.subscribe((event) => events.push(event));
    expect(typeof unsub).toBe("function");

    unsub();
    // After unsubscribe, events should not be received
  });

  it("dispose prevents further prompts", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
    });

    session.dispose();
    await expect(session.prompt("test")).rejects.toThrow("Session disposed");
  });

  it("setThinkingLevel updates and persists to session manager", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
    });

    session.setThinkingLevel("xhigh");
    expect(session.thinkingLevel).toBe("xhigh");

    // Check it was recorded in the session manager
    const entries = sm.getEntries();
    const thinkingEntry = entries.find((e) => e.type === "thinking_level_change");
    expect(thinkingEntry).toBeDefined();
  });

  it("cycleThinkingLevel cycles through levels", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
      thinkingLevel: "medium",
    });

    const next = session.cycleThinkingLevel();
    expect(next).toBe("high");
    expect(session.thinkingLevel).toBe("high");
  });

  it("message queuing works", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
    });

    await session.steer("steer msg");
    await session.followUp("follow msg");

    expect(session.getSteeringMessages()).toEqual(["steer msg"]);
    expect(session.getFollowUpMessages()).toEqual(["follow msg"]);
    expect(session.pendingMessageCount).toBe(2);

    const cleared = session.clearQueue();
    expect(cleared.steering).toEqual(["steer msg"]);
    expect(cleared.followUp).toEqual(["follow msg"]);
    expect(session.pendingMessageCount).toBe(0);
  });

  it("newSession resets messages", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
    });

    session.agent.replaceMessages([{ role: "user", content: "hello" } as unknown as AgentMessage]);
    expect(session.messages.length).toBe(1);

    await session.newSession();
    expect(session.messages.length).toBe(0);
  });

  it("accepts tools array", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const testTool: AgentTool = {
      name: "test_tool",
      description: "A test tool",
      parameters: Type.Object({ input: Type.String() }),
      execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
    } as unknown as AgentTool;

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
      tools: [testTool],
    });

    expect(session.getActiveToolNames()).toEqual(["test_tool"]);
    expect(session.getAllTools()).toEqual([{ name: "test_tool", description: "A test tool" }]);
  });

  it("keeps prompt images visible for non-vision models via fallback", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
      model: { provider: "anthropic", id: "claude-3-5-haiku", input: ["text"] },
    });

    session.agent.streamFn = async function* (_model, context) {
      const messages = (context as { messages?: AgentMessage[] }).messages ?? [];
      const userMessage = messages.at(-1);
      expect(Array.isArray(userMessage?.content)).toBe(true);
      const blocks = (userMessage?.content ?? []) as Array<{ type?: string; text?: string }>;
      expect(blocks.some((block) => block.type === "image")).toBe(false);
      expect(
        blocks.some((block) => block.type === "text" && block.text === "[Vision fallback]"),
      ).toBe(true);
      yield {
        type: "done",
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      };
    };

    await session.prompt("describe this", {
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });

    expect(visionFallbackMocks.applyVisionFallbackToMessages).toHaveBeenCalled();
  });

  it("keeps tool-result images visible for non-vision models via fallback", async () => {
    const sm = ArgentSessionManager.inMemory();
    const settings = ArgentSettingsManager.inMemory();
    const screenshotTool: AgentTool = {
      name: "browser_screenshot",
      description: "Returns an image result",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [{ type: "image", data: "abc", mimeType: "image/png" }],
        details: {},
      }),
    } as unknown as AgentTool;

    const { session } = await createArgentAgentSession({
      sessionManager: sm,
      settingsManager: settings,
      model: { provider: "anthropic", id: "claude-3-5-haiku", input: ["text"] },
      tools: [screenshotTool],
    });

    let callCount = 0;
    session.agent.streamFn = async function* (_model, context) {
      callCount += 1;
      const messages = (context as { messages?: AgentMessage[] }).messages ?? [];
      if (callCount === 1) {
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", id: "tool-1", name: "browser_screenshot", arguments: {} },
            ],
          },
        };
        return;
      }
      const toolResult = messages.find(
        (message) => (message as { role?: string }).role === "toolResult",
      );
      expect(toolResult).toBeDefined();
      const blocks = ((toolResult as { content?: unknown[] }).content ?? []) as Array<{
        type?: string;
        text?: string;
      }>;
      expect(blocks.some((block) => block.type === "image")).toBe(false);
      expect(
        blocks.some((block) => block.type === "text" && block.text === "[Vision fallback]"),
      ).toBe(true);
      yield {
        type: "done",
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      };
    };

    await session.prompt("take a screenshot");

    expect(callCount).toBe(2);
    expect(visionFallbackMocks.applyVisionFallbackToMessages).toHaveBeenCalled();
  });
});
