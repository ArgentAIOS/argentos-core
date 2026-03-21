import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";

const ToolSearchSchema = Type.Object({
  query: Type.String({
    description:
      "Keywords describing the capability you need. Example: 'set up worker', 'deploy app', 'knowledge search', 'session history'.",
    minLength: 1,
  }),
  limit: Type.Optional(
    Type.Number({
      description: "Optional maximum number of matches to return (default 5, max 10).",
      minimum: 1,
      maximum: 10,
    }),
  ),
});

type ToolStatusEntry = {
  name: string;
  label?: string;
  description?: string;
  source: "core" | "plugin";
  pluginId?: string;
  optional?: boolean;
};

type ToolsStatusReport = {
  agentId: string;
  sessionKey: string;
  total: number;
  tools: ToolStatusEntry[];
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function scoreMatch(tool: ToolStatusEntry, terms: string[]) {
  const name = normalize(tool.name);
  const label = normalize(tool.label ?? "");
  const description = normalize(tool.description ?? "");
  let score = 0;
  for (const term of terms) {
    if (!term) {
      continue;
    }
    if (name === term) {
      score += 10;
    }
    if (name.includes(term)) {
      score += 6;
    }
    if (label.includes(term)) {
      score += 4;
    }
    if (description.includes(term)) {
      score += 2;
    }
  }
  return score;
}

function formatMatch(tool: ToolStatusEntry) {
  const label = tool.label?.trim();
  const desc = tool.description?.trim();
  const parts = [`- ${tool.name}`];
  if (label && label.toLowerCase() !== tool.name.toLowerCase()) {
    parts.push(`(${label})`);
  }
  if (desc) {
    parts.push(`— ${desc}`);
  }
  return parts.join(" ");
}

export function createToolSearchTool(opts?: { agentId?: string }): AnyAgentTool {
  return {
    label: "Tool Search",
    name: "tool_search",
    description:
      "Search the agent's currently available tools by keyword when you are not sure which capability exists. Use this before claiming a tool is unavailable.",
    parameters: ToolSearchSchema,
    execute: async (_toolCallId, args) => {
      const params = (args ?? {}) as Record<string, unknown>;
      const rawQuery = typeof params.query === "string" ? params.query.trim() : "";
      if (!rawQuery) {
        throw new Error("tool_search requires a non-empty query.");
      }

      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.max(1, Math.min(10, Math.trunc(params.limit)))
          : 5;
      const terms = rawQuery
        .split(/\s+/g)
        .map((part) => normalize(part))
        .filter(Boolean);

      const gatewayOpts: GatewayCallOptions = { timeoutMs: 15_000 };
      const report = await callGatewayTool<ToolsStatusReport>("tools.status", gatewayOpts, {
        ...(opts?.agentId ? { agentId: opts.agentId } : {}),
      });

      const tools = Array.isArray(report?.tools) ? report.tools : [];
      const ranked = tools
        .map((tool) => ({ tool, score: scoreMatch(tool, terms) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
        .slice(0, limit);

      const text =
        ranked.length === 0
          ? `No matching tools found for "${rawQuery}". If you still believe a capability should exist, check skills or operator docs before saying it is unavailable.`
          : [
              `Tool matches for "${rawQuery}" (${ranked.length}):`,
              ...ranked.map((entry) => formatMatch(entry.tool)),
              "",
              "These tools are already in the current callable surface if policy allows them.",
            ].join("\n");

      return {
        content: [{ type: "text", text }],
        details: {
          ok: true,
          query: rawQuery,
          agentId: report?.agentId,
          sessionKey: report?.sessionKey,
          matches: ranked.map((entry) => ({
            name: entry.tool.name,
            label: entry.tool.label,
            description: entry.tool.description,
            source: entry.tool.source,
            score: entry.score,
          })),
        },
      };
    },
  };
}
