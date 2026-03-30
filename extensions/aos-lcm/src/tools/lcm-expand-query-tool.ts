/**
 * aos-lcm — lcm_expand_query tool
 *
 * Deep recall: expands a summary node back to its source messages
 * and returns the full content. For depth > 0, recursively walks
 * the DAG back to leaf messages.
 *
 * v1: Direct expansion (no sub-agent). Sub-agent delegation for
 * more sophisticated recall with follow-up questions can be added in v2.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { SummaryStore } from "../store/summary-store.js";

const LcmExpandQueryParams = Type.Object({
  summaryId: Type.Number({ description: "The summary node ID to expand" }),
  maxMessages: Type.Optional(
    Type.Number({
      description:
        "Maximum number of source messages to return (default 50). " +
        "Higher-depth summaries may expand to many messages.",
    }),
  ),
});

export function createLcmExpandQueryTool(summaryStore: SummaryStore, getSessionId: () => string) {
  return {
    name: "aos_lcm_expand_query",
    label: "LCM Expand Query",
    description:
      "Expand a summary back to its original source messages. When a summary " +
      "is too compressed to answer your question, use this to retrieve the " +
      "full original messages that were compressed into it. " +
      "Use aos_lcm_grep first to find relevant content, then expand if needed.",
    parameters: LcmExpandQueryParams,
    async execute(_toolCallId: string, params: Static<typeof LcmExpandQueryParams>) {
      const node = summaryStore.getNode(params.summaryId);
      if (!node) {
        return {
          type: "text" as const,
          text: `No summary found with ID ${params.summaryId}.`,
        };
      }

      const messages = summaryStore.expandToMessages(params.summaryId);
      const limit = params.maxMessages ?? 50;
      const truncated = messages.length > limit;
      const shown = truncated ? messages.slice(0, limit) : messages;

      const formatted = shown.map(
        (m) =>
          `[#${m.id} ${m.role} ${m.createdAt}]\n${m.content.slice(0, 2000)}${m.content.length > 2000 ? "..." : ""}`,
      );

      const depthLabel = node.depth === 0 ? "leaf summary" : `depth-${node.depth} summary`;

      return {
        type: "text" as const,
        text: [
          `Expanded ${depthLabel} #${node.id} → ${messages.length} source message${messages.length === 1 ? "" : "s"}`,
          truncated ? `(showing first ${limit} of ${messages.length})` : "",
          "",
          ...formatted,
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    },
  };
}
