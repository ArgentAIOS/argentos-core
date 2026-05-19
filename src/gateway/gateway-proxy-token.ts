/**
 * Shared helpers for the gateway HTTP proxy on port 18789 (`server-http.ts`)
 * and any code that serves dashboard HTML directly from the gateway process
 * (`control-ui.ts`).
 *
 * This mirrors the patterns merged by R-1c's PR #161 in
 * `dashboard/static-server.cjs` (port 8080) but in TypeScript so the gateway
 * path closes the same bare-URL bootstrap gap. See GH #162 for context.
 *
 * The four behaviors gathered here:
 *
 *   1. `readGatewayConfigFromDisk()` — read `~/.argentos/argent.json` fresh on
 *      every call so `argent update` rotations of `gateway.auth.token`
 *      propagate immediately without needing a gateway restart.
 *   2. `bindIsLoopback()` — gate token injection to loopback-only binds. For
 *      lan/tailnet/auto/custom binds a remote browser could read the token
 *      out of the served HTML, which would be a credential leak.
 *   3. `resolveProxyAuthToken()` — precedence chain that lets
 *      Authorization-aware code AND raw `fetch("/api/...")` callers BOTH work:
 *      request URL token > Referer token > disk gateway token.
 *   4. `injectGatewayTokenIntoIndexHtml()` — splice
 *      `window.__ARGENT_GATEWAY_TOKEN__` into the served HTML so the dashboard
 *      bundle can seed `localStorage` on bare-URL boots (Swift app, browser
 *      bookmark, etc.). Idempotent, loopback-only.
 *
 * Plus a single proxy entrypoint:
 *
 *   - `proxyApiRequest()` — forwards the browser's `/api/*` request to the
 *     dashboard api-server, forwarding Authorization (or auto-injecting from
 *     disk on loopback when missing), forwarding the request body for non-GET
 *     methods, and returning the upstream status faithfully (no fall-through
 *     to SPA fallback on non-2xx responses).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_ARGENT_CONFIG_PATH = path.join(
  process.env.HOME || os.homedir(),
  ".argentos",
  "argent.json",
);

export interface GatewayConfigOnDisk {
  token: string | null;
  bind: string | null;
}

/**
 * Read the gateway auth token + bind mode from `~/.argentos/argent.json`. Read
 * fresh per-call (not cached) so token rotations during `argent update`
 * propagate immediately. The cost is one stat + one tiny JSON parse per call,
 * which is negligible on loopback. `pathOverride` lets tests sandbox to a
 * temp argent.json without polluting `process.env.HOME`.
 *
 * Returns `{ token: null, bind: null }` if the file is missing or malformed.
 * When the file exists but `gateway.bind` is unset, defaults to `"loopback"`
 * to match `gateway-daemon.ts`'s default — otherwise a partial config would
 * incorrectly suppress token injection on a daemon that is in fact loopback.
 */
export function readGatewayConfigFromDisk(pathOverride?: string): GatewayConfigOnDisk {
  const target = pathOverride || DEFAULT_ARGENT_CONFIG_PATH;
  try {
    if (!fs.existsSync(target)) {
      return { token: null, bind: null };
    }
    const cfg = JSON.parse(fs.readFileSync(target, "utf-8")) as {
      gateway?: { auth?: { token?: unknown }; bind?: unknown };
    };
    const tokenRaw = cfg?.gateway?.auth?.token;
    const bindRaw = cfg?.gateway?.bind;
    return {
      token: typeof tokenRaw === "string" && tokenRaw.trim() ? tokenRaw.trim() : null,
      bind: typeof bindRaw === "string" && bindRaw.trim() ? bindRaw.trim() : "loopback",
    };
  } catch {
    return { token: null, bind: null };
  }
}

/**
 * Token injection is only safe on loopback. For lan/tailnet/auto/custom binds
 * a remote browser could read the gateway token from the served HTML — that
 * would be a credential leak.
 */
export function bindIsLoopback(bind: string | null | undefined): boolean {
  return bind === "loopback";
}

/**
 * Read `?api_token=` (preferred) or `?token=` from the request URL or its
 * Referer. Returns `null` if neither carries a token. The Referer fallback
 * lets unauthenticated `fetch("/api/...")` calls work after the user clicked
 * through from a token-carrying URL — without it, the dashboard would lose
 * auth on every cross-page navigation.
 */
export function dashboardApiTokenFromRequest(req: IncomingMessage): string | null {
  const host = req.headers.host || "127.0.0.1";
  try {
    const selfUrl = new URL(req.url || "/", `http://${host}`);
    const fromUrl = (
      selfUrl.searchParams.get("api_token") ?? selfUrl.searchParams.get("token")
    )?.trim();
    if (fromUrl) {
      return fromUrl;
    }
  } catch {
    // ignore malformed URL
  }

  const referer = req.headers.referer;
  if (typeof referer === "string" && referer.trim()) {
    try {
      const refererUrl = new URL(referer);
      const fromReferer = (
        refererUrl.searchParams.get("api_token") ?? refererUrl.searchParams.get("token")
      )?.trim();
      if (fromReferer) {
        return fromReferer;
      }
    } catch {
      // ignore malformed referer
    }
  }

  return null;
}

/**
 * Resolve the proxy auth token using the precedence chain:
 *
 *   1. `?api_token=` / `?token=` on the request URL.
 *   2. `?api_token=` / `?token=` on the Referer.
 *   3. `gateway.auth.token` from `~/.argentos/argent.json`.
 *
 * Browser-supplied `Authorization` headers are NOT consulted here — the proxy
 * caller must check that itself before falling back to this resolver, since
 * an explicit Authorization should always win over an implicit fallback.
 *
 * Returns `null` if nothing is available (fresh install with no gateway
 * config, no URL/Referer token, etc.).
 */
export function resolveProxyAuthToken(
  req: IncomingMessage,
  configPathOverride?: string,
): string | null {
  const fromRequest = dashboardApiTokenFromRequest(req);
  if (fromRequest) {
    return fromRequest;
  }
  const cfg = readGatewayConfigFromDisk(configPathOverride);
  return cfg.token;
}

export interface InjectGatewayTokenOpts {
  token: string | null;
  bind: string | null | undefined;
}

/**
 * Inject `window.__ARGENT_GATEWAY_TOKEN__` into the served HTML so that the
 * boot-time client (`App.tsx` → `resolveGatewayToken`) can seed
 * `localStorage["argent.control.settings.v1"].token` even when the URL has no
 * `?token=`. This unblocks `localApiFetch.ts` (which reads localStorage
 * first) and the WS path on bare-URL loads — including Swift-launched
 * dashboards.
 *
 * Returns the original HTML untouched when:
 *   - No fresh gateway token available on disk (e.g. fresh install).
 *   - Gateway is not bound to loopback — for lan/tailnet/auto/custom binds a
 *     remote browser would receive the token in the page source. Only
 *     loopback is safe.
 *   - The injection marker is already present (idempotent guard against
 *     double-injection if upstream HTML ever pre-injects).
 */
export function injectGatewayTokenIntoIndexHtml(
  html: string,
  opts: InjectGatewayTokenOpts,
): string {
  const { token, bind } = opts;
  if (!token) {
    return html;
  }
  if (!bindIsLoopback(bind)) {
    return html;
  }
  if (html.includes("__ARGENT_GATEWAY_TOKEN__")) {
    return html;
  }
  // JSON.stringify escapes any embedded quote/`</script>` so a hostile token
  // can't break out of the script tag.
  const script = `<script>window.__ARGENT_GATEWAY_TOKEN__=${JSON.stringify(token)};</script>`;
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return `${html.slice(0, headClose)}${script}${html.slice(headClose)}`;
  }
  return `${script}${html}`;
}

const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

const MAX_PROXY_BODY_BYTES = 50 * 1024 * 1024;

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export interface ProxyApiRequestOptions {
  /** Port the dashboard api-server is listening on. Defaults to env API_PORT or 9242. */
  apiPort?: number | string;
  /** Override the `~/.argentos/argent.json` path. Tests use this to sandbox. */
  configPathOverride?: string;
  /**
   * Override the global `fetch` for tests. Production passes nothing and
   * falls back to the runtime `fetch`.
   */
  fetchImpl?: typeof fetch;
  /** Max body bytes to buffer for non-GET forwarding. Defaults to 50MB. */
  maxBodyBytes?: number;
}

/**
 * Proxy a `/api/*` request from the gateway to the dashboard api-server.
 *
 * Behaviors:
 *   - Forward the client's headers (filtering hop-by-hop + host).
 *   - If the client did not send `Authorization`, auto-inject the gateway
 *     auth token from disk — but ONLY when bound to loopback. Off-loopback
 *     we let the api-server return 401, which is the correct outcome (no
 *     credential should be added to a request originating from an external
 *     network).
 *   - Forward the request body for non-GET/HEAD methods.
 *   - Return the upstream status code faithfully — DO NOT fall through to
 *     SPA fallback on non-2xx. The pre-fix code's `if (proxyRes.ok)`
 *     fall-through caused 401s from api-server to surface as 200 HTML to the
 *     browser, masking the auth failure as a "page reload."
 *   - On upstream connection failure (api-server down), respond 502 — again,
 *     do not fall through to SPA fallback for `/api/*`.
 */
export async function proxyApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ProxyApiRequestOptions = {},
): Promise<void> {
  const apiPort = String(options.apiPort ?? process.env.API_PORT ?? "9242");
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_PROXY_BODY_BYTES;
  const proxyUrl = `http://127.0.0.1:${apiPort}${req.url ?? "/"}`;

  const proxyHeaders: Record<string, string> = {};
  let clientSentAuthorization = false;
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) {
      continue;
    }
    const flat = Array.isArray(value) ? value.join(", ") : value;
    proxyHeaders[name] = flat;
    if (lower === "authorization") {
      clientSentAuthorization = true;
    }
  }

  if (!clientSentAuthorization) {
    const cfg = readGatewayConfigFromDisk(options.configPathOverride);
    if (cfg.token && bindIsLoopback(cfg.bind)) {
      const injected = resolveProxyAuthToken(req, options.configPathOverride);
      const tokenToUse = injected || cfg.token;
      proxyHeaders["Authorization"] = `Bearer ${tokenToUse}`;
    }
  }

  let body: Buffer | undefined;
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await readRawBody(req, maxBodyBytes);
      if (body.length === 0) {
        body = undefined;
      }
    } catch (err) {
      if (err instanceof Error && err.message === "PAYLOAD_TOO_LARGE") {
        res.statusCode = 413;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "request body too large" }));
        return;
      }
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "failed to read request body" }));
      return;
    }
  }

  let proxyRes: Response;
  try {
    proxyRes = await fetchImpl(proxyUrl, {
      method,
      headers: proxyHeaders,
      body: body as BodyInit | undefined,
    });
  } catch {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "Dashboard API unavailable" }));
    return;
  }

  res.statusCode = proxyRes.status;
  // Forward content-type, content-length, cache-control, etc. — strip
  // hop-by-hop on the way back out too (host etc. won't appear, but be safe).
  proxyRes.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) {
      return;
    }
    res.setHeader(name, value);
  });
  const responseBody = Buffer.from(await proxyRes.arrayBuffer());
  res.end(responseBody);
}
