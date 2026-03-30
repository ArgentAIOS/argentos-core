/**
 * aos-lcm — lcm_describe tool
 *
 * Inspect a specific message or summary node by ID.
 * Returns the full content of a stored message or summary.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ConversationStore } from "../store/conversation-store.js";
import type { SummaryStore } from "../store/summary-store.js";

const LcmDescribeParams = Type.Object({
  id: Type.Number({ description: "The message or summary ID to retrieve" }),
  kind: Type.Optional(
    Type.Union([Type.Literal("message"), Type.Literal("summary")], {
      description: "Whether to look up a message or a summary node (default: message)",
    }),
  ),
});

export function createLcmDescribeTool(
  conversationStore: ConversationStore,
  summaryStore: SummaryStore,
  getSessionId: () => string,
) {
  return {
    name: "aos_lcm_describe",
    label: "LCM Describe",
    description:
      "Retrieve the full content of a specific message or summary node by ID. " +
      "Use after aos_lcm_grep to read the full text of a matched message, or " +
      "to inspect what a summary node contains.",
    parameters: LcmDescribeParams,
    async execute(_toolCallId: string, params: Static<typeof LcmDescribeParams>) {
      const kind = params.kind ?? "message";

      if (kind === "message") {
        const msg = conversationStore.get(params.id);
        if (!msg) {
          return {
            type: "text" as const,
            text: `No message found with ID ${params.id}.`,
          };
        }

        return {
          type: "text" as const,
          text: [
            `Message #${msg.id}`,
            `Role: ${msg.role}`,
            `Tokens: ${msg.tokenCount}`,
            `Created: ${msg.createdAt}`,
            msg.toolCallId ? `Tool Call ID: ${msg.toolCallId}` : null,
            "",
            "--- Content ---",
            msg.content,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }

      // Summary node
      const node = summaryStore.getNode(params.id);
      if (!node) {
        return {
          type: "text" as const,
          text: `No summary found with ID ${params.id}.`,
        };
      }

      const depthLabel =
        node.depth === 0
          ? "leaf (from raw messages)"
          : `depth ${node.depth} (condensed from ${node.sourceIds.length} sources)`;

      return {
        type: "text" as const,
        text: [
          `Summary #${node.id}`,
          `Depth: ${depthLabel}`,
          `Tokens: ${node.tokenCount}`,
          `Condensed: ${node.condensed ? "yes (replaced by higher-depth summary)" : "no (active in context)"}`,
          `Source IDs: [${node.sourceIds.join(", ")}]`,
          `Created: ${node.createdAt}`,
          "",
          "--- Content ---",
          node.content,
        ].join("\n"),
      };
    },
  };
}
