/**
 * Doc Panel Update Tool for Agents
 *
 * Updates an existing document in the dashboard DocPanel by ID.
 * Fetches the current document first, merges changes, then saves.
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

// ============================================================================
// Schema
// ============================================================================

const DocPanelUpdateToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String()),
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

export function createDocPanelUpdateTool(options?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "DocPanel Update",
    name: "doc_panel_update",
    description: `Update an existing document in the dashboard DocPanel by ID.

Use this when you need to revise, append, or replace content in a document
you previously pushed. The document must already exist.

PARAMETERS:
- id (required): The document ID returned when you created it
- content (required): The new/updated content (replaces existing)
- title (optional): New title — keeps existing if omitted
- type (optional): "markdown" | "code" | "data" | "html" — keeps existing if omitted
- language (optional): For code type — keeps existing if omitted
- saveToKnowledge (optional, default true): Also sync to PG knowledge
- knowledgeCollection (optional): Knowledge collection override (default: docpane)`,
    parameters: DocPanelUpdateToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const id = readStringParam(params, "id", { required: true });
      const content = readStringParam(params, "content", {
        required: true,
        trim: false,
        allowEmpty: false,
      });
      const title = readStringParam(params, "title");
      const type = readStringParam(params, "type");
      const language = readStringParam(params, "language");
      const knowledgeCollection = readStringParam(params, "knowledgeCollection");
      const saveToKnowledge =
        typeof params.saveToKnowledge === "boolean" ? params.saveToKnowledge : true;

      try {
        // Fetch existing document
        const getRes = await fetch(
          `${DASHBOARD_API}/api/canvas/document/${encodeURIComponent(id!)}`,
          { headers: dashboardApiHeaders() },
        );

        if (!getRes.ok) {
          if (getRes.status === 404) {
            return textResult(`Document not found: no document with ID "${id}" exists.`);
          }
          const err = await getRes.json().catch(() => ({ error: "Unknown error" }));
          return textResult(
            `Error fetching document: ${(err as { error?: string }).error || getRes.statusText}`,
          );
        }

        const existing = (await getRes.json()) as {
          title?: string;
          type?: string;
          language?: string;
        };

        // Merge: keep existing values unless overridden
        const mergedTitle = title || existing.title || "Untitled";
        const mergedType = type || existing.type || "markdown";
        const mergedLanguage = language || existing.language;

        const saveRes = await fetch(`${DASHBOARD_API}/api/canvas/save`, {
          method: "POST",
          headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            doc: {
              id,
              title: mergedTitle,
              content,
              type: mergedType,
              language: mergedLanguage,
              saveToKnowledge,
              knowledgeCollection,
            },
            sessionKey: options?.agentSessionKey,
          }),
        });

        if (!saveRes.ok) {
          const err = await saveRes.json().catch(() => ({ error: "Unknown error" }));
          return textResult(
            `Error updating document: ${(err as { error?: string }).error || saveRes.statusText}`,
          );
        }

        const payload = (await saveRes.json().catch(() => ({}))) as {
          persisted?: boolean;
          collection?: string;
        };
        const resultLines = [`Document "${mergedTitle}" updated in DocPanel (ID: ${id}).`];
        if (saveToKnowledge && payload.persisted !== false) {
          resultLines.push(
            `Synced to PG knowledge collection "${payload.collection || knowledgeCollection || "docpane"}".`,
          );
        } else if (!saveToKnowledge || payload.persisted === false) {
          resultLines.push("Updated in DocPanel without PG knowledge persistence.");
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
