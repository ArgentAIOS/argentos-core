export type RealtimeVoiceProviderId = string;

export type RealtimeVoiceRole = "user" | "assistant";

export type RealtimeVoiceCloseReason = "completed" | "error" | "cancelled";

export type RealtimeVoiceAudioFormat =
  | {
      encoding: "g711_ulaw";
      sampleRateHz: 8000;
      channels: 1;
    }
  | {
      encoding: "pcm16";
      sampleRateHz: 24000;
      channels: 1;
    };

export const REALTIME_VOICE_AUDIO_FORMAT_G711_ULAW_8KHZ: RealtimeVoiceAudioFormat = {
  encoding: "g711_ulaw",
  sampleRateHz: 8000,
  channels: 1,
};

export const REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ: RealtimeVoiceAudioFormat = {
  encoding: "pcm16",
  sampleRateHz: 24000,
  channels: 1,
};

export type RealtimeVoiceProviderConfig = Record<string, unknown>;

export type RealtimeVoiceProviderReadiness = "live" | "test-only" | "preview";

export type RealtimeVoiceTool = {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type RealtimeVoiceToolCallEvent = {
  itemId: string;
  callId: string;
  name: string;
  args: unknown;
};

export type RealtimeVoiceToolResultOptions = {
  willContinue?: boolean;
};

export type RealtimeVoiceBridgeCallbacks = {
  onAudio: (audio: Buffer) => void;
  onClearAudio: () => void;
  onMark?: (markName: string) => void;
  onTranscript?: (role: RealtimeVoiceRole, text: string, isFinal: boolean) => void;
  onToolCall?: (event: RealtimeVoiceToolCallEvent) => void | Promise<void>;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onClose?: (reason: RealtimeVoiceCloseReason) => void;
};

export type RealtimeVoiceBridgeCreateRequest = RealtimeVoiceBridgeCallbacks & {
  providerConfig: RealtimeVoiceProviderConfig;
  audioFormat?: RealtimeVoiceAudioFormat;
  instructions?: string;
  tools?: RealtimeVoiceTool[];
};

export type RealtimeVoiceBrowserSessionCreateRequest = {
  providerConfig: RealtimeVoiceProviderConfig;
  instructions?: string;
  tools?: RealtimeVoiceTool[];
  model?: string;
  voice?: string;
};

export type RealtimeVoiceBrowserAudioContract = {
  inputEncoding: "pcm16" | "g711_ulaw";
  inputSampleRateHz: number;
  outputEncoding: "pcm16" | "g711_ulaw";
  outputSampleRateHz: number;
};

export type RealtimeVoiceBrowserWebRtcSdpSession = {
  provider: RealtimeVoiceProviderId;
  transport?: "webrtc-sdp";
  clientSecret: string;
  offerUrl?: string;
  model?: string;
  voice?: string;
  expiresAt?: number;
};

export type RealtimeVoiceBrowserJsonPcmWebSocketSession = {
  provider: RealtimeVoiceProviderId;
  transport: "json-pcm-websocket";
  protocol: string;
  clientSecret: string;
  websocketUrl: string;
  audio: RealtimeVoiceBrowserAudioContract;
  initialMessage?: unknown;
  model?: string;
  voice?: string;
  expiresAt?: number;
};

export type RealtimeVoiceBrowserGatewayRelaySession = {
  provider: RealtimeVoiceProviderId;
  transport: "gateway-relay";
  relaySessionId: string;
  audio: RealtimeVoiceBrowserAudioContract;
  model?: string;
  voice?: string;
  expiresAt?: number;
};

export type RealtimeVoiceBrowserManagedRoomSession = {
  provider: RealtimeVoiceProviderId;
  transport: "managed-room";
  roomUrl: string;
  token?: string;
  model?: string;
  voice?: string;
  expiresAt?: number;
};

export type RealtimeVoiceBrowserSession =
  | RealtimeVoiceBrowserWebRtcSdpSession
  | RealtimeVoiceBrowserJsonPcmWebSocketSession
  | RealtimeVoiceBrowserGatewayRelaySession
  | RealtimeVoiceBrowserManagedRoomSession;

export type RealtimeVoiceBridge = {
  supportsToolResultContinuation?: boolean;
  connect(): Promise<void>;
  sendAudio(audio: Buffer): void;
  setMediaTimestamp(ts: number): void;
  sendUserMessage?(text: string): void;
  triggerGreeting?(instructions?: string): void;
  submitToolResult(callId: string, result: unknown, options?: RealtimeVoiceToolResultOptions): void;
  acknowledgeMark(): void;
  close(reason?: RealtimeVoiceCloseReason): void;
  isConnected(): boolean;
};

export type RealtimeVoiceProviderResolveContext = {
  cfg?: unknown;
  rawConfig: RealtimeVoiceProviderConfig;
};

export type RealtimeVoiceProviderConfiguredContext = {
  cfg?: unknown;
  providerConfig: RealtimeVoiceProviderConfig;
};

export type RealtimeVoiceProvider = {
  id: RealtimeVoiceProviderId;
  aliases?: string[];
  label?: string;
  readiness?: RealtimeVoiceProviderReadiness;
  resolveConfig?: (ctx: RealtimeVoiceProviderResolveContext) => RealtimeVoiceProviderConfig;
  isConfigured?: (ctx: RealtimeVoiceProviderConfiguredContext) => boolean;
  createBridge(request: RealtimeVoiceBridgeCreateRequest): RealtimeVoiceBridge;
  createBrowserSession?(
    request: RealtimeVoiceBrowserSessionCreateRequest,
  ): Promise<RealtimeVoiceBrowserSession>;
};
