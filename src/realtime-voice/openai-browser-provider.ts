import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBrowserSession,
  RealtimeVoiceBrowserSessionCreateRequest,
  RealtimeVoiceBridgeCreateRequest,
  RealtimeVoiceProvider,
  RealtimeVoiceProviderConfig,
} from "./provider-types.js";

export type OpenAiRealtimeBrowserProviderOptions = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
};

const DEFAULT_MODEL = "gpt-realtime-1.5";
const DEFAULT_VOICE = "marin";
const CLIENT_SECRET_URL = "https://api.openai.com/v1/realtime/client_secrets";
const OFFER_URL = "https://api.openai.com/v1/realtime/calls";

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function normalizeConfig(
  rawConfig: RealtimeVoiceProviderConfig,
  env: NodeJS.ProcessEnv,
): RealtimeVoiceProviderConfig {
  const nested =
    rawConfig.providers && typeof rawConfig.providers === "object"
      ? (rawConfig.providers as Record<string, unknown>).openai
      : undefined;
  const raw =
    nested && typeof nested === "object" ? (nested as RealtimeVoiceProviderConfig) : rawConfig;
  return {
    ...raw,
    apiKey: asNonEmptyString(raw.apiKey) ?? asNonEmptyString(env.OPENAI_API_KEY),
    model: asNonEmptyString(raw.model) ?? DEFAULT_MODEL,
    voice: asNonEmptyString(raw.voice) ?? DEFAULT_VOICE,
  };
}

export class OpenAiRealtimeBrowserProvider implements RealtimeVoiceProvider {
  readonly id = "openai";
  readonly aliases = ["openai-realtime", "gpt-realtime"];
  readonly label = "OpenAI Realtime";
  readonly readiness = "live";
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAiRealtimeBrowserProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchFn = options.fetch ?? fetch;
  }

  resolveConfig({ rawConfig }: { rawConfig: RealtimeVoiceProviderConfig }) {
    return normalizeConfig(rawConfig, this.env);
  }

  isConfigured({ providerConfig }: { providerConfig: RealtimeVoiceProviderConfig }) {
    return Boolean(asNonEmptyString(providerConfig.apiKey));
  }

  createBridge(_request: RealtimeVoiceBridgeCreateRequest): RealtimeVoiceBridge {
    throw new Error("OpenAI core browser provider does not support gateway relay sessions");
  }

  async createBrowserSession(
    request: RealtimeVoiceBrowserSessionCreateRequest,
  ): Promise<RealtimeVoiceBrowserSession> {
    const config = normalizeConfig(request.providerConfig, this.env);
    const apiKey = asNonEmptyString(config.apiKey);
    if (!apiKey) {
      throw new Error("OpenAI Realtime browser session requires OPENAI_API_KEY");
    }
    const model = request.model ?? asNonEmptyString(config.model) ?? DEFAULT_MODEL;
    const voice = request.voice ?? asNonEmptyString(config.voice) ?? DEFAULT_VOICE;
    const response = await this.fetchFn(CLIENT_SECRET_URL, {
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
      offerUrl: OFFER_URL,
      model,
      voice,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
  }
}

export function createOpenAiRealtimeBrowserProvider(
  options?: OpenAiRealtimeBrowserProviderOptions,
): OpenAiRealtimeBrowserProvider {
  return new OpenAiRealtimeBrowserProvider(options);
}
