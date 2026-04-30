import { pathToFileURL } from "node:url";
import type {
  RealtimeVoiceOperatorSessionEvent,
  RealtimeVoiceOperatorSessionParams,
} from "./operator-session.js";
import type { RealtimeVoiceProvider, RealtimeVoiceProviderConfig } from "./provider-types.js";
import {
  createRealtimeLocalAudioOperatorSession,
  type RealtimeLocalAudioOperatorInputConfig,
  type RealtimeLocalAudioOperatorOutputConfig,
  type RealtimeLocalAudioOperatorSessionParams,
} from "./local-audio-process-session.js";
import { createOpenAiRealtimeVoiceProvider } from "./openai-realtime-provider.js";

export type RealtimeLocalAudioLiveSmokeMode = "dry-run" | "process";

export type RealtimeLocalAudioLiveSmokeResult = {
  ok: boolean;
  mode: RealtimeLocalAudioLiveSmokeMode;
  realDeviceEvidence: boolean;
  providerId?: string;
  providerLabel?: string;
  finalAssistantTranscript?: string;
  audioChunkCount: number;
  eventTypes: string[];
  error?: string;
};

export type RealtimeLocalAudioLiveSmokeOptions = {
  allowTestOnlyProviders?: boolean;
  apiKey?: string;
  configuredProviderId?: string;
  createSession?: (
    params: RealtimeLocalAudioOperatorSessionParams,
  ) => ReturnType<typeof createRealtimeLocalAudioOperatorSession>;
  defaultProviderId?: string;
  env?: NodeJS.ProcessEnv;
  instructions?: string;
  mode?: RealtimeLocalAudioLiveSmokeMode;
  platform?: NodeJS.Platform;
  prompt?: string;
  providerConfigs?: Record<string, RealtimeVoiceProviderConfig>;
  providers?: RealtimeVoiceProvider[];
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PROMPT = "Say exactly: Argent local audio smoke ok.";
const DEFAULT_INSTRUCTIONS = "Live smoke test. Reply with exactly: Argent local audio smoke ok.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function smokeAudioConfig(mode: RealtimeLocalAudioLiveSmokeMode): {
  input: RealtimeLocalAudioOperatorInputConfig;
  output: RealtimeLocalAudioOperatorOutputConfig;
} {
  if (mode === "dry-run") {
    return {
      input: { kind: "synthetic", frames: [] },
      output: { kind: "capture" },
    };
  }
  return {
    input: { kind: "process" },
    output: { kind: "process" },
  };
}

function summarizeEvents(
  events: RealtimeVoiceOperatorSessionEvent[],
  mode: RealtimeLocalAudioLiveSmokeMode,
  session: Pick<
    ReturnType<typeof createRealtimeLocalAudioOperatorSession>["operatorSession"],
    "providerId" | "providerLabel"
  >,
): RealtimeLocalAudioLiveSmokeResult {
  const finalAssistantTranscript = events.find(
    (event): event is Extract<RealtimeVoiceOperatorSessionEvent, { type: "transcript" }> =>
      event.type === "transcript" && event.role === "assistant" && event.isFinal,
  )?.text;
  const errorEvent = events.find(
    (event): event is Extract<RealtimeVoiceOperatorSessionEvent, { type: "error" }> =>
      event.type === "error",
  );
  const audioChunkCount = events.filter((event) => event.type === "audio").length;

  return {
    ok: Boolean(finalAssistantTranscript) && audioChunkCount > 0 && !errorEvent,
    mode,
    realDeviceEvidence:
      mode === "process" &&
      session.providerId !== "fake" &&
      Boolean(finalAssistantTranscript) &&
      audioChunkCount > 0 &&
      !errorEvent,
    providerId: session.providerId,
    providerLabel: session.providerLabel,
    finalAssistantTranscript,
    audioChunkCount,
    eventTypes: events.map((event) => event.type),
    error: errorEvent?.error.message,
  };
}

export async function runRealtimeLocalAudioLiveSmoke({
  allowTestOnlyProviders,
  apiKey,
  configuredProviderId = "openai",
  createSession = createRealtimeLocalAudioOperatorSession,
  defaultProviderId,
  env = process.env,
  instructions = DEFAULT_INSTRUCTIONS,
  mode = env.ARGENT_REALTIME_AUDIO_SMOKE_MODE === "process" ? "process" : "dry-run",
  platform = process.platform,
  prompt = env.ARGENT_REALTIME_AUDIO_SMOKE_PROMPT || DEFAULT_PROMPT,
  providerConfigs,
  providers,
  timeoutMs = Number(env.ARGENT_REALTIME_AUDIO_SMOKE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
}: RealtimeLocalAudioLiveSmokeOptions = {}): Promise<RealtimeLocalAudioLiveSmokeResult> {
  const resolvedProviders = providers ?? [createOpenAiRealtimeVoiceProvider({ env })];
  const resolvedProviderConfigs =
    providerConfigs ?? (apiKey ? { [configuredProviderId]: { apiKey } } : {});
  const events: RealtimeVoiceOperatorSessionEvent[] = [];
  const audioConfig = smokeAudioConfig(mode);
  const session = createSession({
    allowTestOnlyProviders,
    configuredProviderId,
    defaultProviderId,
    env,
    instructions,
    onEvent: (event) => events.push(event),
    platform,
    providerConfigs: resolvedProviderConfigs,
    providers: resolvedProviders,
    ...audioConfig,
  } satisfies RealtimeLocalAudioOperatorSessionParams & RealtimeVoiceOperatorSessionParams);

  try {
    await session.start();
    session.operatorSession.sendUserMessage(prompt);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const summary = summarizeEvents(events, mode, session.operatorSession);
      if (summary.ok || summary.error) {
        return summary;
      }
      await sleep(100);
    }
    return {
      ...summarizeEvents(events, mode, session.operatorSession),
      ok: false,
      error: `Timed out after ${timeoutMs}ms waiting for final assistant transcript and audio output`,
    };
  } finally {
    session.stop("completed");
  }
}

async function main(): Promise<void> {
  try {
    const result = await runRealtimeLocalAudioLiveSmoke();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          mode: process.env.ARGENT_REALTIME_AUDIO_SMOKE_MODE === "process" ? "process" : "dry-run",
          realDeviceEvidence: false,
          audioChunkCount: 0,
          eventTypes: [],
          error: err instanceof Error ? err.message : String(err),
        } satisfies RealtimeLocalAudioLiveSmokeResult,
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
