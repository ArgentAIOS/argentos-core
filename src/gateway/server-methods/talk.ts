import type {
  RealtimeVoiceProvider,
  RealtimeVoiceProviderConfig,
  RealtimeVoiceTool,
} from "../../realtime-voice/provider-types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { loadConfig, type ArgentConfig } from "../../config/config.js";
import { createGeminiLiveProvider } from "../../realtime-voice/gemini-live-provider.js";
import { createOpenAiRealtimeBrowserProvider } from "../../realtime-voice/openai-browser-provider.js";
import { resolveConfiguredRealtimeVoiceProvider } from "../../realtime-voice/provider-resolver.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type TalkRealtimeAudioParams,
  type TalkRealtimeMarkParams,
  type TalkRealtimeSessionParams,
  type TalkRealtimeStopParams,
  type TalkRealtimeToolResultParams,
  validateTalkRealtimeAudioParams,
  validateTalkRealtimeMarkParams,
  validateTalkModeParams,
  validateTalkRealtimeSessionParams,
  validateTalkRealtimeStopParams,
  validateTalkRealtimeToolResultParams,
} from "../protocol/index.js";
import {
  acknowledgeTalkRealtimeRelayMark,
  createTalkRealtimeRelaySession,
  sendTalkRealtimeRelayAudio,
  stopTalkRealtimeRelaySession,
  submitTalkRealtimeRelayToolResult,
} from "../talk-realtime-relay.js";

export type TalkRealtimeTransport = "auto" | "webrtc-sdp" | "gateway-relay";

export type CreateTalkHandlersOptions = {
  loadConfig?: () => ArgentConfig;
  providers?: RealtimeVoiceProvider[];
};

function defaultProviders(): RealtimeVoiceProvider[] {
  return [createOpenAiRealtimeBrowserProvider(), createGeminiLiveProvider()];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTools(
  tools: TalkRealtimeSessionParams["tools"],
): RealtimeVoiceTool[] | undefined {
  if (!Array.isArray(tools)) {
    return undefined;
  }
  return tools.filter((tool): tool is RealtimeVoiceTool => {
    if (!tool || typeof tool !== "object") {
      return false;
    }
    const raw = tool as Record<string, unknown>;
    return raw.type === "function" && typeof raw.name === "string" && raw.name.trim().length > 0;
  });
}

function providerConfigsFromTalkConfig(
  cfg: ArgentConfig,
): Record<string, RealtimeVoiceProviderConfig | undefined> {
  return Object.fromEntries(
    Object.entries(cfg.talk?.realtime?.providers ?? {}).map(([key, value]) => [
      key,
      asObject(value),
    ]),
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidParams(method: string, message: string) {
  return errorShape(ErrorCodes.INVALID_REQUEST, `invalid ${method} params: ${message}`);
}

export function createTalkHandlers(
  options: CreateTalkHandlersOptions = {},
): GatewayRequestHandlers {
  const getConfig = options.loadConfig ?? loadConfig;
  const providers = options.providers ?? defaultProviders();

  return {
    "talk.mode": ({ params, respond, context, client, isWebchatConnect }) => {
      if (client && isWebchatConnect(client.connect) && !context.hasConnectedMobileNode()) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "talk disabled: no connected iOS/Android nodes"),
        );
        return;
      }
      if (!validateTalkModeParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid talk.mode params: ${formatValidationErrors(validateTalkModeParams.errors)}`,
          ),
        );
        return;
      }
      const payload = {
        enabled: (params as { enabled: boolean }).enabled,
        phase: (params as { phase?: string }).phase ?? null,
        ts: Date.now(),
      };
      context.broadcast("talk.mode", payload, { dropIfSlow: true });
      respond(true, payload, undefined);
    },
    "talk.realtime.session": async ({ params, respond, context, client }) => {
      if (!validateTalkRealtimeSessionParams(params)) {
        respond(
          false,
          undefined,
          invalidParams(
            "talk.realtime.session",
            formatValidationErrors(validateTalkRealtimeSessionParams.errors),
          ),
        );
        return;
      }

      try {
        const cfg = getConfig();
        const realtimeConfig = cfg.talk?.realtime;
        if (realtimeConfig?.enabled === false) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.UNAVAILABLE, "talk realtime is disabled"),
          );
          return;
        }

        const p = params as TalkRealtimeSessionParams;
        const requestedProviderId = p.provider ?? realtimeConfig?.provider;
        const model = p.model ?? realtimeConfig?.model;
        const voice = p.voice ?? realtimeConfig?.voice;
        const transport = (p.transport ??
          realtimeConfig?.transport ??
          "auto") as TalkRealtimeTransport;
        const instructions =
          p.instructions ??
          realtimeConfig?.instructions ??
          "Speak naturally and keep responses concise.";
        const resolved = resolveConfiguredRealtimeVoiceProvider({
          cfg,
          configuredProviderId: requestedProviderId,
          defaultProviderId: "openai",
          defaultModel: model,
          providerConfigs: providerConfigsFromTalkConfig(cfg),
          providers,
          noRegisteredProviderMessage: "No realtime voice provider registered for Talk",
        });
        const providerConfig = {
          ...resolved.providerConfig,
          ...(model ? { model } : {}),
          ...(voice ? { voice } : {}),
        };
        const tools = normalizeTools(p.tools);

        if (transport !== "gateway-relay" && resolved.provider.createBrowserSession) {
          const session = await resolved.provider.createBrowserSession({
            providerConfig,
            instructions,
            tools,
            model,
            voice,
          });
          respond(true, {
            ...session,
            provider: resolved.provider.id,
            mode: "browser-direct",
          });
          return;
        }

        if (!client?.connId) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              "talk realtime relay requires a connected client",
            ),
          );
          return;
        }
        const session = createTalkRealtimeRelaySession({
          context,
          connId: client.connId,
          provider: resolved.provider,
          providerConfig,
          instructions,
          tools,
          model,
          voice,
        });
        respond(true, { ...session, mode: "gateway-relay" });
      } catch (error) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatError(error)));
      }
    },
    "talk.realtime.audio": ({ params, respond, client }) => {
      if (!validateTalkRealtimeAudioParams(params)) {
        respond(
          false,
          undefined,
          invalidParams(
            "talk.realtime.audio",
            formatValidationErrors(validateTalkRealtimeAudioParams.errors),
          ),
        );
        return;
      }
      if (!client?.connId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "client connection required"),
        );
        return;
      }
      try {
        const p = params as TalkRealtimeAudioParams;
        sendTalkRealtimeRelayAudio({
          relaySessionId: p.relaySessionId,
          connId: client.connId,
          audioBase64: p.audioBase64,
          timestamp: p.timestamp,
        });
        respond(true, { relaySessionId: p.relaySessionId, accepted: true });
      } catch (error) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatError(error)));
      }
    },
    "talk.realtime.mark": ({ params, respond, client }) => {
      if (!validateTalkRealtimeMarkParams(params)) {
        respond(
          false,
          undefined,
          invalidParams(
            "talk.realtime.mark",
            formatValidationErrors(validateTalkRealtimeMarkParams.errors),
          ),
        );
        return;
      }
      if (!client?.connId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "client connection required"),
        );
        return;
      }
      try {
        const p = params as TalkRealtimeMarkParams;
        acknowledgeTalkRealtimeRelayMark({
          relaySessionId: p.relaySessionId,
          connId: client.connId,
        });
        respond(true, { relaySessionId: p.relaySessionId, acknowledged: true });
      } catch (error) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatError(error)));
      }
    },
    "talk.realtime.toolResult": ({ params, respond, client }) => {
      if (!validateTalkRealtimeToolResultParams(params)) {
        respond(
          false,
          undefined,
          invalidParams(
            "talk.realtime.toolResult",
            formatValidationErrors(validateTalkRealtimeToolResultParams.errors),
          ),
        );
        return;
      }
      if (!client?.connId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "client connection required"),
        );
        return;
      }
      try {
        const p = params as TalkRealtimeToolResultParams;
        submitTalkRealtimeRelayToolResult({
          relaySessionId: p.relaySessionId,
          connId: client.connId,
          callId: p.callId,
          result: p.result,
          willContinue: p.willContinue,
        });
        respond(true, { relaySessionId: p.relaySessionId, submitted: true });
      } catch (error) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatError(error)));
      }
    },
    "talk.realtime.stop": ({ params, respond, client }) => {
      if (!validateTalkRealtimeStopParams(params)) {
        respond(
          false,
          undefined,
          invalidParams(
            "talk.realtime.stop",
            formatValidationErrors(validateTalkRealtimeStopParams.errors),
          ),
        );
        return;
      }
      if (!client?.connId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "client connection required"),
        );
        return;
      }
      try {
        const p = params as TalkRealtimeStopParams;
        stopTalkRealtimeRelaySession({ relaySessionId: p.relaySessionId, connId: client.connId });
        respond(true, { relaySessionId: p.relaySessionId, stopped: true });
      } catch (error) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatError(error)));
      }
    },
  };
}

export const talkHandlers: GatewayRequestHandlers = createTalkHandlers();
