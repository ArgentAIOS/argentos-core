/**
 * Namecheap DNS Tool
 *
 * Core runtime integration for Namecheap domain and DNS management.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const DEFAULT_NAMECHEAP_API_URL = "https://api.namecheap.com/xml.response";

const HostSchema = Type.Object({
  name: Type.String(),
  type: Type.String(),
  address: Type.String(),
  ttl: Type.Optional(Type.String()),
  mxpref: Type.Optional(Type.String()),
});

const NamecheapDnsSchema = Type.Object({
  action: Type.Union([
    Type.Literal("test_connection"),
    Type.Literal("check_domain"),
    Type.Literal("get_hosts"),
    Type.Literal("set_hosts"),
    Type.Literal("raw"),
  ]),
  api_url: Type.Optional(Type.String()),
  domain: Type.Optional(Type.String()),
  sld: Type.Optional(Type.String()),
  tld: Type.Optional(Type.String()),
  hosts: Type.Optional(Type.Array(HostSchema)),
  command: Type.Optional(Type.String()),
  // Keep schema union-free for provider compatibility. Runtime parser still
  // accepts JSON string / kv-entry array formats for backward compatibility.
  params: Type.Optional(Type.Unsafe<Record<string, unknown>>()),
  include_raw: Type.Optional(Type.Boolean()),
});

type JsonObject = Record<string, unknown>;

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  } as import("../../agent-core/core.js").AgentToolResult<unknown>;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function parseDomain(input?: string): { sld: string; tld: string } {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) throw new Error("domain is required");
  const parts = raw.split(".").filter(Boolean);
  if (parts.length < 2) throw new Error("domain must include TLD (example.com)");
  return {
    sld: parts[0],
    tld: parts.slice(1).join("."),
  };
}

function xmlStatus(xml: string): "OK" | "ERROR" | "UNKNOWN" {
  const m = xml.match(/<ApiResponse[^>]*\sStatus="([^"]+)"/i);
  const value = (m?.[1] || "").toUpperCase();
  if (value === "OK") return "OK";
  if (value === "ERROR") return "ERROR";
  return "UNKNOWN";
}

function xmlErrors(xml: string): string[] {
  const out: string[] = [];
  const re = /<Error[^>]*>([\s\S]*?)<\/Error>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = (m[1] || "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

function parseDomainCheck(
  xml: string,
): Array<{ domain?: string; available?: boolean; error?: string }> {
  const out: Array<{ domain?: string; available?: boolean; error?: string }> = [];
  const re = /<DomainCheckResult\s+([^>]+?)\/?>(?:<\/DomainCheckResult>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] || "";
    const domain = attrs.match(/\bDomain="([^"]+)"/i)?.[1];
    const avail = attrs.match(/\bAvailable="([^"]+)"/i)?.[1];
    const error = attrs.match(/\bErrorNo="([^"]+)"/i)?.[1];
    out.push({
      domain,
      available: typeof avail === "string" ? avail.toLowerCase() === "true" : undefined,
      error,
    });
  }
  return out;
}

function parseHosts(
  xml: string,
): Array<{ name?: string; type?: string; address?: string; ttl?: string; mxpref?: string }> {
  const out: Array<{
    name?: string;
    type?: string;
    address?: string;
    ttl?: string;
    mxpref?: string;
  }> = [];
  const re = /<host\s+([^>]+?)\/?>(?:<\/host>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] || "";
    const read = (key: string) => attrs.match(new RegExp(`\\b${key}="([^"]*)"`, "i"))?.[1];
    out.push({
      name: read("Name"),
      type: read("Type"),
      address: read("Address"),
      ttl: read("TTL"),
      mxpref: read("MXPref"),
    });
  }
  return out;
}

function objectParams(raw: unknown): JsonObject {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as JsonObject;
  throw new Error("params must be an object");
}

function rawParamsFormatError(): Error {
  return new Error(
    'Invalid raw params format. Accepted formats: (1) object, (2) JSON string that parses to an object, or (3) array of key/value entries like [["SLD","example"],["TLD","com"]] or [{"key":"SLD","value":"example"}].',
  );
}

function parseRawParams(raw: unknown): JsonObject {
  if (!raw) return {};
  // Format 1: plain object (preferred for tool calls).
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as JsonObject;
  }
  // Format 2: JSON string that parses to an object.
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw rawParamsFormatError();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw rawParamsFormatError();
    }
    return parsed as JsonObject;
  }
  // Format 3: key/value entry arrays. Duplicate keys are resolved by last write wins.
  if (Array.isArray(raw)) {
    const out: JsonObject = {};
    for (const entry of raw) {
      if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string") {
        out[entry[0]] = entry[1];
        continue;
      }
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as { key?: unknown }).key === "string"
      ) {
        out[(entry as { key: string }).key] = (entry as { value?: unknown }).value;
        continue;
      }
      throw rawParamsFormatError();
    }
    return out;
  }
  throw rawParamsFormatError();
}

async function namecheapRequest(params: {
  apiUrl: string;
  apiUser: string;
  apiKey: string;
  username: string;
  clientIp: string;
  command: string;
  extra?: JsonObject;
}): Promise<string> {
  const url = new URL(params.apiUrl);
  const query = url.searchParams;
  query.set("ApiUser", params.apiUser);
  query.set("ApiKey", params.apiKey);
  query.set("UserName", params.username);
  query.set("ClientIp", params.clientIp);
  query.set("Command", params.command);

  for (const [key, value] of Object.entries(params.extra || {})) {
    if (value === undefined || value === null) continue;
    query.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/xml,text/xml" },
  });
  const xml = await res.text();
  if (!res.ok) {
    throw new Error(`Namecheap API error (${res.status}): ${xml.slice(0, 400)}`);
  }
  return xml;
}

export function createNamecheapDnsTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  const resolveKey = (name: string) =>
    resolveServiceKey(name, options?.config, {
      sessionKey: options?.agentSessionKey,
      source: "namecheap_dns",
    });

  return {
    label: "Namecheap DNS",
    name: "namecheap_dns",
    description: `Manage Namecheap DNS/domain records from core runtime.

Actions:
- test_connection: validate credentials (users.getBalances)
- check_domain: check domain availability
- get_hosts: read DNS host records
- set_hosts: replace DNS host records
- raw: call arbitrary Namecheap command`,
    // TODO(issue #69 follow-up): add first-class registrar actions:
    // register_domain, set_custom_nameservers, renew_domain, list_domains.
    parameters: NamecheapDnsSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        const apiUser =
          resolveKey("NAMECHEAP_API_USER") ||
          resolveKey("NAMECHEAP_USERNAME") ||
          process.env.NAMECHEAP_API_USER ||
          process.env.NAMECHEAP_USERNAME;
        const username =
          resolveKey("NAMECHEAP_USERNAME") ||
          resolveKey("NAMECHEAP_API_USER") ||
          process.env.NAMECHEAP_USERNAME ||
          process.env.NAMECHEAP_API_USER;
        const apiKey = resolveKey("NAMECHEAP_API_KEY") || process.env.NAMECHEAP_API_KEY;
        const clientIp = resolveKey("NAMECHEAP_CLIENT_IP") || process.env.NAMECHEAP_CLIENT_IP;

        if (!apiUser || !username || !apiKey || !clientIp) {
          throw new Error(
            "Missing Namecheap creds. Need NAMECHEAP_API_KEY, NAMECHEAP_API_USER/NAMECHEAP_USERNAME, and NAMECHEAP_CLIENT_IP.",
          );
        }

        const apiUrl =
          readStringParam(params, "api_url") ||
          process.env.NAMECHEAP_API_URL ||
          DEFAULT_NAMECHEAP_API_URL;
        const includeRaw = asBool(params.include_raw);

        if (action === "test_connection") {
          const xml = await namecheapRequest({
            apiUrl,
            apiUser,
            apiKey,
            username,
            clientIp,
            command: "namecheap.users.getBalances",
          });
          const status = xmlStatus(xml);
          const errors = xmlErrors(xml);
          return jsonResult({
            action,
            ok: status === "OK",
            status,
            errors,
            raw: includeRaw ? xml : undefined,
          });
        }

        if (action === "check_domain") {
          const explicitSld = readStringParam(params, "sld");
          const explicitTld = readStringParam(params, "tld");
          const parsed = parseDomain(readStringParam(params, "domain"));
          const sld = explicitSld || parsed.sld;
          const tld = explicitTld || parsed.tld;
          const xml = await namecheapRequest({
            apiUrl,
            apiUser,
            apiKey,
            username,
            clientIp,
            command: "namecheap.domains.check",
            extra: { DomainList: `${sld}.${tld}` },
          });
          const status = xmlStatus(xml);
          const errors = xmlErrors(xml);
          return jsonResult({
            action,
            status,
            checks: parseDomainCheck(xml),
            errors,
            raw: includeRaw ? xml : undefined,
          });
        }

        if (action === "get_hosts") {
          const explicitSld = readStringParam(params, "sld");
          const explicitTld = readStringParam(params, "tld");
          const parsed = parseDomain(readStringParam(params, "domain"));
          const sld = explicitSld || parsed.sld;
          const tld = explicitTld || parsed.tld;
          const xml = await namecheapRequest({
            apiUrl,
            apiUser,
            apiKey,
            username,
            clientIp,
            command: "namecheap.domains.dns.getHosts",
            extra: { SLD: sld, TLD: tld },
          });
          const status = xmlStatus(xml);
          const errors = xmlErrors(xml);
          return jsonResult({
            action,
            status,
            domain: `${sld}.${tld}`,
            hosts: parseHosts(xml),
            errors,
            raw: includeRaw ? xml : undefined,
          });
        }

        if (action === "set_hosts") {
          const explicitSld = readStringParam(params, "sld");
          const explicitTld = readStringParam(params, "tld");
          const parsed = parseDomain(readStringParam(params, "domain"));
          const sld = explicitSld || parsed.sld;
          const tld = explicitTld || parsed.tld;
          const hostsRaw = params.hosts;
          if (!Array.isArray(hostsRaw) || hostsRaw.length === 0) {
            throw new Error("hosts array is required for set_hosts");
          }

          const extra: JsonObject = { SLD: sld, TLD: tld };
          hostsRaw.forEach((entry, index) => {
            const host = objectParams(entry);
            const i = index + 1;
            const name = readStringParam(host, "name", { required: true });
            const type = readStringParam(host, "type", { required: true });
            const address = readStringParam(host, "address", { required: true });
            extra[`HostName${i}`] = name;
            extra[`RecordType${i}`] = type;
            extra[`Address${i}`] = address;
            if (readStringParam(host, "ttl"))
              extra[`TTL${i}`] = readStringParam(host, "ttl") as string;
            if (readStringParam(host, "mxpref"))
              extra[`MXPref${i}`] = readStringParam(host, "mxpref") as string;
          });

          const xml = await namecheapRequest({
            apiUrl,
            apiUser,
            apiKey,
            username,
            clientIp,
            command: "namecheap.domains.dns.setHosts",
            extra,
          });
          const status = xmlStatus(xml);
          const errors = xmlErrors(xml);
          return jsonResult({
            action,
            ok: status === "OK",
            status,
            domain: `${sld}.${tld}`,
            submitted: hostsRaw.length,
            errors,
            raw: includeRaw ? xml : undefined,
          });
        }

        if (action === "raw") {
          const command = readStringParam(params, "command", { required: true });
          const extra = parseRawParams(params.params);
          const xml = await namecheapRequest({
            apiUrl,
            apiUser,
            apiKey,
            username,
            clientIp,
            command,
            extra,
          });
          return jsonResult({
            action,
            command,
            status: xmlStatus(xml),
            errors: xmlErrors(xml),
            raw: xml,
          });
        }

        return textResult(
          "Unknown action. Use: test_connection, check_domain, get_hosts, set_hosts, raw",
        );
      } catch (err) {
        return textResult(
          `namecheap_dns error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
