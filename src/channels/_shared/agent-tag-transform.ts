/**
 * Agent tag → icon transform for text-only channels (Telegram, Discord, etc).
 *
 * Agents emit structured signals like `[MOOD:loving]` and
 * `[TTS:[warm and reassuring] spoken text]` to drive dashboard rendering
 * (avatar state ring, voice playback). On rich text channels these tags must
 * not leak as raw text. Instead of stripping the signals — which would lose
 * the emotional intent the agent is communicating — render them as compact
 * icon prefixes so the user can still see how the agent is expressing itself.
 *
 * The transform is intentionally tolerant: malformed tags are left intact
 * rather than crashing or producing garbled output. Unknown moods are
 * skipped (treated as neutral) so we never produce a confusing emoji.
 *
 * The mood→emoji mapping is overridable per-deployment via
 * `channels.defaults.agentTags.moodEmojiMap` in `argent.json`. The override
 * map is merged on top of the built-in defaults: a deployment supplying
 * `{ happy: "🌞" }` keeps every other mood at the default mapping. Pass an
 * explicit empty string (`""`) to suppress a default mood (renders as
 * neutral / no prefix).
 *
 * Reference: GH #198 (initial transform), GH #203 (config override).
 */

/**
 * Built-in mood→emoji map. Exported so callers can introspect or extend the
 * defaults (e.g., when computing the effective map for tests or admin UI).
 * Deployments override this via `channels.defaults.agentTags.moodEmojiMap`.
 */
export const DEFAULT_MOOD_EMOJI: Readonly<Record<string, string>> = {
  happy: "😊",
  loving: "❤️",
  warm: "❤️",
  sad: "😔",
  thinking: "🤔",
  curious: "🤔",
  excited: "🎉",
  concerned: "😟",
  focused: "🎯",
  confused: "😕",
  // neutral → no emoji (intentionally absent — handled as fallback)
};

// First MOOD tag anywhere in the text. Captures the mood name.
const MOOD_TAG_RE = /\[MOOD:\s*([^\]\n]+?)\s*\]/i;
// All MOOD tags (used to strip duplicates after the first).
const MOOD_TAG_ALL_RE = /\[MOOD:\s*[^\]\n]+?\s*\]/gi;
// TTS block: `[TTS:[<tone>] <spoken>]` — captures tone (optional) and spoken.
// Tolerates `TTS_NOW:` and missing tone descriptor. The closing `]` of the
// outer block is the LAST `]` on the same logical run; we use a non-greedy
// match anchored to a closing bracket that is followed by end-of-block.
const TTS_BLOCK_RE = /\[TTS(?:_NOW)?:\s*(?:\[\s*([^\]\n]*?)\s*\]\s*)?([^\n]*?)\]/i;

export type AgentTagTransformOptions = {
  /**
   * Optional per-deployment overrides for the mood→emoji map. Merged on top
   * of {@link DEFAULT_MOOD_EMOJI}. Keys are case-insensitive (normalized to
   * lowercase). Set a key to an empty string to suppress the default emoji
   * for that mood (renders as neutral).
   */
  moodEmojiMap?: Readonly<Record<string, string>>;
};

/**
 * Normalize an override map: lowercase keys, drop non-string values defensively.
 * Returns null if there are no usable overrides.
 */
function normalizeOverrides(
  overrides: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | null {
  if (!overrides) {
    return null;
  }
  const normalized: Record<string, string> = {};
  let hasAny = false;
  for (const [rawKey, rawValue] of Object.entries(overrides)) {
    if (typeof rawValue !== "string") {
      continue;
    }
    const key = rawKey.trim().toLowerCase();
    if (!key) {
      continue;
    }
    normalized[key] = rawValue;
    hasAny = true;
  }
  return hasAny ? normalized : null;
}

/** Look up the emoji for a mood name. Returns null for unknown / neutral. */
function moodToEmoji(
  mood: string,
  overrides: Readonly<Record<string, string>> | null,
): string | null {
  const key = mood.trim().toLowerCase();
  if (!key || key === "neutral") {
    return null;
  }
  // Per-mood override → built-in default. Empty string explicitly suppresses.
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
    const overridden = overrides[key];
    return overridden ? overridden : null;
  }
  return DEFAULT_MOOD_EMOJI[key] ?? null;
}

/**
 * Transform `[MOOD:X]` and `[TTS:[tone] text]` tags in an agent reply into
 * icon-style decoration suitable for plain-text chat surfaces.
 *
 * - The first recognized MOOD tag becomes a leading emoji (additional MOOD
 *   tags are stripped to avoid stacking).
 * - A TTS block becomes `🗣️ <tone>` (tone omitted if absent) followed by
 *   the spoken text inline in the message body.
 * - Unknown moods, malformed tags, and missing pieces degrade gracefully:
 *   the function never throws, and the message body is preserved.
 *
 * Pass `options.moodEmojiMap` to override individual moods or supply
 * custom mood→emoji entries. The override merges on top of the built-in
 * defaults so unsupplied moods keep their default rendering — existing
 * deployments without an override see identical behavior.
 */
export function transformAgentTagsForTextChannel(
  input: string,
  options?: AgentTagTransformOptions,
): string {
  if (!input) {
    return input;
  }

  const overrides = normalizeOverrides(options?.moodEmojiMap);

  let working = input;

  // 1. Extract first MOOD tag (if recognized) and remove all MOOD tags.
  let moodEmoji: string | null = null;
  const moodMatch = MOOD_TAG_RE.exec(working);
  if (moodMatch) {
    moodEmoji = moodToEmoji(moodMatch[1] ?? "", overrides);
    working = working.replace(MOOD_TAG_ALL_RE, "");
  }

  // 2. Extract first TTS block (if any).
  let ttsTone: string | null = null;
  let ttsSpoken: string | null = null;
  const ttsMatch = TTS_BLOCK_RE.exec(working);
  if (ttsMatch) {
    const tone = (ttsMatch[1] ?? "").trim();
    const spoken = (ttsMatch[2] ?? "").trim();
    ttsTone = tone || null;
    ttsSpoken = spoken || null;
    // Replace the matched TTS block with the spoken text inline (without
    // brackets). The icon line is prepended below.
    working =
      working.slice(0, ttsMatch.index) +
      (spoken ? spoken : "") +
      working.slice(ttsMatch.index + ttsMatch[0].length);
  }

  // 3. Build the icon-prefix line.
  const prefixParts: string[] = [];
  if (moodEmoji) {
    prefixParts.push(moodEmoji);
  }
  if (ttsTone !== null || ttsSpoken !== null) {
    // Include 🗣️ whenever a TTS block was present.
    prefixParts.push(ttsTone ? `🗣️ ${ttsTone}` : "🗣️");
  }
  const prefix = prefixParts.join(" ");

  // 4. Tidy whitespace left behind by removed tags. We only trim leading
  //    whitespace when at least one tag was processed — that whitespace is
  //    an artifact of tag removal, not user-authored content. If no tags
  //    were present, the body is returned untouched.
  if (moodMatch || ttsMatch) {
    working = working.replace(/^\s+/, "");
  }

  if (!prefix) {
    return working;
  }
  if (!working) {
    return prefix;
  }
  return `${prefix}\n${working}`;
}
