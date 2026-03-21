/**
 * Argent Agent — Token Estimation
 *
 * Simple heuristic-based token counting for compaction decisions.
 * Not suitable for billing — use provider-reported usage for that.
 *
 * Built for Argent Core - February 16, 2026
 */

// ============================================================================
// Types
// ============================================================================

/** Simplified message type for session storage */
export interface SessionMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolCallId?: string;
  timestamp?: number;
}

// ============================================================================
// Token Estimation
// ============================================================================

/** Per-message overhead for role/formatting tokens */
const MESSAGE_OVERHEAD = 4;

/**
 * Estimate tokens for a string using chars/4 heuristic.
 * Good enough for compaction decisions — not billing.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for an array of messages.
 * Includes per-message overhead and serialized tool call arguments.
 */
export function estimateMessageTokens(messages: SessionMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += MESSAGE_OVERHEAD;
    total += estimateTextTokens(msg.content);
    if (msg.toolCalls) {
      for (const call of msg.toolCalls) {
        total += estimateTextTokens(call.name);
        total += estimateTextTokens(JSON.stringify(call.arguments));
      }
    }
  }
  return total;
}
