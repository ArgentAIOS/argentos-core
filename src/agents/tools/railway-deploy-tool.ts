/**
 * Railway Deploy Tool
 *
 * Core runtime tool for Railway GraphQL API operations.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const DEFAULT_RAILWAY_API_URL = "https://backboard.railway.app/graphql/v2";

const RailwayDeploySchema = Type.Object({
  action: Type.Union([
    Type.Literal("test_connection"),
    Type.Literal("list_projects"),
    Type.Literal("graphql"),
  ]),
  api_url: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
  variables: Type.Optional(Type.Unsafe<Record<string, unknown>>()),
  include_raw: Type.Optional(Type.Boolean()),
});

type JsonObject = Record<string, unknown>;

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  } as import("../../agent-core/core.js").AgentToolResult<unknown>;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractProjects(payload: unknown): JsonObject[] {
  if (!isObject(payload)) return [];
  const data = payload.data;
  if (!isObject(data)) return [];
  const projects = data.projects;
  if (!isObject(projects)) return [];
  const edges = projects.edges;
  if (!Array.isArray(edges)) return [];
  return edges
    .map((edge) => (isObject(edge) && isObject(edge.node) ? edge.node : null))
    .filter((node): node is JsonObject => Boolean(node));
}

async function railwayGraphql(params: {
  apiUrl: string;
  token: string;
  query: string;
  variables?: JsonObject;
}): Promise<unknown> {
  const res = await fetch(params.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: params.query, variables: params.variables || {} }),
  });

  const raw = await res.text();
  const payload = parseJson(raw);
  if (!res.ok) {
    throw new Error(
      `Railway API error (${res.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
    );
  }
  return payload;
}

export function createRailwayDeployTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  const resolveKey = (name: string) =>
    resolveServiceKey(name, options?.config, {
      sessionKey: options?.agentSessionKey,
      source: "railway_deploy",
    });

  return {
    label: "Railway Deploy",
    name: "railway_deploy",
    description: `Manage Railway deployments using core runtime integration.

Actions:
- test_connection: Verify API key by querying account info
- list_projects: List Railway projects
- graphql: Run a custom GraphQL query`,
    parameters: RailwayDeploySchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        const token =
          resolveKey("RAILWAY_API_TOKEN") ||
          resolveKey("RAILWAY_API_KEY") ||
          process.env.RAILWAY_API_TOKEN ||
          process.env.RAILWAY_API_KEY;
        if (!token) {
          throw new Error("No Railway key found. Add RAILWAY_API_TOKEN in Settings > API Keys.");
        }

        const apiUrl =
          readStringParam(params, "api_url") ||
          process.env.RAILWAY_API_URL ||
          DEFAULT_RAILWAY_API_URL;
        const includeRaw = asBool(params.include_raw);

        switch (action) {
          case "test_connection": {
            const payload = await railwayGraphql({
              apiUrl,
              token,
              query: "query ArgentRailwayMe { me { id email name } }",
            });
            const me =
              isObject(payload) && isObject(payload.data) && isObject(payload.data.me)
                ? payload.data.me
                : {};
            return jsonResult({
              action,
              ok: true,
              account: {
                id: typeof me.id === "string" ? me.id : undefined,
                email: typeof me.email === "string" ? me.email : undefined,
                name: typeof me.name === "string" ? me.name : undefined,
              },
              raw: includeRaw ? payload : undefined,
            });
          }

          case "list_projects": {
            const payload = await railwayGraphql({
              apiUrl,
              token,
              query: "query ArgentRailwayProjects { projects { edges { node { id name } } } }",
            });
            const projects = extractProjects(payload).map((project) => ({
              id: typeof project.id === "string" ? project.id : undefined,
              name: typeof project.name === "string" ? project.name : undefined,
            }));
            return jsonResult({
              action,
              count: projects.length,
              projects,
              raw: includeRaw ? payload : undefined,
            });
          }

          case "graphql": {
            const query = readStringParam(params, "query", { required: true, trim: false });
            const variablesRaw = params.variables;
            const variables =
              variablesRaw === undefined ? undefined : toObject(variablesRaw, "variables");
            const payload = await railwayGraphql({ apiUrl, token, query, variables });
            return jsonResult({
              action,
              raw: payload,
            });
          }

          default:
            return textResult("Unknown action. Use: test_connection, list_projects, graphql");
        }
      } catch (err) {
        return textResult(
          `railway_deploy error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
