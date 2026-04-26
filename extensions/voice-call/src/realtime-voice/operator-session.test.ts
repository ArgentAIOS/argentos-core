import { describe, expect, it, vi } from "vitest";
import type { RealtimeVoiceToolCallEvent } from "./provider-types.js";
import { createFakeRealtimeVoiceProvider } from "./fake-provider.js";
import { createRealtimeVoiceOperatorSession } from "./operator-session.js";

function latestBridge(provider: ReturnType<typeof createFakeRealtimeVoiceProvider>) {
  const bridge = provider.bridges.at(-1);
  if (!bridge) {
    throw new Error("Expected fake bridge");
  }
  return bridge;
}

function eventTypes(session: ReturnType<typeof createRealtimeVoiceOperatorSession>) {
  return session.getEvents().map((event) => event.type);
}

describe("createRealtimeVoiceOperatorSession", () => {
  it("records a deterministic fake-provider operator lifecycle", async () => {
    const toolEvent: RealtimeVoiceToolCallEvent = {
      itemId: "item-1",
      callId: "call-1",
      name: "lookup",
      args: { q: "operator" },
    };
    const provider = createFakeRealtimeVoiceProvider();
    const session = createRealtimeVoiceOperatorSession({
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: {
        fake: {
          script: [
            { type: "ready" },
            { type: "transcript", role: "user", text: "hello", isFinal: true },
            { type: "audio", audio: "assistant-audio" },
            { type: "toolCall", event: toolEvent },
            { type: "mark", markName: "assistant-done" },
            { type: "clearAudio" },
            { type: "close", reason: "completed" },
          ],
        },
      },
      onToolCall: (_event, activeSession) => {
        activeSession.submitToolResult("call-1", { ok: true });
      },
    });

    await session.connect();
    session.sendAudio(Buffer.from("operator-audio"));
    session.sendUserMessage("typed operator message");
    session.setMediaTimestamp(72);
    session.triggerGreeting("start locally");
    session.acknowledgeMark();
    const bridge = latestBridge(provider);

    expect(session.providerId).toBe("fake");
    expect(session.providerLabel).toBe("Fake realtime voice");
    expect(eventTypes(session)).toEqual([
      "ready",
      "transcript",
      "audio",
      "toolCall",
      "toolResult",
      "mark",
      "clearAudio",
      "close",
    ]);
    expect(session.getEvents()).toContainEqual({
      type: "transcript",
      role: "user",
      text: "hello",
      isFinal: true,
    });
    expect(session.getEvents()).toContainEqual({
      type: "audio",
      audio: Buffer.from("assistant-audio"),
    });
    expect(bridge.state.toolResults).toEqual([{ callId: "call-1", result: { ok: true } }]);
    expect(bridge.state.audioInputs).toEqual([Buffer.from("operator-audio")]);
    expect(bridge.state.userMessages).toEqual(["typed operator message"]);
    expect(bridge.state.mediaTimestamp).toBe(72);
    expect(bridge.state.greetings).toEqual(["start locally"]);
    expect(bridge.state.markAcks).toBe(1);
    expect(session.isConnected()).toBe(false);
  });

  it("waits for async operator tool handlers before a following scripted close", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const callOrder: string[] = [];
    const session = createRealtimeVoiceOperatorSession({
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: {
        fake: {
          script: [
            {
              type: "toolCall",
              event: { itemId: "item-1", callId: "call-1", name: "lookup", args: {} },
            },
            { type: "close", reason: "completed" },
          ],
        },
      },
      onToolCall: async (_event, activeSession) => {
        await Promise.resolve();
        activeSession.submitToolResult("call-1", { ok: true });
        callOrder.push("tool-result");
      },
      onEvent: (event) => {
        if (event.type === "close") {
          callOrder.push(`close:${event.reason}`);
        }
      },
    });

    await session.connect();

    expect(callOrder).toEqual(["tool-result", "close:completed"]);
    expect(eventTypes(session)).toEqual(["toolCall", "toolResult", "close"]);
  });

  it("records async tool handler failures as error close events", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const session = createRealtimeVoiceOperatorSession({
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: {
        fake: {
          script: [
            {
              type: "toolCall",
              event: { itemId: "item-1", callId: "call-1", name: "lookup", args: {} },
            },
            { type: "close", reason: "completed" },
          ],
        },
      },
      onToolCall: async () => {
        await Promise.resolve();
        throw new Error("operator tool failed");
      },
    });

    await session.connect();

    expect(eventTypes(session)).toEqual(["toolCall", "error", "close"]);
    expect(session.getEvents()[1]).toMatchObject({
      type: "error",
      error: { message: "operator tool failed" },
    });
    expect(session.getEvents()[2]).toEqual({ type: "close", reason: "error" });
  });

  it("supports explicit operator cancellation close semantics", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const onEvent = vi.fn();
    const session = createRealtimeVoiceOperatorSession({
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: { fake: { autoReady: false } },
      onEvent,
    });

    await session.connect();
    session.cancel();

    expect(session.getEvents()).toEqual([{ type: "close", reason: "cancelled" }]);
    expect(onEvent).toHaveBeenCalledWith({ type: "close", reason: "cancelled" });
    expect(session.isConnected()).toBe(false);
  });

  it("supports explicit completed close semantics", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const session = createRealtimeVoiceOperatorSession({
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: { fake: { autoReady: false } },
    });

    await session.connect();
    session.close("completed");

    expect(session.getEvents()).toEqual([{ type: "close", reason: "completed" }]);
    expect(session.isConnected()).toBe(false);
  });

  it("fails before connecting when no operator realtime provider is available", () => {
    expect(() =>
      createRealtimeVoiceOperatorSession({
        providers: [],
      }),
    ).toThrow("No realtime voice provider is available for operator sessions");
  });
});
