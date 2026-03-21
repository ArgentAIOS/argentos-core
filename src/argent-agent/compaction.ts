/**
 * Argent Agent — Context Compaction
 *
 * Summarizes older conversation messages to free up context window space.
 * Keeps recent messages intact and replaces old messages with an LLM summary.
 *
 * Features:
 * - Adaptive chunk sizing based on message size vs context window
 * - Oversized message detection and exclusion
 * - Multi-stage summarization (split → summarize each → merge)
 * - Progressive fallback (full → partial → bare note)
 * - Tool call / tool result pair preservation
 *
 * Built for Argent Core - February 16, 2026
 */

import type { Provider, ModelConfig } from "../argent-ai/types.js";
import type { SessionMessage } from "./tokenizer.js";
import { estimateTextTokens, estimateMessageTokens } from "./tokenizer.js";

// ============================================================================
// Types
// ============================================================================

export interface CompactionConfig {
  /** Provider to use for summarization */
  provider: Provider;
  /** Model config for summarization (use a fast/cheap model) */
  model: ModelConfig;
  /** Maximum context window tokens (default: 128000) */
  maxContextTokens?: number;
  /** Threshold ratio to trigger compaction (default: 0.8) */
  thresholdRatio?: number;
  /** Minimum messages to keep recent (default: 10) */
  keepRecentMessages?: number;
  /** Custom instructions to append to the summarization prompt */
  customInstructions?: string;
  /** Number of parts for multi-stage splitting (default: 2) */
  parts?: number;
}

export interface CompactionResult {
  /** The compacted messages */
  messages: SessionMessage[];
  /** Whether compaction was performed */
  compacted: boolean;
  /** Number of messages removed */
  removedCount: number;
  /** The summary text (if compacted) */
  summary?: string;
  /** Estimated token savings */
  tokenSavings?: number;
}

export interface PruneResult {
  /** Messages after pruning */
  messages: SessionMessage[];
  /** Messages that were dropped */
  droppedMessages: SessionMessage[];
  /** Number of chunks dropped */
  droppedChunks: number;
  /** Number of messages dropped */
  droppedCount: number;
  /** Tokens dropped */
  droppedTokens: number;
  /** Tokens kept */
  keptTokens: number;
  /** Budget that was enforced */
  budgetTokens: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;
const DEFAULT_THRESHOLD_RATIO = 0.8;
const DEFAULT_KEEP_RECENT = 10;
const DEFAULT_PARTS = 2;

/** Base ratio of context to use per summarization chunk */
const BASE_CHUNK_RATIO = 0.4;
/** Minimum chunk ratio — never go below this */
const MIN_CHUNK_RATIO = 0.15;
/** Safety margin for token estimation inaccuracy (overestimates by 20%) */
const SAFETY_MARGIN = 1.2;
/** Minimum messages before multi-stage splitting kicks in */
const MIN_MESSAGES_FOR_SPLIT = 4;

const SUMMARIZATION_PROMPT =
  "Summarize the following conversation concisely, preserving key facts, decisions, and context. " +
  "Include any important tool calls and their results. Be thorough but compact.";

const MERGE_PROMPT =
  "Merge these partial summaries into a single cohesive summary. Preserve decisions, " +
  "TODOs, open questions, and any constraints.";

const DEFAULT_SUMMARY_FALLBACK = "No prior history.";

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if compaction is needed without performing it.
 */
export function needsCompaction(
  messages: SessionMessage[],
  maxContextTokens: number,
  thresholdRatio?: number,
): boolean {
  const ratio = thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  const tokens = estimateMessageTokens(messages);
  return tokens > maxContextTokens * ratio;
}

/**
 * Compact messages if they exceed the context threshold.
 *
 * Algorithm:
 * 1. Check if total tokens > maxContextTokens * thresholdRatio
 * 2. If not, return messages unchanged
 * 3. Split into "summarize" zone (old) and "keep" zone (recent)
 * 4. Preserve tool call + tool result pairs at the split boundary
 * 5. If conversation is large enough, use multi-stage summarization:
 *    a. Split old messages into N parts by token share
 *    b. Summarize each part independently
 *    c. Merge partial summaries into one cohesive summary
 * 6. Progressive fallback if summarization fails:
 *    a. Try full summarization
 *    b. Exclude oversized messages, try again
 *    c. Fall back to a bare "Context contained N messages" note
 * 7. Return [summary, ...kept messages]
 */
export async function compactMessages(
  messages: SessionMessage[],
  config: CompactionConfig,
): Promise<CompactionResult> {
  const maxTokens = config.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
  const ratio = config.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  const keepRecent = config.keepRecentMessages ?? DEFAULT_KEEP_RECENT;

  if (!needsCompaction(messages, maxTokens, ratio)) {
    return { messages, compacted: false, removedCount: 0 };
  }

  const tokensBefore = estimateMessageTokens(messages);

  // Find the split point — keep at least the last N messages
  let splitIndex = Math.max(0, messages.length - keepRecent);

  // Adjust split to not break tool call / tool result pairs.
  while (splitIndex > 0 && messages[splitIndex]?.role === "tool") {
    splitIndex--;
  }

  const toSummarize = messages.slice(0, splitIndex);
  const toKeep = messages.slice(splitIndex);

  if (toSummarize.length === 0) {
    return { messages, compacted: false, removedCount: 0 };
  }

  // Compute adaptive chunk size based on message sizes
  const maxChunkTokens = computeMaxChunkTokens(toSummarize, maxTokens);

  // Use multi-stage summarization for large conversations
  const summaryText = await summarizeInStages({
    messages: toSummarize,
    config,
    maxChunkTokens,
    contextWindow: maxTokens,
    parts: config.parts ?? DEFAULT_PARTS,
  });

  const summaryMessage: SessionMessage = {
    role: "user",
    content: `Previous conversation summary:\n\n${summaryText}`,
    timestamp: Date.now(),
  };

  const compactedMessages = [summaryMessage, ...toKeep];
  const tokensAfter = estimateMessageTokens(compactedMessages);

  return {
    messages: compactedMessages,
    compacted: true,
    removedCount: toSummarize.length,
    summary: summaryText,
    tokenSavings: tokensBefore - tokensAfter,
  };
}

/**
 * Prune history to fit within a token budget.
 * Iteratively drops the oldest chunks until under budget.
 */
export function pruneHistory(params: {
  messages: SessionMessage[];
  maxContextTokens: number;
  maxHistoryShare?: number;
  parts?: number;
}): PruneResult {
  const maxHistoryShare = params.maxHistoryShare ?? 0.5;
  const budgetTokens = Math.max(1, Math.floor(params.maxContextTokens * maxHistoryShare));
  let keptMessages = params.messages;
  const allDropped: SessionMessage[] = [];
  let droppedChunks = 0;
  let droppedCount = 0;
  let droppedTokens = 0;

  const parts = normalizeParts(params.parts ?? DEFAULT_PARTS, keptMessages.length);

  while (keptMessages.length > 0 && estimateMessageTokens(keptMessages) > budgetTokens) {
    const chunks = splitByTokenShare(keptMessages, parts);
    if (chunks.length <= 1) {
      break;
    }
    const [dropped, ...rest] = chunks;
    droppedChunks++;
    droppedCount += dropped.length;
    droppedTokens += estimateMessageTokens(dropped);
    allDropped.push(...dropped);
    keptMessages = rest.flat();
  }

  return {
    messages: keptMessages,
    droppedMessages: allDropped,
    droppedChunks,
    droppedCount,
    droppedTokens,
    keptTokens: estimateMessageTokens(keptMessages),
    budgetTokens,
  };
}

// ============================================================================
// Adaptive Chunk Sizing
// ============================================================================

/**
 * Compute max tokens per summarization chunk based on average message size.
 * When messages are large (big code blocks, file dumps), we use smaller chunks
 * to avoid exceeding the summarization model's own context window.
 */
function computeMaxChunkTokens(messages: SessionMessage[], contextWindow: number): number {
  if (messages.length === 0) {
    return Math.floor(contextWindow * BASE_CHUNK_RATIO);
  }

  const totalTokens = estimateMessageTokens(messages);
  const avgTokens = totalTokens / messages.length;
  const safeAvgTokens = avgTokens * SAFETY_MARGIN;
  const avgRatio = safeAvgTokens / contextWindow;

  // If average message is >10% of context, reduce chunk ratio
  let chunkRatio = BASE_CHUNK_RATIO;
  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    chunkRatio = Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return Math.floor(contextWindow * chunkRatio);
}

/**
 * Check if a single message is too large to summarize safely.
 * If a message is >50% of context, feeding it to the summarizer would leave
 * no room for the summarization prompt and response.
 */
function isOversized(msg: SessionMessage, contextWindow: number): boolean {
  const tokens = estimateMessageTokens([msg]) * SAFETY_MARGIN;
  return tokens > contextWindow * 0.5;
}

// ============================================================================
// Multi-Stage Summarization
// ============================================================================

/**
 * Summarize messages with multi-stage splitting and progressive fallback.
 *
 * For small conversations: single-pass summarization.
 * For large conversations: split into parts, summarize each, merge.
 */
async function summarizeInStages(params: {
  messages: SessionMessage[];
  config: CompactionConfig;
  maxChunkTokens: number;
  contextWindow: number;
  parts: number;
}): Promise<string> {
  const { messages, config, maxChunkTokens, contextWindow, parts } = params;

  if (messages.length === 0) {
    return DEFAULT_SUMMARY_FALLBACK;
  }

  const totalTokens = estimateMessageTokens(messages);
  const normalizedParts = normalizeParts(parts, messages.length);

  // Small enough for single-pass? Skip multi-stage overhead.
  if (
    normalizedParts <= 1 ||
    messages.length < MIN_MESSAGES_FOR_SPLIT ||
    totalTokens <= maxChunkTokens
  ) {
    return summarizeWithFallback(messages, config, maxChunkTokens, contextWindow);
  }

  // Split into parts by token share
  const splits = splitByTokenShare(messages, normalizedParts).filter((c) => c.length > 0);
  if (splits.length <= 1) {
    return summarizeWithFallback(messages, config, maxChunkTokens, contextWindow);
  }

  // Summarize each part independently
  const partialSummaries: string[] = [];
  for (const chunk of splits) {
    partialSummaries.push(
      await summarizeWithFallback(chunk, config, maxChunkTokens, contextWindow),
    );
  }

  if (partialSummaries.length === 1) {
    return partialSummaries[0];
  }

  // Merge partial summaries into one cohesive summary
  const mergeMessages: SessionMessage[] = partialSummaries.map((summary) => ({
    role: "user" as const,
    content: summary,
    timestamp: Date.now(),
  }));

  const mergeInstructions = config.customInstructions
    ? `${MERGE_PROMPT}\n\nAdditional focus:\n${config.customInstructions}`
    : MERGE_PROMPT;

  return summarizeWithFallback(
    mergeMessages,
    { ...config, customInstructions: mergeInstructions },
    maxChunkTokens,
    contextWindow,
  );
}

// ============================================================================
// Progressive Fallback
// ============================================================================

/**
 * Summarize with progressive fallback for handling oversized messages.
 *
 * Tier 1: Full summarization of all messages (chunked if needed).
 * Tier 2: Exclude oversized messages, summarize the rest, note what was skipped.
 * Tier 3: Bare "Context contained N messages" note (never crashes).
 */
async function summarizeWithFallback(
  messages: SessionMessage[],
  config: CompactionConfig,
  maxChunkTokens: number,
  contextWindow: number,
): Promise<string> {
  if (messages.length === 0) {
    return DEFAULT_SUMMARY_FALLBACK;
  }

  // Tier 1: Try full summarization
  try {
    return await summarizeChunked(messages, config, maxChunkTokens);
  } catch (fullError) {
    console.warn(
      `[compaction] Full summarization failed, trying partial: ${
        fullError instanceof Error ? fullError.message : String(fullError)
      }`,
    );
  }

  // Tier 2: Exclude oversized messages, summarize what's left
  const smallMessages: SessionMessage[] = [];
  const oversizedNotes: string[] = [];

  for (const msg of messages) {
    if (isOversized(msg, contextWindow)) {
      const tokens = estimateMessageTokens([msg]);
      oversizedNotes.push(
        `[Large ${msg.role} (~${Math.round(tokens / 1000)}K tokens) omitted from summary]`,
      );
    } else {
      smallMessages.push(msg);
    }
  }

  if (smallMessages.length > 0) {
    try {
      const partialSummary = await summarizeChunked(smallMessages, config, maxChunkTokens);
      const notes = oversizedNotes.length > 0 ? `\n\n${oversizedNotes.join("\n")}` : "";
      return partialSummary + notes;
    } catch (partialError) {
      console.warn(
        `[compaction] Partial summarization also failed: ${
          partialError instanceof Error ? partialError.message : String(partialError)
        }`,
      );
    }
  }

  // Tier 3: Bare note — never throws
  return (
    `Context contained ${messages.length} messages` +
    (oversizedNotes.length > 0 ? ` (${oversizedNotes.length} oversized)` : "") +
    `. Summary unavailable due to size limits.`
  );
}

// ============================================================================
// Chunked Summarization
// ============================================================================

/**
 * Summarize messages by splitting into chunks that fit the summarizer's context.
 * Each chunk is summarized sequentially, with the previous summary carried forward
 * as context for the next chunk (rolling summary).
 */
async function summarizeChunked(
  messages: SessionMessage[],
  config: CompactionConfig,
  maxChunkTokens: number,
): Promise<string> {
  if (messages.length === 0) {
    return DEFAULT_SUMMARY_FALLBACK;
  }

  const chunks = chunkByMaxTokens(messages, maxChunkTokens);
  let summary: string | undefined;

  for (const chunk of chunks) {
    const formatted = formatMessagesForSummary(chunk);
    summary = await summarizeText(formatted, config, summary);
  }

  return summary ?? DEFAULT_SUMMARY_FALLBACK;
}

// ============================================================================
// Splitting Utilities
// ============================================================================

/**
 * Split messages into N parts of roughly equal token weight.
 */
function splitByTokenShare(messages: SessionMessage[], parts: number): SessionMessage[][] {
  if (messages.length === 0) return [];

  const normalizedParts = normalizeParts(parts, messages.length);
  if (normalizedParts <= 1) return [messages];

  const totalTokens = estimateMessageTokens(messages);
  const targetTokens = totalTokens / normalizedParts;
  const chunks: SessionMessage[][] = [];
  let current: SessionMessage[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const msgTokens = estimateMessageTokens([msg]);
    if (
      chunks.length < normalizedParts - 1 &&
      current.length > 0 &&
      currentTokens + msgTokens > targetTokens
    ) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(msg);
    currentTokens += msgTokens;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Split messages into chunks that each fit within maxTokens.
 * Handles oversized single messages by isolating them into their own chunk.
 */
function chunkByMaxTokens(messages: SessionMessage[], maxTokens: number): SessionMessage[][] {
  if (messages.length === 0) return [];

  const chunks: SessionMessage[][] = [];
  let current: SessionMessage[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const msgTokens = estimateMessageTokens([msg]);

    if (current.length > 0 && currentTokens + msgTokens > maxTokens) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(msg);
    currentTokens += msgTokens;

    // Isolate oversized messages to prevent unbounded chunk growth
    if (msgTokens > maxTokens) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function normalizeParts(parts: number, messageCount: number): number {
  if (!Number.isFinite(parts) || parts <= 1) return 1;
  return Math.min(Math.max(1, Math.floor(parts)), Math.max(1, messageCount));
}

// ============================================================================
// Formatting & LLM Calls
// ============================================================================

function formatMessagesForSummary(messages: SessionMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const prefix = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "Tool";
    lines.push(`[${prefix}]: ${msg.content}`);
    if (msg.toolCalls) {
      for (const call of msg.toolCalls) {
        lines.push(`  → Tool call: ${call.name}(${JSON.stringify(call.arguments)})`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Send text to the summarization model.
 * If a previousSummary is provided, it's included as context so the model
 * can produce a rolling summary across chunks.
 */
async function summarizeText(
  conversationText: string,
  config: CompactionConfig,
  previousSummary?: string,
): Promise<string> {
  const { provider, model } = config;

  let systemPrompt = SUMMARIZATION_PROMPT;
  if (config.customInstructions) {
    systemPrompt += `\n\nAdditional focus:\n${config.customInstructions}`;
  }

  let userContent = conversationText;
  if (previousSummary) {
    userContent = `Previous summary:\n${previousSummary}\n\nContinuation:\n${conversationText}`;
  }

  const request = {
    systemPrompt,
    messages: [{ role: "user" as const, content: userContent }],
  };

  const response = await provider.execute(request, model);

  if (response.stopReason === "error") {
    throw new Error(`Compaction summarization failed: ${response.errorMessage ?? "unknown error"}`);
  }

  return response.text;
}
