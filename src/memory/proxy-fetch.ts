import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { ArgentConfig } from "../config/config.js";
import { wrapFetchWithAbortSignal } from "../infra/fetch.js";

/**
 * Resolve the proxy URL the memory subsystem should use for outbound HTTP
 * traffic (LLM + embedding clients). The resolution order matches the upstream
 * MemU contract (PR #310) for argent-core SAFE-PORT #313:
 *
 *  1. Explicit `memory.proxy` from config (if non-empty after trim).
 *  2. `HTTPS_PROXY` env (preferred for the HTTPS endpoints we target).
 *  3. `HTTP_PROXY` env (fallback; some operators only set this one).
 *
 * Returns `undefined` when no proxy is configured so callers can keep the
 * default global fetch path and avoid constructing a `ProxyAgent`.
 */
export function resolveMemoryProxyUrl(config: ArgentConfig | undefined): string | undefined {
  const fromConfig = config?.memory?.proxy?.trim();
  if (fromConfig) {
    return fromConfig;
  }
  const httpsProxy = process.env.HTTPS_PROXY?.trim() || process.env.https_proxy?.trim();
  if (httpsProxy) {
    return httpsProxy;
  }
  const httpProxy = process.env.HTTP_PROXY?.trim() || process.env.http_proxy?.trim();
  if (httpProxy) {
    return httpProxy;
  }
  return undefined;
}

/**
 * Build a `fetch`-shaped function that routes every request through an undici
 * `ProxyAgent`. Returned function is signal-aware (via `wrapFetchWithAbortSignal`).
 */
export function createProxyFetch(proxyUrl: string): typeof fetch {
  const agent = new ProxyAgent(proxyUrl);
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as string | URL, {
      ...(init as Record<string, unknown>),
      dispatcher: agent,
    }) as unknown as Promise<Response>) as typeof fetch;
  return wrapFetchWithAbortSignal(fetcher);
}

/**
 * Convenience: return a proxy-aware fetch if `memory.proxy` or
 * `HTTPS_PROXY`/`HTTP_PROXY` is set, else `undefined` (so callers can
 * default to global `fetch`).
 */
export function resolveMemoryProxyFetch(
  config: ArgentConfig | undefined,
): typeof fetch | undefined {
  const proxyUrl = resolveMemoryProxyUrl(config);
  return proxyUrl ? createProxyFetch(proxyUrl) : undefined;
}
