import type { ArgentConfig } from "../../config/types.js";
import { resolveUserTimezone } from "../../agents/date-time.js";
import { formatZonedTimestamp } from "../../auto-reply/envelope.js";

/**
 * Cron jobs inject "Current time: ..." into their messages.
 * Skip injection for those.
 */
const CRON_TIME_PATTERN = /Current time: /;

/**
 * Matches a leading `[... YYYY-MM-DD HH:MM ...]` envelope — either from
 * channel plugins or from a previous injection. Uses the same YYYY-MM-DD
 * HH:MM format as {@link formatZonedTimestamp}, so detection stays in sync
 * with the formatting.
 */
const TIMESTAMP_ENVELOPE_PATTERN = /^\[.*\d{4}-\d{2}-\d{2} \d{2}:\d{2}/;

export interface TimestampInjectionOptions {
  timezone?: string;
  now?: Date;
  /** Timestamp (ms) of the user's previous message, for elapsed-time awareness. */
  lastUserMessageAt?: number;
}

/**
 * Injects a compact timestamp prefix into a message if one isn't already
 * present. Uses the same `YYYY-MM-DD HH:MM TZ` format as channel envelope
 * timestamps ({@link formatZonedTimestamp}), keeping token cost low (~7
 * tokens) and format consistent across all agent contexts.
 *
 * Used by the gateway `agent` and `chat.send` handlers to give TUI, web,
 * spawned subagents, `sessions_send`, and heartbeat wake events date/time
 * awareness — without modifying the system prompt (which is cached).
 *
 * Channel messages (Discord, Telegram, etc.) already have timestamps via
 * envelope formatting and take a separate code path — they never reach
 * these handlers, so there is no double-stamping risk. The detection
 * pattern is a safety net for edge cases.
 *
 * @see https://github.com/ArgentAIOS/argentos/issues/3658
 */
export function injectTimestamp(message: string, opts?: TimestampInjectionOptions): string {
  if (!message.trim()) {
    return message;
  }

  // Already has an envelope or injected timestamp
  if (TIMESTAMP_ENVELOPE_PATTERN.test(message)) {
    return message;
  }

  // Already has a cron-injected timestamp
  if (CRON_TIME_PATTERN.test(message)) {
    return message;
  }

  const now = opts?.now ?? new Date();
  const timezone = opts?.timezone ?? "UTC";

  const formatted = formatZonedTimestamp(now, timezone);
  if (!formatted) {
    return message;
  }

  // 3-letter DOW: small models (8B) can't reliably derive day-of-week from
  // a date, and may treat a bare "Wed" as a typo. Costs ~1 token.
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(
    now,
  );

  // Include elapsed time since last user message for temporal awareness
  const elapsed = opts?.lastUserMessageAt
    ? formatElapsedTime(now.getTime(), opts.lastUserMessageAt)
    : undefined;

  if (elapsed) {
    return `[${dow} ${formatted} | last message: ${elapsed}] ${message}`;
  }
  return `[${dow} ${formatted}] ${message}`;
}

/**
 * Format elapsed time between two timestamps as a human-readable string.
 * Returns undefined if elapsed is < 30 seconds (same conversational turn).
 */
function formatElapsedTime(nowMs: number, lastMs: number): string | undefined {
  const elapsedMs = nowMs - lastMs;
  if (elapsedMs < 30_000) return undefined; // Same turn, no need

  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h ago` : `${days}d ago`;
  }
  if (hours > 0) {
    const remMin = minutes % 60;
    return remMin > 0 ? `${hours}h ${remMin}m ago` : `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return `${seconds}s ago`;
}

/**
 * Build TimestampInjectionOptions from an ArgentConfig.
 */
export function timestampOptsFromConfig(
  cfg: ArgentConfig,
  lastUserMessageAt?: number,
): TimestampInjectionOptions {
  return {
    timezone: resolveUserTimezone(cfg.agents?.defaults?.userTimezone),
    lastUserMessageAt,
  };
}
