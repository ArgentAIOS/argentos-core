/**
 * aos-lcm — Context Assembler
 *
 * Builds the active context window from a mix of summary nodes and
 * recent raw messages. This is what the model actually sees each turn.
 *
 * Layout: [summary_1, summary_2, ..., summary_n, msg_1, msg_2, ..., msg_m]
 *   - Summaries cover the compressed history
 *   - Messages are the fresh tail (most recent, kept verbatim)
 */

import type { SummaryStore } from "./store/summary-store.js";
import type { ContextItem, LcmConfig } from "./types.js";

export class ContextAssembler {
  constructor(
    private summaryStore: SummaryStore,
    private config: LcmConfig,
  ) {}

  /**
   * Assemble the context for a given session.
   * Returns a formatted string suitable for injection via `prependContext`.
   */
  assemble(sessionId: string): string {
    const items = this.summaryStore.assembleContext(sessionId);
    if (items.length === 0) return "";

    const parts: string[] = [];
    const summaries = items.filter((i) => i.kind === "summary");
    const messages = items.filter((i) => i.kind === "message");

    if (summaries.length > 0) {
      parts.push("[LCM Context — Compressed History]");
      parts.push("");
      for (const item of summaries) {
        if (item.kind !== "summary") continue;
        const s = item.summary;
        const depthLabel =
          s.depth === 0 ? "leaf" : s.depth === 1 ? "condensed" : `depth-${s.depth}`;
        parts.push(`--- Summary (${depthLabel}, ${s.tokenCount} tokens) ---`);
        parts.push(s.content);
        parts.push("");
      }
      parts.push("[End LCM Compressed History]");
      parts.push("");
    }

    // Raw messages are NOT assembled here — they're already in the
    // normal message pipeline. We only inject the summary context
    // via the before_agent_start hook's prependContext.

    return parts.join("\n");
  }

  /**
   * Get the current token budget breakdown for a session.
   * Useful for diagnostics and the dashboard.
   */
  getBudget(sessionId: string, maxContextTokens: number): ContextBudget {
    const items = this.summaryStore.assembleContext(sessionId);

    let summaryTokens = 0;
    let messageTokens = 0;
    let summaryCount = 0;
    let messageCount = 0;

    for (const item of items) {
      if (item.kind === "summary") {
        summaryTokens += item.summary.tokenCount;
        summaryCount++;
      } else {
        messageTokens += item.message.tokenCount;
        messageCount++;
      }
    }

    const totalTokens = summaryTokens + messageTokens;
    const utilization = maxContextTokens > 0 ? totalTokens / maxContextTokens : 0;
    const headroom = maxContextTokens - totalTokens;

    return {
      summaryTokens,
      messageTokens,
      totalTokens,
      summaryCount,
      messageCount,
      maxContextTokens,
      utilization,
      headroom,
      compactionThreshold: maxContextTokens * this.config.contextThreshold,
    };
  }
}

export type ContextBudget = {
  summaryTokens: number;
  messageTokens: number;
  totalTokens: number;
  summaryCount: number;
  messageCount: number;
  maxContextTokens: number;
  utilization: number;
  headroom: number;
  compactionThreshold: number;
};
