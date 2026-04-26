import { describe, expect, it } from "vitest";
import type {
  RealtimeVoiceOperatorSession,
  RealtimeVoiceOperatorSessionEvent,
  RealtimeVoiceOperatorSessionParams,
} from "./operator-session.js";
import { runOpenAiRealtimeLiveSmoke } from "./openai-realtime-live-smoke.js";

function createMockSession(
  events: RealtimeVoiceOperatorSessionEvent[],
  providerId = "openai",
): RealtimeVoiceOperatorSession {
  return {
    providerId,
    providerLabel: "OpenAI Realtime",
    acknowledgeMark: () => {},
    cancel: () => {},
    close: () => {},
    connect: async () => {},
    getEvents: () => [...events],
    isConnected: () => true,
    sendAudio: () => {},
    sendUserMessage: () => {},
    setMediaTimestamp: () => {},
    submitToolResult: () => {},
    triggerGreeting: () => {},
  };
}

describe("runOpenAiRealtimeLiveSmoke", () => {
  it("fails closed before connecting when no live OpenAI key is configured", async () => {
    await expect(runOpenAiRealtimeLiveSmoke({ env: {}, timeoutMs: 1 })).rejects.toThrow(
      'Realtime voice provider "openai" is not configured',
    );
  });

  it("reports success only after the actual session emits final transcript and audio output", async () => {
    const events: RealtimeVoiceOperatorSessionEvent[] = [];

    const result = await runOpenAiRealtimeLiveSmoke({
      env: { OPENAI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      timeoutMs: 500,
      createSession: (params: RealtimeVoiceOperatorSessionParams) => {
        const session = createMockSession(events);
        session.connect = async () => {
          params.onEvent?.({ type: "ready", providerId: session.providerId });
        };
        session.sendUserMessage = () => {
          params.onEvent?.({ type: "audio", audio: Buffer.from([1, 2, 3]) });
          params.onEvent?.({
            type: "transcript",
            role: "assistant",
            text: "Argent realtime smoke ok.",
            isFinal: true,
          });
        };
        return session;
      },
    });

    expect(result).toEqual({
      ok: true,
      providerId: "openai",
      providerLabel: "OpenAI Realtime",
      finalAssistantTranscript: "Argent realtime smoke ok.",
      audioChunkCount: 1,
      eventTypes: ["ready", "audio", "transcript"],
      error: undefined,
    });
  });

  it("does not pass when the actual session emits transcript but no audio output", async () => {
    const result = await runOpenAiRealtimeLiveSmoke({
      env: { OPENAI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      timeoutMs: 1,
      createSession: (params) => {
        const session = createMockSession([]);
        session.connect = async () => {
          params.onEvent?.({ type: "ready", providerId: session.providerId });
        };
        session.sendUserMessage = () => {
          params.onEvent?.({
            type: "transcript",
            role: "assistant",
            text: "Argent realtime smoke ok.",
            isFinal: true,
          });
        };
        return session;
      },
    });

    expect(result).toMatchObject({
      ok: false,
      providerId: "openai",
      providerLabel: "OpenAI Realtime",
      finalAssistantTranscript: "Argent realtime smoke ok.",
      audioChunkCount: 0,
    });
    expect(result.error).toContain("final assistant transcript and audio output");
  });

  it("reports provider identity from the resolved operator session", async () => {
    const result = await runOpenAiRealtimeLiveSmoke({
      env: { OPENAI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      timeoutMs: 500,
      createSession: (params) => {
        const session = createMockSession([], "openai-custom");
        session.connect = async () => {
          params.onEvent?.({ type: "ready", providerId: session.providerId });
        };
        session.sendUserMessage = () => {
          params.onEvent?.({ type: "audio", audio: Buffer.from([1]) });
          params.onEvent?.({
            type: "transcript",
            role: "assistant",
            text: "Argent realtime smoke ok.",
            isFinal: true,
          });
        };
        return session;
      },
    });

    expect(result.providerId).toBe("openai-custom");
    expect(result.providerLabel).toBe("OpenAI Realtime");
  });
});
