import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { formatCliCommand } from "../../cli/command-format.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { wrapWebContent } from "../../security/external-content.js";
import { dashboardApiHeaders } from "../../utils/dashboard-api.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  braveRateLimiter,
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from "./web-shared.js";

const SEARCH_PROVIDERS = ["brave", "perplexity", "tinyfish"] as const;
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 20;

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_PERPLEXITY_BASE_URL = "https://openrouter.ai/api/v1";
const PERPLEXITY_DIRECT_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_PERPLEXITY_MODEL = "perplexity/sonar-pro";
const PERPLEXITY_KEY_PREFIXES = ["pplx-"];
const OPENROUTER_KEY_PREFIXES = ["sk-or-"];
const DEFAULT_TINYFISH_SEARCH_BASE_URL = "https://api.search.tinyfish.ai";
const DEFAULT_ACCEPT_HEADER = "application/json, text/markdown;q=0.9, */*;q=0.8";
// Brave's API only accepts "application/json" or "*/*" — the markdown
// preference in DEFAULT_ACCEPT_HEADER causes a 422 validation error.
const BRAVE_ACCEPT_HEADER = "application/json";

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();
const BRAVE_FRESHNESS_SHORTCUTS = new Set(["pd", "pw", "pm", "py"]);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;

const WebSearchSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  count: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-20).",
      minimum: 1,
      maximum: MAX_SEARCH_COUNT,
    }),
  ),
  country: Type.Optional(
    Type.String({
      description:
        "2-letter country code for region-specific results (e.g., 'DE', 'US', 'ALL'). Default: 'US'.",
    }),
  ),
  search_lang: Type.Optional(
    Type.String({
      description: "ISO language code for search results (e.g., 'de', 'en', 'fr').",
    }),
  ),
  ui_lang: Type.Optional(
    Type.String({
      description: "ISO language code for UI elements.",
    }),
  ),
  freshness: Type.Optional(
    Type.String({
      description:
        "Filter results by discovery time (Brave only). Values: 'pd' (past 24h), 'pw' (past week), 'pm' (past month), 'py' (past year), or date range 'YYYY-MM-DDtoYYYY-MM-DD'.",
    }),
  ),
});

type WebSearchConfig = NonNullable<ArgentConfig["tools"]>["web"] extends infer Web
  ? Web extends { search?: infer Search }
    ? Search
    : undefined
  : undefined;

type BraveSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveSearchResult[];
  };
};

type PerplexityConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

type PerplexityApiKeySource = "config" | "perplexity_env" | "openrouter_env" | "none";

type PerplexitySearchResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
};

type PerplexityBaseUrlHint = "direct" | "openrouter";

type TinyFishConfig = {
  apiKey?: string;
  baseUrl?: string;
  location?: string;
  language?: string;
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

function resolveSearchConfig(cfg?: ArgentConfig): WebSearchConfig {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") {
    return undefined;
  }
  return search as WebSearchConfig;
}

function resolveSearchEnabled(params: { search?: WebSearchConfig; sandboxed?: boolean }): boolean {
  if (typeof params.search?.enabled === "boolean") {
    return params.search.enabled;
  }
  if (params.sandboxed) {
    return true;
  }
  return true;
}

function resolveSearchApiKey(params: {
  search?: WebSearchConfig;
  cfg?: ArgentConfig;
  agentSessionKey?: string;
}): string | undefined {
  const fromServiceKeys = resolveServiceKey("BRAVE_API_KEY", params.cfg, {
    sessionKey: params.agentSessionKey,
    source: "web_search",
  });
  if (fromServiceKeys) {
    return fromServiceKeys.trim();
  }
  const fromConfig =
    params.search && "apiKey" in params.search && typeof params.search.apiKey === "string"
      ? params.search.apiKey.trim()
      : "";
  const fromEnv = (process.env.BRAVE_API_KEY ?? "").trim();
  return fromConfig || fromEnv || undefined;
}

function missingSearchKeyPayload(provider: (typeof SEARCH_PROVIDERS)[number]) {
  if (provider === "perplexity") {
    return {
      error: "missing_perplexity_api_key",
      message:
        "web_search (perplexity) needs an API key. Set PERPLEXITY_API_KEY or OPENROUTER_API_KEY in the Gateway environment, or configure tools.web.search.perplexity.apiKey.",
      docs: "https://docs.argent.ai/tools/web",
    };
  }
  if (provider === "tinyfish") {
    return {
      error: "missing_tinyfish_api_key",
      message:
        "web_search needs a TinyFish API key (free, no credits — recommended path). Sign up at https://agent.tinyfish.ai/api-keys, then set TINYFISH_API_KEY in the Gateway environment or run `" +
        formatCliCommand("argent configure --section web") +
        "`. Or set tools.web.search.provider=brave to use Brave Search instead.",
      docs: "https://docs.argent.ai/tools/web",
    };
  }
  return {
    error: "missing_brave_api_key",
    message: `web_search needs a Brave Search API key. Run \`${formatCliCommand("argent configure --section web")}\` to store it, or set BRAVE_API_KEY in the Gateway environment.`,
    docs: "https://docs.argent.ai/tools/web",
  };
}

function resolveSearchProvider(search?: WebSearchConfig): (typeof SEARCH_PROVIDERS)[number] {
  const raw =
    search && "provider" in search && typeof search.provider === "string"
      ? search.provider.trim().toLowerCase()
      : "";
  if (raw === "perplexity") {
    return "perplexity";
  }
  if (raw === "tinyfish") {
    return "tinyfish";
  }
  if (raw === "brave") {
    return "brave";
  }
  // No explicit provider configured. Preference order (recommended-first):
  //  1. TinyFish when an API key is resolvable (free, no credits — fastest path
  //     in for new users).
  //  2. Brave when the dashboard proxy is configured (proxy uses Brave) or a
  //     Brave key is set.
  //  3. TinyFish as a final default so the missing-key hint nudges users
  //     toward the free path.
  const tinyfishConfig = resolveTinyFishConfig(search);
  const hasTinyFishKey = Boolean(resolveTinyFishApiKey(tinyfishConfig));
  if (hasTinyFishKey) {
    return "tinyfish";
  }
  const dashboardProxy = normalizeApiKey(process.env.ARGENT_DASHBOARD_API);
  if (dashboardProxy) {
    return "brave";
  }
  const hasBraveKey = Boolean(
    normalizeApiKey(
      search && "apiKey" in search && typeof search.apiKey === "string" ? search.apiKey : "",
    ) || normalizeApiKey(process.env.BRAVE_API_KEY),
  );
  if (hasBraveKey) {
    return "brave";
  }
  return "tinyfish";
}

function resolveTinyFishConfig(search?: WebSearchConfig): TinyFishConfig {
  if (!search || typeof search !== "object") {
    return {};
  }
  const tinyfish = "tinyfish" in search ? search.tinyfish : undefined;
  if (!tinyfish || typeof tinyfish !== "object") {
    return {};
  }
  return tinyfish as TinyFishConfig;
}

function resolveTinyFishApiKey(tinyfish?: TinyFishConfig): string | undefined {
  const fromConfig = normalizeApiKey(tinyfish?.apiKey);
  if (fromConfig) {
    return fromConfig;
  }
  const fromEnv = normalizeApiKey(process.env.TINYFISH_API_KEY);
  return fromEnv || undefined;
}

function resolveTinyFishBaseUrl(tinyfish?: TinyFishConfig): string {
  const raw =
    tinyfish && "baseUrl" in tinyfish && typeof tinyfish.baseUrl === "string"
      ? tinyfish.baseUrl.trim()
      : "";
  return (raw || DEFAULT_TINYFISH_SEARCH_BASE_URL).replace(/\/+$/, "");
}

function resolvePerplexityConfig(search?: WebSearchConfig): PerplexityConfig {
  if (!search || typeof search !== "object") {
    return {};
  }
  const perplexity = "perplexity" in search ? search.perplexity : undefined;
  if (!perplexity || typeof perplexity !== "object") {
    return {};
  }
  return perplexity as PerplexityConfig;
}

function resolvePerplexityApiKey(perplexity?: PerplexityConfig): {
  apiKey?: string;
  source: PerplexityApiKeySource;
} {
  const fromConfig = normalizeApiKey(perplexity?.apiKey);
  if (fromConfig) {
    return { apiKey: fromConfig, source: "config" };
  }

  const fromEnvPerplexity = normalizeApiKey(process.env.PERPLEXITY_API_KEY);
  if (fromEnvPerplexity) {
    return { apiKey: fromEnvPerplexity, source: "perplexity_env" };
  }

  const fromEnvOpenRouter = normalizeApiKey(process.env.OPENROUTER_API_KEY);
  if (fromEnvOpenRouter) {
    return { apiKey: fromEnvOpenRouter, source: "openrouter_env" };
  }

  return { apiKey: undefined, source: "none" };
}

function normalizeApiKey(key: unknown): string {
  return typeof key === "string" ? key.trim() : "";
}

function inferPerplexityBaseUrlFromApiKey(apiKey?: string): PerplexityBaseUrlHint | undefined {
  if (!apiKey) {
    return undefined;
  }
  const normalized = apiKey.toLowerCase();
  if (PERPLEXITY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "direct";
  }
  if (OPENROUTER_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "openrouter";
  }
  return undefined;
}

function resolvePerplexityBaseUrl(
  perplexity?: PerplexityConfig,
  apiKeySource: PerplexityApiKeySource = "none",
  apiKey?: string,
): string {
  const fromConfig =
    perplexity && "baseUrl" in perplexity && typeof perplexity.baseUrl === "string"
      ? perplexity.baseUrl.trim()
      : "";
  if (fromConfig) {
    return fromConfig;
  }
  if (apiKeySource === "perplexity_env") {
    return PERPLEXITY_DIRECT_BASE_URL;
  }
  if (apiKeySource === "openrouter_env") {
    return DEFAULT_PERPLEXITY_BASE_URL;
  }
  if (apiKeySource === "config") {
    const inferred = inferPerplexityBaseUrlFromApiKey(apiKey);
    if (inferred === "direct") {
      return PERPLEXITY_DIRECT_BASE_URL;
    }
    if (inferred === "openrouter") {
      return DEFAULT_PERPLEXITY_BASE_URL;
    }
  }
  return DEFAULT_PERPLEXITY_BASE_URL;
}

function resolvePerplexityModel(perplexity?: PerplexityConfig): string {
  const fromConfig =
    perplexity && "model" in perplexity && typeof perplexity.model === "string"
      ? perplexity.model.trim()
      : "";
  return fromConfig || DEFAULT_PERPLEXITY_MODEL;
}

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
  return clamped;
}

function normalizeFreshness(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  if (BRAVE_FRESHNESS_SHORTCUTS.has(lower)) {
    return lower;
  }

  const match = trimmed.match(BRAVE_FRESHNESS_RANGE);
  if (!match) {
    return undefined;
  }

  const [, start, end] = match;
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    return undefined;
  }
  if (start > end) {
    return undefined;
  }

  return `${start}to${end}`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function resolveSiteName(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

async function runPerplexitySearch(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
}): Promise<{ content: string; citations: string[] }> {
  const endpoint = `${params.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: DEFAULT_ACCEPT_HEADER,
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
      "HTTP-Referer": "https://argent.ai",
      "X-Title": "Argent Web Search",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        {
          role: "user",
          content: params.query,
        },
      ],
    }),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Perplexity API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as PerplexitySearchResponse;
  const content = data.choices?.[0]?.message?.content ?? "No response";
  const citations = data.citations ?? [];

  return { content, citations };
}

async function runTinyFishSearch(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
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

async function runWebSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
  provider: (typeof SEARCH_PROVIDERS)[number];
  country?: string;
  search_lang?: string;
  ui_lang?: string;
  freshness?: string;
  perplexityBaseUrl?: string;
  perplexityModel?: string;
  tinyfishBaseUrl?: string;
  tinyfishLocation?: string;
  tinyfishLanguage?: string;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    params.provider === "brave"
      ? `${params.provider}:${params.query}:${params.count}:${params.country || "default"}:${params.search_lang || "default"}:${params.ui_lang || "default"}:${params.freshness || "default"}`
      : params.provider === "tinyfish"
        ? `${params.provider}:${params.query}:${params.count}:${params.tinyfishLocation || params.country || "default"}:${params.tinyfishLanguage || params.search_lang || "default"}`
        : `${params.provider}:${params.query}:${params.count}:${params.country || "default"}:${params.search_lang || "default"}:${params.ui_lang || "default"}`,
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const start = Date.now();

  // Route through Dashboard API proxy when available
  const dashboardApi = process.env.ARGENT_DASHBOARD_API;
  if (dashboardApi) {
    const endpoint =
      params.provider === "perplexity"
        ? `${dashboardApi}/api/proxy/search/perplexity`
        : `${dashboardApi}/api/proxy/search/brave`;
    if (params.provider === "brave") {
      await braveRateLimiter.acquire();
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: dashboardApiHeaders({
        Accept: params.provider === "brave" ? BRAVE_ACCEPT_HEADER : DEFAULT_ACCEPT_HEADER,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        query: params.query,
        count: params.count,
        country: params.country,
        search_lang: params.search_lang,
        ui_lang: params.ui_lang,
        freshness: params.freshness,
        model: params.perplexityModel,
        baseUrl: params.perplexityBaseUrl,
      }),
      signal: withTimeout(undefined, params.timeoutSeconds * 1000),
    });
    if (!res.ok) {
      const detail = await readResponseText(res);
      throw new Error(`Search proxy error (${res.status}): ${detail || res.statusText}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    // For Brave proxy, wrap the results the same way as the direct path
    if (params.provider === "brave") {
      const braveData = data as BraveSearchResponse;
      const results = Array.isArray(braveData.web?.results) ? (braveData.web?.results ?? []) : [];
      const mapped = results.map((entry) => {
        const description = entry.description ?? "";
        const title = entry.title ?? "";
        const url = entry.url ?? "";
        const rawSiteName = resolveSiteName(url);
        return {
          title: title ? wrapWebContent(title, "web_search") : "",
          url,
          description: description ? wrapWebContent(description, "web_search") : "",
          published: entry.age || undefined,
          siteName: rawSiteName || undefined,
        };
      });
      const payload = {
        query: params.query,
        provider: params.provider,
        count: mapped.length,
        tookMs: Date.now() - start,
        results: mapped,
      };
      writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
      return payload;
    }
    // Perplexity proxy: wrap the response
    const perplexityData = data as PerplexitySearchResponse;
    const content = perplexityData.choices?.[0]?.message?.content ?? "No response";
    const citations = perplexityData.citations ?? [];
    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      tookMs: Date.now() - start,
      content: wrapWebContent(content),
      citations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider === "perplexity") {
    const { content, citations } = await runPerplexitySearch({
      query: params.query,
      apiKey: params.apiKey,
      baseUrl: params.perplexityBaseUrl ?? DEFAULT_PERPLEXITY_BASE_URL,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      timeoutSeconds: params.timeoutSeconds,
    });

    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      tookMs: Date.now() - start,
      content: wrapWebContent(content),
      citations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider === "tinyfish") {
    const data = await runTinyFishSearch({
      query: params.query,
      apiKey: params.apiKey,
      baseUrl: params.tinyfishBaseUrl ?? DEFAULT_TINYFISH_SEARCH_BASE_URL,
      location: params.tinyfishLocation ?? params.country,
      language: params.tinyfishLanguage ?? params.search_lang,
      timeoutSeconds: params.timeoutSeconds,
    });
    const rawResults = Array.isArray(data.results) ? data.results : [];
    const sliced = rawResults.slice(0, params.count);
    const mapped = sliced.map((entry) => {
      const description = entry.snippet ?? "";
      const title = entry.title ?? "";
      const url = entry.url ?? "";
      const rawSiteName = entry.site_name || resolveSiteName(url);
      return {
        title: title ? wrapWebContent(title, "web_search") : "",
        url, // Keep raw for tool chaining
        description: description ? wrapWebContent(description, "web_search") : "",
        siteName: rawSiteName || undefined,
        position: entry.position,
      };
    });
    const payload = {
      query: params.query,
      provider: params.provider,
      count: mapped.length,
      totalResults: typeof data.total_results === "number" ? data.total_results : undefined,
      page: typeof data.page === "number" ? data.page : undefined,
      tookMs: Date.now() - start,
      results: mapped,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider !== "brave") {
    throw new Error("Unsupported web search provider.");
  }

  await braveRateLimiter.acquire();
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.count));
  if (params.country) {
    url.searchParams.set("country", params.country);
  }
  if (params.search_lang) {
    url.searchParams.set("search_lang", params.search_lang);
  }
  if (params.ui_lang) {
    // Brave requires full locale codes (e.g. "en-US"), not bare language
    // codes (e.g. "en"). Normalize common short codes to avoid 422 errors.
    const uiLang = params.ui_lang.includes("-")
      ? params.ui_lang
      : `${params.ui_lang}-${(params.country || "US").toUpperCase()}`;
    url.searchParams.set("ui_lang", uiLang);
  }
  if (params.freshness) {
    url.searchParams.set("freshness", params.freshness);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: BRAVE_ACCEPT_HEADER,
      "X-Subscription-Token": params.apiKey,
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Brave Search API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as BraveSearchResponse;
  const results = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];
  const mapped = results.map((entry) => {
    const description = entry.description ?? "";
    const title = entry.title ?? "";
    const url = entry.url ?? "";
    const rawSiteName = resolveSiteName(url);
    return {
      title: title ? wrapWebContent(title, "web_search") : "",
      url, // Keep raw for tool chaining
      description: description ? wrapWebContent(description, "web_search") : "",
      published: entry.age || undefined,
      siteName: rawSiteName || undefined,
    };
  });

  const payload = {
    query: params.query,
    provider: params.provider,
    count: mapped.length,
    tookMs: Date.now() - start,
    results: mapped,
  };
  writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

export function createWebSearchTool(options?: {
  config?: ArgentConfig;
  sandboxed?: boolean;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const search = resolveSearchConfig(options?.config);
  if (!resolveSearchEnabled({ search, sandboxed: options?.sandboxed })) {
    return null;
  }

  const provider = resolveSearchProvider(search);
  const perplexityConfig = resolvePerplexityConfig(search);
  const tinyfishConfig = resolveTinyFishConfig(search);

  const description =
    provider === "perplexity"
      ? "Search the web using Perplexity Sonar (direct or via OpenRouter). Returns AI-synthesized answers with citations from real-time web search."
      : provider === "tinyfish"
        ? "Search the web using TinyFish Search API (recommended — free for every account, no credits). Returns rank-stable structured results tuned for agent retrieval, with optional geo/language targeting."
        : "Search the web using Brave Search API. Supports region-specific and localized search via country and language parameters. Returns titles, URLs, and snippets for fast research.";

  return {
    label: "Web Search",
    name: "web_search",
    description,
    parameters: WebSearchSchema,
    execute: async (_toolCallId, args) => {
      const hasDashboardProxy = Boolean(process.env.ARGENT_DASHBOARD_API);
      const perplexityAuth =
        provider === "perplexity" ? resolvePerplexityApiKey(perplexityConfig) : undefined;
      const tinyfishApiKey =
        provider === "tinyfish" ? resolveTinyFishApiKey(tinyfishConfig) : undefined;
      // TinyFish currently has no dashboard proxy route, so always use the
      // direct API key path even when ARGENT_DASHBOARD_API is set.
      const apiKey =
        provider === "tinyfish"
          ? tinyfishApiKey
          : hasDashboardProxy
            ? "proxy" // Proxy has its own key; use placeholder to skip missing-key check
            : provider === "perplexity"
              ? perplexityAuth?.apiKey
              : resolveSearchApiKey({
                  search,
                  cfg: options?.config,
                  agentSessionKey: options?.agentSessionKey,
                });

      if (!apiKey) {
        return jsonResult(missingSearchKeyPayload(provider));
      }
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const count =
        readNumberParam(params, "count", { integer: true }) ?? search?.maxResults ?? undefined;
      const country = readStringParam(params, "country");
      const search_lang = readStringParam(params, "search_lang");
      const ui_lang = readStringParam(params, "ui_lang");
      const rawFreshness = readStringParam(params, "freshness");
      if (rawFreshness && provider !== "brave") {
        return jsonResult({
          error: "unsupported_freshness",
          message: "freshness is only supported by the Brave web_search provider.",
          docs: "https://docs.argent.ai/tools/web",
        });
      }
      const freshness = rawFreshness ? normalizeFreshness(rawFreshness) : undefined;
      if (rawFreshness && !freshness) {
        return jsonResult({
          error: "invalid_freshness",
          message:
            "freshness must be one of pd, pw, pm, py, or a range like YYYY-MM-DDtoYYYY-MM-DD.",
          docs: "https://docs.argent.ai/tools/web",
        });
      }
      const result = await runWebSearch({
        query,
        count: resolveSearchCount(count, DEFAULT_SEARCH_COUNT),
        apiKey,
        timeoutSeconds: resolveTimeoutSeconds(search?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
        cacheTtlMs: resolveCacheTtlMs(search?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
        provider,
        country,
        search_lang,
        ui_lang,
        freshness,
        perplexityBaseUrl: resolvePerplexityBaseUrl(
          perplexityConfig,
          perplexityAuth?.source,
          perplexityAuth?.apiKey,
        ),
        perplexityModel: resolvePerplexityModel(perplexityConfig),
        tinyfishBaseUrl: resolveTinyFishBaseUrl(tinyfishConfig),
        tinyfishLocation: tinyfishConfig.location,
        tinyfishLanguage: tinyfishConfig.language,
      });
      return jsonResult(result);
    },
  };
}

export const __testing = {
  inferPerplexityBaseUrlFromApiKey,
  resolvePerplexityBaseUrl,
  normalizeFreshness,
  resolveSearchApiKey,
  resolveSearchProvider,
  resolveTinyFishApiKey,
  resolveTinyFishBaseUrl,
  resolveTinyFishConfig,
  runTinyFishSearch,
  DEFAULT_TINYFISH_SEARCH_BASE_URL,
} as const;
