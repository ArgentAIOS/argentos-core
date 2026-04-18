#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || process.env.VITE_PORT || 8080);
const API_PORT = Number(process.env.API_PORT || 9242);
const DIST_DIR = path.join(__dirname, "dist");
const INDEX_PATH = path.join(DIST_DIR, "index.html");

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
    if (fromPath) return fromPath;
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
      if (fromReferer) return fromReferer;
    } catch {
      // ignore malformed referer
    }
  }

  return null;
}

function proxyRequest(req, res) {
  const headers = {
    ...req.headers,
    host: `127.0.0.1:${API_PORT}`,
    "x-forwarded-for": req.socket.remoteAddress || "127.0.0.1",
    "x-forwarded-host": req.headers.host || `${HOST}:${PORT}`,
    "x-forwarded-proto": "http",
  };

  if (!headers.authorization) {
    const token = dashboardApiTokenFromRequest(req);
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

function serveFile(req, res, filePath, fallbackToIndex = false) {
  fs.stat(filePath, (error, stats) => {
    if (!error && stats.isDirectory()) {
      return serveFile(req, res, path.join(filePath, "index.html"), fallbackToIndex);
    }
    if (!error && stats.isFile()) {
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
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        fs.createReadStream(INDEX_PATH).pipe(res);
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

server.listen(PORT, HOST, () => {
  console.log(
    `[dashboard-ui] serving ${DIST_DIR} on http://${HOST}:${PORT} (api -> 127.0.0.1:${API_PORT})`,
  );
});
