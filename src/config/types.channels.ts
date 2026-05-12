import type { GroupPolicy } from "./types.base.js";
import type { DiscordConfig } from "./types.discord.js";
import type { FeishuConfig } from "./types.feishu.js";
import type { GoogleChatConfig } from "./types.googlechat.js";
import type { IMessageConfig } from "./types.imessage.js";
import type { MSTeamsConfig } from "./types.msteams.js";
import type { SignalConfig } from "./types.signal.js";
import type { SlackConfig } from "./types.slack.js";
import type { TelegramConfig } from "./types.telegram.js";
import type { WhatsAppConfig } from "./types.whatsapp.js";

export type ChannelHeartbeatVisibilityConfig = {
  /** Show HEARTBEAT_OK acknowledgments in chat (default: false). */
  showOk?: boolean;
  /** Show heartbeat alerts with actual content (default: true). */
  showAlerts?: boolean;
  /** Emit indicator events for UI status display (default: true). */
  useIndicator?: boolean;
};

/**
 * GH #203: Deployment-level overrides for the agent-tag → icon transform
 * applied to outbound messages on text channels (telegram, discord, signal,
 * slack, imessage, whatsapp, msteams). Lets deployments swap out the
 * default mood emoji for branded variants without forking core.
 */
export type ChannelAgentTagsConfig = {
  /**
   * Override individual mood→emoji entries, or supply entirely new moods.
   * Merged on top of the built-in defaults; unsupplied moods keep their
   * default emoji. Set a key to an empty string to suppress the default
   * emoji for that mood (renders as neutral / no prefix).
   */
  moodEmojiMap?: Record<string, string>;
};

export type ChannelDefaultsConfig = {
  groupPolicy?: GroupPolicy;
  /** Default heartbeat visibility for all channels. */
  heartbeat?: ChannelHeartbeatVisibilityConfig;
  /** Overrides for the agent-tag → icon transform (mood→emoji). */
  agentTags?: ChannelAgentTagsConfig;
};

export type ChannelsConfig = {
  defaults?: ChannelDefaultsConfig;
  whatsapp?: WhatsAppConfig;
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
  feishu?: FeishuConfig;
  googlechat?: GoogleChatConfig;
  slack?: SlackConfig;
  signal?: SignalConfig;
  imessage?: IMessageConfig;
  msteams?: MSTeamsConfig;
  [key: string]: unknown;
};
