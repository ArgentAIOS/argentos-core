import { Type } from "@sinclair/typebox";
import { callGateway } from "../../gateway/call.js";
import { encodeForPrompt } from "../../utils/toon-encoding.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const KnowledgeSearchSchema = Type.Object({
  query: Type.String({ minLength: 1, description: "Search query text" }),
  collection: Type.Optional(
    Type.Unsafe<string | string[]>({
      description:
        "Knowledge collection name or names (optional). If omitted, department routing may auto-select collections.",
    }),
  ),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  includeShared: Type.Optional(
    Type.Boolean({ description: "Include shared memory search results (default false)." }),
  ),
  ingestedOnly: Type.Optional(
    Type.Boolean({ description: "Only return ingested knowledge chunks (default true)." }),
  ),
});

const KnowledgeCollectionsListSchema = Type.Object({
  agentId: Type.Optional(
    Type.String({
      description: "List collections visible to this agent (defaults to current agent).",
    }),
  ),
  includeInaccessible: Type.Optional(
    Type.Boolean({
      description: "Include collections the target agent cannot currently read/write.",
    }),
  ),
});

export function createKnowledgeSearchTool(options?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Knowledge Search",
    name: "knowledge_search",
    description: `Search operator-managed RAG knowledge collections with ACL enforcement.

Use this when you need authoritative knowledge from ingested documents in named collections (for example: default, jason-dev, support-runbooks).

PARAMETERS:
- query: Search query (required)
- collection: Optional collection filter (string or string[])
- limit: Max results (optional, default 12)
- includeShared: Include shared search path (optional)
- ingestedOnly: Restrict to ingested chunks only (optional, default true)`,
    parameters: KnowledgeSearchSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });

      const collectionRaw = params.collection;
      const collection =
        typeof collectionRaw === "string" || Array.isArray(collectionRaw)
          ? (collectionRaw as string | string[])
          : undefined;
      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.max(1, Math.min(100, Math.floor(params.limit)))
          : undefined;
      const includeShared =
        typeof params.includeShared === "boolean" ? params.includeShared : undefined;
      const ingestedOnly =
        typeof params.ingestedOnly === "boolean" ? params.ingestedOnly : undefined;

      const result = await callGateway<{
        success: boolean;
        query: string;
        count: number;
        totalMatched: number;
        limit: number;
        collection?: string[];
        includeShared: boolean;
        ingestedOnly: boolean;
        aclEnforced: boolean;
        results: Array<{
          id: string;
          score: number;
          summary: string;
          type: string;
          citation: string | null;
          collection: string | null;
          sourceFile: string | null;
          chunkIndex: number | null;
          chunkTotal: number | null;
          categories: string[];
          createdAt: string;
        }>;
      }>({
        method: "knowledge.search",
        params: {
          query,
          sessionKey: options?.agentSessionKey,
          options: {
            ...(collection !== undefined ? { collection } : {}),
            ...(limit !== undefined ? { limit } : {}),
            ...(includeShared !== undefined ? { includeShared } : {}),
            ...(ingestedOnly !== undefined ? { ingestedOnly } : {}),
          },
        },
      });

      // TOON-encode results array for compact agent context; keep metadata as-is
      const { results: hits, ...meta } = result;
      const text = [JSON.stringify(meta, null, 2), encodeForPrompt(hits, "knowledge_results")].join(
        "\n",
      );
      return { content: [{ type: "text", text }], details: result };
    },
  };
}

export function createKnowledgeCollectionsListTool(options?: {
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Knowledge Collections List",
    name: "knowledge_collections_list",
    description: `List knowledge collections available to an agent, including ACL capabilities.

Use this before querying or ingesting if you need to discover which collections are readable/writable.`,
    parameters: KnowledgeCollectionsListSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const agentId = readStringParam(params, "agentId");
      const includeInaccessible =
        typeof params.includeInaccessible === "boolean" ? params.includeInaccessible : undefined;

      const result = await callGateway<{
        success: boolean;
        agentId: string;
        actorAgentId: string;
        aclEnforced: boolean;
        collections: Array<{
          collection: string;
          collectionTag: string;
          canRead: boolean;
          canWrite: boolean;
          isOwner: boolean;
          grantedBy: string | null;
          updatedAt: string;
        }>;
      }>({
        method: "knowledge.collections.list",
        params: {
          sessionKey: options?.agentSessionKey,
          options: {
            ...(agentId ? { agentId } : {}),
            ...(includeInaccessible !== undefined ? { includeInaccessible } : {}),
          },
        },
      });

      return jsonResult(result);
    },
  };
}
