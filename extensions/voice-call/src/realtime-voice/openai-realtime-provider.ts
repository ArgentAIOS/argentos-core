import WebSocket from "ws";
import type {
  RealtimeVoiceAudioFormat,
  RealtimeVoiceBridge,
  RealtimeVoiceBrowserSession,
  RealtimeVoiceBrowserSessionCreateRequest,
  RealtimeVoiceBridgeCreateRequest,
  RealtimeVoiceCloseReason,
  RealtimeVoiceProvider,
  RealtimeVoiceProviderConfig,
  RealtimeVoiceToolCallEvent,
  RealtimeVoiceToolResultOptions,
} from "./provider-types.js";
import { REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ } from "./provider-types.js";

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
  temperature?: number;
  vadThreshold?: number;
  silenceDurationMs?: number;
  prefixPaddingMs?: number;
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
  fetch?: typeof fetch;
  webSocketFactory?: OpenAiRealtimeWebSocketFactory;
};

const DEFAULT_MODEL = "gpt-realtime-1.5";
const DEFAULT_INPUT_TRANSCRIPTION = { model: "gpt-4o-transcribe" };
const DEFAULT_VOICE = "marin";
const DEFAULT_BASE_URL = "wss://api.openai.com/v1/realtime";
const OPEN = 1;

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeConfig(
  rawConfig: RealtimeVoiceProviderConfig,
  env: NodeJS.ProcessEnv,
): OpenAiRealtimeVoiceProviderConfig {
  const providerConfig =
    rawConfig.providers && typeof rawConfig.providers === "object"
      ? (rawConfig.providers as Record<string, unknown>).openai
      : undefined;
  const raw =
    providerConfig && typeof providerConfig === "object"
      ? (providerConfig as RealtimeVoiceProviderConfig)
      : rawConfig;
  return {
    apiKey: asNonEmptyString(raw.apiKey) ?? asNonEmptyString(env.OPENAI_API_KEY),
    baseUrl: asNonEmptyString(raw.baseUrl) ?? DEFAULT_BASE_URL,
    inputTranscription:
      raw.inputTranscription === null
        ? null
        : typeof raw.inputTranscription === "object"
          ? (raw.inputTranscription as Record<string, unknown>)
          : DEFAULT_INPUT_TRANSCRIPTION,
    model: asNonEmptyString(raw.model) ?? DEFAULT_MODEL,
    voice: asNonEmptyString(raw.voice) ?? DEFAULT_VOICE,
    inputAudioFormat:
      (asNonEmptyString(raw.inputAudioFormat) as OpenAiRealtimeAudioFormat | undefined) ?? "pcm16",
    outputAudioFormat:
      (asNonEmptyString(raw.outputAudioFormat) as OpenAiRealtimeAudioFormat | undefined) ?? "pcm16",
    temperature: asFiniteNumber(raw.temperature),
    vadThreshold: asFiniteNumber(raw.vadThreshold),
    silenceDurationMs: asFiniteNumber(raw.silenceDurationMs),
    prefixPaddingMs: asFiniteNumber(raw.prefixPaddingMs),
    turnDetection:
      raw.turnDetection === null
        ? null
        : typeof raw.turnDetection === "object"
          ? (raw.turnDetection as Record<string, unknown>)
          : {
              type: "server_vad",
              threshold: asFiniteNumber(raw.vadThreshold) ?? 0.5,
              prefix_padding_ms: asFiniteNumber(raw.prefixPaddingMs) ?? 300,
              silence_duration_ms: asFiniteNumber(raw.silenceDurationMs) ?? 500,
              create_response: true,
            },
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
  private sessionConfigured = false;
  private closed = false;
  private pendingCloseReason: RealtimeVoiceCloseReason | undefined;
  private pendingAudio: Buffer[] = [];
  private currentAssistantTranscript = "";
  private toolCallBuffers = new Map<string, { name: string; callId: string; args: string }>();
  private markQueue: string[] = [];
  private responseStartTimestamp: number | undefined;
  private latestMediaTimestamp = 0;
  private lastAssistantItemId: string | undefined;
  private sessionReadyFired = false;
  private readonly audioFormat: RealtimeVoiceAudioFormat;

  constructor(
    private readonly request: RealtimeVoiceBridgeCreateRequest,
    private readonly config: OpenAiRealtimeVoiceProviderConfig,
    private readonly webSocketFactory: OpenAiRealtimeWebSocketFactory,
  ) {
    this.audioFormat = request.audioFormat ?? REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ;
  }

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
        this.sessionConfigured = false;
        this.sendEvent(this.buildSessionUpdate());
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
        this.sessionConfigured = false;
        this.closed = true;
        this.request.onClose?.(reason);
      });
    });
  }

  sendAudio(audio: Buffer): void {
    if (!this.sessionConfigured) {
      if (this.pendingAudio.length < 320) {
        this.pendingAudio.push(audio);
      }
      return;
    }
    this.sendEvent({ type: "input_audio_buffer.append", audio: audio.toString("base64") });
  }

  setMediaTimestamp(ts: number): void {
    this.latestMediaTimestamp = ts;
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

  submitToolResult(
    callId: string,
    result: unknown,
    options?: RealtimeVoiceToolResultOptions,
  ): void {
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: encodeJsonResult(result),
      },
    });
    if (!options?.willContinue) {
      this.sendEvent({ type: "response.create" });
    }
  }

  acknowledgeMark(): void {
    if (this.markQueue.length === 0) {
      return;
    }
    this.markQueue.shift();
    if (this.markQueue.length === 0) {
      this.responseStartTimestamp = undefined;
      this.lastAssistantItemId = undefined;
    }
  }

  close(reason: RealtimeVoiceCloseReason = "completed"): void {
    if (this.closed) {
      return;
    }
    this.pendingCloseReason = reason;
    this.closed = true;
    this.connected = false;
    this.sessionConfigured = false;
    this.ws?.close(1000, reason);
  }

  isConnected(): boolean {
    return this.connected && this.sessionConfigured;
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
        temperature: this.config.temperature ?? 0.8,
        tools: this.request.tools,
        ...(this.request.tools && this.request.tools.length > 0 ? { tool_choice: "auto" } : {}),
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
    if (this.audioFormat.encoding === "g711_ulaw") {
      return "g711_ulaw";
    }
    if (this.audioFormat.encoding === "pcm16") {
      return "pcm16";
    }
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
      case "session.updated":
        this.sessionConfigured = true;
        for (const chunk of this.pendingAudio.splice(0)) {
          this.sendAudio(chunk);
        }
        if (!this.sessionReadyFired) {
          this.sessionReadyFired = true;
          this.request.onReady?.();
        }
        return;
      case "response.output_audio.delta":
      case "response.audio.delta":
        if (typeof event.delta === "string") {
          this.request.onAudio(Buffer.from(event.delta, "base64"));
          if (this.responseStartTimestamp === undefined) {
            this.responseStartTimestamp = this.latestMediaTimestamp;
          }
          if (typeof event.item_id === "string") {
            this.lastAssistantItemId = event.item_id;
          }
          this.sendMark();
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
      case "response.function_call_arguments.delta": {
        const itemId = asNonEmptyString(event.item_id);
        if (!itemId) {
          return;
        }
        const existing = this.toolCallBuffers.get(itemId);
        if (existing) {
          existing.args += typeof event.delta === "string" ? event.delta : "";
        } else {
          this.toolCallBuffers.set(itemId, {
            name: asNonEmptyString(event.name) ?? "",
            callId: asNonEmptyString(event.call_id) ?? "",
            args: typeof event.delta === "string" ? event.delta : "",
          });
        }
        return;
      }
      case "response.function_call_arguments.done":
        void this.request.onToolCall?.(this.toToolCall(event));
        if (typeof event.item_id === "string") {
          this.toolCallBuffers.delete(event.item_id);
        }
        return;
      case "input_audio_buffer.speech_started":
        this.handleBargeIn();
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
    const itemId = asNonEmptyString(event.item_id) ?? "";
    const buffered = this.toolCallBuffers.get(itemId);
    return {
      itemId,
      callId: buffered?.callId || asNonEmptyString(event.call_id) || "",
      name: buffered?.name || asNonEmptyString(event.name) || "",
      args: parseToolArguments(buffered?.args || event.arguments),
    };
  }

  private handleBargeIn(): void {
    if (this.markQueue.length > 0 && this.lastAssistantItemId) {
      const audioEndMs =
        this.responseStartTimestamp === undefined
          ? 0
          : Math.max(0, this.latestMediaTimestamp - this.responseStartTimestamp);
      this.sendEvent({
        type: "conversation.item.truncate",
        item_id: this.lastAssistantItemId,
        content_index: 0,
        audio_end_ms: audioEndMs,
      });
      this.markQueue = [];
      this.lastAssistantItemId = undefined;
      this.responseStartTimestamp = undefined;
    }
    this.request.onClearAudio();
  }

  private sendMark(): void {
    const markName = `audio-${Date.now()}`;
    this.markQueue.push(markName);
    this.request.onMark?.(markName);
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
  private readonly fetchFn: typeof fetch;
  private readonly webSocketFactory: OpenAiRealtimeWebSocketFactory;

  constructor(options: OpenAiRealtimeVoiceProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchFn = options.fetch ?? fetch;
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

  async createBrowserSession(
    request: RealtimeVoiceBrowserSessionCreateRequest,
  ): Promise<RealtimeVoiceBrowserSession> {
    const config = normalizeConfig(request.providerConfig, this.env);
    const apiKey = config.apiKey ?? asNonEmptyString(this.env.OPENAI_API_KEY);
    if (!apiKey) {
      throw new Error("OpenAI Realtime browser session requires OPENAI_API_KEY");
    }
    const model = request.model ?? config.model ?? DEFAULT_MODEL;
    const voice = request.voice ?? config.voice ?? DEFAULT_VOICE;
    const response = await this.fetchFn("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          instructions: request.instructions,
          audio: { output: { voice } },
          ...(request.tools && request.tools.length > 0
            ? { tools: request.tools, tool_choice: "auto" }
            : {}),
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI Realtime browser session failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    const clientSecret =
      readStringField(payload, "value") ??
      readStringField(readObjectField(payload, "client_secret"), "value");
    if (!clientSecret) {
      throw new Error("OpenAI Realtime browser session did not return a client secret");
    }
    const expiresAt = readNumberField(payload, "expires_at");
    return {
      provider: this.id,
      transport: "webrtc-sdp",
      clientSecret,
      offerUrl: "https://api.openai.com/v1/realtime/calls",
      model,
      voice,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
  }
}

function readObjectField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = (value as Record<string, unknown>)[key];
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return asNonEmptyString((value as Record<string, unknown>)[key]);
}

function readNumberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

export function createOpenAiRealtimeVoiceProvider(
  options?: OpenAiRealtimeVoiceProviderOptions,
): OpenAiRealtimeVoiceProvider {
  return new OpenAiRealtimeVoiceProvider(options);
}
