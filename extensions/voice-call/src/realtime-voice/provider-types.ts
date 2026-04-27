export type RealtimeVoiceProviderId = string;

export type RealtimeVoiceRole = "user" | "assistant";

export type RealtimeVoiceCloseReason = "completed" | "error" | "cancelled";

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

export type RealtimeVoiceBridgeCallbacks = {
  onAudio: (muLaw: Buffer) => void;
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
  instructions?: string;
  tools?: RealtimeVoiceTool[];
};

export type RealtimeVoiceBridge = {
  connect(): Promise<void>;
  sendAudio(audio: Buffer): void;
  setMediaTimestamp(ts: number): void;
  sendUserMessage?(text: string): void;
  triggerGreeting?(instructions?: string): void;
  submitToolResult(callId: string, result: unknown): void;
  acknowledgeMark(): void;
  close(reason?: RealtimeVoiceCloseReason): void;
  isConnected(): boolean;
};

export type RealtimeVoiceProviderResolveContext = {
  rawConfig: RealtimeVoiceProviderConfig;
};

export type RealtimeVoiceProviderConfiguredContext = {
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
};
