import { describe, expect, it, vi } from "vitest";
import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCallbacks,
  RealtimeVoiceProvider,
} from "./provider-types.js";
import {
  REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
  createRealtimeVoiceBridgeSession,
} from "./index.js";

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
  it("passes audio format into provider bridge creation", () => {
    let audioFormat: unknown;
    const provider: RealtimeVoiceProvider = {
      id: "fake",
      createBridge: (request) => {
        audioFormat = request.audioFormat;
        return createBridge(request);
      },
    };

    createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {},
      audioFormat: REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
      audioSink: { sendAudio: vi.fn() },
    });

    expect(audioFormat).toBe(REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ);
  });

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

  it("forwards tool result continuation options", () => {
    const submitToolResult = vi.fn();
    const provider: RealtimeVoiceProvider = {
      id: "fake",
      createBridge: (request) => ({ ...createBridge(request), submitToolResult }),
    };
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {},
      audioSink: { sendAudio: vi.fn() },
    });

    session.submitToolResult("call-1", { ok: true }, { willContinue: true });

    expect(submitToolResult).toHaveBeenCalledWith("call-1", { ok: true }, { willContinue: true });
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

    await callbacks.onToolCall?.({ itemId: "item", callId: "call", name: "lookup", args: {} });

    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "async tool failed" });
    expect(close).toHaveBeenCalledWith("error");
  });
});
