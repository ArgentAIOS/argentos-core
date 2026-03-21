/**
 * Doc Panel List Tool
 *
 * Lists recent documents from the dashboard DocPanel.
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

const DocPanelListToolSchema = Type.Object({
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
});

interface DocumentEntry {
  id: string;
  title: string;
  type: string;
  createdAt: number;
  tags?: string[];
}

export function createDocPanelListTool(options?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "List DocPanel Documents",
    name: "doc_panel_list",
    description: `List recent documents from the dashboard DocPanel.

Use this to:
- See what documents have been created
- Find a document you created earlier
- Check recent reports or analysis

PARAMETERS:
- limit: Max number of documents to return (optional, default: 20, max: 100)

EXAMPLE:
- List recent: { "limit": 10 }`,
    parameters: DocPanelListToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.max(1, Math.min(100, Math.floor(params.limit)))
          : 20;

      try {
        const res = await fetch(`${DASHBOARD_API}/api/canvas/documents?limit=${limit}`, {
          method: "GET",
          headers: dashboardApiHeaders(
            options?.agentSessionKey ? { "x-session-key": options.agentSessionKey } : undefined,
          ),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          return textResult(`Error listing documents: ${err.error || res.statusText}`);
        }

        const data = (await res.json()) as { documents: DocumentEntry[] };
        const docs = Array.isArray(data.documents) ? data.documents : [];

        if (docs.length === 0) {
          return textResult("No documents found in DocPanel.");
        }

        const lines: string[] = [];
        lines.push(`Found ${docs.length} document(s) in DocPanel:\n`);

        for (const doc of docs) {
          const date = doc.createdAt ? new Date(doc.createdAt).toLocaleString() : "unknown";
          const tags = doc.tags && doc.tags.length > 0 ? ` [${doc.tags.join(", ")}]` : "";
          lines.push(`📄 **${doc.title}**${tags}`);
          lines.push(`   ID: ${doc.id}`);
          lines.push(`   Type: ${doc.type}`);
          lines.push(`   Created: ${date}`);
          lines.push("");
        }

        lines.push(
          "\nTip: Use doc_panel_get with the document ID to retrieve content for editing.",
        );

        return textResult(lines.join("\n"));
      } catch (err) {
        return textResult(
          `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
  };
}
