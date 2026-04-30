import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCallbacks,
  RealtimeVoiceProvider,
} from "../realtime-voice/provider-types.js";
import {
  acknowledgeTalkRealtimeRelayMark,
  clearTalkRealtimeRelaySessionsForTest,
  createTalkRealtimeRelaySession,
  sendTalkRealtimeRelayAudio,
  stopTalkRealtimeRelaySession,
  submitTalkRealtimeRelayToolResult,
  TALK_REALTIME_RELAY_EVENT,
  type TalkRealtimeRelayEvent,
} from "./talk-realtime-relay.js";

type TestBridge = RealtimeVoiceBridge & {
  audioFormat: unknown;
  callbacks: RealtimeVoiceBridgeCallbacks;
  sentAudio: Buffer[];
  toolResults: Array<{ callId: string; result: unknown }>;
  timestamps: number[];
  acknowledgeMarkMock: () => void;
};

function createProvider(bridges: TestBridge[]): RealtimeVoiceProvider {
  return {
    id: "test-provider",
    createBridge: (request) => {
      const bridge: TestBridge = {
        acknowledgeMarkMock: vi.fn(),
        audioFormat: request.audioFormat,
        callbacks: request,
        sentAudio: [],
        toolResults: [],
        timestamps: [],
        connect: async () => request.onReady?.(),
        sendAudio: (audio) => bridge.sentAudio.push(audio),
        setMediaTimestamp: (ts) => bridge.timestamps.push(ts),
        submitToolResult: (callId, result) => bridge.toolResults.push({ callId, result }),
        acknowledgeMark: () => bridge.acknowledgeMarkMock(),
        close: vi.fn((reason = "completed") => request.onClose?.(reason)),
        isConnected: () => true,
      };
      bridges.push(bridge);
      return bridge;
    },
  };
}

function createContext() {
  const events: TalkRealtimeRelayEvent[] = [];
  return {
    events,
    context: {
      broadcastToConnIds: vi.fn(
        (
          event: string,
          payload: unknown,
          connIds: ReadonlySet<string>,
          opts?: { dropIfSlow?: boolean },
        ) => {
          expect(event).toBe(TALK_REALTIME_RELAY_EVENT);
          expect([...connIds]).toEqual(["conn-1"]);
          expect(opts).toEqual({ dropIfSlow: true });
          events.push(payload as TalkRealtimeRelayEvent);
        },
      ),
    },
  };
}

describe("talk realtime relay", () => {
  afterEach(() => {
    clearTalkRealtimeRelaySessionsForTest();
  });

  it("creates a PCM gateway relay session and broadcasts bridge events", async () => {
    const bridges: TestBridge[] = [];
    const { context, events } = createContext();
    const result = createTalkRealtimeRelaySession({
      context,
      connId: "conn-1",
      provider: createProvider(bridges),
      providerConfig: {},
      instructions: "Speak briefly.",
      model: "gpt-realtime",
      voice: "marin",
    });
    await Promise.resolve();

    expect(result).toMatchObject({
      provider: "test-provider",
      transport: "gateway-relay",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      model: "gpt-realtime",
      voice: "marin",
    });
    expect(bridges[0]?.audioFormat).toEqual({
      encoding: "pcm16",
      sampleRateHz: 24000,
      channels: 1,
    });
    expect(events).toContainEqual({ relaySessionId: result.relaySessionId, type: "ready" });

    bridges[0]?.callbacks.onAudio(Buffer.from([1, 2, 3]));
    bridges[0]?.callbacks.onTranscript?.("assistant", "hello", true);
    void bridges[0]?.callbacks.onToolCall?.({
      itemId: "item-1",
      callId: "call-1",
      name: "lookup",
      args: { q: "x" },
    });

    expect(events).toContainEqual({
      relaySessionId: result.relaySessionId,
      type: "audio",
      audioBase64: "AQID",
    });
    expect(events).toContainEqual({
      relaySessionId: result.relaySessionId,
      type: "transcript",
      role: "assistant",
      text: "hello",
      final: true,
    });
    expect(events).toContainEqual({
      relaySessionId: result.relaySessionId,
      type: "toolCall",
      itemId: "item-1",
      callId: "call-1",
      name: "lookup",
      args: { q: "x" },
    });
  });

  it("routes browser audio, marks, tool results, and stops by owning connection", async () => {
    const bridges: TestBridge[] = [];
    const { context, events } = createContext();
    const result = createTalkRealtimeRelaySession({
      context,
      connId: "conn-1",
      provider: createProvider(bridges),
      providerConfig: {},
      instructions: "Speak briefly.",
    });
    await Promise.resolve();

    sendTalkRealtimeRelayAudio({
      relaySessionId: result.relaySessionId,
      connId: "conn-1",
      audioBase64: "BAUG",
      timestamp: 120,
    });
    acknowledgeTalkRealtimeRelayMark({
      relaySessionId: result.relaySessionId,
      connId: "conn-1",
    });
    submitTalkRealtimeRelayToolResult({
      relaySessionId: result.relaySessionId,
      connId: "conn-1",
      callId: "call-1",
      result: { ok: true },
    });
    stopTalkRealtimeRelaySession({ relaySessionId: result.relaySessionId, connId: "conn-1" });

    expect(bridges[0]?.sentAudio).toEqual([Buffer.from([4, 5, 6])]);
    expect(bridges[0]?.timestamps).toEqual([120]);
    expect(bridges[0]?.acknowledgeMarkMock).toHaveBeenCalledOnce();
    expect(bridges[0]?.toolResults).toEqual([{ callId: "call-1", result: { ok: true } }]);
    expect(events).toContainEqual({
      relaySessionId: result.relaySessionId,
      type: "close",
      reason: "completed",
    });
  });

  it("rejects oversized audio and wrong-connection access", () => {
    const bridges: TestBridge[] = [];
    const { context } = createContext();
    const result = createTalkRealtimeRelaySession({
      context,
      connId: "conn-1",
      provider: createProvider(bridges),
      providerConfig: {},
      instructions: "Speak briefly.",
    });

    expect(() =>
      sendTalkRealtimeRelayAudio({
        relaySessionId: result.relaySessionId,
        connId: "conn-2",
        audioBase64: "AQID",
      }),
    ).toThrow("Unknown realtime relay session");
    expect(() =>
      sendTalkRealtimeRelayAudio({
        relaySessionId: result.relaySessionId,
        connId: "conn-1",
        audioBase64: "a".repeat(512 * 1024 + 1),
      }),
    ).toThrow("Realtime relay audio frame is too large");
  });
});
