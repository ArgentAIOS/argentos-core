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
 * Reference: GH #198.
 */

const MOOD_EMOJI: Readonly<Record<string, string>> = {
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

/** Look up the emoji for a mood name. Returns null for unknown / neutral. */
function moodToEmoji(mood: string): string | null {
  const key = mood.trim().toLowerCase();
  if (!key || key === "neutral") {
    return null;
  }
  return MOOD_EMOJI[key] ?? null;
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
 */
export function transformAgentTagsForTextChannel(input: string): string {
  if (!input) {
    return input;
  }

  let working = input;

  // 1. Extract first MOOD tag (if recognized) and remove all MOOD tags.
  let moodEmoji: string | null = null;
  const moodMatch = MOOD_TAG_RE.exec(working);
  if (moodMatch) {
    moodEmoji = moodToEmoji(moodMatch[1] ?? "");
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
