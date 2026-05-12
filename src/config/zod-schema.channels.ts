import { z } from "zod";

export const ChannelHeartbeatVisibilitySchema = z
  .object({
    showOk: z.boolean().optional(),
    showAlerts: z.boolean().optional(),
    useIndicator: z.boolean().optional(),
  })
  .strict()
  .optional();

/**
 * GH #203: per-deployment overrides for the agent-tag → icon transform.
 * Lives under `channels.defaults.agentTags` in argent.json.
 *
 * `moodEmojiMap` is `Record<string, string>` (mood name → emoji). Empty
 * strings are allowed and mean "suppress this default mood entirely".
 */
export const ChannelAgentTagsSchema = z
  .object({
    moodEmojiMap: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .optional();
