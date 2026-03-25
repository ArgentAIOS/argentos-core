import type { AssistantMessage } from "../agent-core/ai.js";
import { stripReasoningTagsFromText } from "../shared/text/reasoning-tags.js";
import { sanitizeUserFacingText } from "./pi-embedded-helpers.js";
import { formatToolDetail, resolveToolDisplay } from "./tool-display.js";

/**
 * Strip malformed Minimax tool invocations that leak into text content.
 * Minimax sometimes embeds tool calls as XML in text blocks instead of
 * proper structured tool calls. This removes:
 * - <invoke name="...">...</invoke> blocks
 * - </minimax:tool_call> closing tags
 */
export function stripMinimaxToolCallXml(text: string): string {
  if (!text) {
    return text;
  }
  if (!/minimax:tool_call/i.test(text)) {
    return text;
  }

  // Remove <invoke ...>...</invoke> blocks (non-greedy to handle multiple).
  let cleaned = text.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, "");

  // Remove stray minimax tool tags.
  cleaned = cleaned.replace(/<\/?minimax:tool_call>/gi, "");

  return cleaned;
}

/**
 * Strip downgraded tool call text representations that leak into text content.
 * When replaying history to Gemini, tool calls without `thought_signature` are
 * downgraded to text blocks like `[Tool Call: name (ID: ...)]`. These should
 * not be shown to users.
 */
export function stripDowngradedToolCallText(text: string): string {
  if (!text) {
    return text;
  }
  if (!/\[Tool (?:Call|Result)/i.test(text)) {
    return text;
  }

  const consumeJsonish = (
    input: string,
    start: number,
    options?: { allowLeadingNewlines?: boolean },
  ): number | null => {
    const { allowLeadingNewlines = false } = options ?? {};
    let index = start;
    while (index < input.length) {
      const ch = input[index];
      if (ch === " " || ch === "\t") {
        index += 1;
        continue;
      }
      if (allowLeadingNewlines && (ch === "\n" || ch === "\r")) {
        index += 1;
        continue;
      }
      break;
    }
    if (index >= input.length) {
      return null;
    }

    const startChar = input[index];
    if (startChar === "{" || startChar === "[") {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = index; i < input.length; i += 1) {
        const ch = input[i];
        if (inString) {
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === '"') {
            inString = false;
          }
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === "{" || ch === "[") {
          depth += 1;
          continue;
        }
        if (ch === "}" || ch === "]") {
          depth -= 1;
          if (depth === 0) {
            return i + 1;
          }
        }
      }
      return null;
    }

    if (startChar === '"') {
      let escape = false;
      for (let i = index + 1; i < input.length; i += 1) {
        const ch = input[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          return i + 1;
        }
      }
      return null;
    }

    let end = index;
    while (end < input.length && input[end] !== "\n" && input[end] !== "\r") {
      end += 1;
    }
    return end;
  };

  const stripToolCalls = (input: string): string => {
    const markerRe = /\[Tool Call:[^\]]*\]/gi;
    let result = "";
    let cursor = 0;
    for (const match of input.matchAll(markerRe)) {
      const start = match.index ?? 0;
      if (start < cursor) {
        continue;
      }
      result += input.slice(cursor, start);
      let index = start + match[0].length;
      while (index < input.length && (input[index] === " " || input[index] === "\t")) {
        index += 1;
      }
      if (input[index] === "\r") {
        index += 1;
        if (input[index] === "\n") {
          index += 1;
        }
      } else if (input[index] === "\n") {
        index += 1;
      }
      while (index < input.length && (input[index] === " " || input[index] === "\t")) {
        index += 1;
      }
      if (input.slice(index, index + 9).toLowerCase() === "arguments") {
        index += 9;
        if (input[index] === ":") {
          index += 1;
        }
        if (input[index] === " ") {
          index += 1;
        }
        const end = consumeJsonish(input, index, { allowLeadingNewlines: true });
        if (end !== null) {
          index = end;
        }
      }
      if (
        (input[index] === "\n" || input[index] === "\r") &&
        (result.endsWith("\n") || result.endsWith("\r") || result.length === 0)
      ) {
        if (input[index] === "\r") {
          index += 1;
        }
        if (input[index] === "\n") {
          index += 1;
        }
      }
      cursor = index;
    }
    result += input.slice(cursor);
    return result;
  };

  // Remove [Tool Call: name (ID: ...)] blocks and their Arguments.
  let cleaned = stripToolCalls(text);

  // Remove [Tool Result for ID ...] blocks and their content.
  cleaned = cleaned.replace(/\[Tool Result for ID[^\]]*\]\n?[\s\S]*?(?=\n*\[Tool |\n*$)/gi, "");

  return cleaned.trim();
}

const STRUCTURED_ACTION_ONLY_JSON_RE = /^\s*\{[\s\S]{0,2400}\}\s*$/i;
const FENCED_JSON_BLOCK_RE = /```(?:json)?\s*([\s\S]{1,2400}?)\s*```/gi;
const STRUCTURED_ACTION_COMMAND_RE =
  /^(?:list|get|create|update|delete|generate|render|publish|upload|download|open|close|start|stop|click|type|press|scroll|navigate|snapshot|screenshot|focus|search|fetch|send|post|run|exec|plan|mix|compose|transcribe|summarize|analyze|convert)(?:[_-]|$)/i;
const STRUCTURED_ACTION_ENVELOPE_KEYS = new Set([
  "request",
  "params",
  "arguments",
  "targetId",
  "ref",
]);
const STRUCTURED_ACTION_ROUTING_KEYS = new Set([
  "profile",
  "kind",
  "tool",
  "tool_name",
  "voice_id",
  "video_id",
]);
const STRUCTURED_ACTION_EXECUTION_SUPPORT_KEYS = new Set([
  "max_items",
  "include_raw",
  "output_path",
  "workdir",
  "yieldMs",
  "timeout",
  "background",
  "pty",
  "shell",
]);
const STRUCTURED_ACTION_RESOURCE_KEYS = new Set(["url", "path"]);
const TRUNCATED_TOOL_JSON_FRAGMENT_RE =
  /^\s*"?(?:command|action|request|params|arguments|path|url|workdir|yieldMs|timeout|background|pty|shell)"?\s*:/i;
const TRUNCATED_TOOL_JSON_AUX_KEY_RE =
  /"(?:command|workdir|yieldMs|timeout|request|params|arguments|background|pty|shell|tool|tool_name|ref|targetId)"/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLikelyStructuredToolActionRecord(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  const hasEnvelopeKey = keys.some((key) => STRUCTURED_ACTION_ENVELOPE_KEYS.has(key));
  const hasRoutingKey = keys.some((key) => STRUCTURED_ACTION_ROUTING_KEYS.has(key));
  const hasExecutionSupportKey = keys.some((key) =>
    STRUCTURED_ACTION_EXECUTION_SUPPORT_KEYS.has(key),
  );
  const hasResourceKey = keys.some((key) => STRUCTURED_ACTION_RESOURCE_KEYS.has(key));
  const action = value.action;
  const nestedPayload =
    isRecord(value.request) || isRecord(value.params) || isRecord(value.arguments);
  const command = value.command;
  const hasExecutableCommand = typeof command === "string" && command.trim().length > 0;
  if (typeof action === "string") {
    const normalizedAction = action.trim();
    if (
      normalizedAction &&
      normalizedAction.length <= 80 &&
      STRUCTURED_ACTION_COMMAND_RE.test(normalizedAction) &&
      (hasEnvelopeKey || hasRoutingKey || hasExecutionSupportKey || hasResourceKey)
    ) {
      return true;
    }
  }

  if (
    hasEnvelopeKey &&
    (hasRoutingKey || hasExecutionSupportKey || hasResourceKey || nestedPayload)
  ) {
    return true;
  }

  if (
    hasRoutingKey &&
    (hasExecutableCommand || hasExecutionSupportKey || hasResourceKey || nestedPayload)
  ) {
    return true;
  }

  return hasExecutableCommand && hasExecutionSupportKey;
}

function shouldStripStandaloneStructuredToolActionJson(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed || !STRUCTURED_ACTION_ONLY_JSON_RE.test(trimmed)) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) && isLikelyStructuredToolActionRecord(parsed);
  } catch {
    return false;
  }
}

/**
 * Strip raw structured tool-action JSON that leaked into assistant text.
 */
export function stripStructuredToolActionJsonText(text: string): string {
  if (!text) {
    return text;
  }

  let cleaned = text.replace(FENCED_JSON_BLOCK_RE, (match, inner: string) =>
    shouldStripStandaloneStructuredToolActionJson(inner) ? "" : match,
  );

  if (shouldStripStandaloneStructuredToolActionJson(cleaned)) {
    return "";
  }

  const trimmed = cleaned.trim();
  if (
    TRUNCATED_TOOL_JSON_FRAGMENT_RE.test(trimmed) &&
    TRUNCATED_TOOL_JSON_AUX_KEY_RE.test(trimmed) &&
    !/[.!?]\s*$/.test(trimmed)
  ) {
    return "";
  }

  return cleaned;
}

/**
 * Strip thinking tags and their content from text.
 * This is a safety net for cases where the model outputs <think> tags
 * that slip through other filtering mechanisms.
 */
export function stripThinkingTagsFromText(text: string): string {
  return stripReasoningTagsFromText(text, { mode: "strict", trim: "both" });
}

/**
 * Strip GPT thinking titles that leak as plain text into content.
 *
 * GPT-5.3 Codex (and similar) emits short gerund-phrase "thinking titles"
 * at the very start of a reply, e.g.:
 *   "Composing affirmative warm response"
 *   "Crafting concise narrative response"
 *   "Summarizing test results concisely"
 *
 * These are NOT wrapped in reasoning_content or <think> tags — they appear
 * as regular text content followed by a newline before the actual reply.
 *
 * Heuristic: match a single short line (≤60 chars) at the start of text
 * that begins with a capitalized gerund, contains only lowercase words
 * after the first word, has no end punctuation, and is followed by a newline.
 */
const GPT_THINKING_TITLE_RE = /^([A-Z][a-z]+ing\s+[a-z]+(?:\s+[a-z]+){0,5})\s*\n/;

export function stripGptThinkingTitles(text: string): string {
  if (!text) {
    return text;
  }
  const match = GPT_THINKING_TITLE_RE.exec(text);
  if (!match) {
    return text;
  }
  const title = match[1];
  // Must be short (typical titles are 3-6 words, < 60 chars)
  if (title.length > 60) {
    return text;
  }
  // Must not end with punctuation (real sentences would)
  if (/[.!?;:,]$/.test(title)) {
    return text;
  }
  return text.slice(match[0].length);
}

export function extractAssistantText(msg: AssistantMessage): string {
  const getTextBlockContent = (block: unknown): string | null => {
    if (!block || typeof block !== "object") {
      return null;
    }
    const rec = block as Record<string, unknown>;
    const type = typeof rec.type === "string" ? rec.type : "";
    if (type === "text" && typeof rec.text === "string") {
      return rec.text;
    }
    if (type === "output_text") {
      if (typeof rec.text === "string") {
        return rec.text;
      }
      if (typeof rec.output_text === "string") {
        return rec.output_text;
      }
      if (typeof rec.content === "string") {
        return rec.content;
      }
      if (rec.content && typeof rec.content === "object") {
        const nested = rec.content as Record<string, unknown>;
        if (typeof nested.text === "string") {
          return nested.text;
        }
      }
    }
    return null;
  };

  const blocks = Array.isArray(msg.content)
    ? msg.content
        .map((block) => getTextBlockContent(block))
        .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
        .map((text) =>
          stripGptThinkingTitles(
            stripStructuredToolActionJsonText(
              stripThinkingTagsFromText(stripDowngradedToolCallText(stripMinimaxToolCallXml(text))),
            ),
          ).trim(),
        )
        .filter(Boolean)
    : [];
  const extracted = blocks.join("\n").trim();
  return sanitizeUserFacingText(extracted);
}

export function extractAssistantThinking(msg: AssistantMessage): string {
  if (!Array.isArray(msg.content)) {
    return "";
  }
  const blocks = msg.content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const record = block as unknown as Record<string, unknown>;
      if (record.type === "thinking" && typeof record.thinking === "string") {
        return record.thinking.trim();
      }
      return "";
    })
    .filter(Boolean);
  return blocks.join("\n").trim();
}

export function formatReasoningMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  // Show reasoning in italics (cursive) for markdown-friendly surfaces (Discord, etc.).
  // Keep the plain "Reasoning:" prefix so existing parsing/detection keeps working.
  // Note: Underscore markdown cannot span multiple lines on Telegram, so we wrap
  // each non-empty line separately.
  const italicLines = trimmed
    .split("\n")
    .map((line) => (line ? `_${line}_` : line))
    .join("\n");
  return `Reasoning:\n${italicLines}`;
}

type ThinkTaggedSplitBlock =
  | { type: "thinking"; thinking: string }
  | { type: "text"; text: string };

export function splitThinkingTaggedText(text: string): ThinkTaggedSplitBlock[] | null {
  const trimmedStart = text.trimStart();
  // Avoid false positives: only treat it as structured thinking when it begins
  // with a think tag (common for local/OpenAI-compat providers that emulate
  // reasoning blocks via tags).
  if (!trimmedStart.startsWith("<")) {
    return null;
  }
  const openRe = /<\s*(?:think(?:ing)?|thought|antthinking)\s*>/i;
  const closeRe = /<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/i;
  if (!openRe.test(trimmedStart)) {
    return null;
  }
  if (!closeRe.test(text)) {
    return null;
  }

  const scanRe = /<\s*(\/?)\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi;
  let inThinking = false;
  let cursor = 0;
  let thinkingStart = 0;
  const blocks: ThinkTaggedSplitBlock[] = [];

  const pushText = (value: string) => {
    if (!value) {
      return;
    }
    blocks.push({ type: "text", text: value });
  };
  const pushThinking = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) {
      return;
    }
    blocks.push({ type: "thinking", thinking: cleaned });
  };

  for (const match of text.matchAll(scanRe)) {
    const index = match.index ?? 0;
    const isClose = Boolean(match[1]?.includes("/"));

    if (!inThinking && !isClose) {
      pushText(text.slice(cursor, index));
      thinkingStart = index + match[0].length;
      inThinking = true;
      continue;
    }

    if (inThinking && isClose) {
      pushThinking(text.slice(thinkingStart, index));
      cursor = index + match[0].length;
      inThinking = false;
    }
  }

  if (inThinking) {
    return null;
  }
  pushText(text.slice(cursor));

  const hasThinking = blocks.some((b) => b.type === "thinking");
  if (!hasThinking) {
    return null;
  }
  return blocks;
}

export function promoteThinkingTagsToBlocks(message: AssistantMessage): void {
  if (!Array.isArray(message.content)) {
    return;
  }
  const hasThinkingBlock = message.content.some((block) => block.type === "thinking");
  if (hasThinkingBlock) {
    return;
  }

  const next: AssistantMessage["content"] = [];
  let changed = false;

  for (const block of message.content) {
    if (block.type !== "text") {
      next.push(block);
      continue;
    }
    const split = splitThinkingTaggedText(block.text);
    if (!split) {
      next.push(block);
      continue;
    }
    changed = true;
    for (const part of split) {
      if (part.type === "thinking") {
        next.push({ type: "thinking", thinking: part.thinking });
      } else if (part.type === "text") {
        const cleaned = part.text.trimStart();
        if (cleaned) {
          next.push({ type: "text", text: cleaned });
        }
      }
    }
  }

  if (!changed) {
    return;
  }
  message.content = next;
}

export function extractThinkingFromTaggedText(text: string): string {
  if (!text) {
    return "";
  }
  const scanRe = /<\s*(\/?)\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi;
  let result = "";
  let lastIndex = 0;
  let inThinking = false;
  for (const match of text.matchAll(scanRe)) {
    const idx = match.index ?? 0;
    if (inThinking) {
      result += text.slice(lastIndex, idx);
    }
    const isClose = match[1] === "/";
    inThinking = !isClose;
    lastIndex = idx + match[0].length;
  }
  return result.trim();
}

export function extractThinkingFromTaggedStream(text: string): string {
  if (!text) {
    return "";
  }
  const closed = extractThinkingFromTaggedText(text);
  if (closed) {
    return closed;
  }

  const openRe = /<\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi;
  const closeRe = /<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi;
  const openMatches = [...text.matchAll(openRe)];
  if (openMatches.length === 0) {
    return "";
  }
  const closeMatches = [...text.matchAll(closeRe)];
  const lastOpen = openMatches[openMatches.length - 1];
  const lastClose = closeMatches[closeMatches.length - 1];
  if (lastClose && (lastClose.index ?? -1) > (lastOpen.index ?? -1)) {
    return closed;
  }
  const start = (lastOpen.index ?? 0) + lastOpen[0].length;
  return text.slice(start).trim();
}

export function inferToolMetaFromArgs(toolName: string, args: unknown): string | undefined {
  const display = resolveToolDisplay({ name: toolName, args });
  return formatToolDetail(display);
}
