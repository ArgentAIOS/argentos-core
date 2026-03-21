import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { callGateway } from "../../gateway/call.js";
import { readStringParam } from "./common.js";

const SessionsSearchToolSchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Number({ minimum: 1 })),
});

type SearchHit = {
  sessionKey: string;
  role: string;
  snippet: string;
  timestamp: number;
  sessionUpdatedAt: number;
};

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function createSessionsSearchTool(): AnyAgentTool {
  return {
    label: "Search Chat Transcripts",
    name: "sessions_search",
    description: `Search through all previous chat session transcripts for specific content.

Use this to find:
- Things discussed in previous conversations
- Decisions, instructions, or context from past sessions
- Specific topics or keywords across all chat history

PARAMETERS:
- query: Text to search for in chat messages (required)
- limit: Max results (optional, default: 20)

EXAMPLES:
- Find a discussion: { "query": "avatar moods" }
- Find a decision: { "query": "Yiota model" }
- Find instructions: { "query": "deployment steps" }`,
    parameters: SessionsSearchToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const limit = typeof params.limit === "number" ? Math.max(1, Math.floor(params.limit)) : 20;

      const result = await callGateway<{
        query: string;
        count: number;
        hits: SearchHit[];
      }>({
        method: "sessions.search",
        params: { query, limit },
      });

      const hits = Array.isArray(result?.hits) ? result.hits : [];
      if (hits.length === 0) {
        return textResult(`No chat messages found matching "${query}".`);
      }

      const lines: string[] = [];
      lines.push(`Found ${hits.length} message(s) matching "${query}":`);
      lines.push("");

      // Group by session key
      const grouped = new Map<string, SearchHit[]>();
      for (const hit of hits) {
        const group = grouped.get(hit.sessionKey) ?? [];
        group.push(hit);
        grouped.set(hit.sessionKey, group);
      }

      for (const [sessionKey, sessionHits] of grouped) {
        const sessionDate = sessionHits[0].sessionUpdatedAt
          ? new Date(sessionHits[0].sessionUpdatedAt).toLocaleDateString()
          : "unknown";
        lines.push(`### 💬 Session: ${sessionKey} (${sessionDate})`);
        for (const hit of sessionHits) {
          const role = hit.role === "user" ? "👤 User" : "🤖 Assistant";
          const time = hit.timestamp ? new Date(hit.timestamp).toLocaleTimeString() : "";
          lines.push(`${role}${time ? ` (${time})` : ""}:`);
          lines.push(`  ${hit.snippet}`);
          lines.push("");
        }
      }

      return textResult(lines.join("\n"));
    },
  };
}
