/**
 * EasyDMARC Tool
 *
 * Core runtime integration for EasyDMARC Public API.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const DEFAULT_EASYDMARC_API_URL = "https://developers.easydmarc.com";

const EasyDmarcSchema = Type.Object({
  action: Type.Union([Type.Literal("create_domain"), Type.Literal("request")]),
  api_url: Type.Optional(Type.String()),
  domain: Type.Optional(Type.String()),
  method: Type.Optional(
    Type.Union([
      Type.Literal("GET"),
      Type.Literal("POST"),
      Type.Literal("PATCH"),
      Type.Literal("DELETE"),
    ]),
  ),
  path: Type.Optional(Type.String()),
  payload: Type.Optional(Type.Unsafe<Record<string, unknown>>()),
  include_raw: Type.Optional(Type.Boolean()),
});

type JsonObject = Record<string, unknown>;

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  } as import("../../agent-core/core.js").AgentToolResult<unknown>;
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

function asPayload(value: unknown): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("payload must be an object");
  }
  return value as JsonObject;
}

async function easydmarcRequest(params: {
  apiUrl: string;
  apiKey: string;
  method: string;
  path: string;
  payload?: JsonObject;
}): Promise<{ status: number; body: unknown }> {
  const base = params.apiUrl.replace(/\/+$/, "");
  const path = params.path.startsWith("/") ? params.path : `/${params.path}`;
  const url = `${base}${path}`;

  const res = await fetch(url, {
    method: params.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
      "x-api-key": params.apiKey,
    },
    body: params.payload ? JSON.stringify(params.payload) : undefined,
  });

  const raw = await res.text();
  const body = parseJson(raw);
  if (!res.ok) {
    throw new Error(
      `EasyDMARC API error (${res.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }

  return { status: res.status, body };
}

export function createEasyDmarcTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  const resolveKey = (name: string) =>
    resolveServiceKey(name, options?.config, {
      sessionKey: options?.agentSessionKey,
      source: "easydmarc",
    });

  return {
    label: "EasyDMARC",
    name: "easydmarc",
    description: `Manage EasyDMARC public API operations.

Actions:
- create_domain: POST /public-api/create-domain
- request: arbitrary API request for advanced use`,
    parameters: EasyDmarcSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        const apiKey = resolveKey("EASYDMARC_API_KEY") || process.env.EASYDMARC_API_KEY;
        if (!apiKey) {
          throw new Error("No EasyDMARC key found. Add EASYDMARC_API_KEY in Settings > API Keys.");
        }

        const apiUrl =
          readStringParam(params, "api_url") ||
          process.env.EASYDMARC_API_URL ||
          DEFAULT_EASYDMARC_API_URL;
        const includeRaw = asBool(params.include_raw);

        if (action === "create_domain") {
          const domain = readStringParam(params, "domain", { required: true });
          const payload = await easydmarcRequest({
            apiUrl,
            apiKey,
            method: "POST",
            path: "/public-api/create-domain",
            payload: { domain },
          });
          return jsonResult({
            action,
            domain,
            status: payload.status,
            result: payload.body,
            raw: includeRaw ? payload : undefined,
          });
        }

        if (action === "request") {
          const method = readStringParam(params, "method") || "GET";
          const path = readStringParam(params, "path", { required: true });
          const payload = await easydmarcRequest({
            apiUrl,
            apiKey,
            method,
            path,
            payload: asPayload(params.payload),
          });
          return jsonResult({
            action,
            method,
            path,
            status: payload.status,
            result: payload.body,
            raw: includeRaw ? payload : undefined,
          });
        }

        return textResult("Unknown action. Use: create_domain, request");
      } catch (err) {
        return textResult(`easydmarc error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
