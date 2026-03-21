/**
 * Unified Search Tool for Agents
 *
 * Search across all ArgentOS databases:
 * - Tasks
 * - Memory/Observations
 * - Sessions
 */

import { Type } from "@sinclair/typebox";
import type { UnifiedSearchResult, SearchResultType } from "../../data/types.js";
import { getDataAPI } from "../../data/index.js";
import { isStrictPostgresOnly } from "../../data/storage-config.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { resolveRuntimeStorageConfig } from "../../data/storage-resolver.js";
import { type AnyAgentTool, readStringParam } from "./common.js";

// Helper to return text result
function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

// ============================================================================
// Schema
// ============================================================================

const SearchToolSchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  types: Type.Optional(
    Type.Array(
      Type.Union([Type.Literal("task"), Type.Literal("observation"), Type.Literal("session")]),
    ),
  ),
  limit: Type.Optional(Type.Number({ default: 20 })),
  since: Type.Optional(Type.Number()),
});

// ============================================================================
// Tool Options
// ============================================================================

type SearchToolOptions = {
  agentId?: string;
  channelId?: string;
};

// ============================================================================
// Formatting Helpers
// ============================================================================

const TYPE_ICONS: Record<SearchResultType, string> = {
  task: "📋",
  observation: "💭",
  session: "💬",
};

const TYPE_LABELS: Record<SearchResultType, string> = {
  task: "Task",
  observation: "Memory",
  session: "Session",
};

function formatSearchResults(results: UnifiedSearchResult[], query: string): string {
  const lines: string[] = [];

  lines.push(`Found ${results.length} result(s) for "${query}":`);
  lines.push("");

  // Group by type
  const grouped: Record<SearchResultType, UnifiedSearchResult[]> = {
    task: [],
    observation: [],
    session: [],
  };

  for (const result of results) {
    grouped[result.type].push(result);
  }

  // Format each group
  for (const type of ["task", "observation", "session"] as SearchResultType[]) {
    const typeResults = grouped[type];
    if (typeResults.length === 0) continue;

    lines.push(`### ${TYPE_ICONS[type]} ${TYPE_LABELS[type]}s (${typeResults.length})`);
    lines.push("");

    for (const result of typeResults) {
      const date = new Date(result.timestamp).toLocaleDateString();
      lines.push(`**${result.title}** (${date})`);
      lines.push(`  ID: ${result.id}`);
      if (result.snippet) {
        // Truncate long snippets
        const snippet =
          result.snippet.length > 200 ? result.snippet.slice(0, 200) + "..." : result.snippet;
        lines.push(`  ${snippet}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Tool Implementation
// ============================================================================

export function createSearchTool(opts?: SearchToolOptions): AnyAgentTool {
  return {
    label: "Search",
    name: "argent_search",
    description: `Search across all ArgentOS data including tasks, memory/observations, and sessions.

Use this to find:
- Previous conversations and context
- Related tasks
- Historical observations and tool results
- Session information

PARAMETERS:
- query: Search keywords (required)
- types: Filter by type ["task", "observation", "session"] (optional, default: all)
- limit: Max results (optional, default: 20)
- since: Only results after this timestamp in ms (optional)

EXAMPLES:
- Search everything: { "query": "deployment" }
- Search only tasks: { "query": "PR review", "types": ["task"] }
- Search recent memory: { "query": "API error", "types": ["observation"], "since": 1706745600000 }`,
    parameters: SearchToolSchema,
    execute: async (_toolCallId, args) => {
      if (isStrictPostgresOnly(resolveRuntimeStorageConfig(process.env))) {
        return textResult(
          "argent_search is temporarily unavailable in strict PostgreSQL mode. Use targeted tools (tasks, memory_recall) until unified search is migrated off legacy SQLite/DataAPI.",
        );
      }
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const types = params.types as SearchResultType[] | undefined;
      const limit = typeof params.limit === "number" ? params.limit : 20;
      const since = typeof params.since === "number" ? params.since : undefined;

      const api = await getDataAPI();
      await getStorageAdapter();

      const results = await api.unifiedSearch({
        query,
        types,
        limit,
        since,
        agentId: opts?.agentId,
        channelId: opts?.channelId,
      });

      if (results.length === 0) {
        return textResult(`No results found for: "${query}"`);
      }

      return textResult(formatSearchResults(results, query));
    },
  };
}
