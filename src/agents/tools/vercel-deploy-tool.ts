/**
 * Vercel Deploy Tool
 *
 * Core runtime tool for Vercel project/domain/deployment operations.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { type AnyAgentTool, jsonResult, readNumberParam, readStringParam } from "./common.js";

const DEFAULT_VERCEL_API_URL = "https://api.vercel.com";

const VercelDeploySchema = Type.Object({
  action: Type.Union([
    Type.Literal("test_connection"),
    Type.Literal("list_projects"),
    Type.Literal("create_project"),
    Type.Literal("add_domain"),
    Type.Literal("list_deployments"),
  ]),
  api_url: Type.Optional(Type.String()),
  team_id: Type.Optional(Type.String()),
  project_id: Type.Optional(Type.String()),
  project_name: Type.Optional(Type.String()),
  domain: Type.Optional(Type.String()),
  framework: Type.Optional(Type.String()),
  git_repository: Type.Optional(Type.String()),
  branch: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
  include_raw: Type.Optional(Type.Boolean()),
  payload: Type.Optional(Type.Unsafe<Record<string, unknown>>()),
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function asBool(value: unknown): boolean {
  return value === true;
}

function toPayload(raw: unknown): JsonObject | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw new Error("payload must be an object");
  return raw;
}

async function vercelRequest(params: {
  apiUrl: string;
  token: string;
  method?: "GET" | "POST";
  path: string;
  teamId?: string;
  query?: Record<string, string | number | undefined>;
  body?: JsonObject;
}): Promise<unknown> {
  const base = params.apiUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${params.path}`);
  if (params.teamId) url.searchParams.set("teamId", params.teamId);
  for (const [key, value] of Object.entries(params.query || {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    method: params.method || "GET",
    headers: {
      Authorization: `Bearer ${params.token}`,
      Accept: "application/json",
      ...(params.body ? { "Content-Type": "application/json" } : {}),
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });

  const raw = await res.text();
  const payload = parseJson(raw);
  if (!res.ok) {
    throw new Error(
      `Vercel API error (${res.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
    );
  }
  return payload;
}

export function createVercelDeployTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  const resolveKey = (name: string) =>
    resolveServiceKey(name, options?.config, {
      sessionKey: options?.agentSessionKey,
      source: "vercel_deploy",
    });

  return {
    label: "Vercel Deploy",
    name: "vercel_deploy",
    description: `Manage Vercel deployment resources.

Actions:
- test_connection: validate token
- list_projects: list Vercel projects
- create_project: create project metadata
- add_domain: assign custom domain
- list_deployments: list recent deployments`,
    parameters: VercelDeploySchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        const token = resolveKey("VERCEL_API_TOKEN") || process.env.VERCEL_API_TOKEN;
        if (!token)
          throw new Error("No Vercel token found. Add VERCEL_API_TOKEN in Settings > API Keys.");

        const apiUrl =
          readStringParam(params, "api_url") ||
          process.env.VERCEL_API_URL ||
          DEFAULT_VERCEL_API_URL;
        const teamId =
          readStringParam(params, "team_id") ||
          resolveKey("VERCEL_TEAM_ID") ||
          process.env.VERCEL_TEAM_ID;
        const includeRaw = asBool(params.include_raw);

        switch (action) {
          case "test_connection": {
            const payload = await vercelRequest({ apiUrl, token, path: "/v2/user", teamId });
            const user = isObject(payload) && isObject(payload.user) ? payload.user : {};
            return jsonResult({
              action,
              ok: true,
              user: {
                id: typeof user.id === "string" ? user.id : undefined,
                username: typeof user.username === "string" ? user.username : undefined,
                email: typeof user.email === "string" ? user.email : undefined,
              },
              raw: includeRaw ? payload : undefined,
            });
          }

          case "list_projects": {
            const limit = Math.max(
              1,
              Math.min(100, Math.trunc(readNumberParam(params, "limit") || 20)),
            );
            const payload = await vercelRequest({
              apiUrl,
              token,
              path: "/v9/projects",
              teamId,
              query: { limit },
            });
            const projectsRaw =
              isObject(payload) && Array.isArray(payload.projects) ? payload.projects : [];
            const projects = projectsRaw.filter(isObject).map((project) => ({
              id: typeof project.id === "string" ? project.id : undefined,
              name: typeof project.name === "string" ? project.name : undefined,
              framework: typeof project.framework === "string" ? project.framework : undefined,
            }));
            return jsonResult({
              action,
              count: projects.length,
              projects,
              raw: includeRaw ? payload : undefined,
            });
          }

          case "create_project": {
            const name = readStringParam(params, "project_name", { required: true });
            const framework = readStringParam(params, "framework");
            const customPayload = toPayload(params.payload);
            const body =
              customPayload ||
              ({
                name,
                ...(framework ? { framework } : {}),
              } satisfies JsonObject);
            const payload = await vercelRequest({
              apiUrl,
              token,
              method: "POST",
              path: "/v10/projects",
              teamId,
              body,
            });
            const project = isObject(payload) ? payload : {};
            return jsonResult({
              action,
              project: {
                id: typeof project.id === "string" ? project.id : undefined,
                name: typeof project.name === "string" ? project.name : name,
                framework: typeof project.framework === "string" ? project.framework : framework,
              },
              raw: includeRaw ? payload : undefined,
            });
          }

          case "add_domain": {
            const projectId =
              readStringParam(params, "project_id") || readStringParam(params, "project_name");
            if (!projectId) throw new Error("project_id or project_name is required");
            const domain = readStringParam(params, "domain", { required: true });
            const payload = await vercelRequest({
              apiUrl,
              token,
              method: "POST",
              path: `/v10/projects/${encodeURIComponent(projectId)}/domains`,
              teamId,
              body: { name: domain },
            });
            return jsonResult({
              action,
              project: projectId,
              domain,
              raw: includeRaw ? payload : undefined,
            });
          }

          case "list_deployments": {
            const project =
              readStringParam(params, "project_id") || readStringParam(params, "project_name");
            const limit = Math.max(
              1,
              Math.min(100, Math.trunc(readNumberParam(params, "limit") || 20)),
            );
            const payload = await vercelRequest({
              apiUrl,
              token,
              path: "/v6/deployments",
              teamId,
              query: {
                ...(project ? { projectId: project } : {}),
                limit,
              },
            });
            const deploymentsRaw =
              isObject(payload) && Array.isArray(payload.deployments) ? payload.deployments : [];
            const deployments = deploymentsRaw.filter(isObject).map((deploy) => ({
              id:
                typeof deploy.uid === "string"
                  ? deploy.uid
                  : typeof deploy.id === "string"
                    ? deploy.id
                    : undefined,
              name: typeof deploy.name === "string" ? deploy.name : undefined,
              state: typeof deploy.state === "string" ? deploy.state : undefined,
              url: typeof deploy.url === "string" ? deploy.url : undefined,
              created_at:
                typeof deploy.createdAt === "number"
                  ? new Date(deploy.createdAt).toISOString()
                  : undefined,
            }));
            return jsonResult({
              action,
              count: deployments.length,
              deployments,
              raw: includeRaw ? payload : undefined,
            });
          }

          default:
            return textResult(
              "Unknown action. Use: test_connection, list_projects, create_project, add_domain, list_deployments",
            );
        }
      } catch (err) {
        return textResult(
          `vercel_deploy error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
