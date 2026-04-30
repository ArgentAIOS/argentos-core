import WebSocket from "ws";
import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCreateRequest,
  RealtimeVoiceBrowserSession,
  RealtimeVoiceBrowserSessionCreateRequest,
  RealtimeVoiceCloseReason,
  RealtimeVoiceProvider,
  RealtimeVoiceProviderConfig,
  RealtimeVoiceTool,
} from "./provider-types.js";

export type GeminiLiveWebSocketLike = {
  readyState: number;
  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: unknown) => void): void;
  on(event: "error", cb: (error: Error) => void): void;
  on(event: "close", cb: (code?: number, reason?: Buffer | string) => void): void;
  send(data: string): void;
  close(): void;
};

export type GeminiLiveWebSocketFactory = (
  url: string,
  options?: { headers?: Record<string, string> },
) => GeminiLiveWebSocketLike;

export type GeminiLiveProviderOptions = {
  env?: NodeJS.ProcessEnv;
  webSocketFactory?: GeminiLiveWebSocketFactory;
};

const DEFAULT_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
const DEFAULT_VOICE = "Kore";
const DEFAULT_WEBSOCKET_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const GEMINI_OUTPUT_SAMPLE_RATE_HZ = 24_000;

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readObjectField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = (value as Record<string, unknown>)[key];
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
}

function readArrayField(value: unknown, key: string): unknown[] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = (value as Record<string, unknown>)[key];
  return Array.isArray(raw) ? raw : undefined;
}

function normalizeModelName(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function appendApiKey(url: string, apiKey: string): string {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("key") && !parsed.searchParams.has("access_token")) {
    parsed.searchParams.set("key", apiKey);
  }
  return parsed.toString();
}

function normalizeConfig(
  rawConfig: RealtimeVoiceProviderConfig,
  env: NodeJS.ProcessEnv,
): RealtimeVoiceProviderConfig {
  const providers = readObjectField(rawConfig, "providers");
  const nested = providers?.google ?? providers?.gemini;
  const raw =
    nested && typeof nested === "object" ? (nested as RealtimeVoiceProviderConfig) : rawConfig;
  return {
    ...raw,
    apiKey:
      asNonEmptyString(raw.apiKey) ??
      asNonEmptyString(env.GEMINI_API_KEY) ??
      asNonEmptyString(env.GOOGLE_API_KEY),
    model: asNonEmptyString(raw.model) ?? DEFAULT_MODEL,
    voice: asNonEmptyString(raw.voice) ?? DEFAULT_VOICE,
    websocketUrl: asNonEmptyString(raw.websocketUrl) ?? DEFAULT_WEBSOCKET_URL,
    inputTranscription: asBoolean(raw.inputTranscription) ?? true,
    outputTranscription: asBoolean(raw.outputTranscription) ?? true,
  };
}

function toolToGeminiDeclaration(tool: RealtimeVoiceTool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function buildSetupMessage(request: RealtimeVoiceBridgeCreateRequest): Record<string, unknown> {
  const model = asNonEmptyString(request.providerConfig.model) ?? DEFAULT_MODEL;
  const voice = asNonEmptyString(request.providerConfig.voice) ?? DEFAULT_VOICE;
  const responseModalities = ["AUDIO"];
  const setup: Record<string, unknown> = {
    model: normalizeModelName(model),
    generationConfig: {
      responseModalities,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
    },
  };
  if (request.instructions) {
    setup.systemInstruction = {
      parts: [{ text: request.instructions }],
    };
  }
  if (request.tools?.length) {
    setup.tools = [
      {
        functionDeclarations: request.tools.map(toolToGeminiDeclaration),
      },
    ];
  }
  if (request.providerConfig.inputTranscription !== false) {
    setup.inputAudioTranscription = {};
  }
  if (request.providerConfig.outputTranscription !== false) {
    setup.outputAudioTranscription = {};
  }
  return { setup };
}

function dataToString(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  return String(data);
}

function closeReasonFromError(hasError: boolean): RealtimeVoiceCloseReason {
  return hasError ? "error" : "completed";
}

class GeminiLiveBridge implements RealtimeVoiceBridge {
  supportsToolResultContinuation = false;
  private ws: GeminiLiveWebSocketLike | undefined;
  private connected = false;
  private closed = false;
  private hadError = false;
  private readyResolved = false;
  private callNames = new Map<string, string>();
  private connectResolve: (() => void) | undefined;
  private connectReject: ((error: Error) => void) | undefined;

  constructor(
    private readonly request: RealtimeVoiceBridgeCreateRequest,
    private readonly webSocketFactory: GeminiLiveWebSocketFactory,
  ) {}

  connect(): Promise<void> {
    if (this.connected) {
      return Promise.resolve();
    }
    const apiKey = asNonEmptyString(this.request.providerConfig.apiKey);
    if (!apiKey) {
      return Promise.reject(
        new Error("Gemini Live provider requires GEMINI_API_KEY or GOOGLE_API_KEY"),
      );
    }
    const websocketUrl =
      asNonEmptyString(this.request.providerConfig.websocketUrl) ?? DEFAULT_WEBSOCKET_URL;
    const url = appendApiKey(websocketUrl, apiKey);
    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      const ws = this.webSocketFactory(url);
      this.ws = ws;
      ws.on("open", () => {
        this.connected = true;
        this.sendJson(buildSetupMessage(this.request));
      });
      ws.on("message", (data) => this.handleMessage(data));
      ws.on("error", (error) => this.fail(error));
      ws.on("close", () => this.finishClose());
    });
  }

  sendAudio(audio: Buffer): void {
    if (!audio.length) {
      return;
    }
    const sampleRate =
      this.request.audioFormat?.encoding === "pcm16"
        ? this.request.audioFormat.sampleRateHz
        : GEMINI_OUTPUT_SAMPLE_RATE_HZ;
    this.sendJson({
      realtimeInput: {
        audio: {
          mimeType: `audio/pcm;rate=${sampleRate}`,
          data: audio.toString("base64"),
        },
      },
    });
  }

  setMediaTimestamp(_ts: number): void {
    // Gemini Live derives realtime input activity from streamed media and activity signals.
  }

  sendUserMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    this.sendJson({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: trimmed }] }],
        turnComplete: true,
      },
    });
  }

  triggerGreeting(instructions?: string): void {
    this.sendUserMessage(instructions ?? "Start the realtime voice session.");
  }

  submitToolResult(callId: string, result: unknown): void {
    const name = this.callNames.get(callId) ?? callId;
    this.sendJson({
      toolResponse: {
        functionResponses: [
          {
            id: callId,
            name,
            response: { result },
          },
        ],
      },
    });
  }

  acknowledgeMark(): void {
    // Marks are transport-specific in other providers; Gemini Live has no equivalent ack.
  }

  close(reason: RealtimeVoiceCloseReason = "completed"): void {
    if (reason === "error") {
      this.hadError = true;
    }
    this.closed = true;
    this.ws?.close();
  }

  isConnected(): boolean {
    return this.connected && !this.closed;
  }

  private sendJson(payload: unknown): void {
    if (!this.ws || this.closed) {
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }

  private handleMessage(data: unknown): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(dataToString(data)) as Record<string, unknown>;
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if ("setupComplete" in payload) {
      this.resolveReady();
      return;
    }
    const serverContent = readObjectField(payload, "serverContent");
    if (serverContent) {
      this.handleServerContent(serverContent);
    }
    const toolCall = readObjectField(payload, "toolCall");
    if (toolCall) {
      this.handleToolCall(toolCall);
    }
    const cancellation = readObjectField(payload, "toolCallCancellation");
    if (cancellation) {
      const ids = readArrayField(cancellation, "ids") ?? [];
      for (const id of ids) {
        if (typeof id === "string") {
          this.callNames.delete(id);
        }
      }
    }
  }

  private handleServerContent(serverContent: Record<string, unknown>): void {
    const inputTranscription = readObjectField(serverContent, "inputTranscription");
    const outputTranscription = readObjectField(serverContent, "outputTranscription");
    const inputText = asNonEmptyString(inputTranscription?.text);
    const outputText = asNonEmptyString(outputTranscription?.text);
    if (inputText) {
      this.request.onTranscript?.("user", inputText, true);
    }
    if (outputText) {
      this.request.onTranscript?.("assistant", outputText, true);
    }
    const modelTurn = readObjectField(serverContent, "modelTurn");
    const parts = readArrayField(modelTurn, "parts") ?? [];
    for (const part of parts) {
      const inlineData = readObjectField(part, "inlineData");
      const data = asNonEmptyString(inlineData?.data);
      if (data) {
        this.request.onAudio(Buffer.from(data, "base64"));
      }
      const text = asNonEmptyString((part as Record<string, unknown>)?.text);
      if (text) {
        this.request.onTranscript?.("assistant", text, false);
      }
    }
    if (serverContent.interrupted === true) {
      this.request.onClearAudio();
    }
  }

  private handleToolCall(toolCall: Record<string, unknown>): void {
    const calls = readArrayField(toolCall, "functionCalls") ?? [];
    for (const call of calls) {
      const raw = call as Record<string, unknown>;
      const callId = asNonEmptyString(raw.id) ?? asNonEmptyString(raw.name);
      const name = asNonEmptyString(raw.name);
      if (!callId || !name) {
        continue;
      }
      this.callNames.set(callId, name);
      void this.request.onToolCall?.({
        itemId: callId,
        callId,
        name,
        args: raw.args,
      });
    }
  }

  private resolveReady(): void {
    if (this.readyResolved) {
      return;
    }
    this.readyResolved = true;
    this.request.onReady?.();
    this.connectResolve?.();
    this.connectResolve = undefined;
    this.connectReject = undefined;
  }

  private fail(error: Error): void {
    this.hadError = true;
    this.request.onError?.(error);
    if (!this.readyResolved) {
      this.connectReject?.(error);
      this.connectResolve = undefined;
      this.connectReject = undefined;
    }
  }

  private finishClose(): void {
    const reason = closeReasonFromError(this.hadError);
    this.connected = false;
    this.closed = true;
    if (!this.readyResolved) {
      this.connectReject?.(new Error("Gemini Live provider closed before setup completed"));
      this.connectResolve = undefined;
      this.connectReject = undefined;
    }
    this.request.onClose?.(reason);
  }
}

export class GeminiLiveProvider implements RealtimeVoiceProvider {
  readonly id = "google";
  readonly aliases = ["gemini", "google-live", "gemini-live"];
  readonly label = "Google Gemini Live";
  readonly readiness = "preview";
  private readonly env: NodeJS.ProcessEnv;
  private readonly webSocketFactory: GeminiLiveWebSocketFactory;

  constructor(options: GeminiLiveProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url, opts) => new WebSocket(url, opts) as unknown as GeminiLiveWebSocketLike);
  }

  resolveConfig({ rawConfig }: { rawConfig: RealtimeVoiceProviderConfig }) {
    return normalizeConfig(rawConfig, this.env);
  }

  isConfigured({ providerConfig }: { providerConfig: RealtimeVoiceProviderConfig }) {
    return Boolean(asNonEmptyString(providerConfig.apiKey));
  }

  createBridge(request: RealtimeVoiceBridgeCreateRequest): RealtimeVoiceBridge {
    const providerConfig = normalizeConfig(request.providerConfig, this.env);
    return new GeminiLiveBridge({ ...request, providerConfig }, this.webSocketFactory);
  }

  createBrowserSession(
    _request: RealtimeVoiceBrowserSessionCreateRequest,
  ): Promise<RealtimeVoiceBrowserSession> {
    return Promise.reject(
      new Error(
        "Gemini Live browser-direct sessions require an ephemeral token service; use gateway-relay",
      ),
    );
  }
}

export function createGeminiLiveProvider(options?: GeminiLiveProviderOptions): GeminiLiveProvider {
  return new GeminiLiveProvider(options);
}
