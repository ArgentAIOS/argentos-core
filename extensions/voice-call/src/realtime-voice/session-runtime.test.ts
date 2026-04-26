import { describe, expect, it, vi } from "vitest";
import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCallbacks,
  RealtimeVoiceProvider,
} from "./provider-types.js";
import { createRealtimeVoiceBridgeSession } from "./session-runtime.js";

function createBridge(callbacks: RealtimeVoiceBridgeCallbacks): RealtimeVoiceBridge {
  return {
    connect: async () => callbacks.onReady?.(),
    sendAudio: vi.fn(),
    setMediaTimestamp: vi.fn(),
    sendUserMessage: vi.fn(),
    triggerGreeting: vi.fn(),
    submitToolResult: vi.fn(),
    acknowledgeMark: vi.fn(),
    close: vi.fn(),
    isConnected: () => true,
  };
}

describe("createRealtimeVoiceBridgeSession", () => {
  it("forwards provider audio and clear events to an open sink", () => {
    let callbacks!: RealtimeVoiceBridgeCallbacks;
    const provider: RealtimeVoiceProvider = {
      id: "fake",
      createBridge: (request) => {
        callbacks = request;
        return createBridge(request);
      },
    };
    const audio: Buffer[] = [];
    const clearAudio = vi.fn();

    createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {},
      audioSink: {
        sendAudio: (chunk) => audio.push(chunk),
        clearAudio,
      },
    });

    callbacks.onAudio(Buffer.from("audio"));
    callbacks.onClearAudio();

    expect(audio).toEqual([Buffer.from("audio")]);
    expect(clearAudio).toHaveBeenCalledOnce();
  });

  it("acks marks immediately when configured", () => {
    let callbacks!: RealtimeVoiceBridgeCallbacks;
    let bridge!: RealtimeVoiceBridge;
    const provider: RealtimeVoiceProvider = {
      id: "fake",
      createBridge: (request) => {
        callbacks = request;
        bridge = createBridge(request);
        return bridge;
      },
    };

    createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {},
      markStrategy: "ack-immediately",
      audioSink: {
        sendAudio: vi.fn(),
        sendMark: vi.fn(),
      },
    });

    callbacks.onMark?.("m1");

    expect(bridge.acknowledgeMark).toHaveBeenCalledOnce();
  });

  it("passes tool calls the active session", () => {
    let callbacks!: RealtimeVoiceBridgeCallbacks;
    const provider: RealtimeVoiceProvider = {
      id: "fake",
      createBridge: (request) => {
        callbacks = request;
        return createBridge(request);
      },
    };
    const onToolCall = vi.fn();
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {},
      audioSink: { sendAudio: vi.fn() },
      onToolCall,
    });

    const event = { itemId: "item", callId: "call", name: "lookup", args: { q: "x" } };
    callbacks.onToolCall?.(event);

    expect(onToolCall).toHaveBeenCalledWith(event, session);
  });

  it("triggers the initial greeting on ready when requested", async () => {
    let bridge!: RealtimeVoiceBridge;
    const provider: RealtimeVoiceProvider = {
      id: "fake",
      createBridge: (request) => {
        bridge = createBridge(request);
        return bridge;
      },
    };

    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {},
      audioSink: { sendAudio: vi.fn() },
      triggerGreetingOnReady: true,
      initialGreetingInstructions: "hello",
    });

    await session.connect();

    expect(bridge.triggerGreeting).toHaveBeenCalledWith("hello");
  });
});
