import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { jsonResult, readNumberParam, readStringParam, type AnyAgentTool } from "./common.js";
import { readResponseText, withTimeout } from "./web-shared.js";

/**
 * TinyFish Search API — first-class ranked-search tool.
 *
 * The agent already has `web_search` (which routes to Brave / Perplexity /
 * TinyFish via a backend selector) and `tinyfish_browser` / `tinyfish_agent`
 * for browser automation. `tinyfish_search` is the symmetric counterpart:
 * a direct wrapper around the TinyFish ranked-search endpoint so the agent
 * can pick it explicitly when it wants TinyFish's index, instead of going
 * through `web_search`'s provider-selection layer.
 *
 * Endpoint: GET https://api.search.tinyfish.ai?query=...&location=...&language=...
 * Auth:     X-API-Key: $TINYFISH_API_KEY (same key as fetch/browser/agent)
 * Response: { query, results: [{ position, site_name, title, snippet, url }], total_results, page }
 *
 * Pricing: TinyFish Search is on the free tier (no credits consumed).
 *
 * Config resolution mirrors tinyfish_browser:
 *   1. Dashboard service key (TINYFISH_API_KEY in operator's vault)
 *   2. argent.json tools.web.search.tinyfish.apiKey
 *   3. argent.json tools.web.fetch.tinyfish.apiKey (shared with fetch/browser)
 *   4. TINYFISH_API_KEY env var
 */

export const DEFAULT_TINYFISH_SEARCH_BASE_URL = "https://api.search.tinyfish.ai";
const DEFAULT_SEARCH_TIMEOUT_SECONDS = 30;

type TinyFishSearchConfig = {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  timeoutSeconds?: number;
};

type TinyFishSearchResult = {
  position?: number;
  site_name?: string;
  title?: string;
  snippet?: string;
  url?: string;
};

type TinyFishSearchResponse = {
  query?: string;
  results?: TinyFishSearchResult[];
  total_results?: number;
  page?: number;
};

const SearchSchema = Type.Object({
  query: Type.String({
    description: "Search query. Required.",
    minLength: 1,
  }),
  limit: Type.Optional(
    Type.Number({
      description:
        "Maximum number of results to return (1–25). The TinyFish API may return fewer; this caps the response we surface.",
      minimum: 1,
      maximum: 25,
    }),
  ),
  location: Type.Optional(
    Type.String({
      description:
        'Geographic intent for results, e.g. "United States" or "United Kingdom". Mirrors the TinyFish API `location` parameter.',
    }),
  ),
  language: Type.Optional(
    Type.String({
      description:
        'Result language, e.g. "en" or "en-US". Mirrors the TinyFish API `language` parameter.',
    }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      description: "HTTP timeout in seconds (default 30).",
      minimum: 5,
      maximum: 120,
    }),
  ),
});

type WebToolsConfig = NonNullable<ArgentConfig["tools"]>["web"];

function resolveSearchConfig(cfg?: ArgentConfig): TinyFishSearchConfig {
  const web = cfg?.tools?.web as WebToolsConfig | undefined;
  const search = web?.search as { tinyfish?: TinyFishSearchConfig } | undefined;
  if (search?.tinyfish && typeof search.tinyfish === "object") {
    return search.tinyfish;
  }
  // Fall back to the fetch/browser scope so a single TINYFISH apiKey applies
  // across the whole TinyFish surface unless the operator overrides per-tool.
  const fetchCfg = web?.fetch as { tinyfish?: TinyFishSearchConfig } | undefined;
  return fetchCfg?.tinyfish ?? {};
}

function normalizeApiKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveSearchApiKey(params: {
  search?: TinyFishSearchConfig;
  cfg?: ArgentConfig;
  agentSessionKey?: string;
}): string | undefined {
  const fromServiceKeys = resolveServiceKey("TINYFISH_API_KEY", params.cfg, {
    sessionKey: params.agentSessionKey,
    source: "tinyfish_search",
  });
  if (fromServiceKeys) {
    return fromServiceKeys.trim();
  }
  const fromConfig = normalizeApiKey(params.search?.apiKey);
  if (fromConfig) {
    return fromConfig;
  }
  const fromEnv = normalizeApiKey(process.env.TINYFISH_API_KEY);
  return fromEnv || undefined;
}

export function resolveSearchBaseUrl(search?: TinyFishSearchConfig): string {
  const raw = search && typeof search.baseUrl === "string" ? search.baseUrl.trim() : "";
  return (raw || DEFAULT_TINYFISH_SEARCH_BASE_URL).replace(/\/+$/, "");
}

function missingSearchKeyPayload() {
  return {
    error: "missing_tinyfish_api_key",
    message:
      "tinyfish_search needs a TinyFish API key (free tier — no credits). Set TINYFISH_API_KEY in the Gateway environment, or configure tools.web.search.tinyfish.apiKey. Get a key at https://agent.tinyfish.ai/api-keys.",
    docs: "https://docs.tinyfish.ai/agent-api",
  };
}

export async function executeTinyFishSearch(params: {
  apiKey: string;
  baseUrl: string;
  query: string;
  limit?: number;
  location?: string;
  language?: string;
  timeoutSeconds: number;
}): Promise<TinyFishSearchResponse> {
  const url = new URL(params.baseUrl);
  url.searchParams.set("query", params.query);
  if (params.location) {
    url.searchParams.set("location", params.location);
  }
  if (params.language) {
    url.searchParams.set("language", params.language);
  }
  if (typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
    // The TinyFish docs are loose on this field name; pass both common variants
    // so operators on either edge of the API revision get capped results.
    url.searchParams.set("limit", String(params.limit));
    url.searchParams.set("num_results", String(params.limit));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-Key": params.apiKey,
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`TinyFish Search API error (${res.status}): ${detail || res.statusText}`);
  }

  return (await res.json()) as TinyFishSearchResponse;
}

export function createTinyFishSearchTool(options?: {
  config?: ArgentConfig;
  agentSessionKey?: string;
}): AnyAgentTool {
  const search = resolveSearchConfig(options?.config);
  return {
    label: "TinyFish Search",
    name: "tinyfish_search",
    description:
      "Ranked web search via TinyFish (https://api.search.tinyfish.ai). Use this when you want a direct TinyFish search index lookup instead of routing through the generic web_search tool. Free tier — no credits consumed. Returns { query, results: [{position, title, snippet, url, site_name}], total_results }.",
    parameters: SearchSchema,
    execute: async (_toolCallId, args) => {
      const params = (args ?? {}) as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const apiKey = resolveSearchApiKey({
        search,
        cfg: options?.config,
        agentSessionKey: options?.agentSessionKey,
      });
      if (!apiKey) {
        return jsonResult(missingSearchKeyPayload());
      }
      const baseUrl = resolveSearchBaseUrl(search);
      const timeoutSeconds =
        readNumberParam(params, "timeoutSeconds") ??
        (typeof search.timeoutSeconds === "number" ? search.timeoutSeconds : null) ??
        DEFAULT_SEARCH_TIMEOUT_SECONDS;
      const limit = readNumberParam(params, "limit") ?? undefined;
      const location = readStringParam(params, "location") || undefined;
      const language = readStringParam(params, "language") || undefined;

      const start = Date.now();
      try {
        const data = await executeTinyFishSearch({
          apiKey,
          baseUrl,
          query,
          limit,
          location,
          language,
          timeoutSeconds,
        });
        const rawResults = Array.isArray(data.results) ? data.results : [];
        // Honor caller's limit even if the API ignored ours.
        const capped =
          typeof limit === "number" && limit > 0 ? rawResults.slice(0, limit) : rawResults;
        return jsonResult({
          provider: "tinyfish",
          query: data.query ?? query,
          results: capped,
          total_results: data.total_results ?? rawResults.length,
          page: data.page ?? 1,
          tookMs: Date.now() - start,
          docs: "https://docs.tinyfish.ai/agent-api",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({
          error: "tinyfish_search_failed",
          message,
          tookMs: Date.now() - start,
          docs: "https://docs.tinyfish.ai/agent-api",
        });
      }
    },
  };
}

export const __testing = {
  resolveSearchApiKey,
  resolveSearchBaseUrl,
  resolveSearchConfig,
  executeTinyFishSearch,
  DEFAULT_TINYFISH_SEARCH_BASE_URL,
} as const;
