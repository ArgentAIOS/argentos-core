import { describe, expect, it, vi } from "vitest";
import {
  FakeRealtimeVoiceBridge,
  createFakeRealtimeVoiceProvider,
  type FakeRealtimeVoiceScriptEvent,
} from "./fake-provider.js";
import { resolveConfiguredRealtimeVoiceProvider } from "./provider-resolver.js";
import { createRealtimeVoiceBridgeSession } from "./session-runtime.js";

function latestBridge(provider: ReturnType<typeof createFakeRealtimeVoiceProvider>) {
  const bridge = provider.bridges.at(-1);
  if (!bridge) {
    throw new Error("Expected fake bridge");
  }
  return bridge;
}

describe("FakeRealtimeVoiceProvider", () => {
  it("drives connect, ready, audio, transcript, tool call, mark, and close lifecycle", async () => {
    const toolEvent = { itemId: "item-1", callId: "call-1", name: "lookup", args: { q: "x" } };
    const script: FakeRealtimeVoiceScriptEvent[] = [
      { type: "ready" },
      { type: "audio", audio: "assistant-audio" },
      { type: "transcript", role: "user", text: "hello", isFinal: true },
      { type: "toolCall", event: toolEvent },
      { type: "mark", markName: "m1" },
      { type: "clearAudio" },
      { type: "close", reason: "completed" },
    ];
    const provider = createFakeRealtimeVoiceProvider();
    const audio: Buffer[] = [];
    const clearAudio = vi.fn();
    const marks: string[] = [];
    const onReady = vi.fn();
    const onClose = vi.fn();
    const transcripts: Array<[string, string, boolean]> = [];
    const onToolCall = vi.fn((_event, session) => {
      session.submitToolResult("call-1", { ok: true });
    });

    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: { script },
      audioSink: {
        sendAudio: (chunk) => audio.push(chunk),
        clearAudio,
        sendMark: (markName) => marks.push(markName),
      },
      onReady,
      onTranscript: (role, text, isFinal) => transcripts.push([role, text, isFinal]),
      onToolCall,
      onClose,
    });

    await session.connect();
    session.sendAudio(Buffer.from("caller-audio"));
    session.setMediaTimestamp(42);
    session.sendUserMessage("typed message");
    session.triggerGreeting("greet");
    const bridge = latestBridge(provider);

    expect(onReady).toHaveBeenCalledOnce();
    expect(audio).toEqual([Buffer.from("assistant-audio")]);
    expect(clearAudio).toHaveBeenCalledOnce();
    expect(marks).toEqual(["m1"]);
    expect(transcripts).toEqual([["user", "hello", true]]);
    expect(onToolCall).toHaveBeenCalledWith(toolEvent, session);
    expect(bridge.state.toolResults).toEqual([{ callId: "call-1", result: { ok: true } }]);
    expect(bridge.state.audioInputs).toEqual([Buffer.from("caller-audio")]);
    expect(bridge.state.mediaTimestamp).toBe(42);
    expect(bridge.state.userMessages).toEqual(["typed message"]);
    expect(bridge.state.greetings).toEqual(["greet"]);
    expect(onClose).toHaveBeenCalledWith("completed");
    expect(bridge.isConnected()).toBe(false);
  });

  it("supports immediate mark acknowledgements", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: { script: [{ type: "mark", markName: "m1" }] },
      markStrategy: "ack-immediately",
      audioSink: { sendAudio: vi.fn(), sendMark: vi.fn() },
    });

    await session.connect();

    expect(latestBridge(provider).state.markAcks).toBe(1);
  });

  it("surfaces provider errors", async () => {
    const onError = vi.fn();
    const provider = createFakeRealtimeVoiceProvider();
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: { script: [{ type: "error", message: "boom" }] },
      audioSink: { sendAudio: vi.fn() },
      onError,
    });

    await session.connect();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "boom" });
  });

  it("reports error close reasons distinctly", async () => {
    const onClose = vi.fn();
    const provider = createFakeRealtimeVoiceProvider();
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: { script: [{ type: "close", reason: "error" }] },
      audioSink: { sendAudio: vi.fn() },
      onClose,
    });

    await session.connect();

    expect(onClose).toHaveBeenCalledWith("error");
  });

  it("waits for async tool calls before advancing to a scripted close", async () => {
    const events: string[] = [];
    const toolEvent = { itemId: "item-1", callId: "call-1", name: "lookup", args: { q: "x" } };
    const provider = createFakeRealtimeVoiceProvider();
    const onClose = vi.fn((reason) => events.push(`close:${reason}`));
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {
        script: [
          { type: "toolCall", event: toolEvent },
          { type: "close", reason: "completed" },
        ],
      },
      audioSink: { sendAudio: vi.fn() },
      onToolCall: async (_event, activeSession) => {
        await Promise.resolve();
        activeSession.submitToolResult("call-1", { ok: true });
        events.push("tool-result");
      },
      onClose,
    });

    await session.connect();

    expect(events).toEqual(["tool-result", "close:completed"]);
    expect(latestBridge(provider).state.toolResults).toEqual([
      { callId: "call-1", result: { ok: true } },
    ]);
  });

  it("keeps async tool failures from being overwritten by a following scripted close", async () => {
    const onError = vi.fn();
    const onClose = vi.fn();
    const provider = createFakeRealtimeVoiceProvider();
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {
        script: [
          {
            type: "toolCall",
            event: { itemId: "item-1", callId: "call-1", name: "lookup", args: {} },
          },
          { type: "close", reason: "completed" },
        ],
      },
      audioSink: { sendAudio: vi.fn() },
      onToolCall: async () => {
        await Promise.resolve();
        throw new Error("async tool failed");
      },
      onError,
      onClose,
    });

    await session.connect();

    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "async tool failed" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith("error");
  });

  it("fails provider resolution when fake provider is explicitly unconfigured", () => {
    expect(() =>
      resolveConfiguredRealtimeVoiceProvider({
        configuredProviderId: "fake",
        providers: [createFakeRealtimeVoiceProvider()],
        providerConfigs: { fake: { configured: false } },
      }),
    ).toThrow('Realtime voice provider "fake" is not configured');
  });

  it("exposes fake aliases through provider resolution", () => {
    const provider = createFakeRealtimeVoiceProvider();

    const resolved = resolveConfiguredRealtimeVoiceProvider({
      configuredProviderId: "local-fake",
      providers: [provider],
      providerConfigs: { fake: { configured: true } },
    });

    expect(resolved.provider).toBe(provider);
    expect(resolved.providerConfig).toMatchObject({ configured: true });
  });

  it("can be driven manually after connect", async () => {
    const provider = createFakeRealtimeVoiceProvider();
    const audio: Buffer[] = [];
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: { autoReady: false },
      audioSink: { sendAudio: (chunk) => audio.push(chunk) },
    });

    await session.connect();
    const bridge = latestBridge(provider);
    await bridge.emit({ type: "audio", audio: [1, 2, 3] });

    expect(audio).toEqual([Buffer.from([1, 2, 3])]);
    expect(bridge).toBeInstanceOf(FakeRealtimeVoiceBridge);
  });
});
