/**
 * aos-lcm — lcm_grep tool
 *
 * Full-text search across the immutable message history.
 * Finds messages that were compacted out of the active context.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ConversationStore } from "../store/conversation-store.js";

const LcmGrepParams = Type.Object({
  query: Type.String({
    description:
      "Search query. Supports individual terms and phrases. " +
      'Multiple terms are OR-joined. Example: "database migration"',
  }),
  limit: Type.Optional(Type.Number({ description: "Maximum results to return (default 10)" })),
});

export function createLcmGrepTool(
  conversationStore: ConversationStore,
  getSessionId: () => string,
) {
  return {
    name: "aos_lcm_grep",
    label: "LCM Grep",
    description:
      "Search the full conversation history (including messages that have been compacted " +
      "out of the active context). Uses full-text search with ranked results. " +
      "Use this when you need to recall something discussed earlier that is no " +
      "longer visible in your context window.",
    parameters: LcmGrepParams,
    async execute(_toolCallId: string, params: Static<typeof LcmGrepParams>) {
      const sessionId = getSessionId();
      const results = conversationStore.grep(sessionId, params.query, params.limit ?? 10);

      if (results.length === 0) {
        return {
          type: "text" as const,
          text: `No matches found for "${params.query}" in conversation history.`,
        };
      }

      const formatted = results.map((r, i) =>
        [`[${i + 1}] Message #${r.messageId} (${r.role}, ${r.createdAt})`, `    ${r.snippet}`].join(
          "\n",
        ),
      );

      return {
        type: "text" as const,
        text: [
          `Found ${results.length} match${results.length === 1 ? "" : "es"} for "${params.query}":`,
          "",
          ...formatted,
          "",
          "Use aos_lcm_describe with a message ID for full content.",
        ].join("\n"),
      };
    },
  };
}
