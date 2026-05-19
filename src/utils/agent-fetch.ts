/**
 * ArgentOS Agent-Native Web Fetch
 *
 * Argent is a first-class citizen of the agent web.
 * This module handles all outbound web requests with:
 *
 * 1. Proper agent identity headers (Cloudflare markdown detection)
 * 2. LLMs.txt discovery before crawling any site
 * 3. Markdown-first content requests
 * 4. X402 payment handling (via wallet module)
 * 5. Graceful fallback: markdown → plain text → HTML
 */

import type { AgenticWallet } from "../wallet/wallet.js";

export const ARGENT_USER_AGENT =
  "ArgentOS/1.0 (AI Agent; autonomous; +https://argentos.ai/agent-card.json)";

export interface AgentFetchOptions extends RequestInit {
  /** Max USD willing to pay for X402 gated content */
  maxPaymentUsd?: number;
  /** Prefer markdown response (default: true) */
  preferMarkdown?: boolean;
  /** Check for llms.txt before fetching page (default: true for root domain fetches) */
  checkLlmsTxt?: boolean;
  /** Wallet instance for X402 payments */
  wallet?: AgenticWallet;
  /** Skip llms.txt cache */
  bypassLlmsCache?: boolean;
}

export interface AgentFetchResult {
  url: string;
  content: string;
  contentType: "markdown" | "text" | "html" | "json";
  /** Token count estimate from X-Markdown-Tokens header */
  estimatedTokens?: number;
  /** Parsed llms.txt manifest if discovered */
  llmsManifest?: LlmsManifest;
  /** Whether content came from agent-optimized path */
  agentNative: boolean;
  status: number;
}

export interface LlmsManifest {
  title?: string;
  description?: string;
  raw: string;
  apiEndpoints?: string[];
  capabilities?: string[];
  fetchedAt: Date;
}

// In-memory cache for llms.txt manifests — TTL 1 hour
const llmsCache = new Map<string, { manifest: LlmsManifest; expires: Date }>();

/**
 * Build standard agent request headers.
 * Cloudflare and agent-native sites use these to serve markdown automatically.
 */
export function buildAgentHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "User-Agent": ARGENT_USER_AGENT,
    Accept: "text/markdown, text/plain, application/json, */*",
    "X-Agent-Id": "argent",
    "X-Agent-Platform": "argentos",
    "X-Agent-Version": "1.0.0",
    ...extra,
  };
}

/**
 * Fetch llms.txt from a domain and parse it.
 * Returns null if the site doesn't have one.
 */
export async function fetchLlmsTxt(baseUrl: string): Promise<LlmsManifest | null> {
  const origin = new URL(baseUrl).origin;

  // Check cache first
  const cached = llmsCache.get(origin);
  if (cached && new Date() < cached.expires) {
    return cached.manifest;
  }

  const llmsTxtUrl = `${origin}/llms.txt`;

  try {
    const res = await fetch(llmsTxtUrl, {
      headers: buildAgentHeaders(),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const raw = await res.text();
    const manifest = parseLlmsTxt(raw);

    // Cache for 1 hour
    llmsCache.set(origin, {
      manifest,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    });

    return manifest;
  } catch {
    return null;
  }
}

/**
 * Parse a raw llms.txt document into a structured manifest.
 */
export function parseLlmsTxt(raw: string): LlmsManifest {
  const lines = raw.split("\n");
  const manifest: LlmsManifest = { raw, fetchedAt: new Date() };

  // Extract H1 as title
  const h1 = lines.find((l) => l.startsWith("# "));
  if (h1) manifest.title = h1.slice(2).trim();

  // Extract blockquote as description
  const blockquote = lines.find((l) => l.startsWith("> "));
  if (blockquote) manifest.description = blockquote.slice(2).trim();

  // Extract API endpoints (lines containing /api/ or starting with - /)
  manifest.apiEndpoints = lines
    .filter((l) => l.match(/[-*]\s+\/\w+/) || l.match(/\/api\//))
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);

  return manifest;
}

/**
 * Main agent-native fetch. This is Argent's primary way of accessing the web.
 *
 * Priority chain:
 * 1. Check llms.txt for site navigation hints
 * 2. Request markdown via Accept header (Cloudflare sites respond natively)
 * 3. Check X-Markdown-Tokens for context window planning
 * 4. Handle X402 payment if required
 * 5. Fall back to plain text or HTML
 */
export async function agentFetch(
  url: string,
  options: AgentFetchOptions = {},
): Promise<AgentFetchResult> {
  const {
    preferMarkdown = true,
    checkLlmsTxt = true,
    wallet,
    maxPaymentUsd = 0.1,
    bypassLlmsCache = false,
    ...fetchOptions
  } = options;

  // Step 1: Discover llms.txt for this domain
  let llmsManifest: LlmsManifest | undefined;
  if (checkLlmsTxt) {
    if (bypassLlmsCache) {
      const origin = new URL(url).origin;
      llmsCache.delete(origin);
    }
    const manifest = await fetchLlmsTxt(url);
    if (manifest) {
      llmsManifest = manifest;
    }
  }

  // Step 2: Build agent headers
  const headers = buildAgentHeaders({
    ...(fetchOptions.headers as Record<string, string>),
  });

  // Step 3: Fetch with agent headers
  const fetchFn = wallet
    ? (u: string, opts: RequestInit) => wallet.fetchWithPayment(u, { ...opts, maxPaymentUsd })
    : fetch;

  const res = await fetchFn(url, {
    ...fetchOptions,
    headers,
    signal: fetchOptions.signal ?? AbortSignal.timeout(15000),
  });

  if (!res.ok && res.status !== 402) {
    throw new Error(`Agent fetch failed: ${res.status} ${res.statusText} — ${url}`);
  }

  // Step 4: Determine content type
  const contentType = res.headers.get("Content-Type") ?? "";
  const isMarkdown =
    contentType.includes("markdown") ||
    contentType.includes("text/plain") ||
    url.endsWith(".md") ||
    url.endsWith(".txt");
  const isJson = contentType.includes("json");

  // Step 5: Read token count hint from Cloudflare
  const tokenHeader = res.headers.get("X-Markdown-Tokens");
  const estimatedTokens = tokenHeader ? parseInt(tokenHeader, 10) : undefined;

  const body = await res.text();

  // Step 6: Classify and return
  let resolvedType: AgentFetchResult["contentType"] = "html";
  let agentNative = false;

  if (isJson) {
    resolvedType = "json";
    agentNative = true;
  } else if (isMarkdown) {
    resolvedType = contentType.includes("markdown") ? "markdown" : "text";
    agentNative = contentType.includes("markdown");
  }

  return {
    url,
    content: body,
    contentType: resolvedType,
    estimatedTokens,
    llmsManifest,
    agentNative,
    status: res.status,
  };
}

/**
 * Discover what a site offers to agents before crawling it.
 * Returns a summary of agent-accessible capabilities.
 */
export async function discoverSite(baseUrl: string): Promise<{
  hasLlmsTxt: boolean;
  hasLlmsFullTxt: boolean;
  hasAgentCard: boolean;
  manifest?: LlmsManifest;
  agentCard?: Record<string, unknown>;
  supportsMarkdown: boolean;
}> {
  const origin = new URL(baseUrl).origin;
  const results = {
    hasLlmsTxt: false,
    hasLlmsFullTxt: false,
    hasAgentCard: false,
    manifest: undefined as LlmsManifest | undefined,
    agentCard: undefined as Record<string, unknown> | undefined,
    supportsMarkdown: false,
  };

  // Parallel discovery
  const [llmsTxtRes, llmsFullRes, agentCardRes, markdownProbe] = await Promise.allSettled([
    fetch(`${origin}/llms.txt`, { headers: buildAgentHeaders() }),
    fetch(`${origin}/llms-full.txt`, { headers: buildAgentHeaders() }),
    fetch(`${origin}/agent-card.json`, { headers: buildAgentHeaders() }),
    fetch(origin, { headers: { ...buildAgentHeaders(), Accept: "text/markdown" } }),
  ]);

  if (llmsTxtRes.status === "fulfilled" && llmsTxtRes.value.ok) {
    results.hasLlmsTxt = true;
    results.manifest = parseLlmsTxt(await llmsTxtRes.value.text());
  }

  if (llmsFullRes.status === "fulfilled" && llmsFullRes.value.ok) {
    results.hasLlmsFullTxt = true;
  }

  if (agentCardRes.status === "fulfilled" && agentCardRes.value.ok) {
    results.hasAgentCard = true;
    results.agentCard = await agentCardRes.value.json();
  }

  if (markdownProbe.status === "fulfilled") {
    const ct = markdownProbe.value.headers.get("Content-Type") ?? "";
    results.supportsMarkdown = ct.includes("markdown");
  }

  return results;
}

/**
 * Clear the llms.txt cache (useful for testing or forced refresh)
 */
export function clearLlmsCache(): void {
  llmsCache.clear();
}
