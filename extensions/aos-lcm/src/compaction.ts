/**
 * aos-lcm — Compaction Engine
 *
 * Hierarchical DAG compaction with three-level escalation for guaranteed
 * convergence. Adapted from Voltropy PBC's LCM architecture.
 *
 * Key difference from upstream lossless-claw: we properly remove compacted
 * items from context_items (fixes Bug #203 — unbounded context growth).
 */

import type { ConversationStore } from "./store/conversation-store.js";
import type { SummaryStore } from "./store/summary-store.js";
import type {
  LcmConfig,
  StoredMessage,
  Summarizer,
  CompactionResult,
  CompactionLevel,
} from "./types.js";
import { CompactionLevel as Level } from "./types.js";

const MIN_CONDENSATION_FANOUT = 4;

export class CompactionEngine {
  constructor(
    private conversationStore: ConversationStore,
    private summaryStore: SummaryStore,
    private summarizer: Summarizer,
    private config: LcmConfig,
  ) {}

  /**
   * Check whether compaction should run for a session.
   */
  needsCompaction(sessionId: string, maxContextTokens: number): boolean {
    const currentTokens = this.summaryStore.contextTokenCount(sessionId);
    return currentTokens > maxContextTokens * this.config.contextThreshold;
  }

  /**
   * Run a compaction pass. This may create leaf summaries from raw messages
   * and/or condense lower-depth summaries into higher-depth ones.
   *
   * Returns the result of the compaction, or null if no compaction was needed.
   */
  async compact(sessionId: string, maxContextTokens: number): Promise<CompactionResult | null> {
    if (!this.needsCompaction(sessionId, maxContextTokens)) return null;

    const tokensBefore = this.summaryStore.contextTokenCount(sessionId);

    // Phase 1: Leaf compaction — summarize old raw messages
    const leafResult = await this.compactLeaves(sessionId);

    // Phase 2: Condensation — merge same-depth summaries if enough accumulated
    const condenseResult = await this.condenseSummaries(sessionId);

    const tokensAfter = this.summaryStore.contextTokenCount(sessionId);
    const depth = condenseResult?.depth ?? leafResult?.depth ?? 0;
    const level = condenseResult?.level ?? leafResult?.level ?? Level.NORMAL;

    return {
      summariesCreated:
        (leafResult?.summariesCreated ?? 0) + (condenseResult?.summariesCreated ?? 0),
      messagesCompacted: leafResult?.messagesCompacted ?? 0,
      tokensBefore,
      tokensAfter,
      depth,
      level,
    };
  }

  /**
   * Phase 1: Create leaf summaries from raw messages outside the fresh tail.
   */
  private async compactLeaves(sessionId: string): Promise<CompactionResult | null> {
    const context = this.summaryStore.assembleContext(sessionId);

    // Find raw messages (not in the fresh tail)
    const rawMessages: StoredMessage[] = [];
    const freshTailStart = Math.max(0, context.length - this.config.freshTailCount);
    for (let i = 0; i < freshTailStart; i++) {
      const item = context[i];
      if (item.kind === "message") {
        rawMessages.push(item.message);
      }
    }

    if (rawMessages.length === 0) return null;

    // Chunk raw messages into groups of ~leafChunkTokens
    const chunks = this.chunkMessages(rawMessages, this.config.leafChunkTokens);
    let summariesCreated = 0;
    let messagesCompacted = 0;
    let level: CompactionLevel = Level.NORMAL;

    for (const chunk of chunks) {
      const summary = await this.summarizeWithEscalation(chunk, 0, this.config.leafTargetTokens);
      level = summary.level;

      this.summaryStore.createLeafSummary(
        sessionId,
        summary.content,
        summary.tokenCount,
        chunk.map((m) => m.id),
      );
      summariesCreated++;
      messagesCompacted += chunk.length;
    }

    return {
      summariesCreated,
      messagesCompacted,
      tokensBefore: 0,
      tokensAfter: 0,
      depth: 0,
      level,
    };
  }

  /**
   * Phase 2: Condense same-depth summaries into higher-depth summaries
   * when enough have accumulated (minimum fanout).
   */
  private async condenseSummaries(sessionId: string): Promise<CompactionResult | null> {
    const maxDepth = this.summaryStore.maxDepth(sessionId);
    if (maxDepth < 0) return null;

    const depthLimit =
      this.config.incrementalMaxDepth === -1
        ? maxDepth + 1
        : Math.min(maxDepth + 1, this.config.incrementalMaxDepth);

    let totalCreated = 0;
    let highestDepth = 0;
    let level: CompactionLevel = Level.NORMAL;

    for (let depth = 0; depth < depthLimit; depth++) {
      const uncondensed = this.summaryStore.getUncondensedAtDepth(sessionId, depth);
      if (uncondensed.length < MIN_CONDENSATION_FANOUT) continue;

      // Summarize the group of summaries into a higher-depth node
      const pseudoMessages: StoredMessage[] = uncondensed.map((s) => ({
        id: s.id,
        sessionId: s.sessionId,
        role: "assistant" as const,
        content: s.content,
        tokenCount: s.tokenCount,
        createdAt: s.createdAt,
      }));

      const summary = await this.summarizeWithEscalation(
        pseudoMessages,
        depth + 1,
        this.config.condensedTargetTokens,
      );
      level = summary.level;

      this.summaryStore.createCondensedSummary(
        sessionId,
        summary.content,
        summary.tokenCount,
        uncondensed.map((s) => s.id),
        depth + 1,
      );

      totalCreated++;
      highestDepth = depth + 1;
    }

    if (totalCreated === 0) return null;

    return {
      summariesCreated: totalCreated,
      messagesCompacted: 0,
      tokensBefore: 0,
      tokensAfter: 0,
      depth: highestDepth,
      level,
    };
  }

  /**
   * Three-level escalation for guaranteed convergence:
   * 1. Normal summarization
   * 2. Aggressive (bullet points, half target tokens)
   * 3. Deterministic truncation (no LLM, 512 tokens)
   */
  private async summarizeWithEscalation(
    messages: StoredMessage[],
    depth: number,
    targetTokens: number,
  ): Promise<{ content: string; tokenCount: number; level: CompactionLevel }> {
    // Level 1: Normal
    try {
      const content = await this.summarizer.summarize(messages, {
        depth,
        targetTokens,
        level: Level.NORMAL,
      });
      const tokenCount = estimateTokens(content);
      if (tokenCount <= targetTokens * 1.5) {
        return { content, tokenCount, level: Level.NORMAL };
      }
      // Summary too large — escalate
    } catch {
      // LLM failure — escalate
    }

    // Level 2: Aggressive
    try {
      const content = await this.summarizer.summarize(messages, {
        depth,
        targetTokens: Math.floor(targetTokens * 0.5),
        level: Level.AGGRESSIVE,
      });
      const tokenCount = estimateTokens(content);
      if (tokenCount <= targetTokens * 2) {
        return { content, tokenCount, level: Level.AGGRESSIVE };
      }
    } catch {
      // LLM failure — escalate to deterministic
    }

    // Level 3: Deterministic truncation — always succeeds
    const truncated = deterministicTruncate(messages, 512);
    return {
      content: truncated,
      tokenCount: estimateTokens(truncated),
      level: Level.TRUNCATE,
    };
  }

  /**
   * Split messages into chunks of approximately `targetTokens` each.
   * Preserves tool_use/tool_result pairs at chunk boundaries.
   */
  private chunkMessages(messages: StoredMessage[], targetTokens: number): StoredMessage[][] {
    const chunks: StoredMessage[][] = [];
    let current: StoredMessage[] = [];
    let currentTokens = 0;

    for (const msg of messages) {
      current.push(msg);
      currentTokens += msg.tokenCount;

      if (currentTokens >= targetTokens) {
        // Don't split in the middle of a tool_use/tool_result pair
        if (msg.toolCallId && current.length > 1) {
          // Check if next message is the matching result
          const idx = messages.indexOf(msg);
          if (idx < messages.length - 1 && messages[idx + 1].toolCallId === msg.toolCallId) {
            continue; // Keep the pair together
          }
        }
        chunks.push(current);
        current = [];
        currentTokens = 0;
      }
    }

    if (current.length > 0) {
      // Merge small remainder into last chunk if tiny
      if (chunks.length > 0 && currentTokens < targetTokens * 0.25) {
        chunks[chunks.length - 1].push(...current);
      } else {
        chunks.push(current);
      }
    }

    return chunks;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Deterministic truncation — no LLM call, guaranteed to produce output.
 * Takes the first and last portions of the content to preserve context boundaries.
 */
function deterministicTruncate(messages: StoredMessage[], maxTokens: number): string {
  const maxChars = maxTokens * 4;
  const parts: string[] = [];

  parts.push(
    `[Deterministic summary of ${messages.length} messages, ` +
      `${messages.reduce((s, m) => s + m.tokenCount, 0)} tokens total]`,
  );
  parts.push("");

  // Include first message preview
  if (messages.length > 0) {
    const first = messages[0];
    parts.push(`First (${first.role}): ${first.content.slice(0, 200)}...`);
  }

  // Include last message preview
  if (messages.length > 1) {
    const last = messages[messages.length - 1];
    parts.push(`Last (${last.role}): ${last.content.slice(0, 200)}...`);
  }

  // Add message role distribution
  const roles = messages.reduce(
    (acc, m) => {
      acc[m.role] = (acc[m.role] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  parts.push(`Distribution: ${JSON.stringify(roles)}`);

  let result = parts.join("\n");
  if (result.length > maxChars) {
    result = result.slice(0, maxChars - 3) + "...";
  }

  return result;
}
