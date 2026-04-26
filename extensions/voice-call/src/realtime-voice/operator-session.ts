import type {
  RealtimeVoiceCloseReason,
  RealtimeVoiceProvider,
  RealtimeVoiceProviderConfig,
  RealtimeVoiceRole,
  RealtimeVoiceTool,
  RealtimeVoiceToolCallEvent,
} from "./provider-types.js";
import {
  resolveConfiguredRealtimeVoiceProvider,
  type ResolveConfiguredRealtimeVoiceProviderParams,
} from "./provider-resolver.js";
import {
  createRealtimeVoiceBridgeSession,
  type RealtimeVoiceBridgeSession,
  type RealtimeVoiceMarkStrategy,
} from "./session-runtime.js";

export type RealtimeVoiceOperatorSessionEvent =
  | { type: "ready"; providerId: string }
  | { type: "audio"; audio: Buffer }
  | { type: "clearAudio" }
  | { type: "mark"; markName: string }
  | { type: "transcript"; role: RealtimeVoiceRole; text: string; isFinal: boolean }
  | { type: "toolCall"; event: RealtimeVoiceToolCallEvent }
  | { type: "toolResult"; callId: string; result: unknown }
  | { type: "error"; error: Error }
  | { type: "close"; reason: RealtimeVoiceCloseReason };

export type RealtimeVoiceOperatorSession = {
  readonly providerId: string;
  readonly providerLabel?: string;
  cancel(): void;
  connect(): Promise<void>;
  sendAudio(audio: Buffer): void;
  sendUserMessage(text: string): void;
  setMediaTimestamp(ts: number): void;
  submitToolResult(callId: string, result: unknown): void;
  triggerGreeting(instructions?: string): void;
  acknowledgeMark(): void;
  close(reason?: RealtimeVoiceCloseReason): void;
  isConnected(): boolean;
  getEvents(): RealtimeVoiceOperatorSessionEvent[];
};

export type RealtimeVoiceOperatorSessionParams = Omit<
  ResolveConfiguredRealtimeVoiceProviderParams,
  "noRegisteredProviderMessage"
> & {
  instructions?: string;
  initialGreetingInstructions?: string;
  markStrategy?: RealtimeVoiceMarkStrategy;
  triggerGreetingOnReady?: boolean;
  tools?: RealtimeVoiceTool[];
  onEvent?: (event: RealtimeVoiceOperatorSessionEvent) => void;
  onToolCall?: (
    event: RealtimeVoiceToolCallEvent,
    session: RealtimeVoiceOperatorSession,
  ) => void | Promise<void>;
};

type ResolvedOperatorProvider = {
  provider: RealtimeVoiceProvider;
  providerConfig: RealtimeVoiceProviderConfig;
};

function resolveOperatorProvider(
  params: RealtimeVoiceOperatorSessionParams,
): ResolvedOperatorProvider {
  return resolveConfiguredRealtimeVoiceProvider({
    configuredProviderId: params.configuredProviderId,
    providerConfigs: params.providerConfigs,
    providers: params.providers,
    defaultProviderId: params.defaultProviderId,
    defaultModel: params.defaultModel,
    noRegisteredProviderMessage: "No realtime voice provider is available for operator sessions",
  });
}

export function createRealtimeVoiceOperatorSession(
  params: RealtimeVoiceOperatorSessionParams,
): RealtimeVoiceOperatorSession {
  const { provider, providerConfig } = resolveOperatorProvider(params);
  const events: RealtimeVoiceOperatorSessionEvent[] = [];
  let bridgeSession!: RealtimeVoiceBridgeSession;
  let operatorSession!: RealtimeVoiceOperatorSession;

  const record = (event: RealtimeVoiceOperatorSessionEvent) => {
    events.push(event);
    params.onEvent?.(event);
  };

  bridgeSession = createRealtimeVoiceBridgeSession({
    provider,
    providerConfig,
    instructions: params.instructions,
    initialGreetingInstructions: params.initialGreetingInstructions,
    markStrategy: params.markStrategy,
    triggerGreetingOnReady: params.triggerGreetingOnReady,
    tools: params.tools,
    audioSink: {
      sendAudio: (audio) => record({ type: "audio", audio: Buffer.from(audio) }),
      clearAudio: () => record({ type: "clearAudio" }),
      sendMark: (markName) => record({ type: "mark", markName }),
    },
    onReady: () => record({ type: "ready", providerId: provider.id }),
    onTranscript: (role, text, isFinal) => record({ type: "transcript", role, text, isFinal }),
    onToolCall: async (event) => {
      record({ type: "toolCall", event });
      await params.onToolCall?.(event, operatorSession);
    },
    onError: (error) => record({ type: "error", error }),
    onClose: (reason) => record({ type: "close", reason }),
  });

  operatorSession = {
    providerId: provider.id,
    providerLabel: provider.label,
    acknowledgeMark: () => bridgeSession.acknowledgeMark(),
    cancel: () => bridgeSession.close("cancelled"),
    close: (reason) => bridgeSession.close(reason),
    connect: () => bridgeSession.connect(),
    getEvents: () => [...events],
    isConnected: () => bridgeSession.bridge.isConnected(),
    sendAudio: (audio) => bridgeSession.sendAudio(audio),
    sendUserMessage: (text) => bridgeSession.sendUserMessage(text),
    setMediaTimestamp: (ts) => bridgeSession.setMediaTimestamp(ts),
    submitToolResult: (callId, result) => {
      bridgeSession.submitToolResult(callId, result);
      record({ type: "toolResult", callId, result });
    },
    triggerGreeting: (instructions) => bridgeSession.triggerGreeting(instructions),
  };

  return operatorSession;
}
