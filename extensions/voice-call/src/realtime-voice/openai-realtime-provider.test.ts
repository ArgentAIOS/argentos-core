import { describe, expect, it, vi } from "vitest";
import {
  createOpenAiRealtimeVoiceProvider,
  type OpenAiRealtimeWebSocketFactory,
  type OpenAiRealtimeWebSocketLike,
} from "./openai-realtime-provider.js";
import { resolveConfiguredRealtimeVoiceProvider } from "./provider-resolver.js";
import { createRealtimeVoiceBridgeSession } from "./session-runtime.js";

type ListenerMap = {
  open: Array<() => void>;
  message: Array<(data: Buffer | string) => void>;
  error: Array<(error: Error) => void>;
  close: Array<(code: number, reason: Buffer) => void>;
};

class MockRealtimeWebSocket implements OpenAiRealtimeWebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  readonly listeners: ListenerMap = {
    open: [],
    message: [],
    error: [],
    close: [],
  };

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.emitClose(code ?? 1000, reason ?? "");
  }

  on<Event extends keyof ListenerMap>(event: Event, listener: ListenerMap[Event][number]): void {
    this.listeners[event].push(listener as never);
  }

  emitOpen(): void {
    for (const listener of this.listeners.open) {
      listener();
    }
  }

  emitMessage(event: Record<string, unknown>): void {
    for (const listener of this.listeners.message) {
      listener(JSON.stringify(event));
    }
  }

  emitError(error: Error): void {
    for (const listener of this.listeners.error) {
      listener(error);
    }
  }

  emitClose(code = 1000, reason = "completed"): void {
    for (const listener of this.listeners.close) {
      listener(code, Buffer.from(reason));
    }
  }
}

function createMockWebSocketFactory() {
  const sockets: MockRealtimeWebSocket[] = [];
  const calls: Array<{ url: string; options: { headers: Record<string, string> } }> = [];
  const factory: OpenAiRealtimeWebSocketFactory = (url, options) => {
    calls.push({ url, options });
    const socket = new MockRealtimeWebSocket();
    sockets.push(socket);
    return socket;
  };
  return { calls, factory, sockets };
}

function parseSent(socket: MockRealtimeWebSocket) {
  return socket.sent.map((data) => JSON.parse(data) as Record<string, unknown>);
}

describe("OpenAiRealtimeVoiceProvider", () => {
  it("is labeled live and resolves config from env without exposing fake readiness", () => {
    const provider = createOpenAiRealtimeVoiceProvider({
      env: { OPENAI_API_KEY: "env-key" } as NodeJS.ProcessEnv,
    });

    const resolved = resolveConfiguredRealtimeVoiceProvider({
      configuredProviderId: "openai-realtime",
      providers: [provider],
      providerConfigs: { openai: { voice: "alloy" } },
    });

    expect(provider.readiness).toBe("live");
    expect(resolved.provider).toBe(provider);
    expect(resolved.providerConfig).toMatchObject({
      apiKey: "env-key",
      model: "gpt-realtime",
      voice: "alloy",
      inputAudioFormat: "pcm16",
      inputTranscription: { model: "gpt-4o-transcribe" },
      outputAudioFormat: "pcm16",
    });
  });

  it("fails provider resolution when the live OpenAI key is missing", () => {
    const provider = createOpenAiRealtimeVoiceProvider({ env: {} as NodeJS.ProcessEnv });

    expect(() =>
      resolveConfiguredRealtimeVoiceProvider({
        providers: [provider],
        providerConfigs: { openai: {} },
      }),
    ).toThrow('Realtime voice provider "openai" is not configured');
  });

  it("opens a realtime websocket and sends live session configuration", async () => {
    const { calls, factory, sockets } = createMockWebSocketFactory();
    const provider = createOpenAiRealtimeVoiceProvider({
      env: {} as NodeJS.ProcessEnv,
      webSocketFactory: factory,
    });
    const onReady = vi.fn();
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: {
        apiKey: "test-key",
        model: "gpt-realtime",
        voice: "marin",
        inputAudioFormat: "pcm16",
        outputAudioFormat: "pcm16",
      },
      instructions: "Be brief.",
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "Lookup a thing",
          parameters: { type: "object", properties: {} },
        },
      ],
      audioSink: { sendAudio: vi.fn() },
      onReady,
    });

    const connected = session.connect();
    sockets[0]?.emitOpen();
    await connected;

    expect(calls[0]?.url).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime");
    expect(calls[0]?.options.headers.Authorization).toBe("Bearer test-key");
    expect(onReady).toHaveBeenCalledOnce();
    expect(parseSent(sockets[0] ?? new MockRealtimeWebSocket())[0]).toMatchObject({
      type: "session.update",
      session: {
        model: "gpt-realtime",
        instructions: "Be brief.",
        modalities: ["audio", "text"],
        voice: "marin",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "gpt-4o-transcribe" },
        turn_detection: { type: "server_vad" },
      },
    });
  });

  it("sends audio, text, greetings, and tool results as realtime events", async () => {
    const { factory, sockets } = createMockWebSocketFactory();
    const provider = createOpenAiRealtimeVoiceProvider({ webSocketFactory: factory });
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: { apiKey: "test-key" },
      audioSink: { sendAudio: vi.fn() },
    });

    const connected = session.connect();
    sockets[0]?.emitOpen();
    await connected;
    session.sendAudio(Buffer.from([1, 2, 3]));
    session.sendUserMessage("hello");
    session.triggerGreeting("say hi");
    session.submitToolResult("call-1", { ok: true });

    expect(parseSent(sockets[0] ?? new MockRealtimeWebSocket()).slice(1)).toEqual([
      { type: "input_audio_buffer.append", audio: "AQID" },
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      },
      { type: "response.create" },
      { type: "response.create", response: { instructions: "say hi" } },
      {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "call-1",
          output: '{"ok":true}',
        },
      },
      { type: "response.create" },
    ]);
  });

  it("maps realtime server audio, transcript, tool, and error events into bridge callbacks", async () => {
    const { factory, sockets } = createMockWebSocketFactory();
    const provider = createOpenAiRealtimeVoiceProvider({ webSocketFactory: factory });
    const audio: Buffer[] = [];
    const transcripts: Array<[string, string, boolean]> = [];
    const onToolCall = vi.fn();
    const onError = vi.fn();
    const clearAudio = vi.fn();
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: { apiKey: "test-key" },
      audioSink: { sendAudio: (chunk) => audio.push(chunk), clearAudio },
      onTranscript: (role, text, isFinal) => transcripts.push([role, text, isFinal]),
      onToolCall,
      onError,
    });

    const connected = session.connect();
    sockets[0]?.emitOpen();
    await connected;
    sockets[0]?.emitMessage({ type: "response.output_audio.delta", delta: "AQID" });
    sockets[0]?.emitMessage({ type: "response.audio_transcript.delta", delta: "hel" });
    sockets[0]?.emitMessage({ type: "response.audio_transcript.delta", delta: "lo" });
    sockets[0]?.emitMessage({
      type: "response.audio_transcript.done",
      transcript: "hello",
    });
    sockets[0]?.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "operator said hi",
    });
    sockets[0]?.emitMessage({
      type: "response.function_call_arguments.done",
      item_id: "item-1",
      call_id: "call-1",
      name: "lookup",
      arguments: '{"q":"x"}',
    });
    sockets[0]?.emitMessage({ type: "input_audio_buffer.speech_started" });
    sockets[0]?.emitMessage({ type: "error", error: { message: "boom" } });

    expect(audio).toEqual([Buffer.from([1, 2, 3])]);
    expect(transcripts).toEqual([
      ["assistant", "hel", false],
      ["assistant", "hello", false],
      ["assistant", "hello", true],
      ["user", "operator said hi", true],
    ]);
    expect(onToolCall.mock.calls[0]?.[0]).toEqual({
      itemId: "item-1",
      callId: "call-1",
      name: "lookup",
      args: { q: "x" },
    });
    expect(clearAudio).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "boom" });
  });

  it("closes the websocket with explicit realtime close reasons", async () => {
    const { factory, sockets } = createMockWebSocketFactory();
    const provider = createOpenAiRealtimeVoiceProvider({ webSocketFactory: factory });
    const onClose = vi.fn();
    const session = createRealtimeVoiceBridgeSession({
      provider,
      providerConfig: { apiKey: "test-key" },
      audioSink: { sendAudio: vi.fn() },
      onClose,
    });

    const connected = session.connect();
    sockets[0]?.emitOpen();
    await connected;
    session.close("cancelled");

    expect(sockets[0]?.closeCalls).toEqual([{ code: 1000, reason: "cancelled" }]);
    expect(onClose).toHaveBeenCalledWith("cancelled");
  });
});
