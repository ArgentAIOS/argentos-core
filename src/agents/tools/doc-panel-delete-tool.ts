/**
 * Doc Panel Delete Tool for Agents
 *
 * Deletes a document from the dashboard DocPanel by ID.
 * Supports soft delete (default) and hard/permanent delete.
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

const DocPanelDeleteToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  hard: Type.Optional(Type.Boolean({ default: false })),
  removeFromKnowledge: Type.Optional(Type.Boolean({ default: true })),
  knowledgeCollection: Type.Optional(Type.String()),
});

// ============================================================================
// Tool Implementation
// ============================================================================

export function createDocPanelDeleteTool(options?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "DocPanel Delete",
    name: "doc_panel_delete",
    description: `Delete a document from the dashboard DocPanel by ID.

PARAMETERS:
- id (required): The document ID to delete
- hard (optional, default false): Legacy flag. In PG-only DocPanel mode this is ignored.
- removeFromKnowledge (optional, default true): Must stay true in PG-only DocPanel mode.
- knowledgeCollection (optional): Restrict knowledge delete to one collection.`,
    parameters: DocPanelDeleteToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const id = readStringParam(params, "id", { required: true });
      const hard = typeof params.hard === "boolean" ? params.hard : false;
      const removeFromKnowledge =
        typeof params.removeFromKnowledge === "boolean" ? params.removeFromKnowledge : true;
      const knowledgeCollection = readStringParam(params, "knowledgeCollection");

      try {
        const query = new URLSearchParams();
        if (hard) query.set("hard", "true");
        if (!removeFromKnowledge) query.set("removeFromKnowledge", "false");
        if (knowledgeCollection) query.set("collection", knowledgeCollection);
        const suffix = query.toString();
        const url = `${DASHBOARD_API}/api/canvas/document/${encodeURIComponent(id!)}${suffix ? `?${suffix}` : ""}`;
        const res = await fetch(url, {
          method: "DELETE",
          headers: dashboardApiHeaders(
            options?.agentSessionKey ? { "x-session-key": options.agentSessionKey } : undefined,
          ),
        });

        if (!res.ok) {
          if (res.status === 404) {
            return textResult(`Document not found: no document with ID "${id}" exists.`);
          }
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          return textResult(
            `Error deleting document: ${(err as { error?: string }).error || res.statusText}`,
          );
        }

        const payload = (await res.json().catch(() => ({}))) as { deleted?: number };
        const deletedChunks = Number(payload.deleted || 0);
        const resultLines = [
          `Document "${id}" deleted from DocPanel (PG knowledge-backed storage).`,
          `Removed ${deletedChunks} chunk${deletedChunks === 1 ? "" : "s"} from PG knowledge.`,
        ];
        if (hard) {
          resultLines.push(
            "Note: `hard` is a legacy flag and is ignored in PG-only DocPanel mode.",
          );
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
