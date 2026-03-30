/**
 * aos-lcm — Summarization backend
 *
 * Bridges LCM's summarization needs to ArgentOS's model router.
 * Generates depth-aware prompts and routes through the appropriate tier.
 */

import type { StoredMessage, Summarizer, SummarizeOpts, CompactionLevel } from "./types.js";
import { CompactionLevel as Level } from "./types.js";

/**
 * Create a Summarizer that uses ArgentOS's model routing.
 *
 * The `complete` callback is injected by the plugin registration so the
 * summarizer doesn't import ArgentOS internals directly.
 */
export function createSummarizer(complete: CompleteFn): Summarizer {
  return {
    async summarize(messages: StoredMessage[], opts: SummarizeOpts): Promise<string> {
      const prompt = buildSummarizationPrompt(messages, opts);
      const temperature = opts.level === Level.AGGRESSIVE ? 0.1 : 0.2;

      const result = await complete({
        prompt,
        temperature,
        maxTokens: opts.targetTokens * 2, // allow some headroom
      });

      return result.trim();
    },
  };
}

export type CompleteFn = (opts: {
  prompt: string;
  temperature: number;
  maxTokens: number;
}) => Promise<string>;

// ============================================================================
// Prompt generation
// ============================================================================

function buildSummarizationPrompt(messages: StoredMessage[], opts: SummarizeOpts): string {
  const { depth, targetTokens, level } = opts;

  const header =
    depth === 0
      ? buildLeafPromptHeader(level, targetTokens)
      : buildCondensedPromptHeader(depth, level, targetTokens);

  const body = formatMessagesForSummary(messages, depth);

  return `${header}\n\n${body}`;
}

function buildLeafPromptHeader(level: CompactionLevel, targetTokens: number): string {
  if (level === Level.AGGRESSIVE) {
    return [
      "Summarize the following conversation excerpt into concise bullet points.",
      "Focus ONLY on durable facts, decisions made, and action items.",
      "Omit greetings, acknowledgments, and conversational filler.",
      `Target length: ~${targetTokens} tokens (about ${targetTokens * 4} characters).`,
      "Be extremely concise. Every word must earn its place.",
    ].join("\n");
  }

  return [
    "Summarize the following conversation excerpt.",
    "Preserve: key decisions, technical details, code snippets (if important), action items, and any facts that may be needed later.",
    "You may omit: greetings, filler, repeated information, and verbose tool outputs (keep the conclusion).",
    `Target length: ~${targetTokens} tokens (about ${targetTokens * 4} characters).`,
    "Write in narrative form. Maintain enough detail that someone reading only this summary could continue the conversation.",
  ].join("\n");
}

function buildCondensedPromptHeader(
  depth: number,
  level: CompactionLevel,
  targetTokens: number,
): string {
  if (level === Level.AGGRESSIVE) {
    return [
      `Condense these ${depth === 1 ? "summaries" : "higher-order summaries"} into a single ultra-compact summary.`,
      "Keep ONLY: major decisions, critical facts, unresolved items.",
      `Target length: ~${targetTokens} tokens.`,
    ].join("\n");
  }

  return [
    `Condense the following ${depth === 1 ? "conversation summaries" : `depth-${depth - 1} summaries`} into a single coherent summary.`,
    "These summaries cover different portions of the same conversation.",
    "Merge overlapping information, preserve chronological order where relevant, and maintain all decisions and action items.",
    `Target length: ~${targetTokens} tokens.`,
    "The result should read as a standalone summary of the full conversation span covered.",
  ].join("\n");
}

function formatMessagesForSummary(messages: StoredMessage[], depth: number): string {
  if (depth > 0) {
    // For condensation, messages are actually summaries — just join them
    return messages.map((m, i) => `--- Summary ${i + 1} ---\n${m.content}`).join("\n\n");
  }

  // For leaf summarization, format as a conversation transcript
  return messages
    .map((m) => {
      const prefix = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
      const content = truncateForPrompt(m.content, 4000);
      return `[${prefix}] ${content}`;
    })
    .join("\n\n");
}

/** Truncate a single message's content for inclusion in a summarization prompt. */
function truncateForPrompt(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2) - 20;
  return content.slice(0, half) + "\n\n[...truncated...]\n\n" + content.slice(-half);
}
