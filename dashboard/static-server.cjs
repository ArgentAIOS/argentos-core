#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || process.env.VITE_PORT || 8080);
const API_PORT = Number(process.env.API_PORT || 9242);
const DIST_DIR = path.join(__dirname, "dist");
const INDEX_PATH = path.join(DIST_DIR, "index.html");

// Path to the user's argent.json. Read fresh on each call so that
// `argent update` rotations of `gateway.auth.token` propagate immediately
// without requiring a static-server restart.
const ARGENT_CONFIG_PATH = path.join(process.env.HOME || os.homedir(), ".argentos", "argent.json");

/**
 * Read the gateway auth token + bind mode from argent.json. Returns
 * `{ token: null, bind: null }` if the file is missing or malformed.
 *
 * Read fresh per call (not cached) so token rotations during `argent update`
 * take effect immediately. The cost is ~1 stat + tiny JSON parse per request,
 * which is negligible on loopback. Tests can override `pathOverride` to point
 * at a sandboxed argent.json.
 */
function readGatewayConfigFromDisk(pathOverride) {
  const target = pathOverride || ARGENT_CONFIG_PATH;
  try {
    if (!fs.existsSync(target)) {
      return { token: null, bind: null };
    }
    const cfg = JSON.parse(fs.readFileSync(target, "utf-8"));
    const token = cfg?.gateway?.auth?.token;
    const bind = cfg?.gateway?.bind;
    return {
      token: typeof token === "string" && token.trim() ? token.trim() : null,
      // Default to "loopback" when unset (matches gateway-daemon.ts default
      // at src/macos/gateway-daemon.ts:95). The bind controls whether we are
      // safe to inject the gateway token into served HTML — only when the
      // server is reachable solely from localhost.
      bind: typeof bind === "string" && bind.trim() ? bind.trim() : "loopback",
    };
  } catch {
    return { token: null, bind: null };
  }
}

/**
 * The static-server is the trusted local sidecar. Injecting the gateway auth
 * token into served HTML is only safe when the gateway+dashboard are bound to
 * loopback (no external network reachability). For lan/tailnet/auto/custom
 * binds we must not inject — a remote browser could read the token from the
 * page source.
 */
function bindIsLoopback(bind) {
  return bind === "loopback";
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
};

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

function dashboardApiTokenFromRequest(req) {
  try {
    const selfUrl = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const fromPath = (
      selfUrl.searchParams.get("api_token") ?? selfUrl.searchParams.get("token")
    )?.trim();
    if (fromPath) {
      return fromPath;
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
 * Resolve the dashboard API auth token using the precedence chain that lets
 * BOTH localApiFetch.ts-aware code AND raw `fetch("/api/...")` callers work:
 *
 *   1. Browser-supplied `Authorization` header (preserved as-is) — handled by
 *      caller before invoking this resolver.
 *   2. `?token=` / `?api_token=` query param on the proxied request URL.
 *   3. `?token=` / `?api_token=` query param on the page Referer.
 *   4. `gateway.auth.token` from `~/.argentos/argent.json` — fixes the bare-URL
 *      bootstrap case where neither the browser, the URL, nor the Referer
 *      carries a token. This also fixes the ~95 raw `fetch("/api/...")` call
 *      sites in `dashboard/src/**` that bypass `localApiFetch.ts` entirely
 *      and never set `Authorization` themselves. Reading per-request makes
 *      `argent update` rotations of the gateway token take effect immediately.
 */
function resolveProxyAuthToken(req, configPathOverride) {
  const fromRequest = dashboardApiTokenFromRequest(req);
  if (fromRequest) {
    return fromRequest;
  }
  const cfg = readGatewayConfigFromDisk(configPathOverride);
  return cfg.token;
}

function proxyRequest(req, res, configPathOverride) {
  const headers = {
    ...req.headers,
    host: `127.0.0.1:${API_PORT}`,
    "x-forwarded-for": req.socket.remoteAddress || "127.0.0.1",
    "x-forwarded-host": req.headers.host || `${HOST}:${PORT}`,
    "x-forwarded-proto": "http",
  };

  if (!headers.authorization) {
    const token = resolveProxyAuthToken(req, configPathOverride);
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
  }

  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    sendError(res, 502, `Dashboard API unavailable: ${error.message}`);
  });

  req.pipe(upstream);
}

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function resolveStaticPath(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const normalized = path.posix.normalize(decoded);
  const safePath = normalized.replace(/^(\.\.(\/|\\|$))+/, "").replace(/^\/+/, "");
  return path.join(DIST_DIR, safePath);
}

/**
 * Inject `window.__ARGENT_GATEWAY_TOKEN__` into the served HTML so that the
 * boot-time client (App.tsx → resolveGatewayToken) can seed
 * `localStorage["argent.control.settings.v1"].token` even when the URL has no
 * `?token=`. This unblocks `localApiFetch.ts` (which reads localStorage first)
 * and the WS path on bare-URL loads — including Swift-launched dashboards.
 *
 * Returns the original HTML untouched when:
 *   - No fresh gateway token available on disk (e.g. fresh install).
 *   - Gateway is not bound to loopback — for lan/tailnet/auto/custom binds
 *     a remote browser would receive the token in the page source. Only
 *     loopback is safe (only the local user can hit the static-server).
 *   - The injection marker is already present (idempotent guard against
 *     double-injection if upstream HTML ever pre-injects).
 */
function injectGatewayTokenIntoIndexHtml(html, opts) {
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
  const script = `<script>window.__ARGENT_GATEWAY_TOKEN__=${JSON.stringify(token)};</script>`;
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return `${html.slice(0, headClose)}${script}${html.slice(headClose)}`;
  }
  return `${script}${html}`;
}

function serveIndexHtml(req, res, indexPath, configPathOverride) {
  const cfg = readGatewayConfigFromDisk(configPathOverride);
  let raw;
  try {
    raw = fs.readFileSync(indexPath, "utf-8");
  } catch (err) {
    sendError(res, 500, `Failed to read index.html: ${err.message}`);
    return;
  }
  const body = injectGatewayTokenIntoIndexHtml(raw, cfg);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

function serveFile(req, res, filePath, fallbackToIndex = false, configPathOverride) {
  fs.stat(filePath, (error, stats) => {
    if (!error && stats.isDirectory()) {
      return serveFile(
        req,
        res,
        path.join(filePath, "index.html"),
        fallbackToIndex,
        configPathOverride,
      );
    }
    if (!error && stats.isFile()) {
      // Always inject the gateway token into HTML responses so the SPA can
      // seed localStorage on bare-URL boot. Other static assets stream
      // through unchanged so cache headers + mime types stay correct.
      if (path.basename(filePath) === "index.html") {
        serveIndexHtml(req, res, filePath, configPathOverride);
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", contentTypeFor(filePath));
      res.setHeader(
        "Cache-Control",
        filePath.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable",
      );
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    if (fallbackToIndex) {
      fs.stat(INDEX_PATH, (indexError, indexStats) => {
        if (indexError || !indexStats.isFile()) {
          sendError(res, 500, "Dashboard build output is missing.");
          return;
        }
        serveIndexHtml(req, res, INDEX_PATH, configPathOverride);
      });
      return;
    }
    sendError(res, 404, "Not Found");
  });
}

const server = http.createServer((req, res) => {
  const method = req.method || "GET";
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method)) {
    sendError(res, 405, "Method Not Allowed");
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/live2d-assets" ||
    url.pathname.startsWith("/live2d-assets/")
  ) {
    proxyRequest(req, res);
    return;
  }

  if (url.pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, port: PORT, apiPort: API_PORT }));
    return;
  }

  const candidatePath = resolveStaticPath(url.pathname);
  const relative = path.relative(DIST_DIR, candidatePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendError(res, 403, "Forbidden");
    return;
  }

  const fallbackToIndex = method === "GET" || method === "HEAD";
  serveFile(req, res, candidatePath, fallbackToIndex);
});

// Export internals for unit tests so they can exercise the token-injection
// + auth-fallback paths without spinning up the full server. The IIFE guard
// keeps `node static-server.cjs` (production) bound to the listen() side.
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(
      `[dashboard-ui] serving ${DIST_DIR} on http://${HOST}:${PORT} (api -> 127.0.0.1:${API_PORT})`,
    );
  });
}

module.exports = {
  __test__: {
    readGatewayConfigFromDisk,
    bindIsLoopback,
    dashboardApiTokenFromRequest,
    resolveProxyAuthToken,
    injectGatewayTokenIntoIndexHtml,
  },
};
