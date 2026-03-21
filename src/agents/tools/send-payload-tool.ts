import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import { resolveAgentMainSessionKey } from "../../config/sessions.js";
import { runMessageAction } from "../../infra/outbound/message-action-runner.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { createAudioAlertTool } from "./audio-alert-tool.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";

const RouteSchema = Type.Object({
  channel: Type.String({
    description:
      'Route channel: discord/slack/telegram/whatsapp/etc, or internal routes "main-session" and "audio".',
  }),
  target: Type.Optional(
    Type.String({
      description:
        "Channel target for external routes (user/channel id). For main-session route this can be a session key override.",
    }),
  ),
  accountId: Type.Optional(Type.String({ description: "Optional channel account id override." })),
  bestEffort: Type.Optional(Type.Boolean({ description: "Continue if this route fails." })),
  maxChars: Type.Optional(Type.Number({ minimum: 1, maximum: 20_000 })),
});

const SendPayloadSchema = Type.Object({
  message: Type.String({ description: "Base message payload to fan out." }),
  routes: Type.Array(RouteSchema, { minItems: 1 }),
  media: Type.Optional(
    Type.Array(
      Type.String({
        description: "Optional media URL/path entries appended as MEDIA: directives.",
      }),
    ),
  ),
  sessionKey: Type.Optional(
    Type.String({ description: "Default session key for main-session/audio route injection." }),
  ),
  title: Type.Optional(Type.String({ description: "Optional alert title used by audio route." })),
  voice: Type.Optional(Type.String({ description: "Optional voice override for audio route." })),
  mood: Type.Optional(Type.String({ description: "Optional mood override for audio route." })),
  urgency: Type.Optional(
    Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("urgent")]),
  ),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
});

type UnknownRecord = Record<string, unknown>;

type RouteResult = {
  channel: string;
  target?: string;
  ok: boolean;
  sent?: number;
  sessionKey?: string;
  error?: string;
};

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  } as import("../../agent-core/core.js").AgentToolResult<unknown>;
}

function normalizeChannel(value: string): string {
  return value.trim().toLowerCase();
}

function isMainSessionRoute(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  return normalized === "main-session" || normalized === "main" || normalized === "webchat";
}

function isAudioRoute(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  return normalized === "audio" || normalized === "audio-alert";
}

function sanitizeMediaEntries(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function composePayloadText(message: string, media: string[]): string {
  const lines = [message.trim()];
  for (const entry of media) {
    lines.push(`MEDIA:${entry}`);
  }
  return lines.filter(Boolean).join("\n");
}

function splitIntoChunks(text: string, maxChars?: number): string[] {
  const limit =
    typeof maxChars === "number" && Number.isFinite(maxChars)
      ? Math.max(1, Math.floor(maxChars))
      : 0;
  if (!limit || text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
  };

  for (const para of paragraphs) {
    const next = current ? `${current}\n\n${para}` : para;
    if (next.length <= limit) {
      current = next;
      continue;
    }

    pushCurrent();

    if (para.length <= limit) {
      current = para;
      continue;
    }

    let start = 0;
    while (start < para.length) {
      const slice = para.slice(start, start + limit);
      chunks.push(slice.trim());
      start += limit;
    }
  }

  pushCurrent();
  return chunks.length > 0 ? chunks : [text];
}

function extractToolText(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("content" in result)) {
    return undefined;
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textBlock = content.find(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  ) as { text?: string } | undefined;
  return textBlock?.text?.trim() || undefined;
}

function resolveGatewayOptions(params: UnknownRecord): GatewayCallOptions {
  return {
    gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
    gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
    timeoutMs:
      (typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
        ? Math.max(1, Math.floor(params.timeoutMs))
        : undefined) ?? 30_000,
  };
}

export const __testing = {
  isMainSessionRoute,
  isAudioRoute,
  splitIntoChunks,
  composePayloadText,
};

export function createSendPayloadTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  return {
    label: "Send Payload",
    name: "send_payload",
    description: `Fan out one payload to many destinations.

Supports:
- External channel routes (discord/slack/telegram/whatsapp/etc.)
- main-session route (immediate chat.inject into a session)
- audio route (generate audio_alert, then inject [ALERT]/MEDIA into main session)

Use this for shared sendPayload multi-channel delivery.`,
    parameters: SendPayloadSchema,
    execute: async (_toolCallId, args) => {
      const params = (args as UnknownRecord) ?? {};
      const cfg = options?.config;
      if (!cfg) {
        return textResult("send_payload error: missing runtime config");
      }

      const message = readStringParam(params, "message", { required: true });
      const routesRaw = Array.isArray(params.routes) ? params.routes : [];
      if (routesRaw.length === 0) {
        return textResult("send_payload error: at least one route is required");
      }

      const media = sanitizeMediaEntries(params.media);
      const payloadText = composePayloadText(message, media);
      const defaultSessionKey =
        readStringParam(params, "sessionKey") ||
        options?.agentSessionKey ||
        resolveAgentMainSessionKey({
          cfg,
          agentId: resolveSessionAgentId({
            sessionKey: options?.agentSessionKey,
            config: cfg,
          }),
        });
      const gatewayOpts = resolveGatewayOptions(params);

      const routeResults: RouteResult[] = [];

      for (const rawRoute of routesRaw) {
        if (!rawRoute || typeof rawRoute !== "object" || Array.isArray(rawRoute)) {
          routeResults.push({ channel: "unknown", ok: false, error: "invalid route entry" });
          continue;
        }

        const route = rawRoute as {
          channel?: unknown;
          target?: unknown;
          accountId?: unknown;
          bestEffort?: unknown;
          maxChars?: unknown;
        };

        const channel = typeof route.channel === "string" ? route.channel.trim() : "";
        if (!channel) {
          routeResults.push({ channel: "unknown", ok: false, error: "route channel is required" });
          continue;
        }

        const normalized = normalizeChannel(channel);
        const target = typeof route.target === "string" ? route.target.trim() : "";
        const accountId = typeof route.accountId === "string" ? route.accountId.trim() : undefined;
        const bestEffort = route.bestEffort === true;
        const maxChars =
          typeof route.maxChars === "number" && Number.isFinite(route.maxChars)
            ? Math.max(1, Math.floor(route.maxChars))
            : undefined;

        try {
          if (isMainSessionRoute(normalized)) {
            const sessionKey = target || defaultSessionKey;
            const chunks = splitIntoChunks(payloadText, maxChars);
            for (const chunk of chunks) {
              await callGatewayTool("chat.inject", gatewayOpts, {
                sessionKey,
                message: chunk,
                label: "Fan-out Payload",
              });
            }
            routeResults.push({
              channel: normalized,
              target: sessionKey,
              sessionKey,
              ok: true,
              sent: chunks.length,
            });
            continue;
          }

          if (isAudioRoute(normalized)) {
            const sessionKey = target || defaultSessionKey;
            const audioTool = createAudioAlertTool({
              config: cfg,
              agentSessionKey: options?.agentSessionKey,
            });
            const audioResult = await audioTool.execute(`send-payload-audio-${Date.now()}`, {
              message,
              title: readStringParam(params, "title") || undefined,
              voice: readStringParam(params, "voice") || undefined,
              mood: readStringParam(params, "mood") || undefined,
              urgency: readStringParam(params, "urgency") || undefined,
            });
            const audioText =
              extractToolText(audioResult) || `[ALERT_WARN:Payload Alert]\n${message}`;
            const chunks = splitIntoChunks(audioText, maxChars);
            for (const chunk of chunks) {
              await callGatewayTool("chat.inject", gatewayOpts, {
                sessionKey,
                message: chunk,
                label: "Fan-out Audio",
              });
            }
            routeResults.push({
              channel: normalized,
              target: sessionKey,
              sessionKey,
              ok: true,
              sent: chunks.length,
            });
            continue;
          }

          if (!target) {
            throw new Error("external route requires target");
          }

          const chunks = splitIntoChunks(payloadText, maxChars);
          for (const chunk of chunks) {
            await runMessageAction({
              cfg,
              action: "send",
              params: {
                channel: normalized,
                target,
                ...(accountId ? { accountId } : {}),
                message: chunk,
                bestEffort,
              },
              sessionKey: options?.agentSessionKey,
              agentId: resolveSessionAgentId({
                sessionKey: options?.agentSessionKey,
                config: cfg,
              }),
            });
          }

          routeResults.push({
            channel: normalized,
            target,
            ok: true,
            sent: chunks.length,
          });
        } catch (err) {
          const errorText = err instanceof Error ? err.message : String(err);
          routeResults.push({
            channel: normalized,
            target: target || undefined,
            ok: false,
            error: errorText,
          });
          if (!bestEffort) {
            break;
          }
        }
      }

      const failed = routeResults.filter((result) => !result.ok).length;
      return jsonResult({
        ok: failed === 0,
        requested: routesRaw.length,
        succeeded: routeResults.length - failed,
        failed,
        results: routeResults,
      });
    },
  };
}
