/**
 * Discord Agent Tool
 *
 * Exposes Discord actions as a first-class agent tool so the agent can:
 * - List guilds and channels
 * - Read message history from any channel or DM
 * - Send messages to channels or DM users
 * - List DM conversations
 * - Search messages, manage threads, pins, reactions, etc.
 *
 * Reuses the existing Discord.js client and action handlers — no new
 * connections are created.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { loadConfig } from "../../config/config.js";
import { resolveDiscordAccount } from "../../discord/accounts.js";
import { fetchDiscord } from "../../discord/api.js";
import { normalizeDiscordToken } from "../../discord/token.js";
import { jsonResult, readStringParam } from "./common.js";
import { handleDiscordAction } from "./discord-actions.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const DiscordToolSchema = Type.Object({
  action: Type.Unsafe<string>({
    type: "string",
    enum: [
      "sendMessage",
      "readMessages",
      "fetchMessage",
      "editMessage",
      "deleteMessage",
      "searchMessages",
      "react",
      "reactions",
      "threadCreate",
      "threadList",
      "threadReply",
      "pinMessage",
      "unpinMessage",
      "listPins",
      "poll",
      "sticker",
      "permissions",
      "channelList",
      "channelInfo",
      "memberInfo",
      "roleInfo",
      "emojiList",
      "voiceStatus",
      "eventList",
      "eventCreate",
      "channelCreate",
      "channelEdit",
      "channelDelete",
      "channelMove",
      "categoryCreate",
      "categoryEdit",
      "categoryDelete",
      "channelPermissionSet",
      "channelPermissionRemove",
      "emojiUpload",
      "stickerUpload",
      "roleAdd",
      "roleRemove",
      "timeout",
      "kick",
      "ban",
      "setPresence",
      "listDms",
      "listGuilds",
    ],
    description: "The Discord action to perform.",
  }),
  // Common params
  accountId: Type.Optional(Type.String({ description: "Discord account ID (multi-account)." })),
  channelId: Type.Optional(Type.String({ description: "Channel or DM channel ID." })),
  guildId: Type.Optional(Type.String({ description: "Guild (server) ID." })),
  userId: Type.Optional(Type.String({ description: "User ID." })),
  messageId: Type.Optional(Type.String({ description: "Message ID." })),
  messageLink: Type.Optional(
    Type.String({ description: "Full Discord message link (alternative to IDs)." }),
  ),
  // Send/edit params
  to: Type.Optional(
    Type.String({
      description:
        'Send target. Use "user:<id>" for DMs, "channel:<id>" for channels, or a username.',
    }),
  ),
  content: Type.Optional(Type.String({ description: "Message text content." })),
  mediaUrl: Type.Optional(Type.String({ description: "Media URL to attach." })),
  replyTo: Type.Optional(Type.String({ description: "Message ID to reply to." })),
  embeds: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }))),
  // Read params
  limit: Type.Optional(Type.Number({ description: "Number of messages to fetch (max 100)." })),
  before: Type.Optional(Type.String({ description: "Fetch messages before this message ID." })),
  after: Type.Optional(Type.String({ description: "Fetch messages after this message ID." })),
  around: Type.Optional(Type.String({ description: "Fetch messages around this message ID." })),
  // Search params
  channelIds: Type.Optional(Type.Array(Type.String())),
  authorId: Type.Optional(Type.String()),
  authorIds: Type.Optional(Type.Array(Type.String())),
  // Reaction params
  emoji: Type.Optional(Type.String()),
  remove: Type.Optional(Type.Boolean()),
  // Thread params
  name: Type.Optional(Type.String()),
  autoArchiveMinutes: Type.Optional(Type.Number()),
  includeArchived: Type.Optional(Type.Boolean()),
  // Poll params
  question: Type.Optional(Type.String()),
  answers: Type.Optional(Type.Array(Type.String())),
  allowMultiselect: Type.Optional(Type.Boolean()),
  durationHours: Type.Optional(Type.Number()),
  // Sticker/emoji params
  stickerIds: Type.Optional(Type.Array(Type.String())),
  description: Type.Optional(Type.String()),
  tags: Type.Optional(Type.String()),
  roleIds: Type.Optional(Type.Array(Type.String())),
  roleId: Type.Optional(Type.String()),
  // Channel management params
  type: Type.Optional(Type.Number()),
  parentId: Type.Optional(Type.String()),
  topic: Type.Optional(Type.String()),
  position: Type.Optional(Type.Number()),
  nsfw: Type.Optional(Type.Boolean()),
  rateLimitPerUser: Type.Optional(Type.Number()),
  categoryId: Type.Optional(Type.String()),
  clearParent: Type.Optional(Type.Boolean()),
  // Permission params
  targetId: Type.Optional(Type.String()),
  targetType: Type.Optional(Type.String()),
  allow: Type.Optional(Type.String()),
  deny: Type.Optional(Type.String()),
  // Moderation params
  reason: Type.Optional(Type.String()),
  durationMinutes: Type.Optional(Type.Number()),
  until: Type.Optional(Type.String()),
  deleteMessageDays: Type.Optional(Type.Number()),
  // Presence params
  status: Type.Optional(Type.String()),
  activityType: Type.Optional(Type.String()),
  activityName: Type.Optional(Type.String()),
  activityUrl: Type.Optional(Type.String()),
  activityState: Type.Optional(Type.String()),
  // Event params
  startTime: Type.Optional(Type.String()),
  endTime: Type.Optional(Type.String()),
  entityType: Type.Optional(Type.String()),
  location: Type.Optional(Type.String()),
});

// ---------------------------------------------------------------------------
// DM channel type from Discord API
// ---------------------------------------------------------------------------

type DiscordDmChannel = {
  id: string;
  type: number;
  recipients?: Array<{
    id: string;
    username: string;
    global_name?: string | null;
    bot?: boolean;
  }>;
  last_message_id?: string | null;
};

// ---------------------------------------------------------------------------
// New actions: listDms, listGuilds
// ---------------------------------------------------------------------------

async function listDmChannels(accountId?: string) {
  const cfg = loadConfig();
  const account = resolveDiscordAccount({ cfg, accountId });
  const token = normalizeDiscordToken(account.token);
  if (!token) {
    throw new Error("Discord bot token not available for DM listing.");
  }
  const channels = await fetchDiscord<DiscordDmChannel[]>("/users/@me/channels", token);
  return channels
    .filter((ch) => ch.type === 1 || ch.type === 3) // DM or Group DM
    .map((ch) => ({
      channelId: ch.id,
      type: ch.type === 1 ? "dm" : "group_dm",
      recipients: (ch.recipients ?? []).map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.global_name ?? r.username,
        bot: r.bot ?? false,
      })),
      lastMessageId: ch.last_message_id ?? null,
    }));
}

async function listGuilds(accountId?: string) {
  const cfg = loadConfig();
  const account = resolveDiscordAccount({ cfg, accountId });
  const token = normalizeDiscordToken(account.token);
  if (!token) {
    throw new Error("Discord bot token not available for guild listing.");
  }
  const guilds = await fetchDiscord<Array<{ id: string; name: string; icon?: string | null }>>(
    "/users/@me/guilds",
    token,
  );
  return guilds.map((g) => ({
    id: g.id,
    name: g.name,
  }));
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createDiscordTool(options?: { config?: ArgentConfig }): AnyAgentTool {
  return {
    label: "Discord",
    name: "discord_manage",
    description:
      "Interact with Discord: list guilds/channels, read message history, send messages, manage DMs, threads, reactions, pins, and more. " +
      'Use "listGuilds" to see servers, "channelList" for channels in a guild, "readMessages" to fetch history, ' +
      '"sendMessage" to post, "listDms" to see DM conversations.',
    parameters: DiscordToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const cfg = options?.config ?? loadConfig();

      // Handle new actions that aren't in the existing handler
      if (action === "listDms") {
        const accountId = readStringParam(params, "accountId");
        const dms = await listDmChannels(accountId);
        return jsonResult({ ok: true, dms });
      }

      if (action === "listGuilds") {
        const accountId = readStringParam(params, "accountId");
        const guilds = await listGuilds(accountId);
        return jsonResult({ ok: true, guilds });
      }

      // Delegate everything else to the existing handler
      return await handleDiscordAction(params, cfg);
    },
  };
}
