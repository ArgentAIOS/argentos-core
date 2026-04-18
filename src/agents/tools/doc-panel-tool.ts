/**
 * Doc Panel Tool for Agents
 *
 * Pushes documents, reports, and analysis to the dashboard's
 * slide-out DocPanel via the `/api/canvas/save` endpoint.
 * The dashboard SSE handler catches `document_saved` events
 * and opens the panel automatically.
 */

import { Type } from "@sinclair/typebox";
import crypto from "node:crypto";
import { dashboardApiHeaders } from "../../utils/dashboard-api.js";
import { type AnyAgentTool, readStringParam } from "./common.js";

const DASHBOARD_API = process.env.ARGENT_DASHBOARD_API || "http://localhost:9242";

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

// ============================================================================
// Schema
// ============================================================================

const DocPanelToolSchema = Type.Object({
  title: Type.String(),
  content: Type.String(),
  type: Type.Optional(
    Type.Union([
      Type.Literal("markdown"),
      Type.Literal("code"),
      Type.Literal("data"),
      Type.Literal("html"),
    ]),
  ),
  language: Type.Optional(Type.String()),
  saveToKnowledge: Type.Optional(Type.Boolean({ default: true })),
  knowledgeCollection: Type.Optional(Type.String()),
});

// ============================================================================
// Tool Implementation
// ============================================================================

export function createDocPanelTool(options?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "DocPanel",
    name: "doc_panel",
    description: `Push a document, report, or analysis to the dashboard DocPanel.

WHEN TO USE THIS TOOL (mandatory):
- Any research, analysis, or report the user requests
- Comparisons, summaries, or deep dives
- Code reviews or technical documentation
- Data tables, lists, or structured content
- Anything longer than a few paragraphs

DO NOT put long-form user-facing content in chat. Use doc_panel for surfaced deliverables.
Do NOT use doc_panel for repetitive autonomous scratch notes, low-signal background thinking, or near-duplicate reformulations when memory_store, tasks, or updating an existing doc is the better fit.
Give a brief 1-2 sentence summary in chat after pushing.

TYPES:
- markdown (default): Reports, analysis, formatted text
- code: Source code with syntax highlighting
- data: Raw data, JSON, CSV
- html: Rich interactive content

KNOWLEDGE PERSISTENCE:
- saveToKnowledge (default: true): Also persist this document to PG-backed knowledge.
- knowledgeCollection (optional): Knowledge collection name (defaults to "docpane").

EXAMPLES:
- Report: { "title": "Silver Market Analysis", "content": "# Overview\\n\\n..." }
- Code: { "title": "API Handler", "content": "...", "type": "code", "language": "typescript" }
- Persist to collection: { "title": "Ops Runbook", "content": "...", "knowledgeCollection": "ops" }`,
    parameters: DocPanelToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const title = readStringParam(params, "title", { required: true });
      const content = readStringParam(params, "content", {
        required: true,
        trim: false,
        allowEmpty: false,
      });
      const type = readStringParam(params, "type") || "markdown";
      const language = readStringParam(params, "language");
      const knowledgeCollection = readStringParam(params, "knowledgeCollection");
      const saveToKnowledge =
        typeof params.saveToKnowledge === "boolean" ? params.saveToKnowledge : true;

      const docId = crypto.randomUUID();

      try {
        const res = await fetch(`${DASHBOARD_API}/api/canvas/save`, {
          method: "POST",
          headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            doc: {
              id: docId,
              title,
              content,
              type,
              language,
              autoRouted: true,
              saveToKnowledge,
              knowledgeCollection,
            },
            sessionKey: options?.agentSessionKey,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          return textResult(`Error saving document: ${err.error || res.statusText}`);
        }

        const data = (await res.json()) as {
          id?: string;
          tags?: string[];
          persisted?: boolean;
          collection?: string;
        };
        const savedId = data.id || docId;
        const resultLines = [
          `Document "${title}" pushed to DocPanel (ID: ${savedId}). The panel will slide out automatically in the dashboard.`,
        ];

        if (saveToKnowledge && data.persisted !== false) {
          resultLines.push(
            `Persisted to PG knowledge collection "${data.collection || knowledgeCollection || "docpane"}".`,
          );
        } else if (!saveToKnowledge || data.persisted === false) {
          resultLines.push("Saved to DocPanel without PG knowledge persistence.");
        }

        return textResult(resultLines.join("\n"));
      } catch (err) {
        return textResult(
          `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
  };
}
