export type InlineTtsDirectiveParseResult = {
  cleanedText: string;
  spokenText: string | null;
  hasDirective: boolean;
};

const INLINE_TTS_TEXT_BLOCK_RE = /\[\[tts:text\]\]([\s\S]*?)\[\[\/tts:text\]\]/gi;
const INLINE_TTS_CONTROL_RE = /\[\[(?:\/?tts(?::[^\]]+)?)\]\]/gi;
const INLINE_TTS_LOOSE_TEXT_BLOCK_RE =
  /(?:^|\s)\[?\[?tts:text\]?\]?\s*([\s\S]*?)\s*\[?\[?\/tts:text\]?\]?/gi;
const INLINE_TTS_LOOSE_CONTROL_RE = /(^|\s)\[?\[?\/?tts(?::[^\]]+?)?\]?\]?/gi;

export function parseInlineTtsDirectives(text: string): InlineTtsDirectiveParseResult {
  if (!text) {
    return { cleanedText: "", spokenText: null, hasDirective: false };
  }

  let hasDirective = false;
  let spokenText: string | null = null;

  let cleanedText = text.replace(INLINE_TTS_TEXT_BLOCK_RE, (_match, inner: string) => {
    hasDirective = true;
    const next = inner.trim();
    if (!spokenText && next) {
      spokenText = next;
    }
    return "";
  });

  cleanedText = cleanedText.replace(INLINE_TTS_LOOSE_TEXT_BLOCK_RE, (_match, inner: string) => {
    hasDirective = true;
    const next = inner.trim();
    if (!spokenText && next) {
      spokenText = next;
    }
    return "";
  });

  cleanedText = cleanedText.replace(INLINE_TTS_CONTROL_RE, () => {
    hasDirective = true;
    return "";
  });

  cleanedText = cleanedText.replace(
    INLINE_TTS_LOOSE_CONTROL_RE,
    (_match, leadingWhitespace: string) => {
      hasDirective = true;
      return leadingWhitespace;
    },
  );

  cleanedText = cleanedText
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanedText, spokenText, hasDirective };
}

export function stripInlineTtsDirectives(text: string): string {
  return parseInlineTtsDirectives(text).cleanedText;
}
