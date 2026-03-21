/**
 * Doc Panel Search Tool
 *
 * Searches documents in the dashboard DocPanel by query.
 */

import { Type } from "@sinclair/typebox";
import { dashboardApiHeaders } from "../../utils/dashboard-api.js";
import { type AnyAgentTool, readStringParam } from "./common.js";

const DASHBOARD_API = process.env.ARGENT_DASHBOARD_API || "http://localhost:9242";

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

const DocPanelSearchToolSchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
});

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  type: string;
  score: number;
  createdAt: number;
}

export function createDocPanelSearchTool(options?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Search DocPanel Documents",
    name: "doc_panel_search",
    description: `Search through DocPanel documents by content or title.

Use this to:
- Find a specific document you created
- Search for documents about a topic
- Locate documents containing specific keywords

PARAMETERS:
- query: Search text to find in documents (required)
- limit: Max results to return (optional, default: 10, max: 50)

EXAMPLES:
- Find report: { "query": "silver market analysis" }
- Find code: { "query": "API authentication handler" }
- Search topic: { "query": "deployment steps" }`,
    parameters: DocPanelSearchToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.max(1, Math.min(50, Math.floor(params.limit)))
          : 10;

      try {
        const res = await fetch(`${DASHBOARD_API}/api/canvas/search`, {
          method: "POST",
          headers: dashboardApiHeaders({
            "Content-Type": "application/json",
            ...(options?.agentSessionKey ? { "x-session-key": options.agentSessionKey } : {}),
          }),
          body: JSON.stringify({ query, limit, sessionKey: options?.agentSessionKey }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          return textResult(`Error searching documents: ${err.error || res.statusText}`);
        }

        const data = (await res.json()) as { results: SearchResult[] };
        const results = Array.isArray(data.results) ? data.results : [];

        if (results.length === 0) {
          return textResult(`No documents found matching "${query}".`);
        }

        const lines: string[] = [];
        lines.push(`Found ${results.length} document(s) matching "${query}":\n`);

        for (const result of results) {
          const date = result.createdAt ? new Date(result.createdAt).toLocaleString() : "unknown";
          const score = result.score ? `(relevance: ${(result.score * 100).toFixed(0)}%)` : "";
          lines.push(`📄 **${result.title}** ${score}`);
          lines.push(`   ID: ${result.id}`);
          lines.push(`   Type: ${result.type}`);
          lines.push(`   Created: ${date}`);
          if (result.snippet) {
            lines.push(`   Preview: ${result.snippet}`);
          }
          lines.push("");
        }

        lines.push("\nTip: Use doc_panel_get with the document ID to retrieve full content.");

        return textResult(lines.join("\n"));
      } catch (err) {
        return textResult(
          `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
  };
}
