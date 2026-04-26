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
    const acknowledgeMark = vi.fn();
    const provider: RealtimeVoiceProvider = {
      id: "fake",
      createBridge: (request) => {
        callbacks = request;
        return { ...createBridge(request), acknowledgeMark };
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

    expect(acknowledgeMark).toHaveBeenCalledOnce();
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
    const triggerGreeting = vi.fn();
    const provider: RealtimeVoiceProvider = {
      id: "fake",
      createBridge: (request) => {
        return { ...createBridge(request), triggerGreeting };
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

    expect(triggerGreeting).toHaveBeenCalledWith("hello");
  });

  it("surfaces tool call handler failures and closes the bridge", () => {
    let callbacks!: RealtimeVoiceBridgeCallbacks;
    const close = vi.fn();
    const onClose = vi.fn();
    const provider: RealtimeVoiceProvider = {
      id: "fake",
      createBridge: (request) => {
        callbacks = request;
        return {
          ...createBridge(request),
          close: (reason) => {
            close(reason);
            request.onClose?.(reason ?? "completed");
          },
        };
      },
    };
    const onError = vi.fn();
    const onToolCall = vi.fn(() => {
      throw new Error("tool failed");
    });

    createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {},
      audioSink: { sendAudio: vi.fn() },
      onToolCall,
      onError,
      onClose,
    });

    callbacks.onToolCall?.({ itemId: "item", callId: "call", name: "lookup", args: {} });

    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "tool failed" });
    expect(close).toHaveBeenCalledWith("error");
    expect(onClose).toHaveBeenCalledWith("error");
  });

  it("surfaces async tool call handler failures and closes the bridge as an error", async () => {
    let callbacks!: RealtimeVoiceBridgeCallbacks;
    const close = vi.fn();
    const onError = vi.fn();
    const provider: RealtimeVoiceProvider = {
      id: "fake",
      createBridge: (request) => {
        callbacks = request;
        return { ...createBridge(request), close };
      },
    };

    createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {},
      audioSink: { sendAudio: vi.fn() },
      onToolCall: async () => {
        throw new Error("async tool failed");
      },
      onError,
    });

    callbacks.onToolCall?.({ itemId: "item", callId: "call", name: "lookup", args: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "async tool failed" });
    expect(close).toHaveBeenCalledWith("error");
  });
});
