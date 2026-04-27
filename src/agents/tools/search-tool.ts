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
    details: { text },
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

function includesQuery(value: unknown, query: string): boolean {
  if (typeof value !== "string") return false;
  return value.toLowerCase().includes(query.toLowerCase());
}

function generateSnippet(text: string, query: string, maxLength = 200): string {
  const normalizedText = text.trim();
  if (normalizedText.length <= maxLength) return normalizedText;

  const index = normalizedText.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return `${normalizedText.slice(0, maxLength)}...`;

  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(normalizedText.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalizedText.length ? "..." : "";
  return `${prefix}${normalizedText.slice(start, end)}${suffix}`;
}

async function strictPostgresSearch(params: {
  query: string;
  types?: SearchResultType[];
  limit: number;
  since?: number;
  agentId?: string;
  channelId?: string;
}): Promise<UnifiedSearchResult[]> {
  const adapter = await getStorageAdapter();
  const types = params.types ?? ["task", "observation", "session"];
  const results: UnifiedSearchResult[] = [];

  if (types.includes("task")) {
    const tasks = await adapter.tasks.list({
      agentId: params.agentId,
      channelId: params.channelId,
      limit: Math.max(params.limit * 5, 50),
    });
    for (const task of tasks) {
      const searchable = [
        task.title,
        task.description,
        task.status,
        task.priority,
        task.assignee,
        ...(Array.isArray(task.tags) ? task.tags : []),
      ]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" ");
      if (!includesQuery(searchable, params.query)) continue;
      if (params.since && task.createdAt < params.since) continue;
      results.push({
        type: "task",
        id: task.id,
        title: task.title,
        snippet: generateSnippet(task.description || task.title, params.query),
        score: 1,
        timestamp: task.createdAt,
        source: "postgres",
      });
    }
  }

  if (types.includes("observation")) {
    const memory =
      params.agentId && adapter.memory.withAgentId
        ? adapter.memory.withAgentId(params.agentId)
        : adapter.memory;
    const hits = await memory.searchByKeyword(params.query, Math.max(params.limit * 5, 50));
    for (const hit of hits) {
      const item = hit.item;
      const timestamp = Date.parse(item.createdAt);
      if (params.since && Number.isFinite(timestamp) && timestamp < params.since) continue;
      const text = [item.summary, item.reflection, item.lesson]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" ");
      results.push({
        type: "observation",
        id: `memu:${item.id}`,
        title: `[${item.memoryType}] long-term memory`,
        snippet: generateSnippet(text || item.summary, params.query),
        score: hit.score,
        timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
        source: "postgres",
      });
    }
  }

  results.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
  return results.slice(0, params.limit);
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
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const types = params.types as SearchResultType[] | undefined;
      const limit = typeof params.limit === "number" ? params.limit : 20;
      const since = typeof params.since === "number" ? params.since : undefined;
      const strictPostgres = isStrictPostgresOnly(resolveRuntimeStorageConfig(process.env));

      if (strictPostgres) {
        const results = await strictPostgresSearch({
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
      }

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
