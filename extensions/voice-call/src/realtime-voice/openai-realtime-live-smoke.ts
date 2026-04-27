import { pathToFileURL } from "node:url";
import { createOpenAiRealtimeVoiceProvider } from "./openai-realtime-provider.js";
import {
  createRealtimeVoiceOperatorSession,
  type RealtimeVoiceOperatorSession,
  type RealtimeVoiceOperatorSessionEvent,
  type RealtimeVoiceOperatorSessionParams,
} from "./operator-session.js";

export type OpenAiRealtimeLiveSmokeResult = {
  ok: boolean;
  providerId: string;
  providerLabel?: string;
  finalAssistantTranscript?: string;
  audioChunkCount: number;
  eventTypes: string[];
  error?: string;
};

export type OpenAiRealtimeLiveSmokeOptions = {
  apiKey?: string;
  createSession?: (params: RealtimeVoiceOperatorSessionParams) => RealtimeVoiceOperatorSession;
  env?: NodeJS.ProcessEnv;
  instructions?: string;
  prompt?: string;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PROMPT = "Say exactly: Argent realtime smoke ok.";
const DEFAULT_INSTRUCTIONS = "Live smoke test. Reply with exactly: Argent realtime smoke ok.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeEvents(
  events: RealtimeVoiceOperatorSessionEvent[],
  session: Pick<RealtimeVoiceOperatorSession, "providerId" | "providerLabel">,
): OpenAiRealtimeLiveSmokeResult {
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
    providerId: session.providerId,
    providerLabel: session.providerLabel,
    finalAssistantTranscript,
    audioChunkCount,
    eventTypes: events.map((event) => event.type),
    error: errorEvent?.error.message,
  };
}

export async function runOpenAiRealtimeLiveSmoke({
  apiKey,
  createSession = createRealtimeVoiceOperatorSession,
  env = process.env,
  instructions = DEFAULT_INSTRUCTIONS,
  prompt = DEFAULT_PROMPT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: OpenAiRealtimeLiveSmokeOptions = {}): Promise<OpenAiRealtimeLiveSmokeResult> {
  const provider = createOpenAiRealtimeVoiceProvider({ env });
  const events: RealtimeVoiceOperatorSessionEvent[] = [];
  const session = createSession({
    providers: [provider],
    configuredProviderId: "openai",
    providerConfigs: { openai: apiKey ? { apiKey } : {} },
    instructions,
    onEvent: (event) => events.push(event),
  });

  try {
    await session.connect();
    session.sendUserMessage(prompt);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const summary = summarizeEvents(events, session);
      if (summary.ok || summary.error) {
        return summary;
      }
      await sleep(100);
    }
    return {
      ...summarizeEvents(events, session),
      ok: false,
      error: `Timed out after ${timeoutMs}ms waiting for final assistant transcript and audio output`,
    };
  } finally {
    session.close("completed");
  }
}

async function main(): Promise<void> {
  try {
    const result = await runOpenAiRealtimeLiveSmoke();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          providerId: "openai",
          providerLabel: "OpenAI Realtime",
          audioChunkCount: 0,
          eventTypes: [],
          error: err instanceof Error ? err.message : String(err),
        } satisfies OpenAiRealtimeLiveSmokeResult,
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
