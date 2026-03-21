/**
 * Doc Panel Get Tool
 *
 * Retrieves full content of a document from the dashboard DocPanel.
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

const DocPanelGetToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  open: Type.Optional(Type.Boolean()),
});

interface Document {
  id: string;
  title: string;
  content: string;
  type: string;
  language?: string;
  createdAt: number;
  updatedAt?: number;
  tags?: string[];
}

export function createDocPanelGetTool(options?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Get DocPanel Document",
    name: "doc_panel_get",
    description: `Retrieve the full content of a document from the dashboard DocPanel.

Use this to:
- Read a document you created earlier
- Get content for editing or updating
- Review a previous report or analysis

PARAMETERS:
- id: Document ID (required) - get this from doc_panel_list or doc_panel_search

EXAMPLE:
- Get document: { "id": "abc-123-def" }

After retrieving, you can:
- Read and discuss the content
- Update it by calling doc_panel again with the same title (creates new version)
- Extract specific information

By default this tool also opens/focuses the document in the dashboard DocPanel tab.
Set "open": false if you only want retrieval without UI focus.`,
    parameters: DocPanelGetToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const id = readStringParam(params, "id", { required: true });
      const shouldOpen = typeof params.open === "boolean" ? params.open : true;
      const headers = dashboardApiHeaders(
        options?.agentSessionKey ? { "x-session-key": options.agentSessionKey } : undefined,
      );

      try {
        const res = await fetch(`${DASHBOARD_API}/api/canvas/document/${encodeURIComponent(id)}`, {
          method: "GET",
          headers,
        });

        if (!res.ok) {
          if (res.status === 404) {
            return textResult(`Document not found: ${id}`);
          }
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          return textResult(`Error retrieving document: ${err.error || res.statusText}`);
        }

        const doc = (await res.json()) as Document;
        let openStatusLine = "";
        if (shouldOpen) {
          try {
            const openRes = await fetch(`${DASHBOARD_API}/api/canvas/open`, {
              method: "POST",
              headers: dashboardApiHeaders({
                "Content-Type": "application/json",
                ...(options?.agentSessionKey ? { "x-session-key": options.agentSessionKey } : {}),
              }),
              body: JSON.stringify({ id: doc.id, sessionKey: options?.agentSessionKey }),
            });
            if (openRes.ok) {
              openStatusLine = "🗂️ **DocPanel:** Opened/focused in dashboard tab.";
            } else {
              const err = await openRes.json().catch(() => ({ error: `HTTP ${openRes.status}` }));
              openStatusLine = `⚠️ **DocPanel open failed:** ${err.error || openRes.statusText}`;
            }
          } catch (openErr) {
            openStatusLine = `⚠️ **DocPanel open failed:** ${openErr instanceof Error ? openErr.message : "Unknown error"}`;
          }
        }

        const lines: string[] = [];
        lines.push(`📄 **${doc.title}**\n`);
        lines.push(`**ID:** ${doc.id}`);
        lines.push(`**Type:** ${doc.type}`);
        if (doc.language) {
          lines.push(`**Language:** ${doc.language}`);
        }
        if (doc.tags && doc.tags.length > 0) {
          lines.push(`**Tags:** ${doc.tags.join(", ")}`);
        }
        const created = doc.createdAt ? new Date(doc.createdAt).toLocaleString() : "unknown";
        lines.push(`**Created:** ${created}`);
        if (doc.updatedAt && doc.updatedAt !== doc.createdAt) {
          const updated = new Date(doc.updatedAt).toLocaleString();
          lines.push(`**Updated:** ${updated}`);
        }
        if (openStatusLine) {
          lines.push(openStatusLine);
        }
        lines.push("\n---\n");
        lines.push("**CONTENT:**\n");
        lines.push(doc.content);

        return textResult(lines.join("\n"));
      } catch (err) {
        return textResult(
          `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
  };
}
