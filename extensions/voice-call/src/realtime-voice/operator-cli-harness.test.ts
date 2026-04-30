import { describe, expect, it, vi } from "vitest";
import type { RealtimeVoiceToolCallEvent } from "./provider-types.js";
import { createFakeRealtimeVoiceProvider } from "./fake-provider.js";
import { createRealtimeVoiceOperatorCliHarness } from "./operator-cli-harness.js";

function latestBridge(provider: ReturnType<typeof createFakeRealtimeVoiceProvider>) {
  const bridge = provider.bridges.at(-1);
  if (!bridge) {
    throw new Error("Expected fake bridge");
  }
  return bridge;
}

describe("createRealtimeVoiceOperatorCliHarness", () => {
  it("feeds operator text/audio-token commands and records deterministic session logs", async () => {
    const toolEvent: RealtimeVoiceToolCallEvent = {
      itemId: "item-1",
      callId: "call-1",
      name: "lookup",
      args: { q: "cli" },
    };
    const toolResult = { ok: true };
    const provider = createFakeRealtimeVoiceProvider();
    const harness = createRealtimeVoiceOperatorCliHarness({
      allowTestOnlyProviders: true,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: {
        fake: {
          script: [
            { type: "ready" },
            { type: "transcript", role: "assistant", text: "ready", isFinal: true },
            { type: "audio", audio: [1, 2, 3] },
            { type: "toolCall", event: toolEvent },
            { type: "mark", markName: "m1" },
            { type: "clearAudio" },
          ],
        },
      },
    });

    await harness.run([
      { type: "connect" },
      { type: "toolResult", callId: "call-1", result: toolResult },
      { type: "text", text: "operator typed this" },
      { type: "audioToken", token: "operator-audio-token" },
      { type: "audioToken", token: [4, 5, 6] },
      { type: "mediaTimestamp", timestamp: 88 },
      { type: "greeting", instructions: "say hello" },
      { type: "ackMark" },
      { type: "close", reason: "completed" },
    ]);
    toolEvent.args = { q: "mutated" };
    toolResult.ok = false;

    expect(harness.getLog()).toEqual([
      { source: "operator", command: { type: "connect" } },
      { source: "session", event: { type: "ready", providerId: "fake" } },
      {
        source: "session",
        event: { type: "transcript", role: "assistant", text: "ready", isFinal: true },
      },
      { source: "session", event: { type: "audio", base64: "AQID" } },
      {
        source: "session",
        event: {
          type: "toolCall",
          event: { itemId: "item-1", callId: "call-1", name: "lookup", args: { q: "cli" } },
        },
      },
      { source: "session", event: { type: "mark", markName: "m1" } },
      { source: "session", event: { type: "clearAudio" } },
      {
        source: "operator",
        command: { type: "toolResult", callId: "call-1", result: { ok: true } },
      },
      {
        source: "session",
        event: { type: "toolResult", callId: "call-1", result: { ok: true } },
      },
      { source: "operator", command: { type: "text", text: "operator typed this" } },
      {
        source: "operator",
        command: { type: "audioToken", token: "operator-audio-token" },
      },
      { source: "operator", command: { type: "audioToken", token: "BAUG" } },
      { source: "operator", command: { type: "mediaTimestamp", timestamp: 88 } },
      { source: "operator", command: { type: "greeting", instructions: "say hello" } },
      { source: "operator", command: { type: "ackMark" } },
      { source: "operator", command: { type: "close", reason: "completed" } },
      { source: "session", event: { type: "close", reason: "completed" } },
    ]);
    const returnedLog = harness.getLog();
    returnedLog[7] = { source: "operator", command: { type: "cancel" } };
    expect(harness.getLog()[7]).toEqual({
      source: "operator",
      command: { type: "toolResult", callId: "call-1", result: { ok: true } },
    });

    const bridge = latestBridge(provider);
    expect(bridge.state.toolResults).toEqual([{ callId: "call-1", result: { ok: false } }]);
    expect(bridge.state.userMessages).toEqual(["operator typed this"]);
    expect(bridge.state.audioInputs).toEqual([
      Buffer.from("operator-audio-token"),
      Buffer.from([4, 5, 6]),
    ]);
    expect(bridge.state.mediaTimestamp).toBe(88);
    expect(bridge.state.greetings).toEqual(["say hello"]);
    expect(bridge.state.markAcks).toBe(1);
    expect(harness.session.isConnected()).toBe(false);
    expect(harness.isClosed()).toBe(true);
  });

  it("logs operator cancellation distinctly from completed close", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const harness = createRealtimeVoiceOperatorCliHarness({
      allowTestOnlyProviders: true,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: { fake: { autoReady: false } },
    });

    await harness.run([{ type: "connect" }, { type: "cancel" }]);

    await expect(harness.dispatch({ type: "text", text: "too late" })).rejects.toThrow(
      "Realtime voice operator CLI harness is closed",
    );
    expect(harness.getLog()).toEqual([
      { source: "operator", command: { type: "connect" } },
      { source: "operator", command: { type: "cancel" } },
      { source: "session", event: { type: "close", reason: "cancelled" } },
    ]);
    expect(harness.session.isConnected()).toBe(false);
    expect(harness.isClosed()).toBe(true);
  });

  it("rejects close-callback reentrant commands during terminal dispatch", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const lateErrors: string[] = [];
    const harness = createRealtimeVoiceOperatorCliHarness({
      allowTestOnlyProviders: true,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: { fake: { autoReady: false } },
      onLog: (entry) => {
        if (entry.source === "session" && entry.event.type === "close") {
          void harness.dispatch({ type: "text", text: "late close text" }).catch((err: unknown) => {
            lateErrors.push(err instanceof Error ? err.message : String(err));
          });
        }
      },
    });

    await harness.run([{ type: "connect" }, { type: "close", reason: "completed" }]);
    await Promise.resolve();

    expect(lateErrors).toEqual(["Realtime voice operator CLI harness is closed"]);
    expect(latestBridge(provider).state.userMessages).toEqual([]);
  });

  it("rejects cancel-callback reentrant commands during terminal dispatch", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const lateErrors: string[] = [];
    const harness = createRealtimeVoiceOperatorCliHarness({
      allowTestOnlyProviders: true,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: { fake: { autoReady: false } },
      onEvent: (event) => {
        if (event.type === "close") {
          void harness
            .dispatch({ type: "text", text: "late cancel text" })
            .catch((err: unknown) => {
              lateErrors.push(err instanceof Error ? err.message : String(err));
            });
        }
      },
    });

    await harness.run([{ type: "connect" }, { type: "cancel" }]);
    await Promise.resolve();

    expect(lateErrors).toEqual(["Realtime voice operator CLI harness is closed"]);
    expect(latestBridge(provider).state.userMessages).toEqual([]);
  });

  it("preserves async fake tool-call flow through the operator session", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const order: string[] = [];
    const harness = createRealtimeVoiceOperatorCliHarness({
      allowTestOnlyProviders: true,
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
      onToolCall: async (_event, session) => {
        await Promise.resolve();
        session.submitToolResult("call-1", { ok: true });
        order.push("tool-result");
      },
      onLog: (entry) => {
        if (entry.source === "session" && entry.event.type === "close") {
          order.push(`close:${entry.event.reason}`);
        }
      },
    });

    await harness.run([{ type: "connect" }]);

    expect(order).toEqual(["tool-result", "close:completed"]);
    expect(harness.getLog()).toEqual([
      { source: "operator", command: { type: "connect" } },
      {
        source: "session",
        event: {
          type: "toolCall",
          event: { itemId: "item-1", callId: "call-1", name: "lookup", args: {} },
        },
      },
      {
        source: "session",
        event: { type: "toolResult", callId: "call-1", result: { ok: true } },
      },
      { source: "session", event: { type: "close", reason: "completed" } },
    ]);
    expect(harness.isClosed()).toBe(false);
  });

  it("normalizes provider errors into deterministic log messages", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const harness = createRealtimeVoiceOperatorCliHarness({
      allowTestOnlyProviders: true,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: { fake: { script: [{ type: "error", message: "boom" }] } },
    });

    await harness.run([{ type: "connect" }]);

    expect(harness.getLog()).toEqual([
      { source: "operator", command: { type: "connect" } },
      { source: "session", event: { type: "error", message: "boom" } },
    ]);
  });

  it("mirrors session events to caller-provided logging hooks", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const onEvent = vi.fn();
    const onLog = vi.fn((entry) => {
      if (entry.source === "session" && entry.event.type === "ready") {
        entry.event.providerId = "mutated";
      }
    });
    const harness = createRealtimeVoiceOperatorCliHarness({
      allowTestOnlyProviders: true,
      providers: [provider],
      configuredProviderId: "fake",
      providerConfigs: { fake: { script: [{ type: "ready" }] } },
      onEvent,
      onLog,
    });

    await harness.run([{ type: "connect" }]);

    expect(onEvent).toHaveBeenCalledWith({ type: "ready", providerId: "fake" });
    expect(onLog).toHaveBeenCalledTimes(2);
    expect(harness.getLog()).toEqual([
      { source: "operator", command: { type: "connect" } },
      { source: "session", event: { type: "ready", providerId: "fake" } },
    ]);
  });
});
