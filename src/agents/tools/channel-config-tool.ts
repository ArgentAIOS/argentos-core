/**
 * Channel Config Tool
 *
 * Lets agents inspect and update messaging channel configuration from the
 * operator-owned Argent config file. Secrets are write-only and never revealed.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/types.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

type ChannelConfigAction = "list" | "get" | "update";

type ChannelConfigToolOptions = {
  config?: ArgentConfig;
  loadConfig?: () => ArgentConfig;
  writeConfigFile?: (config: ArgentConfig) => Promise<void>;
};

type ChannelSummary = {
  id: string;
  configured: boolean;
  enabled: boolean;
  sourceOfTruth: string;
  secretFieldsConfigured: string[];
  tokenConfigured: boolean;
  dmPolicy?: unknown;
  groupPolicy?: unknown;
  mentionGating?: unknown;
  threadMode?: unknown;
  allowFromCount: number;
  groupAllowFromCount: number;
  accountCount: number;
};

const CHANNEL_SOURCE_NOTICE =
  "Messaging channel readiness is stored in argent.json under channels.<id>; do not use service_keys for channel enablement.";

const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

const SECRET_FIELD_HINTS = ["token", "secret", "key"];
const DEFAULT_WRITE_FIELDS = [
  "enabled",
  "dmPolicy",
  "groupPolicy",
  "mentionGating",
  "threadMode",
  "allowFrom",
  "groupAllowFrom",
  "token",
  "secretField",
];

const ChannelConfigToolSchema = Type.Object({
  action: Type.Optional(
    Type.Union([Type.Literal("list"), Type.Literal("get"), Type.Literal("update")]),
  ),
  channel: Type.Optional(
    Type.String({
      description:
        "Channel id, e.g. telegram, slack, discord, signal, whatsapp, imessage, or another installed channel id.",
    }),
  ),
  enabled: Type.Optional(Type.Boolean()),
  dmPolicy: Type.Optional(Type.String()),
  groupPolicy: Type.Optional(Type.String()),
  mentionGating: Type.Optional(Type.Boolean()),
  threadMode: Type.Optional(Type.String()),
  allowFrom: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()])),
  groupAllowFrom: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()])),
  token: Type.Optional(
    Type.String({
      description:
        "Write-only channel credential. Stored as botToken for Telegram unless secretField is supplied; otherwise stored as token or the existing configured token field.",
    }),
  ),
  secretField: Type.Optional(
    Type.String({
      description:
        "Optional write-only credential field name such as token, botToken, appToken, signingSecret, webhookSecret, clientSecret, appSecret, or apiKey.",
    }),
  ),
});

function normalizeAction(value: string | undefined): ChannelConfigAction {
  if (value === "get" || value === "update") {
    return value;
  }
  return "list";
}

function normalizeChannelId(channel: string | undefined): string | undefined {
  const trimmed = channel?.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if (!CHANNEL_ID_RE.test(trimmed)) {
    throw new Error("channel must be an alphanumeric channel id");
  }
  return trimmed;
}

function normalizeListParam(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]+/) : [];
  return Array.from(
    new Set(raw.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSecretField(field: string): boolean {
  const normalized = field.toLowerCase();
  return SECRET_FIELD_HINTS.some((hint) => normalized.includes(hint));
}

function configuredSecretFields(channelConfig: Record<string, unknown>): string[] {
  return Object.entries(channelConfig)
    .filter(([key, value]) => isSecretField(key) && typeof value === "string" && value.trim())
    .map(([key]) => key)
    .toSorted();
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function summarizeChannel(id: string, value: unknown): ChannelSummary {
  const channel = isRecord(value) ? value : {};
  const secretFieldsConfigured = configuredSecretFields(channel);
  const accounts = isRecord(channel.accounts) ? Object.keys(channel.accounts) : [];
  return {
    id,
    configured: isRecord(value),
    enabled: channel.enabled !== false,
    sourceOfTruth: `argent.json:channels.${id}`,
    secretFieldsConfigured,
    tokenConfigured: secretFieldsConfigured.length > 0,
    dmPolicy: channel.dmPolicy,
    groupPolicy: channel.groupPolicy,
    mentionGating: channel.mentionGating,
    threadMode: channel.threadMode,
    allowFromCount: countArray(channel.allowFrom),
    groupAllowFromCount: countArray(channel.groupAllowFrom),
    accountCount: accounts.length,
  };
}

function summarizeChannels(config: ArgentConfig): ChannelSummary[] {
  const channels = config.channels;
  if (!isRecord(channels)) {
    return [];
  }
  return Object.entries(channels)
    .filter(([id]) => id !== "defaults")
    .map(([id, value]) => summarizeChannel(id, value))
    .toSorted((a, b) => a.id.localeCompare(b.id));
}

function resolveSecretField(
  channelId: string,
  channelConfig: Record<string, unknown>,
  raw?: string,
) {
  const explicit = raw?.trim();
  if (explicit) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(explicit) || !isSecretField(explicit)) {
      throw new Error("secretField must be a token/secret/key field name");
    }
    return explicit;
  }
  const existing = configuredSecretFields(channelConfig)[0];
  if (existing) {
    return existing;
  }
  return channelId === "telegram" ? "botToken" : "token";
}

function readConfig(options: ChannelConfigToolOptions): ArgentConfig {
  if (options.config) {
    return options.config;
  }
  if (options.loadConfig) {
    return options.loadConfig();
  }
  throw new Error("channel_config requires config access");
}

async function writeConfig(options: ChannelConfigToolOptions, config: ArgentConfig): Promise<void> {
  if (options.writeConfigFile) {
    await options.writeConfigFile(config);
    return;
  }
  const { writeConfigFile } = await import("../../config/config.js");
  await writeConfigFile(config);
}

function cloneConfig(config: ArgentConfig): ArgentConfig {
  return JSON.parse(JSON.stringify(config)) as ArgentConfig;
}

export function createChannelConfigTool(options: ChannelConfigToolOptions = {}): AnyAgentTool {
  return {
    label: "ChannelConfig",
    name: "channel_config",
    description: `Inspect and update operator messaging channel config from argent.json.

Use this, not service_keys, to answer whether Telegram, Slack, Discord, Signal, WhatsApp, iMessage, or any installed channel is configured/enabled.

Secrets are write-only: this tool reports whether token-like fields are configured but never reveals token values.

PARAMS:
- action: list | get | update (default: list)
- channel: required for get/update
- enabled, dmPolicy, groupPolicy, mentionGating, threadMode: update safe channel settings
- allowFrom, groupAllowFrom: update allowlists
- token: write-only credential value
- secretField: optional token field override for nonstandard channels`,
    parameters: ChannelConfigToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = normalizeAction(readStringParam(params, "action"));
      const channelId = normalizeChannelId(readStringParam(params, "channel"));
      const config = readConfig(options);

      if (action === "list") {
        return jsonResult({
          ok: true,
          sourceOfTruth: "argent.json:channels",
          notice: CHANNEL_SOURCE_NOTICE,
          channels: summarizeChannels(config),
        });
      }

      if (!channelId) {
        throw new Error("channel required");
      }

      const channels = isRecord(config.channels) ? config.channels : {};
      if (action === "get") {
        return jsonResult({
          ok: true,
          sourceOfTruth: `argent.json:channels.${channelId}`,
          notice: CHANNEL_SOURCE_NOTICE,
          channel: summarizeChannel(channelId, channels[channelId]),
        });
      }

      const nextConfig = cloneConfig(config);
      const nextChannels = isRecord(nextConfig.channels)
        ? (nextConfig.channels as Record<string, unknown>)
        : {};
      nextConfig.channels = nextChannels as ArgentConfig["channels"];
      const current = isRecord(nextChannels[channelId]) ? { ...nextChannels[channelId] } : {};

      for (const key of DEFAULT_WRITE_FIELDS) {
        if (!(key in params)) {
          continue;
        }
        if (
          key === "allowFrom" ||
          key === "groupAllowFrom" ||
          key === "token" ||
          key === "secretField"
        ) {
          continue;
        }
        current[key] = params[key];
      }

      const allowFrom = normalizeListParam(params.allowFrom);
      if (allowFrom !== undefined) {
        if (allowFrom.length > 0) {
          current.allowFrom = allowFrom;
        } else {
          delete current.allowFrom;
        }
      }

      const groupAllowFrom = normalizeListParam(params.groupAllowFrom);
      if (groupAllowFrom !== undefined) {
        if (groupAllowFrom.length > 0) {
          current.groupAllowFrom = groupAllowFrom;
        } else {
          delete current.groupAllowFrom;
        }
      }

      const token = readStringParam(params, "token");
      if (token) {
        const secretField = resolveSecretField(
          channelId,
          current,
          readStringParam(params, "secretField"),
        );
        current[secretField] = token;
      }

      nextChannels[channelId] = current;
      await writeConfig(options, nextConfig);

      return jsonResult({
        ok: true,
        sourceOfTruth: `argent.json:channels.${channelId}`,
        notice: CHANNEL_SOURCE_NOTICE,
        channel: summarizeChannel(channelId, current),
      });
    },
  };
}
