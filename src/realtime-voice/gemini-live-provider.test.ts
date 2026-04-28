import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createGeminiLiveProvider,
  type GeminiLiveWebSocketFactory,
  type GeminiLiveWebSocketLike,
} from "./gemini-live-provider.js";

class MockGeminiSocket extends EventEmitter implements GeminiLiveWebSocketLike {
  readyState = 1;
  sent: unknown[] = [];
  closed = false;

  override on(event: "open", cb: () => void): this;
  override on(event: "message", cb: (data: unknown) => void): this;
  override on(event: "error", cb: (error: Error) => void): this;
  override on(event: "close", cb: (code?: number, reason?: Buffer | string) => void): this;
  override on(event: string, cb: (...args: unknown[]) => void): this {
    return super.on(event, cb);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
    this.emit("close", 1000, "closed");
  }
}

function createSocketFactory() {
  const sockets: MockGeminiSocket[] = [];
  const urls: string[] = [];
  const factory: GeminiLiveWebSocketFactory = (url) => {
    urls.push(url);
    const socket = new MockGeminiSocket();
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets, urls };
}

describe("GeminiLiveProvider", () => {
  it("resolves Gemini API keys from config or server environment", () => {
    const provider = createGeminiLiveProvider({
      env: { GEMINI_API_KEY: "env-key" } as NodeJS.ProcessEnv,
    });

    const providerConfig = provider.resolveConfig?.({ rawConfig: {} }) ?? {};

    expect(providerConfig).toMatchObject({
      apiKey: "env-key",
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      voice: "Kore",
    });
    expect(provider.isConfigured?.({ providerConfig })).toBe(true);
  });

  it("opens a Live WebSocket and sends setup without logging or returning the API key", async () => {
    const { factory, sockets, urls } = createSocketFactory();
    const provider = createGeminiLiveProvider({
      env: {} as NodeJS.ProcessEnv,
      webSocketFactory: factory,
    });
    const bridge = provider.createBridge({
      providerConfig: {
        apiKey: "server-key",
        model: "gemini-test-live",
        voice: "Puck",
      },
      instructions: "Keep replies short.",
      onAudio: vi.fn(),
      onClearAudio: vi.fn(),
      onReady: vi.fn(),
    });

    const connected = bridge.connect();
    sockets[0]?.emit("open");
    sockets[0]?.emit("message", JSON.stringify({ setupComplete: {} }));
    await connected;

    expect(urls[0]).toContain("generativelanguage.googleapis.com");
    expect(urls[0]).toContain("key=server-key");
    expect(sockets[0]?.sent[0]).toEqual({
      setup: {
        model: "models/gemini-test-live",
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Puck",
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: "Keep replies short." }],
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
  });

  it("maps relay text, audio, transcripts, and tool calls to Gemini Live messages", async () => {
    const { factory, sockets } = createSocketFactory();
    const onAudio = vi.fn();
    const onTranscript = vi.fn();
    const onToolCall = vi.fn();
    const provider = createGeminiLiveProvider({
      env: {} as NodeJS.ProcessEnv,
      webSocketFactory: factory,
    });
    const bridge = provider.createBridge({
      providerConfig: { apiKey: "server-key" },
      audioFormat: { encoding: "pcm16", sampleRateHz: 24000, channels: 1 },
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "Look something up.",
          parameters: { type: "object", properties: {} },
        },
      ],
      onAudio,
      onClearAudio: vi.fn(),
      onTranscript,
      onToolCall,
    });
    const connected = bridge.connect();
    sockets[0]?.emit("open");
    sockets[0]?.emit("message", JSON.stringify({ setupComplete: {} }));
    await connected;

    bridge.sendUserMessage("hello");
    bridge.sendAudio(Buffer.from([1, 2, 3, 4]));
    sockets[0]?.emit(
      "message",
      JSON.stringify({
        serverContent: {
          inputTranscription: { text: "hello" },
          outputTranscription: { text: "hi there" },
          modelTurn: {
            parts: [{ inlineData: { data: Buffer.from("pcm").toString("base64") } }],
          },
        },
      }),
    );
    sockets[0]?.emit(
      "message",
      JSON.stringify({
        toolCall: {
          functionCalls: [{ id: "call-1", name: "lookup", args: { q: "Argent" } }],
        },
      }),
    );
    bridge.submitToolResult("call-1", { ok: true });

    expect(sockets[0]?.sent).toContainEqual({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: "hello" }] }],
        turnComplete: true,
      },
    });
    expect(sockets[0]?.sent).toContainEqual({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=24000",
          data: Buffer.from([1, 2, 3, 4]).toString("base64"),
        },
      },
    });
    expect(onTranscript).toHaveBeenCalledWith("user", "hello", true);
    expect(onTranscript).toHaveBeenCalledWith("assistant", "hi there", true);
    expect(onAudio).toHaveBeenCalledWith(Buffer.from("pcm"));
    expect(onToolCall).toHaveBeenCalledWith({
      itemId: "call-1",
      callId: "call-1",
      name: "lookup",
      args: { q: "Argent" },
    });
    expect(sockets[0]?.sent).toContainEqual({
      toolResponse: {
        functionResponses: [
          {
            id: "call-1",
            name: "lookup",
            response: { result: { ok: true } },
          },
        ],
      },
    });
  });

  it("truth-labels browser-direct Gemini Live as requiring an ephemeral token service", async () => {
    const provider = createGeminiLiveProvider({
      env: { GEMINI_API_KEY: "env-key" } as NodeJS.ProcessEnv,
    });

    await expect(
      provider.createBrowserSession?.({ providerConfig: { apiKey: "server-key" } }),
    ).rejects.toThrow("ephemeral token service");
  });
});
