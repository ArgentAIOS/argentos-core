import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCreateRequest,
  RealtimeVoiceCloseReason,
  RealtimeVoiceProvider,
  RealtimeVoiceRole,
  RealtimeVoiceToolCallEvent,
} from "./provider-types.js";

export type FakeRealtimeVoiceScriptEvent =
  | { type: "ready" }
  | { type: "audio"; audio: Buffer | string | number[] }
  | { type: "clearAudio" }
  | { type: "mark"; markName: string }
  | { type: "transcript"; role: RealtimeVoiceRole; text: string; isFinal?: boolean }
  | { type: "toolCall"; event: RealtimeVoiceToolCallEvent }
  | { type: "error"; message: string }
  | { type: "close"; reason?: RealtimeVoiceCloseReason };

export type FakeRealtimeVoiceProviderConfig = {
  configured?: boolean;
  autoReady?: boolean;
  script?: FakeRealtimeVoiceScriptEvent[];
};

export type FakeRealtimeVoiceBridgeState = {
  audioInputs: Buffer[];
  connected: boolean;
  greetings: Array<string | undefined>;
  mediaTimestamp: number;
  markAcks: number;
  toolResults: Array<{ callId: string; result: unknown }>;
  userMessages: string[];
};

function toAudioBuffer(audio: Buffer | string | number[]): Buffer {
  if (Buffer.isBuffer(audio)) {
    return audio;
  }
  if (Array.isArray(audio)) {
    return Buffer.from(audio);
  }
  return Buffer.from(audio);
}

export class FakeRealtimeVoiceBridge implements RealtimeVoiceBridge {
  readonly state: FakeRealtimeVoiceBridgeState = {
    audioInputs: [],
    connected: false,
    greetings: [],
    mediaTimestamp: 0,
    markAcks: 0,
    toolResults: [],
    userMessages: [],
  };
  private closed = false;

  constructor(
    private readonly request: RealtimeVoiceBridgeCreateRequest,
    private readonly config: FakeRealtimeVoiceProviderConfig,
  ) {}

  async connect(): Promise<void> {
    if (this.closed) {
      throw new Error("Fake realtime voice bridge is closed");
    }
    this.state.connected = true;
    const script =
      this.config.script ?? (this.config.autoReady === false ? [] : [{ type: "ready" }]);
    for (const event of script) {
      this.emit(event);
    }
  }

  sendAudio(audio: Buffer): void {
    this.state.audioInputs.push(Buffer.from(audio));
  }

  setMediaTimestamp(ts: number): void {
    this.state.mediaTimestamp = ts;
  }

  sendUserMessage(text: string): void {
    this.state.userMessages.push(text);
  }

  triggerGreeting(instructions?: string): void {
    this.state.greetings.push(instructions);
  }

  submitToolResult(callId: string, result: unknown): void {
    this.state.toolResults.push({ callId, result });
  }

  acknowledgeMark(): void {
    this.state.markAcks += 1;
  }

  close(reason: RealtimeVoiceCloseReason = "completed"): void {
    this.closeWith(reason);
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  emit(event: FakeRealtimeVoiceScriptEvent): void {
    if (this.closed && event.type !== "close") {
      return;
    }
    switch (event.type) {
      case "ready":
        this.request.onReady?.();
        return;
      case "audio":
        this.request.onAudio(toAudioBuffer(event.audio));
        return;
      case "clearAudio":
        this.request.onClearAudio();
        return;
      case "mark":
        this.request.onMark?.(event.markName);
        return;
      case "transcript":
        this.request.onTranscript?.(event.role, event.text, event.isFinal ?? false);
        return;
      case "toolCall":
        this.request.onToolCall?.(event.event);
        return;
      case "error":
        this.request.onError?.(new Error(event.message));
        return;
      case "close":
        this.closeWith(event.reason ?? "completed");
        return;
    }
  }

  private closeWith(reason: RealtimeVoiceCloseReason): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.state.connected = false;
    this.request.onClose?.(reason);
  }
}

export class FakeRealtimeVoiceProvider implements RealtimeVoiceProvider {
  readonly id = "fake";
  readonly aliases = ["test", "local-fake"];
  readonly label = "Fake realtime voice";
  readonly bridges: FakeRealtimeVoiceBridge[] = [];

  resolveConfig({
    rawConfig,
  }: {
    rawConfig: Record<string, unknown>;
  }): FakeRealtimeVoiceProviderConfig {
    return {
      configured: typeof rawConfig.configured === "boolean" ? rawConfig.configured : true,
      autoReady: typeof rawConfig.autoReady === "boolean" ? rawConfig.autoReady : true,
      script: Array.isArray(rawConfig.script)
        ? (rawConfig.script as FakeRealtimeVoiceScriptEvent[])
        : undefined,
    };
  }

  isConfigured({ providerConfig }: { providerConfig: Record<string, unknown> }): boolean {
    return providerConfig.configured !== false;
  }

  createBridge(request: RealtimeVoiceBridgeCreateRequest): RealtimeVoiceBridge {
    const bridge = new FakeRealtimeVoiceBridge(
      request,
      request.providerConfig as FakeRealtimeVoiceProviderConfig,
    );
    this.bridges.push(bridge);
    return bridge;
  }
}

export function createFakeRealtimeVoiceProvider(): FakeRealtimeVoiceProvider {
  return new FakeRealtimeVoiceProvider();
}
