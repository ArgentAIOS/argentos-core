import WebSocket from "ws";
import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCreateRequest,
  RealtimeVoiceCloseReason,
  RealtimeVoiceProvider,
  RealtimeVoiceProviderConfig,
  RealtimeVoiceToolCallEvent,
} from "./provider-types.js";

export type OpenAiRealtimeAudioFormat = "pcm16" | "g711_ulaw" | "g711_alaw";

export type OpenAiRealtimeAudioFormatConfig =
  | OpenAiRealtimeAudioFormat
  | { type: "audio/pcm"; rate: 24000 }
  | { type: "audio/pcmu" }
  | { type: "audio/pcma" };

export type OpenAiRealtimeVoiceProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  inputTranscription?: Record<string, unknown> | null;
  model?: string;
  voice?: string;
  inputAudioFormat?: OpenAiRealtimeAudioFormat;
  outputAudioFormat?: OpenAiRealtimeAudioFormat;
  turnDetection?: Record<string, unknown> | null;
};

export type OpenAiRealtimeWebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: Buffer | string) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
};

export type OpenAiRealtimeWebSocketFactory = (
  url: string,
  options: { headers: Record<string, string> },
) => OpenAiRealtimeWebSocketLike;

export type OpenAiRealtimeVoiceProviderOptions = {
  env?: NodeJS.ProcessEnv;
  webSocketFactory?: OpenAiRealtimeWebSocketFactory;
};

const DEFAULT_MODEL = "gpt-realtime";
const DEFAULT_INPUT_TRANSCRIPTION = { model: "gpt-4o-transcribe" };
const DEFAULT_VOICE = "marin";
const DEFAULT_BASE_URL = "wss://api.openai.com/v1/realtime";
const OPEN = 1;

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeConfig(
  rawConfig: RealtimeVoiceProviderConfig,
  env: NodeJS.ProcessEnv,
): OpenAiRealtimeVoiceProviderConfig {
  return {
    apiKey: asNonEmptyString(rawConfig.apiKey) ?? asNonEmptyString(env.OPENAI_API_KEY),
    baseUrl: asNonEmptyString(rawConfig.baseUrl) ?? DEFAULT_BASE_URL,
    inputTranscription:
      rawConfig.inputTranscription === null
        ? null
        : typeof rawConfig.inputTranscription === "object"
          ? (rawConfig.inputTranscription as Record<string, unknown>)
          : DEFAULT_INPUT_TRANSCRIPTION,
    model: asNonEmptyString(rawConfig.model) ?? DEFAULT_MODEL,
    voice: asNonEmptyString(rawConfig.voice) ?? DEFAULT_VOICE,
    inputAudioFormat:
      (asNonEmptyString(rawConfig.inputAudioFormat) as OpenAiRealtimeAudioFormat | undefined) ??
      "pcm16",
    outputAudioFormat:
      (asNonEmptyString(rawConfig.outputAudioFormat) as OpenAiRealtimeAudioFormat | undefined) ??
      "pcm16",
    turnDetection:
      rawConfig.turnDetection === null
        ? null
        : typeof rawConfig.turnDetection === "object"
          ? (rawConfig.turnDetection as Record<string, unknown>)
          : { type: "server_vad" },
  };
}

function encodeJsonResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

function parseToolArguments(args: unknown): unknown {
  if (typeof args !== "string") {
    return args;
  }
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

export class OpenAiRealtimeVoiceBridge implements RealtimeVoiceBridge {
  private ws: OpenAiRealtimeWebSocketLike | undefined;
  private connected = false;
  private closed = false;
  private pendingCloseReason: RealtimeVoiceCloseReason | undefined;
  private currentAssistantTranscript = "";

  constructor(
    private readonly request: RealtimeVoiceBridgeCreateRequest,
    private readonly config: OpenAiRealtimeVoiceProviderConfig,
    private readonly webSocketFactory: OpenAiRealtimeWebSocketFactory,
  ) {}

  connect(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error("OpenAI Realtime voice provider requires OPENAI_API_KEY");
    }
    if (this.closed) {
      throw new Error("OpenAI Realtime voice bridge is closed");
    }
    return new Promise((resolve, reject) => {
      const ws = this.webSocketFactory(this.buildUrl(), {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });
      this.ws = ws;
      ws.on("open", () => {
        this.connected = true;
        this.sendEvent(this.buildSessionUpdate());
        this.request.onReady?.();
        resolve();
      });
      ws.on("message", (data) => this.handleMessage(data));
      ws.on("error", (error) => {
        this.request.onError?.(error);
        if (!this.connected) {
          reject(error);
        }
      });
      ws.on("close", () => {
        const reason: RealtimeVoiceCloseReason = this.closed
          ? (this.pendingCloseReason ?? "completed")
          : "error";
        this.connected = false;
        this.closed = true;
        this.request.onClose?.(reason);
      });
    });
  }

  sendAudio(audio: Buffer): void {
    this.sendEvent({ type: "input_audio_buffer.append", audio: audio.toString("base64") });
  }

  setMediaTimestamp(_ts: number): void {
    // OpenAI Realtime does not require caller media timestamps for local operator sessions.
  }

  sendUserMessage(text: string): void {
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.sendEvent({ type: "response.create" });
  }

  triggerGreeting(instructions?: string): void {
    this.sendEvent({
      type: "response.create",
      response: instructions ? { instructions } : {},
    });
  }

  submitToolResult(callId: string, result: unknown): void {
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: encodeJsonResult(result),
      },
    });
    this.sendEvent({ type: "response.create" });
  }

  acknowledgeMark(): void {
    // Marks are transport-specific in the bridge session; OpenAI Realtime has no mark ack event.
  }

  close(reason: RealtimeVoiceCloseReason = "completed"): void {
    if (this.closed) {
      return;
    }
    this.pendingCloseReason = reason;
    this.closed = true;
    this.connected = false;
    this.ws?.close(1000, reason);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private buildUrl(): string {
    const url = new URL(this.config.baseUrl ?? DEFAULT_BASE_URL);
    url.searchParams.set("model", this.config.model ?? DEFAULT_MODEL);
    return url.toString();
  }

  private buildSessionUpdate(): Record<string, unknown> {
    return {
      type: "session.update",
      session: {
        model: this.config.model ?? DEFAULT_MODEL,
        instructions: this.request.instructions,
        modalities: ["audio", "text"],
        voice: this.config.voice ?? DEFAULT_VOICE,
        input_audio_format: this.toRealtimeBetaAudioFormat(this.config.inputAudioFormat ?? "pcm16"),
        output_audio_format: this.toRealtimeBetaAudioFormat(
          this.config.outputAudioFormat ?? "pcm16",
        ),
        input_audio_transcription: this.config.inputTranscription ?? null,
        turn_detection: this.config.turnDetection ?? null,
        tools: this.request.tools,
      },
    };
  }

  private sendEvent(event: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(event));
  }

  private toRealtimeBetaAudioFormat(format: OpenAiRealtimeAudioFormat): OpenAiRealtimeAudioFormat {
    return format;
  }

  private handleMessage(data: Buffer | string): void {
    let event: { type?: string; [key: string]: unknown };
    try {
      event = JSON.parse(Buffer.isBuffer(data) ? data.toString() : data);
    } catch (err) {
      this.request.onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    switch (event.type) {
      case "response.output_audio.delta":
      case "response.audio.delta":
        if (typeof event.delta === "string") {
          this.request.onAudio(Buffer.from(event.delta, "base64"));
        }
        return;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        if (typeof event.delta === "string") {
          this.currentAssistantTranscript += event.delta;
          this.request.onTranscript?.("assistant", this.currentAssistantTranscript, false);
        }
        return;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        this.emitFinalAssistantTranscript(event.transcript);
        return;
      case "conversation.item.input_audio_transcription.completed":
        if (typeof event.transcript === "string") {
          this.request.onTranscript?.("user", event.transcript, true);
        }
        return;
      case "response.function_call_arguments.done":
        void this.request.onToolCall?.(this.toToolCall(event));
        return;
      case "input_audio_buffer.speech_started":
        this.request.onClearAudio();
        return;
      case "error":
        this.request.onError?.(new Error(this.formatError(event.error)));
        return;
    }
  }

  private emitFinalAssistantTranscript(transcript: unknown): void {
    const text = typeof transcript === "string" ? transcript : this.currentAssistantTranscript;
    if (text) {
      this.request.onTranscript?.("assistant", text, true);
    }
    this.currentAssistantTranscript = "";
  }

  private toToolCall(event: Record<string, unknown>): RealtimeVoiceToolCallEvent {
    return {
      itemId: asNonEmptyString(event.item_id) ?? "",
      callId: asNonEmptyString(event.call_id) ?? "",
      name: asNonEmptyString(event.name) ?? "",
      args: parseToolArguments(event.arguments),
    };
  }

  private formatError(error: unknown): string {
    if (typeof error === "string") {
      return error;
    }
    if (error && typeof error === "object" && "message" in error) {
      return String((error as { message: unknown }).message);
    }
    return "OpenAI Realtime error";
  }
}

export class OpenAiRealtimeVoiceProvider implements RealtimeVoiceProvider {
  readonly id = "openai";
  readonly aliases = ["openai-realtime", "gpt-realtime"];
  readonly label = "OpenAI Realtime";
  readonly readiness = "live";
  private readonly env: NodeJS.ProcessEnv;
  private readonly webSocketFactory: OpenAiRealtimeWebSocketFactory;

  constructor(options: OpenAiRealtimeVoiceProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url, opts) => new WebSocket(url, opts) as unknown as OpenAiRealtimeWebSocketLike);
  }

  resolveConfig({ rawConfig }: { rawConfig: RealtimeVoiceProviderConfig }) {
    return normalizeConfig(rawConfig, this.env);
  }

  isConfigured({ providerConfig }: { providerConfig: RealtimeVoiceProviderConfig }) {
    return Boolean(asNonEmptyString(providerConfig.apiKey));
  }

  createBridge(request: RealtimeVoiceBridgeCreateRequest): RealtimeVoiceBridge {
    return new OpenAiRealtimeVoiceBridge(
      request,
      normalizeConfig(request.providerConfig, this.env),
      this.webSocketFactory,
    );
  }
}

export function createOpenAiRealtimeVoiceProvider(
  options?: OpenAiRealtimeVoiceProviderOptions,
): OpenAiRealtimeVoiceProvider {
  return new OpenAiRealtimeVoiceProvider(options);
}
