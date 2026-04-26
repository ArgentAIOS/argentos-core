const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const net = require("net");
const os = require("os");
const { execSync, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  detectConnectorRoots,
  chooseDefaultConnectorRoot,
  scaffoldConnector,
} = require("./connectors-builder.cjs");

const app = express();
const PORT = process.env.API_PORT || 9242;

function readRuntimeBuildInfo(baseDir) {
  const candidates = [
    path.join(baseDir, "dist", "build-info.json"),
    path.join(baseDir, "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf-8"));
      if (typeof parsed?.version === "string" && parsed.version.trim()) {
        return {
          version: parsed.version.trim(),
          commit:
            typeof parsed?.commit === "string" && parsed.commit.trim()
              ? parsed.commit.trim()
              : null,
          builtAt:
            typeof parsed?.builtAt === "string" && parsed.builtAt.trim()
              ? parsed.builtAt.trim()
              : null,
          source: path.basename(candidate),
        };
      }
    } catch {
      // ignore malformed or missing candidates
    }
  }
  return {
    version: null,
    commit: null,
    builtAt: null,
    source: null,
  };
}

function resolveGatewayAuthToken(config = readArgentConfig()) {
  let gwToken = config.gateway?.auth?.token || "";
  if (!gwToken) {
    try {
      const plistPath = path.join(os.homedir(), "Library/LaunchAgents/ai.argent.gateway.plist");
      if (fs.existsSync(plistPath)) {
        const plistRaw = fs.readFileSync(plistPath, "utf-8");
        const match = plistRaw.match(
          /<key>ARGENT_GATEWAY_TOKEN<\/key>\s*<string>([^<]+)<\/string>/,
        );
        if (match?.[1]) gwToken = match[1].trim();
      }
    } catch {}
  }
  if (!gwToken) {
    try {
      gwToken = require("child_process")
        .execSync("/bin/launchctl getenv ARGENT_GATEWAY_TOKEN 2>/dev/null || true", {
          timeout: 2000,
        })
        .toString()
        .trim();
    } catch {}
  }
  if (!gwToken) gwToken = process.env.ARGENT_GATEWAY_TOKEN || "";
  return gwToken;
}

function sendGatewayRpcFireAndForget(method, params, options = {}) {
  try {
    const WebSocket = require("ws");
    const config = readArgentConfig();
    const gwPort = config.gateway?.port || 18789;
    const gwToken = resolveGatewayAuthToken(config);
    const ws = new WebSocket(`ws://127.0.0.1:${gwPort}`);
    const connectId = `dashboard-api-connect-${crypto.randomUUID()}`;
    const requestId = `dashboard-api-rpc-${crypto.randomUUID()}`;
    const timeout = setTimeout(
      () => {
        try {
          ws.close();
        } catch {}
      },
      Number(options.timeoutMs) || 3000,
    );
    if (typeof timeout.unref === "function") timeout.unref();

    function cleanup() {
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {}
    }

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "req",
          id: connectId,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: "dashboard-api",
              version: "1.0.0",
              platform: "node",
              mode: "api",
            },
            caps: [],
            auth: gwToken ? { token: gwToken } : undefined,
          },
        }),
      );
    });
    ws.on("message", (raw) => {
      let msg = null;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?.type !== "res") return;
      if (msg.id === connectId) {
        if (!msg.ok) {
          cleanup();
          return;
        }
        ws.send(JSON.stringify({ type: "req", id: requestId, method, params }));
        return;
      }
      if (msg.id === requestId) cleanup();
    });
    ws.on("error", (err) => {
      if (options.logErrors) {
        console.warn(`[GatewayRPC] ${method} failed:`, err.message);
      }
      cleanup();
    });
  } catch (err) {
    if (options.logErrors) {
      console.warn(`[GatewayRPC] ${method} unavailable:`, err.message);
    }
  }
}

// API responses should never rely on browser cache revalidation.
// 304 + empty body breaks JSON fetch flows that expect a payload.
app.disable("etag");

// Sentry error monitoring (opt-in via SENTRY_DSN env var)
let Sentry = null;
try {
  if (process.env.SENTRY_DSN) {
    Sentry = require("@sentry/node");
    Sentry.init({ dsn: process.env.SENTRY_DSN });
    console.log("[API] Sentry error monitoring enabled");
  }
} catch {
  // @sentry/node not available — skip silently
}

// ============================================
// Security: CORS + Auth
// ============================================
const ALLOWED_ORIGINS = [
  "http://localhost:8080",
  "http://localhost:5173",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5173",
  "http://localhost:18789", // Gateway (Swift wrapper loads dashboard here)
  "http://127.0.0.1:18789", // Gateway (alternate)
];

// Argent Lite: on a Pi the operator may access via hostname or LAN IP.
// Dynamically add the system hostname and all non-loopback IPs so CORS
// doesn't block saves from the same machine via a different address.
try {
  const os = require("os");
  const hostname = os.hostname();
  const ifaces = os.networkInterfaces();
  const extraHosts = new Set([hostname]);
  if (hostname && !hostname.endsWith(".local")) {
    extraHosts.add(`${hostname}.local`);
  }
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (!iface.internal && iface.family === "IPv4") {
        extraHosts.add(iface.address);
      }
    }
  }
  for (const host of extraHosts) {
    for (const port of [8080, 5173, 18789]) {
      const origin = `http://${host}:${port}`;
      if (!ALLOWED_ORIGINS.includes(origin)) {
        ALLOWED_ORIGINS.push(origin);
      }
    }
  }
} catch {
  /* best-effort — loopback origins always work */
}
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, same-origin)
      // Also allow "null" origin from sandboxed iframes (about:srcdoc widgets)
      if (!origin || origin === "null" || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS: origin not allowed"));
      }
    },
    credentials: true,
  }),
);

const PUBLIC_CORE_BLOCKED_API_PATTERNS = [
  "/api/org/**",
  "/api/settings/intent/**",
  "/api/settings/knowledge/collections/grant",
  "/api/system/open",
  "/api/lockscreen/emergency-unlock",
  "/api/logs/tail",
  "/api/proxy/cors",
  "/api/security/filesystem-permissions/decision",
  "/api/devices/**",
  "/api/settings/auth",
  "/api/settings/cors-allowlist/**",
  "/api/settings/filesystem-allowlist/**",
  "/api/settings/pairing",
  "/api/settings/load-profile",
  "/api/settings/aos-google/preflight",
  "/api/settings/aos-google/launch",
  "/api/settings/connectors/scaffold",
  "/api/settings/agent/raw-config",
  "/api/settings/service-keys/migrate",
];

function getDashboardSurfaceProfile(config) {
  return config?.distribution?.surfaceProfile === "full" ? "full" : "public-core";
}

function normalizeSurfaceApiPath(req) {
  const rawPath =
    typeof req?.path === "string" && req.path.trim()
      ? req.path
      : typeof req?.originalUrl === "string" && req.originalUrl.trim()
        ? req.originalUrl.split("?")[0]
        : "/";
  return rawPath.startsWith("/api/") || rawPath === "/api" ? rawPath : `/api${rawPath}`;
}

function matchesSurfaceRoutePattern(routePath, pattern) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return routePath === prefix || routePath.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return routePath.startsWith(`${prefix}/`);
  }
  if (pattern.includes("/:")) {
    const regex = new RegExp(
      `^${pattern
        .split("/")
        .map((segment) => {
          if (!segment) return "";
          if (segment.startsWith(":")) return "[^/]+";
          return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/")}$`,
    );
    return regex.test(routePath);
  }
  return routePath === pattern;
}

function isBlockedInPublicCore(routePath) {
  return PUBLIC_CORE_BLOCKED_API_PATTERNS.some((pattern) =>
    matchesSurfaceRoutePattern(routePath, pattern),
  );
}

app.use("/api", (req, res, next) => {
  if (req.method === "OPTIONS") return next();
  const surfaceProfile = getDashboardSurfaceProfile(readArgentConfig());
  if (surfaceProfile !== "public-core") return next();
  const routePath = normalizeSurfaceApiPath(req);
  if (!isBlockedInPublicCore(routePath)) return next();
  return res.status(403).json({
    error: "Route not available in Public Core",
    surfaceProfile,
    route: routePath,
  });
});

// Optional bearer token auth — if DASHBOARD_API_TOKEN is set, enforce it
const DASHBOARD_API_TOKEN = process.env.DASHBOARD_API_TOKEN || null;
if (DASHBOARD_API_TOKEN) {
  app.use("/api/", (req, res, next) => {
    // Allow preflight and health check (no auth needed)
    if (req.method === "OPTIONS") return next();
    if (req.path === "/api/health" || req.path === "/health") return next();
    if (req.originalUrl?.includes("/api/settings/auth-profiles/openai-codex/oauth/callback")) {
      return next();
    }
    if (req.path.endsWith("/events")) return next(); // SSE — EventSource can't send headers
    if (req.path === "/media" || req.path === "/api/media") return next(); // Media served via <img>/<video>/<audio> tags — has own path-based security
    if (req.path === "/proxy/tts/elevenlabs" || req.path === "/api/proxy/tts/elevenlabs")
      return next(); // Browser TTS calls may not have access to dashboard API token
    if (req.path === "/proxy/tts/openai" || req.path === "/api/proxy/tts/openai") return next();
    if (req.path === "/proxy/tts/fish" || req.path === "/api/proxy/tts/fish") return next();
    if (req.path.startsWith("/license")) return next(); // License endpoints need to work before auth is established
    const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
    if (!token) {
      return res.status(401).json({ error: "Authorization required" });
    }
    try {
      const a = Buffer.from(token);
      const b = Buffer.from(DASHBOARD_API_TOKEN);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: "Invalid token" });
      }
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
    next();
  });
  console.log("[Security] Dashboard API token auth ENABLED");
} else {
  console.log("[Security] Dashboard API token auth DISABLED (set DASHBOARD_API_TOKEN to enable)");
}

app.use(express.json({ limit: "50mb" }));

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

// ============================================
// Security: URL validation for proxy endpoints
// ============================================
function isExternalUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    // Block localhost, private IPs, link-local, metadata endpoints
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      host === "[::1]" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host === "metadata.google.internal" ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^fc00:/.test(host) ||
      /^fe80:/.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Media file serving (for TTS audio, etc.)
// ============================================
app.get("/api/media", (req, res) => {
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: "path query parameter required" });
  }

  // Security: normalize path and reject traversal
  const normalized = path.normalize(filePath);
  if (normalized.includes("..")) {
    return res.status(403).json({ error: "Path traversal not allowed" });
  }

  // Security: only allow specific directories
  const allowedPrefixes = [
    "/var/folders/", // macOS temp directories
    "/tmp/",
    path.join(process.env.HOME, ".argentos"),
    path.join(process.env.HOME, "argent"),
  ];

  const isAllowed = allowedPrefixes.some((prefix) => normalized.startsWith(prefix));
  if (!isAllowed) {
    return res.status(403).json({ error: "Access denied to this path" });
  }

  if (!fs.existsSync(normalized)) {
    return res.status(404).json({ error: "File not found" });
  }

  // Determine content type
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  };

  const contentType = mimeTypes[ext] || "application/octet-stream";
  const stat = fs.statSync(normalized);
  const fileSize = stat.size;

  // Range request support (required for video/audio seeking)
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType,
    });
    fs.createReadStream(normalized, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Accept-Ranges": "bytes",
      "Content-Type": contentType,
    });
    fs.createReadStream(normalized).pipe(res);
  }
});

// Cleanup media files (used when deleting documents with media)
app.post("/api/media/cleanup", (req, res) => {
  const { paths } = req.body;
  if (!Array.isArray(paths)) {
    return res.status(400).json({ error: "paths array required" });
  }

  const allowedPrefixes = ["/var/folders/", "/tmp/"];
  let deleted = 0;

  for (const filePath of paths) {
    const normalized = path.normalize(filePath);
    if (normalized.includes("..")) continue;
    // Only allow temp directories for safety
    if (!allowedPrefixes.some((p) => normalized.startsWith(p))) continue;
    try {
      if (fs.existsSync(normalized)) {
        fs.unlinkSync(normalized);
        deleted++;
      }
    } catch (err) {
      console.warn(`[Media cleanup] Failed to delete ${normalized}:`, err.message);
    }
  }

  res.json({ deleted });
});

// ============================================
// SSE for real-time canvas notifications
// ============================================
const canvasClients = new Set();

// SSE endpoint for canvas events
app.get("/api/canvas/events", (req, res) => {
  console.log("[SSE] Canvas client connected");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  // Advise EventSource reconnect delay for transient drops.
  res.write("retry: 3000\n\n");

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  // Keep proxies/load balancers from idling out long-lived SSE sockets.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      canvasClients.delete(res);
    }
  }, 15000);

  canvasClients.add(res);

  req.on("close", () => {
    console.log("[SSE] Canvas client disconnected");
    clearInterval(heartbeat);
    canvasClients.delete(res);
  });
});

// Helper to broadcast canvas events to all connected clients
function broadcastCanvasEvent(event) {
  const data = JSON.stringify(event);
  console.log(`[SSE] Broadcasting to ${canvasClients.size} clients:`, event.type);
  for (const client of canvasClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      canvasClients.delete(client);
    }
  }
}

// ============================================
// Think Tank SSE — real-time debate events
// ============================================
const tankClients = new Set();

app.get("/api/think-tank/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  tankClients.add(res);
  req.on("close", () => {
    tankClients.delete(res);
  });
});

// Receive events from the Think Tank plugin and broadcast to SSE clients
// Auth-exempt: paths ending with /events are allowed by the auth middleware
app.post("/api/think-tank/events", (req, res) => {
  const event = req.body;
  if (!event || !event.type) {
    return res.status(400).json({ error: "Missing event type" });
  }
  const payload = JSON.stringify(event);
  for (const client of tankClients) {
    client.write(`data: ${payload}\n\n`);
  }
  // Also broadcast to canvas SSE for backwards compat
  broadcastCanvasEvent({ ...event, source: "think-tank" });
  res.json({ ok: true, clients: tankClients.size });
});

// ============================================
// Contemplation Wakeups — heartbeat → dashboard
// ============================================
const contemplationClients = new Set();
let lastContemplationAt = 0;
const CONTEMPLATION_COOLDOWN_MS = 30 * 60 * 1000; // Max 1 wakeup per 30 minutes

// SSE endpoint for contemplation events
app.get("/api/contemplation/events", (req, res) => {
  console.log("[SSE] Contemplation client connected");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  contemplationClients.add(res);
  req.on("close", () => {
    console.log("[SSE] Contemplation client disconnected");
    contemplationClients.delete(res);
  });
});

function broadcastContemplation(event) {
  const data = JSON.stringify(event);
  console.log(`[Contemplation] Broadcasting to ${contemplationClients.size} clients:`, event.type);
  for (const client of contemplationClients) {
    client.write(`data: ${data}\n\n`);
  }
}

// POST endpoint — heartbeat runner or gateway can push contemplation wakeups
// Body: { text, mood?, significance?, source? }
app.post("/api/contemplation/wakeup", (req, res) => {
  const now = Date.now();
  const { text, mood, significance, source } = req.body || {};

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "text is required" });
  }

  // Rate limit: max 1 wakeup per cooldown period
  if (now - lastContemplationAt < CONTEMPLATION_COOLDOWN_MS) {
    const remainingMs = CONTEMPLATION_COOLDOWN_MS - (now - lastContemplationAt);
    console.log(`[Contemplation] Rate-limited, ${Math.round(remainingMs / 1000)}s remaining`);
    return res.status(429).json({
      error: "Rate limited",
      retryAfterMs: remainingMs,
    });
  }

  // Parse mood from text if not explicitly provided
  let resolvedMood = mood;
  if (!resolvedMood) {
    const moodMatch = text.match(/\[MOOD:([^\]]+)\]/);
    if (moodMatch) resolvedMood = moodMatch[1].trim();
  }

  // Strip markers from display text
  const displayText = text
    .replace(/\[MOOD:[^\]]+\]/g, "")
    .replace(/\[WAKEUP:[^\]]+\]/g, "")
    .replace(/\[SIGNIFICANCE:[^\]]+\]/g, "")
    .trim();

  if (displayText.length === 0) {
    return res.status(400).json({ error: "No displayable text after stripping markers" });
  }

  lastContemplationAt = now;

  const event = {
    type: "contemplation_wakeup",
    text: displayText,
    mood: resolvedMood || null,
    significance: significance || "normal",
    source: source || "heartbeat",
    timestamp: new Date().toISOString(),
  };

  broadcastContemplation(event);
  console.log("[Contemplation] Wakeup sent:", displayText.slice(0, 80));

  res.json({ ok: true, event });
});

// GET endpoint — check contemplation status
app.get("/api/contemplation/status", (req, res) => {
  const now = Date.now();
  const cooldownRemaining = Math.max(0, CONTEMPLATION_COOLDOWN_MS - (now - lastContemplationAt));
  res.json({
    lastWakeupAt: lastContemplationAt ? new Date(lastContemplationAt).toISOString() : null,
    cooldownRemainingMs: cooldownRemaining,
    clientsConnected: contemplationClients.size,
  });
});

// Health check endpoint
const startTime = Date.now();
function parseConnectionTarget(connectionString, fallbackHost, fallbackPort) {
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname || fallbackHost;
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : fallbackPort;
    return { host, port: Number.isFinite(port) ? port : fallbackPort };
  } catch {
    return { host: fallbackHost, port: fallbackPort };
  }
}

function loadStorageTargets() {
  const configPath =
    process.env.ARGENT_CONFIG_PATH || path.join(process.env.HOME || "", ".argentos", "argent.json");
  const defaults = {
    postgres: { host: "127.0.0.1", port: 5433 },
    redis: { host: "127.0.0.1", port: 6380 },
  };
  try {
    if (!fs.existsSync(configPath)) return defaults;
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const storage = parsed?.storage || {};
    const pgConn = storage?.postgres?.connectionString;
    const redisHost = storage?.redis?.host || defaults.redis.host;
    const redisPort = Number.parseInt(String(storage?.redis?.port ?? defaults.redis.port), 10);
    return {
      postgres: parseConnectionTarget(pgConn, defaults.postgres.host, defaults.postgres.port),
      redis: {
        host: redisHost,
        port: Number.isFinite(redisPort) ? redisPort : defaults.redis.port,
      },
    };
  } catch {
    return defaults;
  }
}

function checkTcpReachable(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function resolveBrewCommand() {
  const candidates = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "brew";
}

function resolvePgDumpCommand() {
  const candidates = [
    "/opt/homebrew/opt/postgresql@17/bin/pg_dump",
    "/usr/local/opt/postgresql@17/bin/pg_dump",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "pg_dump";
}

function getDatabaseBackupDir() {
  return path.join(process.env.HOME, ".argentos", "backups", "database");
}

function getDatabaseBackupLogPath() {
  return path.join(getDatabaseBackupDir(), "database-backup-cron.log");
}

function getDatabaseBackupPlistPath() {
  return path.join(process.env.HOME, "Library", "LaunchAgents", "ai.argent.database-backup.plist");
}

function readStorageConfigSummary() {
  const configPath =
    process.env.ARGENT_CONFIG_PATH || path.join(process.env.HOME || "", ".argentos", "argent.json");
  const defaults = {
    backend: "sqlite",
    readFrom: "sqlite",
    writeTo: ["sqlite"],
    postgresConnectionString: null,
  };
  try {
    if (!fs.existsSync(configPath)) return defaults;
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const storage = parsed?.storage || {};
    return {
      backend: storage.backend || defaults.backend,
      readFrom: storage.readFrom || defaults.readFrom,
      writeTo: Array.isArray(storage.writeTo) ? storage.writeTo : defaults.writeTo,
      postgresConnectionString:
        typeof storage?.postgres?.connectionString === "string"
          ? storage.postgres.connectionString.trim() || null
          : null,
    };
  } catch {
    return defaults;
  }
}

function listDatabaseBackups() {
  const backupDir = getDatabaseBackupDir();
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("argentos-db-backup-") && f.endsWith(".dump"))
    .map((f) => {
      const fullPath = path.join(backupDir, f);
      const stats = fs.statSync(fullPath);
      return {
        filename: f,
        path: fullPath,
        createdAt: stats.mtime.toISOString(),
        sizeMb: (stats.size / 1024 / 1024).toFixed(1),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getPostgresServiceState(postgresPort) {
  const brew = resolveBrewCommand();
  let serviceStatus = "unknown";
  try {
    const out = execFileSync(brew, ["services", "list", "--json"], {
      stdio: "pipe",
      timeout: 5000,
      encoding: "utf8",
    });
    const rows = JSON.parse(out);
    const pg = Array.isArray(rows)
      ? rows.find((row) => String(row?.name || "").startsWith("postgresql@17"))
      : null;
    if (pg?.status) serviceStatus = String(pg.status);
  } catch {}

  let pid = null;
  let reachable = false;
  try {
    const result = execSync(
      `/usr/sbin/lsof -nP -iTCP:${postgresPort} -sTCP:LISTEN -t 2>/dev/null || true`,
      { timeout: 3000 },
    )
      .toString()
      .trim();
    if (result) {
      reachable = true;
      pid = Number.parseInt(result.split("\n")[0] || "", 10) || null;
    }
  } catch {}

  return {
    service: "postgresql@17",
    status: reachable ? "running" : serviceStatus === "started" ? "started" : "stopped",
    pid,
    reachable,
  };
}

app.get("/api/health", async (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const memoryUsage = process.memoryUsage();
  const storageTargets = loadStorageTargets();

  const [postgresReachable, redisReachable] = await Promise.all([
    checkTcpReachable(storageTargets.postgres.host, storageTargets.postgres.port),
    checkTcpReachable(storageTargets.redis.host, storageTargets.redis.port),
  ]);

  const criticalServicesDown = [];
  if (!postgresReachable) criticalServicesDown.push("postgres");
  if (!redisReachable) criticalServicesDown.push("redis");
  const status = criticalServicesDown.length > 0 ? "degraded" : "ok";

  res.json({
    status,
    service: "argent-api",
    uptime: uptimeSeconds,
    uptimeFormatted: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    criticalServicesDown,
    services: {
      postgres: {
        required: true,
        host: storageTargets.postgres.host,
        port: storageTargets.postgres.port,
        reachable: postgresReachable,
      },
      redis: {
        required: true,
        host: storageTargets.redis.host,
        port: storageTargets.redis.port,
        reachable: redisReachable,
      },
    },
    gateway: {
      status: "running",
      uptime: uptimeSeconds * 1000,
      connections: 0, // TODO: track active WebSocket connections
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024) + " MB",
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + " MB",
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + " MB",
      },
    },
    loop: {
      state: "idle", // TODO: read from src/core/loop.ts when available
      queueDepth: 0, // TODO: track event queue depth
      eventsProcessed: 0, // TODO: track total events processed
    },
  });
});

// Open a file/folder path in Finder or Terminal
app.post("/api/system/open", (req, res) => {
  const { path: targetPath, mode } = req.body || {};
  if (!targetPath || typeof targetPath !== "string") {
    return res.status(400).json({ error: "path is required" });
  }
  // Security: must be absolute path, no traversal
  const normalized = path.normalize(targetPath);
  if (!path.isAbsolute(normalized) || normalized.includes("..")) {
    return res.status(403).json({ error: "Invalid path" });
  }
  // Verify path exists
  if (!fs.existsSync(normalized)) {
    return res.status(404).json({ error: "Path not found" });
  }
  try {
    if (mode === "terminal") {
      // Open Terminal.app at the path (use directory for files)
      const dir = fs.statSync(normalized).isDirectory() ? normalized : path.dirname(normalized);
      execSync(`open -a Terminal "${dir}"`, { timeout: 5000 });
    } else {
      // Default: reveal in Finder (for files: select the file; for dirs: open the dir)
      if (fs.statSync(normalized).isDirectory()) {
        execSync(`open "${normalized}"`, { timeout: 5000 });
      } else {
        execSync(`open -R "${normalized}"`, { timeout: 5000 });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/build-info", (_req, res) => {
  const repoRoot = path.resolve(__dirname, "..");
  res.json(readRuntimeBuildInfo(repoRoot));
});

// Emergency unlock — admin touches ~/.argentos/emergency-unlock, dashboard consumes it
const EMERGENCY_UNLOCK_PATH = path.join(process.env.HOME, ".argentos", "emergency-unlock");
app.post("/api/lockscreen/emergency-unlock", (req, res) => {
  try {
    if (fs.existsSync(EMERGENCY_UNLOCK_PATH)) {
      const stat = fs.statSync(EMERGENCY_UNLOCK_PATH);
      const ageMs = Date.now() - stat.mtimeMs;
      // Only honor if created within the last 5 minutes
      if (ageMs < 5 * 60 * 1000) {
        fs.unlinkSync(EMERGENCY_UNLOCK_PATH);
        return res.json({ unlocked: true });
      }
      // Stale token — clean it up
      fs.unlinkSync(EMERGENCY_UNLOCK_PATH);
    }
    res.json({ unlocked: false });
  } catch {
    res.json({ unlocked: false });
  }
});

// Usage and cost metrics endpoint
app.get("/api/usage/cost", (req, res) => {
  const days = parseInt(req.query.days) || 7;

  // TODO: Query actual usage data from gateway database
  // For now, return mock data structure for UI development
  res.json({
    days: days,
    totalRequests: 1234,
    inputTokens: 50000,
    outputTokens: 25000,
    estimatedCost: 1.25,
    errorRate: "0.5%",
    avgResponseTime: "1.2s",
    p95Latency: "2.1s",
    p99Latency: "3.5s",
    cacheHitRate: "45%",
    byTier: {
      local: 100,
      fast: 500,
      balanced: 500,
      powerful: 134,
    },
  });
});

// Logs tail endpoint
app.get("/api/logs/tail", (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const cursor = parseInt(req.query.cursor) || 0;

  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    // Try to read from ArgentOS log directory
    const logPaths = [
      path.join(os.homedir(), ".argentos", "logs", "gateway.log"),
      path.join(os.homedir(), ".argentos", "logs", "argent.log"),
      path.join(os.homedir(), ".openclaw", "logs", "gateway.log"),
    ];

    let logFile = null;
    for (const logPath of logPaths) {
      if (fs.existsSync(logPath)) {
        logFile = logPath;
        break;
      }
    }

    if (!logFile) {
      // No log file found, return empty logs
      return res.json({
        file: "none",
        lines: [],
        cursor: 0,
        size: 0,
        truncated: false,
        reset: false,
      });
    }

    // Read the log file
    const logContent = fs.readFileSync(logFile, "utf-8");
    const allLines = logContent.split("\n").filter((line) => line.trim());

    // Get the last N lines
    const startIdx = Math.max(0, allLines.length - limit);
    const lines = allLines.slice(startIdx);

    res.json({
      file: logFile,
      lines: lines,
      cursor: allLines.length,
      size: Buffer.byteLength(logContent),
      truncated: startIdx > 0,
      reset: false,
    });
  } catch (err) {
    console.error("[Logs] Error reading logs:", err);
    res.json({
      file: "error",
      lines: [`[Error reading logs: ${err.message}]`],
      cursor: 0,
      size: 0,
      truncated: false,
      reset: false,
    });
  }
});

// Test route
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

const CALENDAR_SETTINGS_PATH = path.join(
  process.env.HOME || "",
  ".argentos",
  "dashboard-calendar.json",
);

function readCalendarSettings() {
  try {
    if (!fs.existsSync(CALENDAR_SETTINGS_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(CALENDAR_SETTINGS_PATH, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCalendarSettings(next) {
  try {
    fs.mkdirSync(path.dirname(CALENDAR_SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(CALENDAR_SETTINGS_PATH, JSON.stringify(next, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Calendar] Failed to write settings:", err.message);
  }
}

function listGogCalendarAccountsDetailed() {
  try {
    const output = execFileSync("gog", ["auth", "list", "--json"], {
      encoding: "utf-8",
      timeout: 10000,
    });
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed?.accounts)) return [];
    return parsed.accounts
      .filter((entry) => entry && typeof entry.email === "string")
      .filter((entry) => Array.isArray(entry.services) && entry.services.includes("calendar"))
      .map((entry) => ({
        email: entry.email,
        client: entry.client || "default",
        auth: entry.auth || "oauth",
        createdAt: entry.created_at || null,
      }));
  } catch {
    return [];
  }
}

function listGogCalendarAccounts() {
  return listGogCalendarAccountsDetailed().map((entry) => entry.email);
}

function getGogDefaultAccount() {
  try {
    const output = execFileSync("gog", ["auth", "status"], {
      encoding: "utf-8",
      timeout: 10000,
    });
    const line = output
      .split("\n")
      .map((row) => row.trim())
      .find((row) => row.startsWith("account\t"));
    if (!line) return null;
    const [, account] = line.split("\t");
    return account || null;
  } catch {
    return null;
  }
}

const calendarSettings = readCalendarSettings();
let cachedGogCalendarAccount =
  (process.env.GOG_CALENDAR_ACCOUNT || process.env.GOG_ACCOUNT || "").trim() ||
  (typeof calendarSettings.account === "string" ? calendarSettings.account.trim() : "") ||
  null;

function persistCalendarAccount(account) {
  cachedGogCalendarAccount = account;
  const current = readCalendarSettings();
  writeCalendarSettings({
    ...current,
    account: account || null,
    updatedAt: new Date().toISOString(),
  });
}

function normalizeRequestedAccount(raw) {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim();
  return normalized ? normalized : null;
}

function getRequestedCalendarAccount(req) {
  return normalizeRequestedAccount(req.query?.account);
}

function runGogCalendarEvents(preferredAccount = null) {
  const strictPreferred = Boolean(preferredAccount);
  const queue = [];
  const seen = new Set();
  const enqueue = (account) => {
    const normalized = typeof account === "string" ? account.trim() : "";
    const key = normalized || "__default__";
    if (seen.has(key)) return;
    seen.add(key);
    queue.push(normalized || null);
  };

  if (strictPreferred) {
    enqueue(preferredAccount);
  } else {
    enqueue(cachedGogCalendarAccount);
    enqueue(null);
  }

  let lastError = null;
  let expanded = false;

  for (let i = 0; i < queue.length; i++) {
    const account = queue[i];
    try {
      const args = account
        ? ["--account", account, "calendar", "events", "--json"]
        : ["calendar", "events", "--json"];
      const output = execFileSync("gog", args, {
        encoding: "utf-8",
        timeout: 10000,
      });
      const data = JSON.parse(output);
      if (account && account !== cachedGogCalendarAccount) {
        persistCalendarAccount(account);
        console.log(`[Calendar] Switched gog account to ${account}`);
      }
      return { data, account };
    } catch (err) {
      lastError = err;
      if (!strictPreferred && !expanded && i === queue.length - 1) {
        expanded = true;
        for (const discovered of listGogCalendarAccounts()) {
          enqueue(discovered);
        }
      }
    }
  }

  throw lastError || new Error("Failed to fetch calendar via gog");
}

app.get("/api/calendar/accounts", (req, res) => {
  try {
    const accounts = listGogCalendarAccountsDetailed();
    const defaultAccount = getGogDefaultAccount();
    res.json({
      accounts,
      selectedAccount: cachedGogCalendarAccount,
      defaultAccount,
      settingsPath: CALENDAR_SETTINGS_PATH,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/calendar/account", (req, res) => {
  const requested = normalizeRequestedAccount(req.body?.account ?? "");
  const knownAccounts = listGogCalendarAccounts();

  if (requested && knownAccounts.length > 0 && !knownAccounts.includes(requested)) {
    return res.status(400).json({
      error: "Unknown calendar account",
      account: requested,
      knownAccounts,
    });
  }

  persistCalendarAccount(requested);
  return res.json({
    ok: true,
    selectedAccount: cachedGogCalendarAccount,
  });
});

// Calendar endpoint - gets next event from gog
app.get("/api/calendar/next", (req, res) => {
  console.log("Calendar endpoint hit");
  try {
    const requestedAccount = getRequestedCalendarAccount(req);
    const { data, account } = runGogCalendarEvents(requestedAccount);
    const now = new Date();

    // Find next upcoming event
    const nextEvent = data.events?.find((event) => {
      const start = new Date(event.start?.dateTime || event.start?.date);
      return start > now;
    });

    if (nextEvent) {
      res.json({
        event: {
          summary: nextEvent.summary,
          start: nextEvent.start?.dateTime || nextEvent.start?.date,
          end: nextEvent.end?.dateTime || nextEvent.end?.date,
          location: nextEvent.location,
        },
        account: account || null,
      });
    } else {
      res.json({ event: null, account: account || null });
    }
  } catch (err) {
    console.warn("Calendar unavailable:", err.message);
    res.json({
      event: null,
      unavailable: true,
      source: "gog",
      account: cachedGogCalendarAccount,
    });
  }
});

// Calendar endpoint - gets today's events from gog
app.get("/api/calendar/today", (req, res) => {
  console.log("Calendar today endpoint hit");
  try {
    const requestedAccount = getRequestedCalendarAccount(req);
    const { data, account } = runGogCalendarEvents(requestedAccount);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // Filter events for today
    const todayEvents = (data.events || [])
      .filter((event) => {
        const start = new Date(event.start?.dateTime || event.start?.date);
        return start >= todayStart && start < todayEnd;
      })
      .map((event, i) => ({
        id: String(i + 1),
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        location: event.location || "",
        description: event.description || "",
        attendees: event.attendees?.map((a) => a.displayName || a.email),
        hangoutLink: event.hangoutLink,
        conferenceData: event.conferenceData,
        htmlLink: event.htmlLink, // Direct link to view in Google Calendar
      }));

    res.json({ events: todayEvents, account: account || null });
  } catch (err) {
    console.warn("Calendar today unavailable:", err.message);
    res.json({
      events: [],
      unavailable: true,
      source: "gog",
      account: cachedGogCalendarAccount,
    });
  }
});

// Calendar endpoint - gets upcoming events (next 7 days)
app.get("/api/calendar/upcoming", (req, res) => {
  console.log("Calendar upcoming endpoint hit");
  try {
    const requestedAccount = getRequestedCalendarAccount(req);
    const { data, account } = runGogCalendarEvents(requestedAccount);
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Filter upcoming events (next 7 days)
    const upcomingEvents = (data.events || [])
      .filter((event) => {
        const start = new Date(event.start?.dateTime || event.start?.date);
        return start > now && start < weekFromNow;
      })
      .slice(0, 10) // Limit to 10 events
      .map((event, i) => ({
        id: String(i + 1),
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        location: event.location || "",
        description: event.description || "",
        attendees: event.attendees?.map((a) => a.displayName || a.email),
        hangoutLink: event.hangoutLink,
        conferenceData: event.conferenceData,
        htmlLink: event.htmlLink,
      }));

    res.json({ events: upcomingEvents, account: account || null });
  } catch (err) {
    console.warn("Calendar upcoming unavailable:", err.message);
    res.json({
      events: [],
      unavailable: true,
      source: "gog",
      account: cachedGogCalendarAccount,
    });
  }
});

function weatherIconFromDescription(desc) {
  const normalized = String(desc || "").toLowerCase();
  if (normalized.includes("rain") || normalized.includes("drizzle")) return "rain";
  if (normalized.includes("cloud") || normalized.includes("overcast")) return "cloud";
  if (normalized.includes("snow")) return "snow";
  if (normalized.includes("thunder") || normalized.includes("storm")) return "storm";
  return "sun";
}

function buildFallbackDetailedWeather() {
  const now = new Date();
  return {
    current: {
      temp: 72,
      feelsLike: 72,
      condition: "Clear",
      humidity: 50,
      wind: 5,
      icon: "sun",
    },
    hourly: Array.from({ length: 8 }, (_, i) => ({
      time: `${String(now.getHours() + i).padStart(2, "0")}:00`,
      temp: 72,
      condition: "Clear",
      icon: "sun",
    })),
    daily: Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now);
      date.setDate(now.getDate() + i);
      return {
        day: i === 0 ? "Today" : date.toLocaleDateString("en-US", { weekday: "short" }),
        high: 74,
        low: 66,
        condition: "Clear",
        icon: "sun",
      };
    }),
    cachedAt: Date.now(),
  };
}

function normalizeWttrTime(rawTime) {
  const value = Number.parseInt(String(rawTime || "0"), 10);
  const hours = Number.isFinite(value) ? Math.max(0, Math.floor(value / 100)) : 0;
  return `${String(hours).padStart(2, "0")}:00`;
}

function buildDetailedWeatherFromWttr(data) {
  const current = data?.current_condition?.[0] || {};
  const hourlyData = Array.isArray(data?.weather?.[0]?.hourly) ? data.weather[0].hourly : [];
  const dailyData = Array.isArray(data?.weather) ? data.weather : [];
  const now = new Date();
  const currentCondition = current.weatherDesc?.[0]?.value || "Clear";

  return {
    current: {
      temp: Number.parseInt(current.temp_F || "72", 10),
      feelsLike: Number.parseInt(current.FeelsLikeF || "72", 10),
      condition: currentCondition,
      humidity: Number.parseInt(current.humidity || "50", 10),
      wind: Number.parseInt(current.windspeedMiles || "5", 10),
      icon: weatherIconFromDescription(currentCondition),
    },
    hourly: hourlyData.slice(0, 8).map((h) => {
      const condition = h.weatherDesc?.[0]?.value || "Clear";
      return {
        time: normalizeWttrTime(h.time),
        temp: Number.parseInt(h.tempF || "72", 10),
        condition,
        icon: weatherIconFromDescription(condition),
      };
    }),
    daily: dailyData.slice(0, 7).map((d, i) => {
      const date = new Date(now);
      date.setDate(now.getDate() + i);
      const condition = d.hourly?.[4]?.weatherDesc?.[0]?.value || "Clear";
      return {
        day: i === 0 ? "Today" : date.toLocaleDateString("en-US", { weekday: "short" }),
        high: Number.parseInt(d.maxtempF || "74", 10),
        low: Number.parseInt(d.mintempF || "66", 10),
        condition,
        icon: weatherIconFromDescription(condition),
      };
    }),
    cachedAt: Date.now(),
  };
}

async function fetchWttrDetailedWeather(location = "Austin,TX") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ArgentOS-Dashboard/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`wttr.in returned ${response.status}`);
    }

    const data = await response.json();
    return buildDetailedWeatherFromWttr(data);
  } finally {
    clearTimeout(timeout);
  }
}

// Weather endpoint - compact current conditions
app.get("/api/weather", async (req, res) => {
  console.log("Weather endpoint hit");
  try {
    const detailed = await fetchWttrDetailedWeather("Austin,TX");
    res.json({
      temp: detailed.current.temp,
      condition: detailed.current.condition,
      icon: detailed.current.icon,
    });
  } catch (err) {
    console.warn("Weather unavailable:", err.message);
    const fallback = buildFallbackDetailedWeather();
    res.json({
      temp: fallback.current.temp,
      condition: fallback.current.condition,
      icon: fallback.current.icon,
      unavailable: true,
    });
  }
});

// Weather endpoint - full forecast used by dashboard modal
app.get("/api/weather/detailed", async (req, res) => {
  console.log("Weather detailed endpoint hit");
  try {
    const detailed = await fetchWttrDetailedWeather("Austin,TX");
    res.json(detailed);
  } catch (err) {
    console.warn("Weather detailed unavailable:", err.message);
    res.json({
      ...buildFallbackDetailedWeather(),
      unavailable: true,
    });
  }
});

// Precious metals ticker endpoint (proxied to avoid CORS)
// Used by SilverPriceWidget for live dashboard ticker
app.get("/api/metals/ticker", async (req, res) => {
  try {
    const response = await fetch("https://api.silverintel.report/api/prices/ticker");
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("SilverIntel ticker API error:", err.message);
    res.status(503).json({ error: "Unable to fetch ticker", message: err.message });
  }
});

// Precious metals prices endpoint
// Fetches COMEX + SGE from your SilverIntel Report API
app.get("/api/metals/prices", async (req, res) => {
  console.log("Metals prices endpoint hit");

  try {
    // Fetch COMEX spot prices from SilverIntel API
    const response = await fetch("https://api.silverintel.report/api/prices/spot");
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.silver || !data.gold) {
      throw new Error("Invalid response format");
    }

    const silverPrice = data.silver.price;
    const goldPrice = data.gold.price;
    const goldSilverRatio = (goldPrice / silverPrice).toFixed(2);

    // Try to get SGE data (optional - don't fail if unavailable)
    let sgePrice = null;
    let sgePremium = null;
    let sgeMarketStatus = null;

    try {
      const shanghaiResponse = await fetch("https://api.silverintel.report/api/prices/shanghai");
      if (shanghaiResponse.ok) {
        const shanghaiData = await shanghaiResponse.json();
        if (shanghaiData && shanghaiData.available) {
          sgePrice = shanghaiData.price_usd;
          sgePremium = shanghaiData.premium?.pct || null;
          sgeMarketStatus = shanghaiData.market_status;
        }
      }
    } catch (shanghaiErr) {
      console.warn("SGE data unavailable:", shanghaiErr.message);
    }

    res.json({
      silver: {
        spot: silverPrice,
        sge: sgePrice,
        change24h: data.silver.change || 0,
        changePercent: data.silver.changePct || 0,
        sgePremium: sgePremium,
      },
      gold: {
        spot: goldPrice,
        change24h: data.gold.change || 0,
        changePercent: data.gold.changePct || 0,
      },
      goldSilverRatio: parseFloat(goldSilverRatio),
      sgeMarketStatus: sgeMarketStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("SilverIntel API error:", err.message);
    res.status(503).json({
      error: "Unable to fetch prices",
      message: err.message,
    });
  }
});

// ============================================
// TTS Proxy — ElevenLabs & OpenAI
// ============================================

// ============================================
// CORS Proxy — generic allowlist-based proxy
// ============================================

const CORS_ALLOWLIST_PATH = path.join(process.env.HOME, ".argentos", "cors-allowlist.json");
const FILESYSTEM_ALLOWLIST_PATH = path.join(
  process.env.HOME,
  ".argentos",
  "filesystem-allowlist.json",
);
const FILESYSTEM_AUDIT_LOG_PATH = path.join(
  process.env.HOME,
  ".argentos",
  "security-audit-filesystem.jsonl",
);

/** Load the CORS allowlist from disk (or return empty default) */
function readCorsAllowlist() {
  try {
    if (fs.existsSync(CORS_ALLOWLIST_PATH)) {
      return JSON.parse(fs.readFileSync(CORS_ALLOWLIST_PATH, "utf-8"));
    }
  } catch (err) {
    console.error("[CorsProxy] Failed to read allowlist:", err.message);
  }
  return { domains: [] };
}

/** Write the CORS allowlist to disk */
function writeCorsAllowlist(data) {
  const dir = path.dirname(CORS_ALLOWLIST_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CORS_ALLOWLIST_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function normalizeFilesystemPath(inputPath) {
  const resolved = path.resolve(String(inputPath || "").trim());
  const root = path.parse(resolved).root;
  if (resolved === root) return resolved;
  return resolved.replace(/[\\/]+$/, "");
}

function isPathCoveredByAllowlist(targetPath, allowlistedPath) {
  const target = normalizeFilesystemPath(targetPath);
  const allow = normalizeFilesystemPath(allowlistedPath);
  if (process.platform === "win32") {
    const t = target.toLowerCase();
    const a = allow.toLowerCase();
    return t === a || t.startsWith(`${a}${path.sep}`);
  }
  return target === allow || target.startsWith(`${allow}${path.sep}`);
}

function readFilesystemAllowlist() {
  try {
    if (fs.existsSync(FILESYSTEM_ALLOWLIST_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(FILESYSTEM_ALLOWLIST_PATH, "utf-8"));
      const entriesRaw = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.entries)
          ? parsed.entries
          : [];
      const entries = entriesRaw
        .filter((entry) => entry && typeof entry.path === "string" && entry.path.trim().length > 0)
        .map((entry) => ({
          path: normalizeFilesystemPath(entry.path),
          addedAt:
            typeof entry.addedAt === "string" && entry.addedAt.length > 0
              ? entry.addedAt
              : new Date(0).toISOString(),
          addedBy: typeof entry.addedBy === "string" ? entry.addedBy : undefined,
          source: typeof entry.source === "string" ? entry.source : undefined,
          note: typeof entry.note === "string" ? entry.note : undefined,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
      return { entries };
    }
  } catch (err) {
    console.error("[FilesystemAllowlist] Failed to read allowlist:", err.message);
  }
  return { entries: [] };
}

function writeFilesystemAllowlist(data) {
  const dir = path.dirname(FILESYSTEM_ALLOWLIST_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const deduped = [];
  for (const entry of data.entries || []) {
    const covered = deduped.find((current) => isPathCoveredByAllowlist(entry.path, current.path));
    if (covered) continue;
    const next = deduped.filter((current) => !isPathCoveredByAllowlist(current.path, entry.path));
    next.push(entry);
    deduped.splice(0, deduped.length, ...next);
  }
  deduped.sort((a, b) => a.path.localeCompare(b.path));
  fs.writeFileSync(
    FILESYSTEM_ALLOWLIST_PATH,
    JSON.stringify({ entries: deduped }, null, 2),
    "utf-8",
  );
}

function getAuditActor(req) {
  const headerActor =
    req.headers["x-argent-actor-id"] ||
    req.headers["x-operator-id"] ||
    req.headers["x-user-id"] ||
    null;
  if (typeof headerActor === "string" && headerActor.trim().length > 0) {
    return headerActor.trim();
  }
  if (Array.isArray(headerActor) && headerActor.length > 0) {
    return String(headerActor[0]).trim();
  }
  return "dashboard-api";
}

function appendFilesystemAuditEvent(req, event) {
  try {
    const dir = path.dirname(FILESYSTEM_AUDIT_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    const eventActorId =
      event && typeof event.actorId === "string" && event.actorId.trim().length > 0
        ? event.actorId.trim()
        : getAuditActor(req);
    const payload = {
      eventId: crypto.randomUUID(),
      ts: now,
      actorId: eventActorId,
      actorType: "operator",
      sourceIp: req.ip || null,
      ...event,
    };
    fs.appendFileSync(FILESYSTEM_AUDIT_LOG_PATH, `${JSON.stringify(payload)}\n`, "utf-8");
  } catch (err) {
    console.error("[FilesystemAllowlist] Failed to append audit event:", err.message);
  }
}

/**
 * Validate a URL for the CORS proxy:
 * - Must be https (or http for localhost only)
 * - Block private/internal IPs to prevent SSRF (except localhost for dev)
 */
function validateProxyUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.toLowerCase();

    // Allow http only for localhost
    if (parsed.protocol === "http:") {
      if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
        return {
          ok: false,
          error: "HTTP only allowed for localhost. Use HTTPS for external URLs.",
        };
      }
      return { ok: true, parsed };
    }

    if (parsed.protocol !== "https:") {
      return { ok: false, error: "Only HTTPS URLs are allowed" };
    }

    // Block private/internal IPs (SSRF protection) — but allow localhost for dev
    if (
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host === "metadata.google.internal" ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^fc00:/.test(host) ||
      /^fe80:/.test(host)
    ) {
      return { ok: false, error: "Private/internal IPs are not allowed" };
    }

    return { ok: true, parsed };
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
}

// POST /api/proxy/cors — Generic CORS proxy for allowlisted domains
app.post("/api/proxy/cors", async (req, res) => {
  try {
    const { url, method = "GET", headers = {}, body = null } = req.body;

    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    // Validate URL format and SSRF protection
    const validation = validateProxyUrl(url);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    // Extract domain and check allowlist
    const domain = validation.parsed.hostname.toLowerCase();
    const allowlist = readCorsAllowlist();
    const isAllowed = allowlist.domains.some((entry) => entry.domain.toLowerCase() === domain);

    if (!isAllowed) {
      return res.status(403).json({
        error: "Domain not in CORS allowlist",
        domain,
      });
    }

    // Proxy the request server-side
    const fetchOptions = {
      method: method.toUpperCase(),
      headers: { ...headers },
    };

    // Only attach body for methods that support it
    if (body && !["GET", "HEAD"].includes(fetchOptions.method)) {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const upstream = await fetch(url, fetchOptions);

    // Forward the content-type from upstream
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const responseBody = await upstream.arrayBuffer();

    res
      .status(upstream.status)
      .set("Content-Type", contentType)
      .set("X-Proxied-Via", "argent-cors-proxy")
      .send(Buffer.from(responseBody));
  } catch (err) {
    console.error("[CorsProxy] Proxy error:", err.message);
    res.status(502).json({ error: "Proxy request failed", message: err.message });
  }
});

// POST /api/gateway/tools/invoke — Proxy tool invocations to the gateway (avoids CORS)
app.post("/api/gateway/tools/invoke", async (req, res) => {
  try {
    const config = readArgentConfig();
    const gwPort = config.gateway?.port || 18789;

    // Resolve gateway token: config → plist → launchctl env → process env
    let gwToken = config.gateway?.auth?.token || "";
    if (!gwToken) {
      try {
        const plistPath = path.join(os.homedir(), "Library/LaunchAgents/ai.argent.gateway.plist");
        if (fs.existsSync(plistPath)) {
          const plistRaw = fs.readFileSync(plistPath, "utf-8");
          const match = plistRaw.match(
            /<key>ARGENT_GATEWAY_TOKEN<\/key>\s*<string>([^<]+)<\/string>/,
          );
          if (match?.[1]) gwToken = match[1].trim();
        }
      } catch {}
    }
    if (!gwToken) {
      try {
        gwToken = require("child_process")
          .execSync("/bin/launchctl getenv ARGENT_GATEWAY_TOKEN 2>/dev/null || true", {
            timeout: 2000,
          })
          .toString()
          .trim();
      } catch {}
    }
    if (!gwToken) gwToken = process.env.ARGENT_GATEWAY_TOKEN || "";

    const headers = { "Content-Type": "application/json" };
    if (gwToken) headers["Authorization"] = `Bearer ${gwToken}`;
    const upstream = await fetch(`http://127.0.0.1:${gwPort}/tools/invoke`, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[GatewayProxy] tools/invoke error:", err.message);
    res.status(502).json({ error: "Gateway proxy failed", message: err.message });
  }
});

// GET /api/settings/cors-allowlist — List all allowlisted domains
app.get("/api/settings/cors-allowlist", (req, res) => {
  try {
    const data = readCorsAllowlist();
    res.json(data);
  } catch (err) {
    console.error("[CorsProxy] Error listing allowlist:", err);
    res.status(500).json({ error: "Failed to read CORS allowlist" });
  }
});

// POST /api/settings/cors-allowlist — Add a domain to the allowlist
app.post("/api/settings/cors-allowlist", (req, res) => {
  try {
    const { domain, note } = req.body;

    if (!domain || typeof domain !== "string") {
      return res.status(400).json({ error: "domain is required (string)" });
    }

    // Normalize: strip protocol/path, lowercase
    const normalized = domain
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .toLowerCase()
      .trim();
    if (!normalized) {
      return res.status(400).json({ error: "Invalid domain" });
    }

    const data = readCorsAllowlist();

    // Check for duplicates
    if (data.domains.some((d) => d.domain.toLowerCase() === normalized)) {
      return res.status(409).json({ error: "Domain already in allowlist", domain: normalized });
    }

    data.domains.push({
      domain: normalized,
      addedAt: new Date().toISOString(),
      note: note || "",
    });

    writeCorsAllowlist(data);
    console.log(`[CorsProxy] Added domain to allowlist: ${normalized}`);
    res.json(data);
  } catch (err) {
    console.error("[CorsProxy] Error adding domain:", err);
    res.status(500).json({ error: "Failed to add domain to allowlist" });
  }
});

// DELETE /api/settings/cors-allowlist/:domain — Remove a domain from the allowlist
app.delete("/api/settings/cors-allowlist/:domain", (req, res) => {
  try {
    const target = decodeURIComponent(req.params.domain).toLowerCase().trim();
    const data = readCorsAllowlist();
    const before = data.domains.length;
    data.domains = data.domains.filter((d) => d.domain.toLowerCase() !== target);

    if (data.domains.length === before) {
      return res.status(404).json({ error: "Domain not found in allowlist", domain: target });
    }

    writeCorsAllowlist(data);
    console.log(`[CorsProxy] Removed domain from allowlist: ${target}`);
    res.json({ ok: true, domain: target });
  } catch (err) {
    console.error("[CorsProxy] Error removing domain:", err);
    res.status(500).json({ error: "Failed to remove domain from allowlist" });
  }
});

// GET /api/settings/filesystem-allowlist — List managed filesystem allowlist entries
app.get("/api/settings/filesystem-allowlist", (req, res) => {
  try {
    const data = readFilesystemAllowlist();
    res.json(data);
  } catch (err) {
    console.error("[FilesystemAllowlist] Error listing allowlist:", err);
    res.status(500).json({ error: "Failed to read filesystem allowlist" });
  }
});

// POST /api/settings/filesystem-allowlist — Add a managed filesystem allowlist entry
app.post("/api/settings/filesystem-allowlist", (req, res) => {
  try {
    const { path: requestedPath, note, addedBy, source } = req.body || {};
    if (!requestedPath || typeof requestedPath !== "string") {
      return res.status(400).json({ error: "path is required (string)" });
    }

    const normalized = normalizeFilesystemPath(requestedPath);
    const data = readFilesystemAllowlist();
    const covered = data.entries.find((entry) => isPathCoveredByAllowlist(normalized, entry.path));
    if (covered) {
      return res.status(200).json({
        entries: data.entries,
        unchanged: true,
        coveredBy: covered.path,
      });
    }

    data.entries.push({
      path: normalized,
      addedAt: new Date().toISOString(),
      addedBy: typeof addedBy === "string" ? addedBy : getAuditActor(req),
      source: typeof source === "string" ? source : "security-ui",
      note: typeof note === "string" ? note : undefined,
    });

    writeFilesystemAllowlist(data);
    appendFilesystemAuditEvent(req, {
      eventType: "filesystem_permission_approved",
      decision: "allow-and-save",
      approvedPath: normalized,
      attemptedPath: requestedPath,
      reason: "security-ui-add",
    });
    res.json(readFilesystemAllowlist());
  } catch (err) {
    console.error("[FilesystemAllowlist] Error adding path:", err);
    res.status(500).json({ error: "Failed to add filesystem allowlist path" });
  }
});

// DELETE /api/settings/filesystem-allowlist/:path — Remove a managed filesystem allowlist entry
app.delete("/api/settings/filesystem-allowlist/:path", (req, res) => {
  try {
    const target = normalizeFilesystemPath(decodeURIComponent(req.params.path));
    const data = readFilesystemAllowlist();
    const before = data.entries.length;
    data.entries = data.entries.filter((entry) => normalizeFilesystemPath(entry.path) !== target);
    if (data.entries.length === before) {
      return res
        .status(404)
        .json({ error: "Path not found in filesystem allowlist", path: target });
    }
    writeFilesystemAllowlist(data);
    appendFilesystemAuditEvent(req, {
      eventType: "filesystem_allowlist_entry_removed",
      decision: "revoke",
      approvedPath: target,
      attemptedPath: target,
      reason: "security-ui-remove",
    });
    res.json({ ok: true, path: target });
  } catch (err) {
    console.error("[FilesystemAllowlist] Error removing path:", err);
    res.status(500).json({ error: "Failed to remove filesystem allowlist path" });
  }
});

// POST /api/security/filesystem-permissions/decision — Record approval flow decisions
app.post("/api/security/filesystem-permissions/decision", (req, res) => {
  try {
    const {
      decision,
      attemptedPath,
      approvedPath,
      reason,
      agentId,
      sessionId,
      toolName,
      actorId,
      note,
    } = req.body || {};
    const normalizedAttempted =
      typeof attemptedPath === "string" && attemptedPath.trim().length > 0
        ? normalizeFilesystemPath(attemptedPath)
        : undefined;
    const normalizedApproved =
      typeof approvedPath === "string" && approvedPath.trim().length > 0
        ? normalizeFilesystemPath(approvedPath)
        : normalizedAttempted;

    if (!["allow-once", "allow-and-save", "deny"].includes(decision)) {
      return res
        .status(400)
        .json({ error: 'decision must be "allow-once" | "allow-and-save" | "deny"' });
    }
    if (!normalizedAttempted) {
      return res.status(400).json({ error: "attemptedPath is required (string)" });
    }
    if (decision === "allow-and-save" && !normalizedApproved) {
      return res.status(400).json({ error: "approvedPath is required for allow-and-save" });
    }

    let saved = false;
    if (decision === "allow-and-save") {
      const data = readFilesystemAllowlist();
      const covered = data.entries.find((entry) =>
        isPathCoveredByAllowlist(normalizedApproved, entry.path),
      );
      if (!covered) {
        data.entries.push({
          path: normalizedApproved,
          addedAt: new Date().toISOString(),
          addedBy:
            typeof actorId === "string" && actorId.trim().length > 0 ? actorId : getAuditActor(req),
          source: "path-denial-approval",
          note: typeof note === "string" ? note : undefined,
        });
        writeFilesystemAllowlist(data);
        saved = true;
      }
    }

    appendFilesystemAuditEvent(req, {
      eventType:
        decision === "deny" ? "filesystem_permission_denied" : "filesystem_permission_approved",
      decision,
      attemptedPath: normalizedAttempted,
      approvedPath: normalizedApproved || null,
      reason: typeof reason === "string" && reason.trim().length > 0 ? reason : "permission-flow",
      actorId: typeof actorId === "string" && actorId.trim().length > 0 ? actorId : undefined,
      agentId: typeof agentId === "string" && agentId.trim().length > 0 ? agentId : undefined,
      sessionId:
        typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId : undefined,
      toolName: typeof toolName === "string" && toolName.trim().length > 0 ? toolName : undefined,
    });

    res.json({
      ok: true,
      decision,
      saved,
      attemptedPath: normalizedAttempted,
      approvedPath: normalizedApproved || null,
      entries: decision === "allow-and-save" ? readFilesystemAllowlist().entries : undefined,
    });
  } catch (err) {
    console.error("[FilesystemAllowlist] Error handling permission decision:", err);
    res.status(500).json({ error: "Failed to process filesystem permission decision" });
  }
});

// News endpoint - fetches from SilverIntel Report API
app.get("/api/news", async (req, res) => {
  console.log("News endpoint hit");
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const response = await fetch(
      `https://api.silverintel.report/api/news/?limit=${limit}&offset=${offset}`,
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const articles = await response.json();

    // Map to the format expected by the widget
    const mapped = articles.map((article) => ({
      title: article.title || "",
      summary: article.summary || article.content?.slice(0, 200) || "",
      source: article.source || "Silver Intel",
      published_at: article.published_at || new Date().toISOString(),
      category: article.category || "silver_price",
      sentiment: article.sentiment || "neutral",
      importance: article.importance || 3,
      tickers_mentioned: article.tickers_mentioned || article.tickers || [],
      image_url: article.image_url || null,
      slug: article.slug || article.url || "",
      url: article.url || "",
    }));

    res.json(mapped);
  } catch (err) {
    console.error("News API error:", err.message);
    // Return empty array on error
    res.json([]);
  }
});

// Cron jobs endpoint - serves cached cron job data
app.get("/api/cron/jobs", (req, res) => {
  console.log("Cron jobs endpoint hit");
  try {
    const fs = require("fs");
    const path = require("path");
    const cronFile = path.join(__dirname, "..", "memory", "cron-jobs.json");

    if (fs.existsSync(cronFile)) {
      const data = JSON.parse(fs.readFileSync(cronFile, "utf-8"));
      res.json(data);
    } else {
      res.json({ jobs: [] });
    }
  } catch (err) {
    console.error("Cron jobs error:", err.message);
    res.json({ jobs: [] });
  }
});

// ============================================
// TASK API - Backend task management (SQLite)
// ============================================

const STORAGE_CONFIG_PATH = path.join(process.env.HOME || "", ".argentos", "argent.json");

function readStorageBackend() {
  try {
    if (!fs.existsSync(STORAGE_CONFIG_PATH)) return "sqlite";
    const raw = JSON.parse(fs.readFileSync(STORAGE_CONFIG_PATH, "utf8"));
    const backend = String(raw?.storage?.backend || "sqlite").toLowerCase();
    if (backend === "postgres" || backend === "dual") return backend;
    return "sqlite";
  } catch {
    return "sqlite";
  }
}

const LEGACY_SQLITE_QUARANTINE = process.env.ARGENT_QUARANTINE_LEGACY_SQLITE !== "0";
const STORAGE_BACKEND = readStorageBackend();
const IS_PG_STORAGE_BACKEND = STORAGE_BACKEND === "postgres" || STORAGE_BACKEND === "dual";
const LEGACY_SQLITE_QUARANTINED = LEGACY_SQLITE_QUARANTINE && IS_PG_STORAGE_BACKEND;
const STORAGE_CONFIG = readStorageConfig();

function readStorageConfig() {
  try {
    if (!fs.existsSync(STORAGE_CONFIG_PATH)) {
      return { backend: "sqlite", postgresConnectionString: null };
    }
    const raw = JSON.parse(fs.readFileSync(STORAGE_CONFIG_PATH, "utf8"));
    const backend = String(raw?.storage?.backend || "sqlite").toLowerCase();
    const postgresConnectionString =
      typeof raw?.storage?.postgres?.connectionString === "string" &&
      raw.storage.postgres.connectionString.trim()
        ? raw.storage.postgres.connectionString.trim()
        : null;
    return { backend, postgresConnectionString };
  } catch {
    return { backend: "sqlite", postgresConnectionString: null };
  }
}

function resolvePgConnectionString() {
  const fromConfig = STORAGE_CONFIG.postgresConnectionString;
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.ARGENT_PG_URL || process.env.DATABASE_URL;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  return "postgres://localhost:5433/argentos";
}

let _postgresFactory = null;
let _pgSqlClient = null;
let _pgCompatSchemaPromise = null;
let _pgClientSetByTests = false;

async function ensurePgCompatSchema(sql) {
  // Minimal schema for dashboard API compatibility on fresh PG installs.
  // This keeps /api/tasks, /api/projects, and canvas-backed knowledge endpoints
  // from hard-failing when full migrations have not run yet.
  await sql`
    CREATE TABLE IF NOT EXISTS agents (
      id text PRIMARY KEY,
      name text NOT NULL DEFAULT '',
      role text NOT NULL DEFAULT 'generalist',
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS memory_items (
      id text PRIMARY KEY,
      agent_id text NOT NULL,
      memory_type text NOT NULL DEFAULT 'knowledge',
      summary text NOT NULL DEFAULT '',
      significance text NOT NULL DEFAULT 'noteworthy',
      extra jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    ALTER TABLE memory_items
      ADD COLUMN IF NOT EXISTS agent_id text,
      ADD COLUMN IF NOT EXISTS memory_type text,
      ADD COLUMN IF NOT EXISTS summary text,
      ADD COLUMN IF NOT EXISTS significance text,
      ADD COLUMN IF NOT EXISTS extra jsonb,
      ADD COLUMN IF NOT EXISTS created_at timestamptz,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY,
      title text NOT NULL,
      description text,
      status text NOT NULL DEFAULT 'pending',
      priority text NOT NULL DEFAULT 'normal',
      source text NOT NULL DEFAULT 'user',
      assignee text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz,
      due_at timestamptz,
      agent_id text,
      team_id text,
      parent_task_id text,
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `;

  await sql`
    ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS description text,
      ADD COLUMN IF NOT EXISTS status text,
      ADD COLUMN IF NOT EXISTS priority text,
      ADD COLUMN IF NOT EXISTS source text,
      ADD COLUMN IF NOT EXISTS assignee text,
      ADD COLUMN IF NOT EXISTS created_at timestamptz,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz,
      ADD COLUMN IF NOT EXISTS started_at timestamptz,
      ADD COLUMN IF NOT EXISTS completed_at timestamptz,
      ADD COLUMN IF NOT EXISTS due_at timestamptz,
      ADD COLUMN IF NOT EXISTS agent_id text,
      ADD COLUMN IF NOT EXISTS team_id text,
      ADD COLUMN IF NOT EXISTS parent_task_id text,
      ADD COLUMN IF NOT EXISTS tags jsonb,
      ADD COLUMN IF NOT EXISTS metadata jsonb
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks (parent_task_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memory_items_agent_memory_type ON memory_items (agent_id, memory_type)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS dashboard_apps (
      id text PRIMARY KEY,
      name text NOT NULL,
      description text,
      icon text,
      code text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      creator text NOT NULL DEFAULT 'ai',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_opened_at timestamptz,
      open_count integer NOT NULL DEFAULT 0,
      pinned boolean NOT NULL DEFAULT false,
      deleted_at timestamptz,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_dashboard_apps_updated
      ON dashboard_apps (pinned DESC, updated_at DESC)
      WHERE deleted_at IS NULL
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS dashboard_widgets (
      id text PRIMARY KEY,
      name text NOT NULL,
      description text,
      icon text NOT NULL DEFAULT '📦',
      code text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      creator text NOT NULL DEFAULT 'ai',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_updated
      ON dashboard_widgets (updated_at DESC)
      WHERE deleted_at IS NULL
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS dashboard_widget_slots (
      position integer PRIMARY KEY,
      widget_id text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    INSERT INTO agents (id, name, role, status)
    VALUES ('main', 'main', 'generalist', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

async function getPgSqlClient() {
  if (!IS_PG_STORAGE_BACKEND) return null;
  if (_pgSqlClient) return _pgSqlClient;
  if (!_postgresFactory) {
    _postgresFactory = await import("postgres")
      .then((mod) => mod.default || mod)
      .catch((err) => {
        console.error("[API] postgres module unavailable:", err?.message || err);
        throw err;
      });
  }
  const postgres = _postgresFactory;
  _pgSqlClient = postgres(resolvePgConnectionString(), {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  if (_pgClientSetByTests) {
    return _pgSqlClient;
  }
  if (!_pgCompatSchemaPromise) {
    _pgCompatSchemaPromise = ensurePgCompatSchema(_pgSqlClient).catch((err) => {
      _pgCompatSchemaPromise = null;
      throw err;
    });
  }
  await _pgCompatSchemaPromise;
  return _pgSqlClient;
}

function setPgSqlClientForTests(client) {
  _pgSqlClient = client || null;
  _pgClientSetByTests = Boolean(client);
  _pgCompatSchemaPromise = _pgClientSetByTests ? Promise.resolve() : null;
}

async function getPgDashboardCompatHooks() {
  const sql = await getPgSqlClient();
  const hooks = sql?.__dashboardCompat;
  if (!hooks || typeof hooks !== "object") return null;
  return hooks;
}

function isStorageUnavailableError(err) {
  const code = String(err?.code || "");
  const message = String(err?.message || "").toLowerCase();
  return (
    code === "ECONNREFUSED" ||
    code === "57P01" ||
    code === "UNAVAILABLE" ||
    message.includes("connect econnrefused") ||
    message.includes("connection refused") ||
    message.includes("not connected to gateway") ||
    message.includes("database system is starting up") ||
    message.includes("terminating connection") ||
    message.includes('relation "tasks" does not exist') ||
    message.includes('relation "memory_items" does not exist')
  );
}

function parseTaskMetadata(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseTaskTags(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry) => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
    } catch {
      // Ignore invalid JSON.
    }
  }
  return [];
}

function mapTaskStatusFromDb(status) {
  if (status === "in_progress") return "in-progress";
  return status || "pending";
}

function mapTaskStatusToDb(status) {
  if (status === "in-progress") return "in_progress";
  return status;
}

function taskFromPgRow(row) {
  if (!row) return null;
  const metadata = parseTaskMetadata(row.metadata);
  const tags = parseTaskTags(row.tags);
  const type = extractTaskType(metadata, row.parentTaskId || row.parent_task_id);
  return {
    id: row.id,
    title: row.title,
    details: row.description || undefined,
    status: mapTaskStatusFromDb(row.status),
    type,
    schedule:
      metadata.schedule && typeof metadata.schedule === "object" ? metadata.schedule : undefined,
    priority: row.priority || "normal",
    assignee: row.assignee || undefined,
    createdAt: safeIso(row.createdAt || row.created_at),
    startedAt: safeIso(row.startedAt || row.started_at),
    completedAt: safeIso(row.completedAt || row.completed_at),
    dueAt: safeIso(row.dueAt || row.due_at),
    tags: tags.length > 0 ? tags : undefined,
    source: row.source || "user",
    agentId: row.agentId || row.agent_id || undefined,
    teamId: row.teamId || row.team_id || undefined,
    parentTaskId: row.parentTaskId || row.parent_task_id || undefined,
    metadata,
  };
}

function toPgDateOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function computeNextScheduledRunEpoch(schedule, fromTime) {
  if (!schedule || typeof schedule !== "object") return null;
  const now = Number(fromTime || Date.now());

  if (schedule.frequency === "interval" && Number.isFinite(schedule.intervalMinutes)) {
    const minutes = Math.max(1, Number(schedule.intervalMinutes));
    return now + minutes * 60_000;
  }

  if (schedule.frequency === "weekly" && Array.isArray(schedule.days) && schedule.days.length > 0) {
    const [hoursRaw, minutesRaw] = String(schedule.time || "09:00")
      .split(":")
      .map((part) => Number(part));
    const hours = Number.isFinite(hoursRaw) ? hoursRaw : 9;
    const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 0;
    const base = new Date(now);
    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = new Date(base);
      candidate.setDate(candidate.getDate() + offset);
      candidate.setHours(hours, minutes, 0, 0);
      if (schedule.days.includes(candidate.getDay()) && candidate.getTime() > now) {
        return candidate.getTime();
      }
    }
    return null;
  }

  if (schedule.frequency === "daily") {
    const [hoursRaw, minutesRaw] = String(schedule.time || "09:00")
      .split(":")
      .map((part) => Number(part));
    const hours = Number.isFinite(hoursRaw) ? hoursRaw : 9;
    const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 0;
    const candidate = new Date(now);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() <= now) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  return null;
}

function createPgTasksCompatDb() {
  async function listRaw(options = {}) {
    const sql = await getPgSqlClient();
    if (!sql) return [];
    const where = [];
    const params = [];
    let idx = 1;

    if (!options.includeCompleted) {
      where.push(`status NOT IN ('completed','cancelled')`);
    }

    if (Object.prototype.hasOwnProperty.call(options, "assignee")) {
      if (options.assignee === null) {
        where.push("assignee IS NULL");
      } else {
        where.push(`assignee = $${idx}`);
        params.push(options.assignee);
        idx += 1;
      }
    }

    let query = `
      SELECT
        id,
        title,
        description,
        status,
        priority,
        source,
        assignee,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        due_at AS "dueAt",
        agent_id AS "agentId",
        team_id AS "teamId",
        parent_task_id AS "parentTaskId",
        tags,
        metadata
      FROM tasks
    `;
    if (where.length > 0) {
      query += ` WHERE ${where.join(" AND ")}`;
    }
    query += ` ORDER BY created_at DESC`;
    if (options.limit) {
      query += ` LIMIT $${idx}`;
      params.push(Number(options.limit));
    }
    return sql.unsafe(query, params);
  }

  async function getRaw(id) {
    const sql = await getPgSqlClient();
    if (!sql) return null;
    const rows = await sql`
      SELECT
        id,
        title,
        description,
        status,
        priority,
        source,
        assignee,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        due_at AS "dueAt",
        agent_id AS "agentId",
        team_id AS "teamId",
        parent_task_id AS "parentTaskId",
        tags,
        metadata
      FROM tasks
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  return {
    async listTasks(options = {}) {
      const rows = await listRaw(options);
      return rows.map(taskFromPgRow);
    },
    async getTask(id) {
      const row = await getRaw(id);
      return taskFromPgRow(row);
    },
    async createTask({
      title,
      details,
      type = "one-time",
      schedule,
      priority = "normal",
      assignee,
      source = "user",
      parentTaskId,
      dueAt,
      agentId,
      teamId,
      tags,
      metadata,
    }) {
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const id = crypto.randomUUID();
      const now = new Date();
      const mergedMeta = mergeTaskMetadata({}, { type, schedule, metadata });
      const created = await sql`
        INSERT INTO tasks (
          id, title, description, status, priority, source, assignee, created_at, updated_at,
          due_at, parent_task_id, agent_id, team_id, tags, metadata
        ) VALUES (
          ${id},
          ${title},
          ${details || null},
          ${"pending"},
          ${priority || "normal"},
          ${source || "user"},
          ${assignee || null},
          ${now},
          ${now},
          ${toPgDateOrNull(dueAt)},
          ${parentTaskId || null},
          ${agentId || null},
          ${teamId || null},
          ${Array.isArray(tags) ? tags : []},
          ${mergedMeta}
        )
        RETURNING
          id,
          title,
          description,
          status,
          priority,
          source,
          assignee,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          due_at AS "dueAt",
          agent_id AS "agentId",
          team_id AS "teamId",
          parent_task_id AS "parentTaskId",
          tags,
          metadata
      `;
      return taskFromPgRow(created[0] || null);
    },
    async updateTask(id, updates = {}) {
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const existing = await getRaw(id);
      if (!existing) return null;
      const existingMeta = parseTaskMetadata(existing.metadata);
      const nextMeta = mergeTaskMetadata(existingMeta, updates);
      const nextStatus = updates.status ? mapTaskStatusToDb(updates.status) : existing.status;
      const now = new Date();
      const startedAt =
        nextStatus === "in_progress" ? existing.startedAt || now : existing.startedAt || null;
      const completedAt =
        nextStatus === "completed" ? existing.completedAt || now : existing.completedAt || null;

      const updated = await sql`
        UPDATE tasks
        SET
          title = ${updates.title ?? existing.title},
          description = ${updates.details ?? existing.description},
          status = ${nextStatus},
          priority = ${updates.priority ?? existing.priority},
          assignee = ${
            Object.prototype.hasOwnProperty.call(updates, "assignee")
              ? updates.assignee || null
              : existing.assignee || null
          },
          due_at = ${
            Object.prototype.hasOwnProperty.call(updates, "dueAt")
              ? toPgDateOrNull(updates.dueAt)
              : existing.dueAt || null
          },
          started_at = ${startedAt},
          completed_at = ${completedAt},
          metadata = ${nextMeta},
          updated_at = ${now}
        WHERE id = ${id}
        RETURNING
          id,
          title,
          description,
          status,
          priority,
          source,
          assignee,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          due_at AS "dueAt",
          agent_id AS "agentId",
          team_id AS "teamId",
          parent_task_id AS "parentTaskId",
          tags,
          metadata
      `;
      return taskFromPgRow(updated[0] || null);
    },
    async deleteTask(id) {
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const out = await sql`DELETE FROM tasks WHERE id = ${id}`;
      return Number(out.count || 0) > 0;
    },
    async startTask(id) {
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const now = new Date();
      const updated = await sql`
        UPDATE tasks
        SET status = 'in_progress', started_at = COALESCE(started_at, ${now}), updated_at = ${now}
        WHERE id = ${id}
        RETURNING
          id,
          title,
          description,
          status,
          priority,
          source,
          assignee,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          due_at AS "dueAt",
          agent_id AS "agentId",
          team_id AS "teamId",
          parent_task_id AS "parentTaskId",
          tags,
          metadata
      `;
      return taskFromPgRow(updated[0] || null);
    },
    async completeTask(id) {
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const now = new Date();
      const updated = await sql`
        UPDATE tasks
        SET status = 'completed', completed_at = COALESCE(completed_at, ${now}), updated_at = ${now}
        WHERE id = ${id}
        RETURNING
          id,
          title,
          description,
          status,
          priority,
          source,
          assignee,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          due_at AS "dueAt",
          agent_id AS "agentId",
          team_id AS "teamId",
          parent_task_id AS "parentTaskId",
          tags,
          metadata
      `;
      return taskFromPgRow(updated[0] || null);
    },
    async searchTasks(query, limit = 20) {
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const q = `%${String(query || "")
        .trim()
        .toLowerCase()}%`;
      const rows = await sql`
        SELECT
          id,
          title,
          description,
          status,
          priority,
          source,
          assignee,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          due_at AS "dueAt",
          agent_id AS "agentId",
          team_id AS "teamId",
          parent_task_id AS "parentTaskId",
          tags,
          metadata
        FROM tasks
        WHERE
          lower(title) LIKE ${q}
          OR lower(COALESCE(description, '')) LIKE ${q}
          OR lower(COALESCE(tags::text, '')) LIKE ${q}
        ORDER BY created_at DESC
        LIMIT ${Math.max(1, Number(limit) || 20)}
      `;
      return rows.map(taskFromPgRow);
    },
    async getTaskCounts() {
      const rows = await this.listTasks({ limit: 5000 });
      const counts = {
        pending: 0,
        "in-progress": 0,
        completed: 0,
        blocked: 0,
        failed: 0,
        cancelled: 0,
      };
      for (const row of rows) {
        const status = row?.status || "pending";
        if (Object.prototype.hasOwnProperty.call(counts, status)) {
          counts[status] += 1;
        }
      }
      return counts;
    },
    async listProjects() {
      const rows = await this.listTasks({ limit: 5000, includeCompleted: true });
      const projects = rows.filter((task) => task?.type === "project");
      const childrenByParent = new Map();
      for (const row of rows) {
        if (!row?.parentTaskId) continue;
        if (!childrenByParent.has(row.parentTaskId)) childrenByParent.set(row.parentTaskId, []);
        childrenByParent.get(row.parentTaskId).push(row);
      }
      return projects
        .map((project) => {
          const children = childrenByParent.get(project.id) || [];
          const completedCount = children.filter((child) => child.status === "completed").length;
          return {
            ...project,
            taskCount: children.length,
            completedCount,
          };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    async getProjectTasks(projectId) {
      const rows = await this.listTasks({ limit: 5000, includeCompleted: true });
      return rows
        .filter((task) => task.parentTaskId === projectId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    },
    async getScheduledTasksDue() {
      const hooks = await getPgDashboardCompatHooks();
      const compatFn = hooks?.tasks?.getScheduledTasksDue;
      if (typeof compatFn === "function") {
        return (await compatFn()) || [];
      }
      const sql = await getPgSqlClient();
      if (!sql) return [];
      const now = Date.now();
      const rows = await sql`
        SELECT
          id,
          title,
          description,
          status,
          priority,
          source,
          assignee,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          due_at AS "dueAt",
          agent_id AS "agentId",
          team_id AS "teamId",
          parent_task_id AS "parentTaskId",
          tags,
          metadata
        FROM tasks
        WHERE
          status NOT IN ('completed', 'in_progress')
          AND COALESCE(metadata->>'type', '') IN ('scheduled', 'interval')
          AND COALESCE(metadata->'schedule'->>'nextRun', '') ~ '^[0-9]+$'
          AND (metadata->'schedule'->>'nextRun')::bigint <= ${now}
        ORDER BY (metadata->'schedule'->>'nextRun')::bigint ASC
        LIMIT 200
      `;
      return rows.map(taskFromPgRow);
    },
    async markScheduledTaskExecuted(id) {
      const hooks = await getPgDashboardCompatHooks();
      const compatFn = hooks?.tasks?.markScheduledTaskExecuted;
      if (typeof compatFn === "function") {
        return await compatFn(id);
      }
      const sql = await getPgSqlClient();
      if (!sql) return null;
      const row = await getRaw(id);
      const task = taskFromPgRow(row);
      if (!task || !task.schedule || typeof task.schedule !== "object") return null;
      const now = Date.now();
      const nextSchedule = {
        ...task.schedule,
        lastRun: now,
        nextRun: computeNextScheduledRunEpoch(task.schedule, now),
      };
      const metadata = {
        ...normalizeMetadata(task.metadata),
        type: task.type || extractTaskType(normalizeMetadata(task.metadata), task.parentTaskId),
        schedule: nextSchedule,
      };
      await sql`
        UPDATE tasks
        SET
          metadata = ${metadata},
          status = 'pending',
          updated_at = ${new Date(now)}
        WHERE id = ${id}
      `;
      const updated = await getRaw(id);
      return taskFromPgRow(updated);
    },
  };
}

let tasksDb = null;
if (LEGACY_SQLITE_QUARANTINED) {
  // Logged as info-level to avoid false "error" alerts during PG compatibility mode.
  console.log(
    `[API] Legacy dashboard SQLite modules are quarantined (backend=${STORAGE_BACKEND}, ARGENT_QUARANTINE_LEGACY_SQLITE=${process.env.ARGENT_QUARANTINE_LEGACY_SQLITE ?? "1"}).`,
  );
  tasksDb = createPgTasksCompatDb();
} else {
  tasksDb = require("./src/db/tasksDb.cjs");
  console.log("[API] Tasks database loaded from:", tasksDb.DB_PATH);
}

let _taskStorageAdapterPromise = null;

function shouldUseSharedTaskStore() {
  const backend = STORAGE_BACKEND;
  return backend === "postgres" || backend === "dual";
}

function getLegacyTasksDbOrThrow() {
  if (!tasksDb) {
    throw new Error(
      "Legacy tasks SQLite fallback is quarantined. Shared task storage must be available.",
    );
  }
  return tasksDb;
}

async function getTaskStorageAdapter() {
  // Dist entrypoint filenames are content-hashed in this build, so the old
  // static import path can fail at runtime. For dashboard API stability, use
  // direct PG compatibility methods when SQLite is quarantined.
  return null;
}

function safeIso(value) {
  if (value === null || value === undefined) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function toEpochMs(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.getTime();
}

function statusFromStorage(status) {
  if (status === "in_progress") return "in-progress";
  return status || "pending";
}

function statusToStorage(status) {
  if (status === "in-progress") return "in_progress";
  return status;
}

function normalizeMetadata(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function extractTaskType(meta, parentTaskId) {
  if (meta && typeof meta.type === "string" && meta.type.trim()) return meta.type.trim();
  if (parentTaskId) return "one-time";
  return "one-time";
}

function toDashboardTaskFromStorage(task) {
  if (!task) return null;
  const metadata = normalizeMetadata(task.metadata);
  return {
    id: task.id,
    title: task.title,
    details: task.description || undefined,
    status: statusFromStorage(task.status),
    type: extractTaskType(metadata, task.parentTaskId),
    schedule:
      metadata.schedule && typeof metadata.schedule === "object" ? metadata.schedule : undefined,
    priority: task.priority || "normal",
    assignee: task.assignee || undefined,
    createdAt: safeIso(task.createdAt),
    startedAt: safeIso(task.startedAt),
    completedAt: safeIso(task.completedAt),
    dueAt: safeIso(task.dueAt),
    tags: Array.isArray(task.tags) ? task.tags : undefined,
    source: task.source || "user",
    agentId: task.agentId || undefined,
    teamId: task.teamId || undefined,
    parentTaskId: task.parentTaskId || undefined,
    metadata,
  };
}

function mergeTaskMetadata(existing, updates) {
  const current = normalizeMetadata(existing);
  const next = { ...current };
  if (updates.type !== undefined) next.type = updates.type;
  if (updates.schedule !== undefined) next.schedule = updates.schedule;
  if (updates.metadata && typeof updates.metadata === "object") {
    Object.assign(next, updates.metadata);
  }
  return next;
}

function archivedAtFromMetadata(metadata) {
  const normalized = normalizeMetadata(metadata);
  const archivedAt = normalized.archivedAt;
  return typeof archivedAt === "string" && archivedAt.trim() ? archivedAt.trim() : undefined;
}

function isArchivedProjectTask(task) {
  if (!task || typeof task !== "object") return false;
  return Boolean(archivedAtFromMetadata(task.metadata));
}

function isProjectTask(task) {
  const metadata = normalizeMetadata(task.metadata);
  return extractTaskType(metadata, task.parentTaskId) === "project";
}

function isWorkerLaneTask(task) {
  if (!task || typeof task !== "object") return false;
  if (task.source === "job") return true;
  const metadata = normalizeMetadata(task.metadata);
  return Boolean(metadata.jobAssignmentId);
}

function filterOperatorLaneTasks(tasks, options = {}) {
  if (options.includeWorkerTasks) return tasks;
  return tasks.filter((task) => !isWorkerLaneTask(task));
}

async function listTasksCompat(options = {}) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) {
    return filterOperatorLaneTasks(await getLegacyTasksDbOrThrow().listTasks(options), options);
  }

  const rows = await adapter.tasks.list({ limit: options.limit || 500 });
  let filtered = filterOperatorLaneTasks(rows, options);
  if (!options.includeCompleted) {
    filtered = filtered.filter((task) => {
      const status = statusFromStorage(task.status);
      return status !== "completed" && status !== "cancelled";
    });
  }
  if (Object.prototype.hasOwnProperty.call(options, "assignee")) {
    if (options.assignee === null) {
      filtered = filtered.filter((task) => !task.assignee);
    } else {
      filtered = filtered.filter((task) => task.assignee === options.assignee);
    }
  }
  filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return filtered.map(toDashboardTaskFromStorage);
}

async function getTaskCompat(id) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) return getLegacyTasksDbOrThrow().getTask(id);
  const row = await adapter.tasks.get(id);
  return toDashboardTaskFromStorage(row);
}

async function createTaskCompat(input) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) return getLegacyTasksDbOrThrow().createTask(input);

  const metadata = mergeTaskMetadata(
    {},
    { type: input.type || "one-time", schedule: input.schedule, metadata: input.metadata },
  );
  const task = await adapter.tasks.create({
    title: input.title,
    description: input.details,
    priority: input.priority || "normal",
    source: input.source || "user",
    assignee: input.assignee || undefined,
    parentTaskId: input.parentTaskId || undefined,
    dueAt: toEpochMs(input.dueAt),
    agentId: input.agentId || undefined,
    teamId: input.teamId || undefined,
    metadata,
  });
  return toDashboardTaskFromStorage(task);
}

async function updateTaskCompat(id, updates) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) return getLegacyTasksDbOrThrow().updateTask(id, updates);

  const existing = await adapter.tasks.get(id);
  if (!existing) return null;
  const metadata = mergeTaskMetadata(existing.metadata, updates);
  const updated = await adapter.tasks.update(id, {
    title: updates.title,
    description: updates.details,
    status: updates.status ? statusToStorage(updates.status) : undefined,
    priority: updates.priority,
    assignee: updates.assignee,
    dueAt: updates.dueAt !== undefined ? toEpochMs(updates.dueAt) : undefined,
    metadata,
  });
  return toDashboardTaskFromStorage(updated);
}

async function deleteTaskCompat(id) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) return getLegacyTasksDbOrThrow().deleteTask(id);
  return adapter.tasks.delete(id);
}

async function startTaskCompat(id) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) return getLegacyTasksDbOrThrow().startTask(id);
  const task = await adapter.tasks.start(id);
  return toDashboardTaskFromStorage(task);
}

async function completeTaskCompat(id) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) return getLegacyTasksDbOrThrow().completeTask(id);
  const task = await adapter.tasks.complete(id);
  return toDashboardTaskFromStorage(task);
}

async function searchTasksCompat(query, limit = 20, options = {}) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) {
    return filterOperatorLaneTasks(
      getLegacyTasksDbOrThrow().searchTasks(query, limit),
      options,
    ).slice(0, limit);
  }

  const q = String(query || "").toLowerCase();
  const rows = filterOperatorLaneTasks(
    await adapter.tasks.list({ limit: Math.max(limit * 5, 200) }),
    options,
  );
  const filtered = rows.filter((task) => {
    const title = String(task.title || "").toLowerCase();
    const desc = String(task.description || "").toLowerCase();
    const tags = Array.isArray(task.tags) ? task.tags.join(" ").toLowerCase() : "";
    return title.includes(q) || desc.includes(q) || tags.includes(q);
  });
  filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return filtered.slice(0, limit).map(toDashboardTaskFromStorage);
}

async function getTaskCountsCompat(options = {}) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) {
    const tasks = filterOperatorLaneTasks(
      getLegacyTasksDbOrThrow().listTasks({ limit: 4000 }),
      options,
    );
    const counts = {
      pending: 0,
      "in-progress": 0,
      completed: 0,
      blocked: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const task of tasks) {
      const status = task?.status || "pending";
      if (Object.prototype.hasOwnProperty.call(counts, status)) {
        counts[status] += 1;
      }
    }
    return counts;
  }

  const rows = filterOperatorLaneTasks(await adapter.tasks.list({ limit: 4000 }), options);
  const counts = {
    pending: 0,
    "in-progress": 0,
    completed: 0,
    blocked: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    const status = statusFromStorage(row.status);
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  }
  return counts;
}

async function listProjectsCompat(options = {}) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) {
    const legacyProjects = filterOperatorLaneTasks(
      await getLegacyTasksDbOrThrow().listProjects(),
      options,
    );
    if (options.includeArchived) return legacyProjects;
    return legacyProjects.filter((project) => !isArchivedProjectTask(project));
  }

  const rows = filterOperatorLaneTasks(await adapter.tasks.list({ limit: 4000 }), options);
  const projects = rows.filter(isProjectTask);
  const childrenByParent = new Map();
  for (const row of rows) {
    if (!row.parentTaskId) continue;
    if (!childrenByParent.has(row.parentTaskId)) {
      childrenByParent.set(row.parentTaskId, []);
    }
    childrenByParent.get(row.parentTaskId).push(row);
  }
  const mapped = projects.map((project) => {
    const children = childrenByParent.get(project.id) || [];
    const completed = children.filter(
      (child) => statusFromStorage(child.status) === "completed",
    ).length;
    return {
      ...toDashboardTaskFromStorage(project),
      taskCount: children.length,
      completedCount: completed,
    };
  });
  const visible = options.includeArchived
    ? mapped
    : mapped.filter((project) => !isArchivedProjectTask(project));
  visible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return visible;
}

async function getProjectTasksCompat(projectId, options = {}) {
  const adapter = await getTaskStorageAdapter();
  if (!adapter) {
    return filterOperatorLaneTasks(
      await Promise.resolve(getLegacyTasksDbOrThrow().getProjectTasks(projectId)),
      options,
    );
  }
  const rows = filterOperatorLaneTasks(
    await adapter.tasks.list({ parentTaskId: projectId, limit: 2000 }),
    options,
  );
  rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return rows.map(toDashboardTaskFromStorage);
}

// SSE for real-time task updates
const tasksClients = new Set();

app.get("/api/tasks/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  tasksClients.add(res);

  req.on("close", () => {
    tasksClients.delete(res);
  });
});

function broadcastTasksEvent(event) {
  const data = JSON.stringify(event);
  for (const client of tasksClients) {
    client.write(`data: ${data}\n\n`);
  }
}

async function runSchedulerTick() {
  if (!tasksDb || typeof tasksDb.getScheduledTasksDue !== "function") {
    return { dueCount: 0 };
  }
  const dueTasks = await Promise.resolve(tasksDb.getScheduledTasksDue());
  const queue = Array.isArray(dueTasks) ? dueTasks : [];
  if (queue.length > 0) {
    console.log(`[Scheduler] Found ${queue.length} due task(s)`);
  }
  for (const task of queue) {
    console.log(`[Scheduler] Executing task: ${task.title} (${task.id})`);
    broadcastTasksEvent({ type: "task_execute", task });
    if (typeof tasksDb.markScheduledTaskExecuted === "function") {
      await Promise.resolve(tasksDb.markScheduledTaskExecuted(task.id));
    }
  }
  return { dueCount: queue.length };
}

// GET /api/tasks - List all tasks
app.get("/api/tasks", async (req, res) => {
  console.log("Tasks list endpoint hit");
  try {
    const options = {};
    if (req.query.includeWorkerTasks !== undefined) {
      options.includeWorkerTasks =
        String(req.query.includeWorkerTasks).toLowerCase() === "true" ||
        String(req.query.includeWorkerTasks) === "1";
    }
    if (req.query.assignee !== undefined) {
      options.assignee = req.query.assignee === "null" ? null : req.query.assignee;
    }
    const tasks = await listTasksCompat(options);
    res.json({ tasks });
  } catch (err) {
    console.error("Error listing tasks:", err);
    if (isStorageUnavailableError(err)) {
      return res.status(200).json({
        tasks: [],
        degraded: true,
        warning: "Task storage unavailable",
      });
    }
    res.status(500).json({ error: "Failed to list tasks" });
  }
});

// POST /api/tasks - Create a new task
app.post("/api/tasks", async (req, res) => {
  console.log("Tasks create endpoint hit:", req.body);
  const { title, details, type = "one-time", schedule, priority = "normal", assignee } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: "Title is required" });
  }

  try {
    const task = await createTaskCompat({
      title: title.trim(),
      details: details?.trim(),
      type,
      schedule,
      priority,
      assignee: assignee || undefined,
      source: "user",
    });
    broadcastTasksEvent({ type: "task_created", task: { id: task.id, title: task.title } });
    res.status(201).json({ task });
  } catch (err) {
    console.error("Error creating task:", err);
    res.status(500).json({ error: "Failed to save task" });
  }
});

// PATCH /api/tasks/:id - Update a task
app.patch("/api/tasks/:id", async (req, res) => {
  console.log("Tasks update endpoint hit:", req.params.id, req.body);
  const { id } = req.params;
  const updates = req.body;

  try {
    const task = await updateTaskCompat(id, {
      title: updates.title?.trim(),
      details: updates.details?.trim(),
      status: updates.status,
      type: updates.type,
      schedule: updates.schedule,
      priority: updates.priority,
      assignee: updates.assignee,
      dueAt: updates.dueAt,
      metadata: updates.metadata,
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    broadcastTasksEvent({ type: "task_updated", task: { id: task.id, title: task.title } });
    res.json({ task });
  } catch (err) {
    console.error("Error updating task:", err);
    res.status(500).json({ error: "Failed to update task" });
  }
});

// DELETE /api/tasks/:id - Delete a task
app.delete("/api/tasks/:id", async (req, res) => {
  console.log("Tasks delete endpoint hit:", req.params.id);
  const { id } = req.params;

  try {
    const deleted = await deleteTaskCompat(id);

    if (!deleted) {
      return res.status(404).json({ error: "Task not found" });
    }

    broadcastTasksEvent({ type: "task_deleted", taskId: id });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting task:", err);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// POST /api/tasks/:id/start - Start a task (set to in-progress)
app.post("/api/tasks/:id/start", async (req, res) => {
  console.log("Tasks start endpoint hit:", req.params.id);
  const { id } = req.params;

  try {
    const task = await startTaskCompat(id);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    broadcastTasksEvent({ type: "task_updated", task: { id: task.id, title: task.title } });
    res.json({ task });
  } catch (err) {
    console.error("Error starting task:", err);
    res.status(500).json({ error: "Failed to start task" });
  }
});

// POST /api/tasks/:id/complete - Complete a task
app.post("/api/tasks/:id/complete", async (req, res) => {
  console.log("Tasks complete endpoint hit:", req.params.id);
  const { id } = req.params;

  try {
    const task = await completeTaskCompat(id);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    broadcastTasksEvent({ type: "task_updated", task: { id: task.id, title: task.title } });
    res.json({ task });
  } catch (err) {
    console.error("Error completing task:", err);
    res.status(500).json({ error: "Failed to complete task" });
  }
});

// GET /api/tasks/search - Search tasks
app.get("/api/tasks/search", async (req, res) => {
  console.log("Tasks search endpoint hit:", req.query.q);
  const { q, limit = 20, includeWorkerTasks } = req.query;

  if (!q) {
    return res.status(400).json({ error: "Search query (q) is required" });
  }

  try {
    const tasks = await searchTasksCompat(q, parseInt(limit, 10), {
      includeWorkerTasks:
        String(includeWorkerTasks).toLowerCase() === "true" || String(includeWorkerTasks) === "1",
    });
    res.json({ tasks });
  } catch (err) {
    console.error("Error searching tasks:", err);
    res.status(500).json({ error: "Failed to search tasks" });
  }
});

// GET /api/tasks/counts - Get task counts by status
app.get("/api/tasks/counts", async (req, res) => {
  console.log("Tasks counts endpoint hit");
  try {
    const counts = await getTaskCountsCompat({
      includeWorkerTasks:
        String(req.query.includeWorkerTasks).toLowerCase() === "true" ||
        String(req.query.includeWorkerTasks) === "1",
    });
    res.json({ counts });
  } catch (err) {
    console.error("Error getting task counts:", err);
    res.status(500).json({ error: "Failed to get task counts" });
  }
});

// ============================================
// PROJECTS API - Project management (groups of tasks)
// ============================================

// GET /api/projects - List all projects with progress
app.get("/api/projects", async (req, res) => {
  console.log("Projects list endpoint hit");
  try {
    const projects = await listProjectsCompat({
      includeArchived:
        String(req.query.includeArchived).toLowerCase() === "true" ||
        String(req.query.includeArchived) === "1",
      includeWorkerTasks:
        String(req.query.includeWorkerTasks).toLowerCase() === "true" ||
        String(req.query.includeWorkerTasks) === "1",
    });
    res.json({ projects });
  } catch (err) {
    console.error("Error listing projects:", err);
    if (isStorageUnavailableError(err)) {
      return res.status(200).json({
        projects: [],
        degraded: true,
        warning: "Project storage unavailable",
      });
    }
    res.status(500).json({ error: "Failed to list projects" });
  }
});

// POST /api/projects/:id/archive - Archive or unarchive a project
app.post("/api/projects/:id/archive", async (req, res) => {
  console.log("Project archive endpoint hit:", req.params.id, req.body);
  const { id } = req.params;
  const archived = req.body?.archived !== false;

  try {
    const project = await getTaskCompat(id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    if (project.type !== "project") {
      return res.status(400).json({ error: "Task is not a project" });
    }

    const metadata = normalizeMetadata(project.metadata);
    if (archived) {
      metadata.archivedAt = new Date().toISOString();
    } else {
      metadata.archivedAt = null;
    }

    const updated = await updateTaskCompat(id, { metadata });
    if (!updated) {
      return res.status(500).json({ error: "Failed to update project archive state" });
    }

    broadcastTasksEvent({
      type: "task_updated",
      task: { id: updated.id, title: updated.title },
    });

    return res.json({ project: updated });
  } catch (err) {
    console.error("Error archiving project:", err);
    res.status(500).json({ error: "Failed to update project archive state" });
  }
});

// GET /api/projects/:id - Get project detail with child tasks
app.get("/api/projects/:id", async (req, res) => {
  console.log("Project detail endpoint hit:", req.params.id);
  const { id } = req.params;
  const includeWorkerTasks =
    String(req.query.includeWorkerTasks).toLowerCase() === "true" ||
    String(req.query.includeWorkerTasks) === "1";

  try {
    const project = await getTaskCompat(id);
    if (!project || (!includeWorkerTasks && isWorkerLaneTask(project))) {
      return res.status(404).json({ error: "Project not found" });
    }

    const childTasks = await getProjectTasksCompat(id, { includeWorkerTasks });
    const completedCount = childTasks.filter((t) => t.status === "completed").length;

    res.json({
      project: {
        ...project,
        taskCount: childTasks.length,
        completedCount,
      },
      tasks: childTasks,
    });
  } catch (err) {
    console.error("Error getting project:", err);
    res.status(500).json({ error: "Failed to get project" });
  }
});

// POST /api/projects/:id/tasks - Add a child task to an existing project
app.post("/api/projects/:id/tasks", async (req, res) => {
  console.log("Project add task endpoint hit:", req.params.id, req.body);
  const { id } = req.params;
  const { title, details, priority = "normal" } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ error: "Title is required" });
  }

  try {
    const project = await getTaskCompat(id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    if (project.type !== "project") {
      return res.status(400).json({ error: "Task is not a project" });
    }

    const task = await createTaskCompat({
      title: title.trim(),
      details: details?.trim(),
      priority,
      source: "user",
      parentTaskId: id,
    });

    broadcastTasksEvent({
      type: "task_created",
      task: { id: task.id, title: task.title, parentTaskId: id },
    });
    res.status(201).json({ task });
  } catch (err) {
    console.error("Error creating project task:", err);
    res.status(500).json({ error: "Failed to add project task" });
  }
});

// DELETE /api/projects/:id - Delete a project and all child tasks
app.delete("/api/projects/:id", async (req, res) => {
  console.log("Project delete endpoint hit:", req.params.id);
  const { id } = req.params;

  try {
    const project = await getTaskCompat(id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    if (project.type !== "project") {
      return res.status(400).json({ error: "Task is not a project" });
    }

    const childTasks = await getProjectTasksCompat(id);
    for (const child of childTasks) {
      await deleteTaskCompat(child.id);
      broadcastTasksEvent({ type: "task_deleted", taskId: child.id, parentTaskId: id });
    }

    const deletedProject = await deleteTaskCompat(id);
    if (!deletedProject) {
      return res.status(404).json({ error: "Project not found" });
    }

    broadcastTasksEvent({ type: "task_deleted", taskId: id });
    res.json({ success: true, deletedChildTasks: childTasks.length });
  } catch (err) {
    console.error("Error deleting project:", err);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// POST /api/projects - Create a project with child tasks
app.post("/api/projects", async (req, res) => {
  console.log("Projects create endpoint hit:", req.body);
  const { title, details, priority = "normal", tasks: childTasks = [] } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: "Title is required" });
  }

  try {
    // Create project task
    const project = await createTaskCompat({
      title: title.trim(),
      details: details?.trim(),
      type: "project",
      priority,
      source: "user",
    });

    // Create child tasks
    const created = [];
    for (const child of childTasks) {
      if (child.title?.trim()) {
        const task = await createTaskCompat({
          title: child.title.trim(),
          details: child.details?.trim(),
          priority: child.priority || priority,
          source: "user",
          parentTaskId: project.id,
        });
        created.push(task);
      }
    }

    res.status(201).json({
      project: {
        ...project,
        taskCount: created.length,
        completedCount: 0,
      },
      tasks: created,
    });
  } catch (err) {
    console.error("Error creating project:", err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

// ============================================
// MEMORY API - Read-only MemU memory inspector
// ============================================

function parseNumberOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseMemoryJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Ignore malformed JSON.
    }
  }
  return {};
}

function parseMemoryJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Ignore malformed JSON.
    }
  }
  return [];
}

const MEMORY_SOURCE_CASE_SQL = `
  CASE
    WHEN r.url LIKE 'heartbeat://%' THEN 'heartbeat'
    WHEN r.url LIKE 'cron://%' THEN 'cron'
    WHEN r.url LIKE 'session://%' THEN 'session'
    WHEN r.url LIKE 'kb://docpane/%' THEN 'docpane'
    WHEN r.url LIKE 'kb://%' THEN 'knowledge'
    WHEN r.url LIKE 'vault://%' THEN 'vault'
    WHEN r.url LIKE 'file://%' THEN 'file'
    WHEN r.url IS NULL THEN 'direct'
    ELSE 'other'
  END
`;

const MEMORY_CATEGORY_CANONICAL_RULES = [
  {
    pattern:
      /^(cron|cron job|cron jobs|schedule|scheduling|automated scheduling|automated cron job)$/i,
    canonical: "Automated Scheduling",
  },
  {
    pattern: /^(automation|automated operations)$/i,
    canonical: "Automated Operations",
  },
  {
    pattern: /^(monitoring|heartbeat|automated alerting|alerts?)$/i,
    canonical: "Monitoring",
  },
  { pattern: /^(atera integration)$/i, canonical: "Atera" },
  { pattern: /^(vip email)$/i, canonical: "VIP Email" },
  { pattern: /^20\d{2}$/, canonical: null },
];

function titleCaseMemoryWord(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeMemoryCategoryName(name) {
  const normalized = String(name || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) return null;
  for (const rule of MEMORY_CATEGORY_CANONICAL_RULES) {
    if (rule.pattern.test(normalized)) return rule.canonical;
  }
  if (/^[\d\W_]+$/.test(normalized)) return null;
  return titleCaseMemoryWord(normalized);
}

function normalizeMemoryAliasName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isCanonicalPersonAliasCandidate(name) {
  const trimmed = String(name || "").trim();
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(trimmed)) return false;
  if (!/^[A-Z][a-z'-]*$/.test(trimmed)) return false;
  const genericStopwords = new Set([
    "sender",
    "operator",
    "user",
    "admin",
    "name",
    "family",
    "mother",
    "father",
    "daughter",
    "son",
    "wife",
    "husband",
    "parent",
    "technician",
    "client",
    "customer",
  ]);
  return !genericStopwords.has(trimmed.toLowerCase());
}

function findCanonicalPersonAliasRecord(name, candidates) {
  const normalized = String(name || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!isCanonicalPersonAliasCandidate(normalized) || normalized.includes(" ")) {
    return null;
  }
  const folded = normalizeMemoryAliasName(normalized);
  const matches = candidates.filter((candidate) => {
    if (candidate.entity_type !== "person") return false;
    if (candidate.name.includes("(") || candidate.name.includes(")")) return false;
    if (!/^[A-Z][a-z'-]*(?:\s+[A-Z][a-z'-]*)+$/.test(String(candidate.name || "").trim())) {
      return false;
    }
    const candidateParts = candidate.name.trim().split(/\s+/);
    return (
      candidateParts.length >= 2 && normalizeMemoryAliasName(candidateParts[0] || "") === folded
    );
  });
  if (matches.length !== 1) return null;
  if (parseNumberOr(matches[0].memory_count, 0) < 5) return null;
  return matches[0];
}

function isEmptySisConsolidationContent(content) {
  return /\*\*Patterns found:\*\*\s*0\b/i.test(String(content || ""));
}

function buildSisConsolidationSignatureForInspector(content) {
  return String(content || "")
    .replace(/## SIS Consolidation \(\d{4}-\d{2}-\d{2}\)/g, "## SIS Consolidation (<date>)")
    .replace(/\*\*Episodes analyzed:\*\*\s*\d+/g, "**Episodes analyzed:** <n>")
    .replace(/Period:\s+[^\n]+/g, "Period: <normalized>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatMemoryDay(value) {
  return String(value || "").slice(0, 10);
}

const MEMORY_REPAIR_HISTORY_PATH = path.join(
  process.env.HOME || "",
  ".argentos",
  "memory-repair-history.json",
);

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readMemoryRepairHistory() {
  try {
    if (!fs.existsSync(MEMORY_REPAIR_HISTORY_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(MEMORY_REPAIR_HISTORY_PATH, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeMemoryRepairHistory(entries) {
  ensureParentDir(MEMORY_REPAIR_HISTORY_PATH);
  fs.writeFileSync(MEMORY_REPAIR_HISTORY_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

async function getMemoryStatsSnapshot(sql) {
  const [itemsRows, resourcesRows, categoriesRows, entitiesRows, reflectionsRows] =
    await Promise.all([
      sql`SELECT count(*)::bigint AS cnt FROM memory_items`,
      sql`SELECT count(*)::bigint AS cnt FROM resources`,
      sql`SELECT count(*)::bigint AS cnt FROM memory_categories`,
      sql`SELECT count(*)::bigint AS cnt FROM entities`,
      sql`SELECT count(*)::bigint AS cnt FROM reflections`,
    ]);
  return {
    items: parseNumberOr(itemsRows?.[0]?.cnt, 0),
    resources: parseNumberOr(resourcesRows?.[0]?.cnt, 0),
    categories: parseNumberOr(categoriesRows?.[0]?.cnt, 0),
    entities: parseNumberOr(entitiesRows?.[0]?.cnt, 0),
    reflections: parseNumberOr(reflectionsRows?.[0]?.cnt, 0),
  };
}

function chooseBetterEntityRecord(a, b) {
  const aCount = parseNumberOr(a?.memory_count, 0);
  const bCount = parseNumberOr(b?.memory_count, 0);
  if (aCount !== bCount) return aCount > bCount ? a : b;
  const aSummaryLen = String(a?.profile_summary || "").length;
  const bSummaryLen = String(b?.profile_summary || "").length;
  if (aSummaryLen !== bSummaryLen) return aSummaryLen > bSummaryLen ? a : b;
  return String(a?.created_at || "") <= String(b?.created_at || "") ? a : b;
}

function detectManualEntityReviewCandidates(entityRows) {
  const manual = [];
  const people = entityRows.filter((row) => row.entity_type === "person");
  const fullNamesByFirst = new Map();
  for (const row of people) {
    const name = String(row.name || "").trim();
    if (name.includes("(") || !name.includes(" ")) continue;
    const first = normalizeMemoryAliasName(name.split(/\s+/)[0] || "");
    if (!first) continue;
    const bucket = fullNamesByFirst.get(first) || [];
    bucket.push(row);
    fullNamesByFirst.set(first, bucket);
  }

  for (const row of people) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    if (name.includes("(") || name.includes(")")) {
      manual.push({
        type: "parenthetical",
        agentId: row.agent_id,
        sourceName: row.name,
        candidates: [],
      });
      continue;
    }
    if (name.includes(" ")) continue;
    const first = normalizeMemoryAliasName(name);
    const candidates = (fullNamesByFirst.get(first) || [])
      .filter((candidate) => candidate.id !== row.id)
      .map((candidate) => candidate.name);
    const uniqueCandidates = Array.from(new Set(candidates));
    if (uniqueCandidates.length > 1) {
      manual.push({
        type: "ambiguous_short_name",
        agentId: row.agent_id,
        sourceName: row.name,
        candidates: uniqueCandidates.slice(0, 5),
      });
    }
  }

  return manual.slice(0, 20);
}

async function getMemoryQualityReport(sql) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [sourceMixRows, fanoutRows, categoryRows, entityRows, reflectionRows] = await Promise.all([
    sql.unsafe(
      `
        SELECT ${MEMORY_SOURCE_CASE_SQL} AS source_kind, count(mi.id)::bigint AS item_count
        FROM memory_items mi
        LEFT JOIN resources r ON r.id = mi.resource_id
        WHERE mi.created_at >= $1
        GROUP BY 1
        ORDER BY count(mi.id) DESC
      `,
      [since],
    ),
    sql.unsafe(
      `
        SELECT ${MEMORY_SOURCE_CASE_SQL} AS source_kind,
               count(DISTINCT r.id)::bigint AS resource_count,
               count(mi.id)::bigint AS item_count
        FROM resources r
        LEFT JOIN memory_items mi ON mi.resource_id = r.id AND mi.created_at >= $1
        WHERE r.created_at >= $1 OR mi.id IS NOT NULL
        GROUP BY 1
        ORDER BY count(mi.id) DESC
      `,
      [since],
    ),
    sql`
      SELECT id, agent_id, name, summary, updated_at
      FROM memory_categories
      ORDER BY created_at ASC
    `,
    sql`
      SELECT id, agent_id, name, entity_type, relationship, profile_summary, emotional_texture,
             memory_count, first_mentioned_at, last_mentioned_at
      FROM entities
      WHERE entity_type = 'person'
      ORDER BY memory_count DESC, created_at ASC
    `,
    sql`
      SELECT id, trigger_type, content, created_at
      FROM reflections
      WHERE trigger_type = 'sis_consolidation'
      ORDER BY created_at DESC
    `,
  ]);

  const categoryPreview = [];
  const categoryGroups = new Map();
  let droppedCategoryCandidates = 0;
  for (const row of categoryRows) {
    const canonical = normalizeMemoryCategoryName(row.name);
    if (!canonical) {
      droppedCategoryCandidates += 1;
      continue;
    }
    const key = `${row.agent_id}::${canonical}`;
    if (!categoryGroups.has(key)) categoryGroups.set(key, []);
    categoryGroups.get(key).push(row);
  }
  let categoryRenameCandidates = 0;
  let categoryMergeCandidates = 0;
  for (const [key, rows] of categoryGroups.entries()) {
    const canonical = key.split("::").slice(1).join("::");
    const canonicalRow = rows.find((row) => row.name === canonical) || rows[0];
    const duplicates = rows.filter((row) => row.id !== canonicalRow.id);
    if (duplicates.length > 0) {
      categoryMergeCandidates += duplicates.length;
      categoryPreview.push({
        agentId: canonicalRow.agent_id,
        canonical,
        keeperName: canonicalRow.name,
        mergeNames: duplicates.map((row) => row.name),
      });
    } else if (canonicalRow.name !== canonical) {
      categoryRenameCandidates += 1;
      categoryPreview.push({
        agentId: canonicalRow.agent_id,
        canonical,
        keeperName: canonicalRow.name,
        mergeNames: [],
      });
    }
  }

  const entityPreview = [];
  const entityMergePlans = [];
  const exactDuplicatePreview = [];
  const exactDuplicatePlans = [];
  const entitiesByAgent = new Map();
  for (const row of entityRows) {
    const bucket = entitiesByAgent.get(row.agent_id) || [];
    bucket.push(row);
    entitiesByAgent.set(row.agent_id, bucket);
  }
  let entityMergeCandidates = 0;
  let exactDuplicateEntityCandidates = 0;
  for (const rows of entitiesByAgent.values()) {
    const exactGroups = new Map();
    for (const row of rows) {
      const normalized = normalizeMemoryAliasName(row.name);
      if (!normalized || !String(row.name || "").includes(" ")) continue;
      const key = `${row.entity_type}::${normalized}`;
      if (!exactGroups.has(key)) exactGroups.set(key, []);
      exactGroups.get(key).push(row);
    }
    for (const groupRows of exactGroups.values()) {
      if (groupRows.length <= 1) continue;
      let keeper = groupRows[0];
      for (const row of groupRows.slice(1)) {
        keeper = chooseBetterEntityRecord(keeper, row);
      }
      const duplicates = groupRows.filter((row) => row.id !== keeper.id);
      exactDuplicateEntityCandidates += duplicates.length;
      exactDuplicatePreview.push({
        agentId: keeper.agent_id,
        canonicalName: keeper.name,
        mergeNames: duplicates.map((row) => row.name),
      });
      for (const row of duplicates) {
        exactDuplicatePlans.push({ source: row, target: keeper });
      }
    }

    for (const row of rows) {
      const normalized = String(row.name || "")
        .trim()
        .replace(/\s+/g, " ");
      if (!normalized || normalized.includes(" ")) continue;
      const canonical = findCanonicalPersonAliasRecord(normalized, rows);
      if (!canonical || canonical.id === row.id) continue;
      entityMergeCandidates += 1;
      entityMergePlans.push({ source: row, target: canonical });
      entityPreview.push({
        sourceName: row.name,
        targetName: canonical.name,
        agentId: row.agent_id,
      });
    }
  }
  const manualEntityReview = detectManualEntityReviewCandidates(entityRows);

  let emptySisConsolidations = 0;
  let duplicateEmptySisCandidates = 0;
  const reflectionPreview = [];
  const reflectionGroups = new Map();
  for (const row of reflectionRows) {
    if (!isEmptySisConsolidationContent(row.content)) continue;
    emptySisConsolidations += 1;
    const key = `${formatMemoryDay(row.created_at)}::${buildSisConsolidationSignatureForInspector(row.content)}`;
    if (!reflectionGroups.has(key)) reflectionGroups.set(key, []);
    reflectionGroups.get(key).push(row);
  }
  for (const rows of reflectionGroups.values()) {
    if (rows.length <= 1) continue;
    duplicateEmptySisCandidates += rows.length - 1;
    reflectionPreview.push({
      createdDay: formatMemoryDay(rows[0]?.created_at),
      duplicateCount: rows.length - 1,
      sample: String(rows[0]?.content || "").slice(0, 120),
    });
  }

  const sourceMix = sourceMixRows.map((row) => ({
    sourceKind: row.source_kind || "other",
    itemCount: parseNumberOr(row.item_count, 0),
  }));

  const fanoutBySource = fanoutRows.map((row) => {
    const resourceCount = parseNumberOr(row.resource_count, 0);
    const itemCount = parseNumberOr(row.item_count, 0);
    return {
      sourceKind: row.source_kind || "other",
      resourceCount,
      itemCount,
      avgItemsPerResource: resourceCount > 0 ? Number((itemCount / resourceCount).toFixed(2)) : 0,
    };
  });

  return {
    semantics: {
      stats:
        "Raw stored PostgreSQL counts across memory_items, resources, categories, entities, and reflections.",
      entities:
        "Raw entity rows sorted by bond strength and memory count. Names are not automatically merged in the inspector view.",
      categories:
        "Raw stored categories plus linked item counts. Similar names may represent duplicate categories until repaired.",
      reflections:
        "Raw reflection rows. SIS consolidations are shown as stored, including older low-novelty entries already written before dedupe.",
      timeline:
        "Raw memory_items grouped by created_at day and memory_type only. Categories, entities, reflections, and resources are not included in the timeline counts.",
    },
    sourceMix,
    fanoutBySource,
    sis: {
      totalConsolidations: reflectionRows.length,
      emptyConsolidations: emptySisConsolidations,
      duplicateEmptyCandidates: duplicateEmptySisCandidates,
      preview: reflectionPreview.slice(0, 10),
    },
    repairPreview: {
      categoryRenameCandidates,
      categoryMergeCandidates,
      droppedCategoryCandidates,
      entityMergeCandidates,
      exactDuplicateEntityCandidates,
      duplicateEmptySisCandidates,
      categories: categoryPreview.slice(0, 12),
      entities: entityPreview.slice(0, 12),
      exactDuplicateEntities: exactDuplicatePreview.slice(0, 12),
      manualEntityReview,
      reflections: reflectionPreview.slice(0, 12),
      _entityMergePlans: entityMergePlans,
      _exactDuplicatePlans: exactDuplicatePlans,
      _categoryGroups: categoryGroups,
      _reflectionGroups: reflectionGroups,
    },
    repairHistory: readMemoryRepairHistory().slice(-10).reverse(),
  };
}

async function applyMemoryRepair(sql) {
  const quality = await getMemoryQualityReport(sql);
  const beforeStats = await getMemoryStatsSnapshot(sql);
  const result = {
    categoriesRenamed: 0,
    categoriesMerged: 0,
    entityMerges: 0,
    reflectionsPruned: 0,
  };

  await sql.begin(async (tx) => {
    for (const rows of quality.repairPreview._categoryGroups.values()) {
      const canonical = normalizeMemoryCategoryName(rows[0]?.name);
      if (!canonical) continue;
      let keeper = rows.find((row) => row.name === canonical) || rows[0];
      if (keeper.name !== canonical) {
        const conflict = rows.find((row) => row.id !== keeper.id && row.name === canonical);
        if (!conflict) {
          const [updated] = await tx.unsafe(
            `UPDATE memory_categories SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
            [canonical, keeper.id],
          );
          if (updated?.id) {
            result.categoriesRenamed += 1;
            keeper = { ...keeper, name: canonical };
          }
        }
      }

      for (const row of rows) {
        if (row.id === keeper.id) continue;
        await tx.unsafe(
          `
            INSERT INTO category_items (item_id, category_id)
            SELECT item_id, $1
            FROM category_items
            WHERE category_id = $2
            ON CONFLICT DO NOTHING
          `,
          [keeper.id, row.id],
        );
        await tx.unsafe(`DELETE FROM category_items WHERE category_id = $1`, [row.id]);
        await tx.unsafe(`DELETE FROM memory_categories WHERE id = $1`, [row.id]);
        result.categoriesMerged += 1;
      }
    }

    for (const plan of quality.repairPreview._exactDuplicatePlans) {
      const { source, target } = plan;
      await tx.unsafe(
        `
          INSERT INTO item_entities (item_id, entity_id, role)
          SELECT item_id, $1, role
          FROM item_entities
          WHERE entity_id = $2
          ON CONFLICT DO NOTHING
        `,
        [target.id, source.id],
      );
      const mergedProfile =
        (target.profile_summary || "").length >= (source.profile_summary || "").length
          ? target.profile_summary
          : source.profile_summary;
      await tx.unsafe(
        `
          UPDATE entities
          SET relationship = COALESCE(relationship, $1),
              emotional_texture = COALESCE(emotional_texture, $2),
              profile_summary = COALESCE($3, profile_summary),
              first_mentioned_at = LEAST(COALESCE(first_mentioned_at, $4), COALESCE($4, first_mentioned_at)),
              last_mentioned_at = GREATEST(COALESCE(last_mentioned_at, $5), COALESCE($5, last_mentioned_at)),
              memory_count = (SELECT count(*)::int FROM item_entities WHERE entity_id = $6),
              updated_at = NOW()
          WHERE id = $6
        `,
        [
          source.relationship ?? null,
          source.emotional_texture ?? null,
          mergedProfile ?? null,
          source.first_mentioned_at ?? null,
          source.last_mentioned_at ?? null,
          target.id,
        ],
      );
      await tx.unsafe(`DELETE FROM item_entities WHERE entity_id = $1`, [source.id]);
      await tx.unsafe(`DELETE FROM entities WHERE id = $1`, [source.id]);
      result.entityMerges += 1;
    }

    for (const plan of quality.repairPreview._entityMergePlans) {
      const { source, target } = plan;
      await tx.unsafe(
        `
          INSERT INTO item_entities (item_id, entity_id, role)
          SELECT item_id, $1, role
          FROM item_entities
          WHERE entity_id = $2
          ON CONFLICT DO NOTHING
        `,
        [target.id, source.id],
      );
      const mergedProfile =
        (target.profile_summary || "").length >= (source.profile_summary || "").length
          ? target.profile_summary
          : source.profile_summary;
      await tx.unsafe(
        `
          UPDATE entities
          SET relationship = COALESCE(relationship, $1),
              emotional_texture = COALESCE(emotional_texture, $2),
              profile_summary = COALESCE($3, profile_summary),
              first_mentioned_at = LEAST(COALESCE(first_mentioned_at, $4), COALESCE($4, first_mentioned_at)),
              last_mentioned_at = GREATEST(COALESCE(last_mentioned_at, $5), COALESCE($5, last_mentioned_at)),
              memory_count = (SELECT count(*)::int FROM item_entities WHERE entity_id = $6),
              updated_at = NOW()
          WHERE id = $6
        `,
        [
          source.relationship ?? null,
          source.emotional_texture ?? null,
          mergedProfile ?? null,
          source.first_mentioned_at ?? null,
          source.last_mentioned_at ?? null,
          target.id,
        ],
      );
      await tx.unsafe(`DELETE FROM item_entities WHERE entity_id = $1`, [source.id]);
      await tx.unsafe(`DELETE FROM entities WHERE id = $1`, [source.id]);
      await tx.unsafe(
        `
          UPDATE entities
          SET memory_count = (SELECT count(*)::int FROM item_entities WHERE entity_id = $1),
              updated_at = NOW()
          WHERE id = $1
        `,
        [target.id],
      );
      result.entityMerges += 1;
    }

    for (const rows of quality.repairPreview._reflectionGroups.values()) {
      if (rows.length <= 1) continue;
      const keep = rows[0]?.id;
      for (const row of rows) {
        if (row.id === keep) continue;
        await tx.unsafe(`DELETE FROM reflections WHERE id = $1`, [row.id]);
        result.reflectionsPruned += 1;
      }
    }
  });

  const afterStats = await getMemoryStatsSnapshot(sql);
  const historyEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    result,
    beforeStats,
    afterStats,
    preview: {
      categoryRenameCandidates: quality.repairPreview.categoryRenameCandidates,
      categoryMergeCandidates: quality.repairPreview.categoryMergeCandidates,
      droppedCategoryCandidates: quality.repairPreview.droppedCategoryCandidates,
      exactDuplicateEntityCandidates: quality.repairPreview.exactDuplicateEntityCandidates,
      entityMergeCandidates: quality.repairPreview.entityMergeCandidates,
      duplicateEmptySisCandidates: quality.repairPreview.duplicateEmptySisCandidates,
      manualEntityReviewCount: quality.repairPreview.manualEntityReview.length,
    },
  };
  const history = readMemoryRepairHistory();
  history.push(historyEntry);
  writeMemoryRepairHistory(history.slice(-25));

  return {
    ...result,
    historyEntry,
  };
}

function memoryItemFromPgRecord(record) {
  const extraObj = parseMemoryJsonObject(record?.extra);
  return {
    id: record?.id ?? "",
    resource_id: record?.resource_id ?? null,
    memory_type: record?.memory_type ?? "knowledge",
    summary: String(record?.summary ?? ""),
    happened_at: safeIso(record?.happened_at) ?? null,
    content_hash: record?.content_hash ?? null,
    reinforcement_count: parseNumberOr(record?.reinforcement_count, 1),
    last_reinforced_at: safeIso(record?.last_reinforced_at) ?? null,
    extra: JSON.stringify(extraObj),
    emotional_valence: parseNumberOr(record?.emotional_valence, 0),
    emotional_arousal: parseNumberOr(record?.emotional_arousal, 0),
    mood_at_capture: record?.mood_at_capture ?? null,
    significance: record?.significance ?? "routine",
    reflection: record?.reflection ?? null,
    lesson: record?.lesson ?? null,
    created_at: safeIso(record?.created_at) ?? null,
    updated_at: safeIso(record?.updated_at) ?? null,
  };
}

function entityFromPgRecord(record) {
  return {
    id: record?.id ?? "",
    name: String(record?.name ?? ""),
    entity_type: record?.entity_type ?? "person",
    relationship: record?.relationship ?? null,
    bond_strength: parseNumberOr(record?.bond_strength, 0),
    emotional_texture: record?.emotional_texture ?? null,
    profile_summary: record?.profile_summary ?? null,
    first_mentioned_at: safeIso(record?.first_mentioned_at) ?? null,
    last_mentioned_at: safeIso(record?.last_mentioned_at) ?? null,
    memory_count: parseNumberOr(record?.memory_count, 0),
    created_at: safeIso(record?.created_at) ?? null,
    updated_at: safeIso(record?.updated_at) ?? null,
  };
}

function categoryFromPgRecord(record, itemCount) {
  return {
    id: record?.id ?? "",
    name: String(record?.name ?? ""),
    description: record?.description ?? null,
    summary: record?.summary ?? null,
    item_count: itemCount,
    created_at: safeIso(record?.created_at) ?? null,
    updated_at: safeIso(record?.updated_at) ?? null,
  };
}

function reflectionFromPgRecord(record) {
  return {
    id: record?.id ?? "",
    trigger_type: record?.trigger_type ?? "manual",
    period_start: safeIso(record?.period_start) ?? null,
    period_end: safeIso(record?.period_end) ?? null,
    content: String(record?.content ?? ""),
    lessons_extracted: JSON.stringify(parseMemoryJsonArray(record?.lessons_extracted)),
    entities_involved: JSON.stringify(parseMemoryJsonArray(record?.entities_involved)),
    self_insights: JSON.stringify(parseMemoryJsonArray(record?.self_insights)),
    mood: record?.mood ?? null,
    created_at: safeIso(record?.created_at) ?? null,
  };
}

function createPgMemoryCompatDb() {
  const tableExistsCache = new Map();

  async function hasTable(sql, tableName) {
    if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName);
    const regName = `public.${tableName}`;
    const rows = await sql`SELECT to_regclass(${regName}) AS "regName"`;
    const exists = Boolean(rows?.[0]?.regName);
    tableExistsCache.set(tableName, exists);
    return exists;
  }

  async function countTableRows(sql, tableName) {
    if (!(await hasTable(sql, tableName))) return 0;
    const rows = await sql.unsafe(`SELECT count(*)::bigint AS cnt FROM ${tableName}`);
    return parseNumberOr(rows?.[0]?.cnt, 0);
  }

  async function selectItemRows(sql, query, params) {
    const rows = await sql.unsafe(query, params);
    return rows.map((row) => memoryItemFromPgRecord(row.row || {}));
  }

  return {
    async getStats() {
      const sql = await getPgSqlClient();
      if (!sql)
        throw Object.assign(new Error("Memory storage unavailable"), { code: "UNAVAILABLE" });

      const [items, resources, categories, entities, reflections] = await Promise.all([
        countTableRows(sql, "memory_items"),
        countTableRows(sql, "resources"),
        countTableRows(sql, "memory_categories"),
        countTableRows(sql, "entities"),
        countTableRows(sql, "reflections"),
      ]);

      const byType = {};
      const bySignificance = {};

      if (items > 0) {
        const typeRows = await sql`
          SELECT memory_type, count(*)::bigint AS cnt
          FROM memory_items
          GROUP BY memory_type
        `;
        for (const row of typeRows) {
          byType[row.memory_type || "unknown"] = parseNumberOr(row.cnt, 0);
        }

        const sigRows = await sql`
          SELECT significance, count(*)::bigint AS cnt
          FROM memory_items
          GROUP BY significance
        `;
        for (const row of sigRows) {
          bySignificance[row.significance || "routine"] = parseNumberOr(row.cnt, 0);
        }
      }

      return { items, resources, categories, entities, reflections, byType, bySignificance };
    },

    async searchItems(query, opts = {}) {
      const sql = await getPgSqlClient();
      if (!sql)
        throw Object.assign(new Error("Memory storage unavailable"), { code: "UNAVAILABLE" });

      const q = typeof query === "string" ? query.trim() : "";
      const { type, significance, entity, limit = 50, offset = 0, sort = "created_at_desc" } = opts;
      const where = ["1=1"];
      const params = [];
      let idx = 1;

      if (q) {
        where.push(
          `(summary ILIKE $${idx} OR COALESCE(extra::text, '') ILIKE $${idx} OR COALESCE(reflection, '') ILIKE $${idx} OR COALESCE(lesson, '') ILIKE $${idx})`,
        );
        params.push(`%${q}%`);
        idx += 1;
      }

      if (type) {
        where.push(`memory_type = $${idx}`);
        params.push(type);
        idx += 1;
      }

      if (significance) {
        where.push(`significance = $${idx}`);
        params.push(significance);
        idx += 1;
      }

      if (entity && (await hasTable(sql, "item_entities"))) {
        where.push(`id IN (SELECT item_id FROM item_entities WHERE entity_id = $${idx})`);
        params.push(entity);
        idx += 1;
      }

      const sortClauseMap = {
        created_at_desc: "created_at DESC",
        created_at_asc: "created_at ASC",
        reinforcement_desc:
          "COALESCE((to_jsonb(memory_items)->>'reinforcement_count')::int, 1) DESC, created_at DESC",
        significance_desc:
          "CASE COALESCE(significance, 'routine') WHEN 'core' THEN 4 WHEN 'important' THEN 3 WHEN 'noteworthy' THEN 2 ELSE 1 END DESC, created_at DESC",
      };
      const orderBy = sortClauseMap[sort] || sortClauseMap.created_at_desc;

      const countQuery = `
        SELECT count(*)::bigint AS cnt
        FROM memory_items
        WHERE ${where.join(" AND ")}
      `;
      const totalRows = await sql.unsafe(countQuery, params);
      const total = parseNumberOr(totalRows?.[0]?.cnt, 0);

      const selectQuery = `
        SELECT to_jsonb(memory_items) AS row
        FROM memory_items
        WHERE ${where.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT $${idx}
        OFFSET $${idx + 1}
      `;
      const itemParams = [
        ...params,
        Math.max(1, Number(limit) || 50),
        Math.max(0, Number(offset) || 0),
      ];
      const items = await selectItemRows(sql, selectQuery, itemParams);

      return { items, total };
    },

    async getItem(id) {
      const sql = await getPgSqlClient();
      if (!sql)
        throw Object.assign(new Error("Memory storage unavailable"), { code: "UNAVAILABLE" });

      const itemRows = await sql`
        SELECT to_jsonb(memory_items) AS row
        FROM memory_items
        WHERE id = ${id}
        LIMIT 1
      `;
      const record = itemRows?.[0]?.row;
      if (!record) return null;

      const categories = [];
      if ((await hasTable(sql, "memory_categories")) && (await hasTable(sql, "category_items"))) {
        const catRows = await sql`
          SELECT to_jsonb(mc) AS row
          FROM memory_categories mc
          JOIN category_items ci ON ci.category_id = mc.id
          WHERE ci.item_id = ${id}
          ORDER BY mc.name
        `;
        for (const row of catRows) {
          const category = row.row || {};
          categories.push({
            id: category.id ?? "",
            name: String(category.name ?? ""),
            description: category.description ?? null,
          });
        }
      }

      const entities = [];
      if ((await hasTable(sql, "entities")) && (await hasTable(sql, "item_entities"))) {
        const entityRows = await sql`
          SELECT to_jsonb(e) AS row, ie.role
          FROM entities e
          JOIN item_entities ie ON ie.entity_id = e.id
          WHERE ie.item_id = ${id}
          ORDER BY COALESCE((to_jsonb(e)->>'bond_strength')::float, 0) DESC
        `;
        for (const row of entityRows) {
          const entity = row.row || {};
          entities.push({
            id: entity.id ?? "",
            name: String(entity.name ?? ""),
            entity_type: entity.entity_type ?? "person",
            bond_strength: parseNumberOr(entity.bond_strength, 0),
            role: row.role || "mentioned",
          });
        }
      }

      return { ...memoryItemFromPgRecord(record), categories, entities };
    },

    async listEntities(opts = {}) {
      const sql = await getPgSqlClient();
      if (!sql)
        throw Object.assign(new Error("Memory storage unavailable"), { code: "UNAVAILABLE" });
      if (!(await hasTable(sql, "entities"))) return { entities: [], total: 0 };

      const { type, minBond, sort = "bond_desc", limit = 50, offset = 0 } = opts;
      const where = ["1=1"];
      const params = [];
      let idx = 1;

      if (type) {
        where.push(`entity_type = $${idx}`);
        params.push(type);
        idx += 1;
      }
      if (minBond !== undefined && minBond !== null && minBond !== "") {
        where.push(`COALESCE((to_jsonb(entities)->>'bond_strength')::float, 0) >= $${idx}`);
        params.push(parseNumberOr(minBond, 0));
        idx += 1;
      }

      const orderMap = {
        bond_desc:
          "COALESCE((to_jsonb(entities)->>'bond_strength')::float, 0) DESC, COALESCE((to_jsonb(entities)->>'memory_count')::int, 0) DESC",
        bond_asc: "COALESCE((to_jsonb(entities)->>'bond_strength')::float, 0) ASC",
        name_asc: "name ASC",
        memory_count_desc: "COALESCE((to_jsonb(entities)->>'memory_count')::int, 0) DESC",
        last_mentioned_desc: "last_mentioned_at DESC",
      };
      const orderBy = orderMap[sort] || orderMap.bond_desc;

      const totalRows = await sql.unsafe(
        `SELECT count(*)::bigint AS cnt FROM entities WHERE ${where.join(" AND ")}`,
        params,
      );
      const total = parseNumberOr(totalRows?.[0]?.cnt, 0);

      const query = `
        SELECT to_jsonb(entities) AS row
        FROM entities
        WHERE ${where.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT $${idx}
        OFFSET $${idx + 1}
      `;
      const rows = await sql.unsafe(query, [
        ...params,
        Math.max(1, Number(limit) || 50),
        Math.max(0, Number(offset) || 0),
      ]);
      const entities = rows.map((row) => entityFromPgRecord(row.row || {}));

      return { entities, total };
    },

    async getEntity(id) {
      const sql = await getPgSqlClient();
      if (!sql)
        throw Object.assign(new Error("Memory storage unavailable"), { code: "UNAVAILABLE" });
      if (!(await hasTable(sql, "entities"))) return null;

      const rows = await sql`
        SELECT to_jsonb(entities) AS row
        FROM entities
        WHERE id = ${id}
        LIMIT 1
      `;
      const record = rows?.[0]?.row;
      if (!record) return null;

      let recentItems = [];
      if ((await hasTable(sql, "item_entities")) && (await hasTable(sql, "memory_items"))) {
        const recentRows = await sql`
          SELECT to_jsonb(mi) AS row
          FROM memory_items mi
          JOIN item_entities ie ON ie.item_id = mi.id
          WHERE ie.entity_id = ${id}
          ORDER BY mi.created_at DESC
          LIMIT 10
        `;
        recentItems = recentRows.map((row) => memoryItemFromPgRecord(row.row || {}));
      }

      return { ...entityFromPgRecord(record), recentItems };
    },

    async listCategories(opts = {}) {
      const sql = await getPgSqlClient();
      if (!sql)
        throw Object.assign(new Error("Memory storage unavailable"), { code: "UNAVAILABLE" });
      if (!(await hasTable(sql, "memory_categories"))) return { categories: [], total: 0 };

      const { limit = 50, offset = 0 } = opts;
      const hasCategoryItems = await hasTable(sql, "category_items");
      const categoriesQuery = hasCategoryItems
        ? `
            SELECT to_jsonb(mc) AS row,
                   (SELECT count(*)::bigint FROM category_items ci WHERE ci.category_id = mc.id) AS item_count
            FROM memory_categories mc
            ORDER BY item_count DESC
            LIMIT $1 OFFSET $2
          `
        : `
            SELECT to_jsonb(mc) AS row, 0::bigint AS item_count
            FROM memory_categories mc
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
          `;
      const rows = await sql.unsafe(categoriesQuery, [
        Math.max(1, Number(limit) || 50),
        Math.max(0, Number(offset) || 0),
      ]);
      const categories = rows.map((row) =>
        categoryFromPgRecord(row.row || {}, parseNumberOr(row.item_count, 0)),
      );
      const totalRows = await sql`SELECT count(*)::bigint AS cnt FROM memory_categories`;
      const total = parseNumberOr(totalRows?.[0]?.cnt, 0);

      return { categories, total };
    },

    async getCategory(id) {
      const sql = await getPgSqlClient();
      if (!sql)
        throw Object.assign(new Error("Memory storage unavailable"), { code: "UNAVAILABLE" });
      if (!(await hasTable(sql, "memory_categories"))) return null;

      const rows = await sql`
        SELECT to_jsonb(memory_categories) AS row
        FROM memory_categories
        WHERE id = ${id}
        LIMIT 1
      `;
      const record = rows?.[0]?.row;
      if (!record) return null;

      let items = [];
      if ((await hasTable(sql, "category_items")) && (await hasTable(sql, "memory_items"))) {
        const itemRows = await sql`
          SELECT to_jsonb(mi) AS row
          FROM memory_items mi
          JOIN category_items ci ON ci.item_id = mi.id
          WHERE ci.category_id = ${id}
          ORDER BY mi.created_at DESC
          LIMIT 50
        `;
        items = itemRows.map((row) => memoryItemFromPgRecord(row.row || {}));
      }

      return { ...categoryFromPgRecord(record, items.length), items };
    },

    async listReflections(opts = {}) {
      const sql = await getPgSqlClient();
      if (!sql)
        throw Object.assign(new Error("Memory storage unavailable"), { code: "UNAVAILABLE" });
      if (!(await hasTable(sql, "reflections"))) return { reflections: [], total: 0 };

      const { trigger, limit = 50, offset = 0 } = opts;
      const where = ["1=1"];
      const params = [];
      let idx = 1;

      if (trigger) {
        where.push(`trigger_type = $${idx}`);
        params.push(trigger);
        idx += 1;
      }

      const totalRows = await sql.unsafe(
        `SELECT count(*)::bigint AS cnt FROM reflections WHERE ${where.join(" AND ")}`,
        params,
      );
      const total = parseNumberOr(totalRows?.[0]?.cnt, 0);

      const query = `
        SELECT to_jsonb(reflections) AS row
        FROM reflections
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${idx}
        OFFSET $${idx + 1}
      `;
      const rows = await sql.unsafe(query, [
        ...params,
        Math.max(1, Number(limit) || 50),
        Math.max(0, Number(offset) || 0),
      ]);
      const reflections = rows.map((row) => reflectionFromPgRecord(row.row || {}));

      return { reflections, total };
    },

    async getTimeline(days = 30) {
      const sql = await getPgSqlClient();
      if (!sql)
        throw Object.assign(new Error("Memory storage unavailable"), { code: "UNAVAILABLE" });

      const dayWindow = Math.max(1, Math.min(365, Number(days) || 30));
      const start = new Date(Date.now() - dayWindow * 24 * 60 * 60 * 1000);
      const rows = await sql`
        SELECT
          DATE(created_at)::text AS date,
          count(*)::bigint AS count,
          memory_type
        FROM memory_items
        WHERE created_at >= ${start}
        GROUP BY DATE(created_at), memory_type
        ORDER BY DATE(created_at) ASC
      `;

      const dateMap = {};
      for (const row of rows) {
        const date = row.date;
        if (!dateMap[date]) {
          dateMap[date] = { date, count: 0, byType: {} };
        }
        const count = parseNumberOr(row.count, 0);
        dateMap[date].count += count;
        dateMap[date].byType[row.memory_type || "unknown"] = count;
      }
      return Object.values(dateMap);
    },
  };
}

let memoryDb = null;
if (LEGACY_SQLITE_QUARANTINED) {
  memoryDb = createPgMemoryCompatDb();
  console.log("[MemoryDB] Using PostgreSQL compatibility mode for memory inspector.");
} else {
  try {
    memoryDb = require("./src/db/memoryDb.cjs");
    console.log("[MemoryDB] Module loaded — memory inspector available");
  } catch (err) {
    if (IS_PG_STORAGE_BACKEND) {
      memoryDb = createPgMemoryCompatDb();
      console.warn(
        "[MemoryDB] SQLite memory inspector unavailable; falling back to PostgreSQL compatibility mode:",
        err.message,
      );
    } else {
      console.warn("[MemoryDB] Memory database not available:", err.message);
    }
  }
}

// GET /api/memory/stats - Aggregated memory counts
app.get("/api/memory/stats", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    res.json(await memoryDb.getStats());
  } catch (err) {
    console.error("Error getting memory stats:", err);
    res.status(500).json({ error: "Failed to get memory stats" });
  }
});

// GET /api/memory/quality - Repair preview + source/fanout semantics
app.get("/api/memory/quality", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const sql = await getPgSqlClient();
    if (!sql) return res.status(503).json({ error: "Memory storage unavailable" });
    const quality = await getMemoryQualityReport(sql);
    delete quality.repairPreview._entityMergePlans;
    delete quality.repairPreview._exactDuplicatePlans;
    delete quality.repairPreview._categoryGroups;
    delete quality.repairPreview._reflectionGroups;
    res.json(quality);
  } catch (err) {
    console.error("Error getting memory quality report:", err);
    res.status(500).json({ error: "Failed to get memory quality report" });
  }
});

// POST /api/memory/repair/apply - Historical category/entity/reflection cleanup
app.post("/api/memory/repair/apply", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const sql = await getPgSqlClient();
    if (!sql) return res.status(503).json({ error: "Memory storage unavailable" });
    const result = await applyMemoryRepair(sql);
    res.json(result);
  } catch (err) {
    console.error("Error applying memory repair:", err);
    res.status(500).json({ error: "Failed to apply memory repair" });
  }
});

// GET /api/memory/repair/export - download repair history/export bundle
app.get("/api/memory/repair/export", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const sql = await getPgSqlClient();
    if (!sql) return res.status(503).json({ error: "Memory storage unavailable" });
    const quality = await getMemoryQualityReport(sql);
    delete quality.repairPreview._entityMergePlans;
    delete quality.repairPreview._exactDuplicatePlans;
    delete quality.repairPreview._categoryGroups;
    delete quality.repairPreview._reflectionGroups;
    const payload = {
      exportedAt: new Date().toISOString(),
      quality,
      history: readMemoryRepairHistory().slice(-25),
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="memory-repair-export-${formatMemoryDay(payload.exportedAt)}.json"`,
    );
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("Error exporting memory repair history:", err);
    res.status(500).json({ error: "Failed to export memory repair history" });
  }
});

// GET /api/memory/items - Search/list memory items
app.get("/api/memory/items", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const { q, type, significance, entity, limit, offset, sort } = req.query;
    const result = await memoryDb.searchItems(q || "", {
      type: type || undefined,
      significance: significance || undefined,
      entity: entity || undefined,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      sort: sort || "created_at_desc",
    });
    res.json(result);
  } catch (err) {
    console.error("Error searching memory items:", err);
    res.status(500).json({ error: "Failed to search memory items" });
  }
});

// GET /api/memory/items/:id - Get single memory item with categories and entities
app.get("/api/memory/items/:id", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const item = await memoryDb.getItem(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    res.json(item);
  } catch (err) {
    console.error("Error getting memory item:", err);
    res.status(500).json({ error: "Failed to get memory item" });
  }
});

// GET /api/memory/entities - List entities
app.get("/api/memory/entities", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const { type, minBond, sort, limit, offset } = req.query;
    const result = await memoryDb.listEntities({
      type: type || undefined,
      minBond: minBond !== undefined ? parseFloat(minBond) : undefined,
      sort: sort || "bond_desc",
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) {
    console.error("Error listing entities:", err);
    res.status(500).json({ error: "Failed to list entities" });
  }
});

// GET /api/memory/entities/:id - Get single entity with recent items
app.get("/api/memory/entities/:id", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const entity = await memoryDb.getEntity(req.params.id);
    if (!entity) return res.status(404).json({ error: "Entity not found" });
    res.json(entity);
  } catch (err) {
    console.error("Error getting entity:", err);
    res.status(500).json({ error: "Failed to get entity" });
  }
});

// GET /api/memory/categories - List categories with item counts
app.get("/api/memory/categories", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const { limit, offset } = req.query;
    const result = await memoryDb.listCategories({
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) {
    console.error("Error listing categories:", err);
    res.status(500).json({ error: "Failed to list categories" });
  }
});

// GET /api/memory/categories/:id - Get single category with items
app.get("/api/memory/categories/:id", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const category = await memoryDb.getCategory(req.params.id);
    if (!category) return res.status(404).json({ error: "Category not found" });
    res.json(category);
  } catch (err) {
    console.error("Error getting category:", err);
    res.status(500).json({ error: "Failed to get category" });
  }
});

// GET /api/memory/reflections - List reflections
app.get("/api/memory/reflections", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const { trigger, limit, offset } = req.query;
    const result = await memoryDb.listReflections({
      trigger: trigger || undefined,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) {
    console.error("Error listing reflections:", err);
    res.status(500).json({ error: "Failed to list reflections" });
  }
});

// GET /api/memory/timeline - Daily memory counts
app.get("/api/memory/timeline", async (req, res) => {
  if (!memoryDb) return res.status(503).json({ error: "Memory database not available" });
  try {
    const days = parseInt(req.query.days) || 30;
    res.json(await memoryDb.getTimeline(days));
  } catch (err) {
    console.error("Error getting memory timeline:", err);
    res.status(500).json({ error: "Failed to get memory timeline" });
  }
});

// Canvas document storage endpoints (PG knowledge-backed)

const KNOWLEDGE_TEXT_MIME_PREFIXES = ["text/"];
const KNOWLEDGE_TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/yaml",
  "application/csv",
  "application/sql",
]);
const KNOWLEDGE_DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const KNOWLEDGE_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function normalizeMimeType(value) {
  if (!value) return undefined;
  return String(value).split(";")[0].trim().toLowerCase() || undefined;
}

function isTextMime(mime) {
  if (!mime) return false;
  if (KNOWLEDGE_TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  return KNOWLEDGE_TEXT_MIME_EXACT.has(mime);
}

function isLikelyBase64(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length % 4 !== 0) return false;
  return !/[^A-Za-z0-9+/=]/.test(trimmed);
}

function stripDataUrlPrefix(value) {
  const trimmed = String(value ?? "").trim();
  const m = /^data:[^;]+;base64,(.*)$/i.exec(trimmed);
  return m ? m[1] : trimmed;
}

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function collapseWhitespacePreserveLines(text) {
  return String(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function extractDocxXmlText(xml) {
  const withMarkers = String(xml)
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  const withoutTags = withMarkers.replace(/<[^>]+>/g, "");
  return collapseWhitespacePreserveLines(decodeXmlEntities(withoutTags));
}

async function extractDocxText(buffer) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const parts = Object.keys(zip.files)
    .filter((name) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name))
    .sort();
  if (parts.length === 0) return "";
  const sections = [];
  for (const part of parts) {
    const file = zip.file(part);
    if (!file) continue;
    const xml = await file.async("string");
    const text = extractDocxXmlText(xml);
    if (text) sections.push(text);
  }
  return sections.join("\n\n");
}

function extractSharedStrings(xml) {
  const out = [];
  for (const match of String(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const block = match[1] || "";
    const withoutPhonetic = block.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
    const text = collapseWhitespacePreserveLines(
      decodeXmlEntities(withoutPhonetic.replace(/<[^>]+>/g, "")),
    );
    out.push(text);
  }
  return out;
}

function cellRefFromAttrs(attrs) {
  return String(attrs || "").match(/\br="([^"]+)"/)?.[1];
}

function cellTypeFromAttrs(attrs) {
  return String(attrs || "").match(/\bt="([^"]+)"/)?.[1];
}

function extractCellText(body, type, sharedStrings) {
  const bodyText = String(body || "");
  if (type === "inlineStr") {
    const inline = bodyText.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] || "";
    return collapseWhitespacePreserveLines(decodeXmlEntities(inline.replace(/<[^>]+>/g, "")));
  }
  const raw = bodyText.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || "";
  if (!raw) return "";
  if (type === "s") {
    const idx = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(idx) && idx >= 0 && idx < sharedStrings.length)
      return sharedStrings[idx] || "";
    return "";
  }
  if (type === "b") return raw.trim() === "1" ? "TRUE" : "FALSE";
  return decodeXmlEntities(raw.trim());
}

function extractWorksheetText(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of String(xml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowBody = rowMatch[1] || "";
    const cells = [];
    for (const cellMatch of rowBody.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] || "";
      const body = cellMatch[2] || "";
      const ref = cellRefFromAttrs(attrs);
      const type = cellTypeFromAttrs(attrs);
      const value = extractCellText(body, type, sharedStrings);
      if (!value) continue;
      cells.push(ref ? `${ref}:${value}` : value);
    }
    if (cells.length > 0) rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}

async function extractXlsxText(buffer) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsFile
    ? extractSharedStrings(await sharedStringsFile.async("string"))
    : [];
  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort();
  if (sheetFiles.length === 0) return "";
  const out = [];
  for (const sheetFile of sheetFiles) {
    const file = zip.file(sheetFile);
    if (!file) continue;
    const xml = await file.async("string");
    const text = extractWorksheetText(xml, sharedStrings);
    if (text) out.push(`[${path.basename(sheetFile)}]\n${text}`);
  }
  return out.join("\n\n");
}

async function extractPdfText(buffer, maxPages = 8) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
  }).promise;
  const pages = Math.min(doc.numPages, Math.max(1, maxPages));
  const parts = [];
  for (let pageNum = 1; pageNum <= pages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .filter(Boolean)
      .join(" ");
    if (pageText) parts.push(pageText);
  }
  return parts.join("\n\n");
}

async function extractIngestTextFromFile(file) {
  const fileName = String(file?.fileName || file?.name || "file");
  const providedMime =
    normalizeMimeType(file?.mimeType || file?.type) || "application/octet-stream";
  const rawContent = typeof file?.content === "string" ? file.content : "";
  if (!rawContent) {
    throw new Error(`empty content (${fileName})`);
  }

  if (!isLikelyBase64(stripDataUrlPrefix(rawContent)) && isTextMime(providedMime)) {
    return rawContent;
  }

  const payload = stripDataUrlPrefix(rawContent);
  if (!isLikelyBase64(payload)) {
    throw new Error(`invalid base64 payload (${fileName})`);
  }
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length === 0) {
    throw new Error(`empty decoded payload (${fileName})`);
  }

  if (providedMime === "application/pdf") {
    return extractPdfText(buffer, 8);
  }
  if (providedMime === KNOWLEDGE_DOCX_MIME) {
    return extractDocxText(buffer);
  }
  if (providedMime === KNOWLEDGE_XLSX_MIME) {
    return extractXlsxText(buffer);
  }
  if (isTextMime(providedMime)) {
    return buffer.toString("utf-8");
  }

  throw new Error(`unsupported mime for ingest (${providedMime})`);
}

function sanitizeTagValue(value, fallback = "unknown") {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function chunkTextForIngest(text, chunkSize, overlap) {
  const content = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!content) return [];
  const chunks = [];
  const size = Math.max(300, Math.min(12000, Number(chunkSize) || 1800));
  const ov = Math.max(0, Math.min(size - 1, Number(overlap) || 200));
  let start = 0;
  while (start < content.length) {
    const end = Math.min(content.length, start + size);
    chunks.push({ start, end, text: content.slice(start, end) });
    if (end >= content.length) break;
    start = Math.max(0, end - ov);
  }
  return chunks;
}

let _knowledgeGatewayHandlersPromise = null;
let _knowledgeGatewayLoadFailed = false;

async function loadKnowledgeGatewayHandlers() {
  if (_knowledgeGatewayLoadFailed) return null;
  if (!_knowledgeGatewayHandlersPromise) {
    _knowledgeGatewayHandlersPromise = import("../dist/gateway/server-methods/knowledge.js")
      .then((mod) => mod.knowledgeHandlers)
      .catch((err) => {
        console.error(
          "[Knowledge] Failed to load gateway knowledge handlers:",
          err?.message || err,
        );
        _knowledgeGatewayLoadFailed = true;
        _knowledgeGatewayHandlersPromise = null;
        return null;
      });
  }
  return _knowledgeGatewayHandlersPromise;
}

function knowledgeGatewayErrorStatus(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "INVALID_REQUEST" || code === "INVALID_PARAMS") return 400;
  if (code === "UNAVAILABLE" || code === "INTERNAL_ERROR") return 503;
  return 500;
}

function parseSessionAgentId(sessionKey) {
  const raw = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!raw) return "main";
  const match = raw.match(/agent:([^:]+)/i);
  if (match?.[1]) return match[1].trim();
  return "main";
}

function normalizeKnowledgeOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKnowledgeExtra(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Ignore malformed JSON.
    }
  }
  return {};
}

function parseKnowledgeCitation(summary, fallback) {
  const fallbackText = normalizeKnowledgeOptionalString(fallback);
  if (fallbackText) return fallbackText;
  const m = /^\s*\[\[citation:([^\]]+)\]\]/i.exec(String(summary || ""));
  return m?.[1]?.trim() || null;
}

function stripKnowledgeCitation(summary) {
  return String(summary || "")
    .replace(/^\s*\[\[citation:[^\]]+\]\]\s*/i, "")
    .trim();
}

function parseKnowledgeCollectionFilters(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function useGlobalKnowledgeScope(options) {
  if (!options || typeof options !== "object") return false;
  if (options.scope === "global" || options.includeAllAgents === true) return true;
  const collections = parseKnowledgeCollectionFilters(options.collection)
    .map((entry) => sanitizeTagValue(String(entry).toLowerCase(), ""))
    .filter(Boolean);
  return collections.includes("docpane");
}

function knowledgeCollectionFromExtra(extra) {
  return (
    normalizeKnowledgeOptionalString(extra?.collection) ||
    normalizeKnowledgeOptionalString(extra?.collectionTag)
  );
}

function normalizeKnowledgeDocumentTags(extra) {
  if (Array.isArray(extra?.docTags)) {
    return extra.docTags
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (Array.isArray(extra?.tags)) {
    return extra.tags
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function formatKnowledgeRowFromPg(row, includeFullText = false) {
  const extra = normalizeKnowledgeExtra(row.extra);
  const summary = String(row.summary || "");
  const stripped = stripKnowledgeCitation(summary);
  const sourceFile = normalizeKnowledgeOptionalString(extra.sourceFile) || null;
  const documentTitle = normalizeKnowledgeOptionalString(extra.docTitle) || null;
  const chunkIndex = Number.isFinite(Number(extra.chunkIndex)) ? Number(extra.chunkIndex) : null;
  const chunkTotal = Number.isFinite(Number(extra.chunkTotal)) ? Number(extra.chunkTotal) : null;
  const documentTags = normalizeKnowledgeDocumentTags(extra);
  const title =
    documentTitle ||
    (sourceFile && chunkIndex && chunkTotal
      ? `${sourceFile} (${chunkIndex}/${chunkTotal})`
      : sourceFile || `knowledge:${String(row.id || "").slice(0, 8)}`);
  return {
    id: row.id,
    title,
    type: row.memoryType || "knowledge",
    sourceType: extra.source === "knowledge_ingest" ? "ingested" : "memory",
    collection: knowledgeCollectionFromExtra(extra) || null,
    sourceFile,
    citation: parseKnowledgeCitation(summary, extra.citation),
    chunkIndex,
    chunkTotal,
    savedAt: safeIso(row.createdAt || row.created_at),
    excerpt: stripped.slice(0, 260),
    fullText: includeFullText ? stripped : undefined,
    documentId: normalizeKnowledgeOptionalString(extra.docId) || null,
    documentTitle,
    documentType: normalizeKnowledgeOptionalString(extra.docType) || null,
    documentLanguage: normalizeKnowledgeOptionalString(extra.docLanguage) || null,
    documentCreatedAt: normalizeKnowledgeOptionalString(extra.docCreatedAt) || null,
    documentTags,
    _summary: stripped,
    _sourceTag: normalizeKnowledgeOptionalString(extra.sourceTag).toLowerCase(),
  };
}

function knowledgeRowMatchesFilters(row, opts) {
  const ingestedOnly = opts.ingestedOnly !== false;
  if (ingestedOnly && row.sourceType !== "ingested") return false;

  const query = normalizeKnowledgeOptionalString(opts.q).toLowerCase();
  const sourceFileFilter = normalizeKnowledgeOptionalString(opts.sourceFile).toLowerCase();
  const collections = parseKnowledgeCollectionFilters(opts.collection).map((entry) =>
    normalizeKnowledgeOptionalString(entry).toLowerCase(),
  );
  const collectionTags = new Set(collections.map((entry) => sanitizeTagValue(entry, "")));
  const rowCollection = normalizeKnowledgeOptionalString(row.collection).toLowerCase();
  const rowCollectionTag = sanitizeTagValue(rowCollection, "");

  if (collections.length > 0) {
    if (!collections.includes(rowCollection) && !collectionTags.has(rowCollectionTag)) return false;
  }

  if (sourceFileFilter) {
    const src = normalizeKnowledgeOptionalString(row.sourceFile).toLowerCase();
    if (!src.includes(sourceFileFilter)) return false;
  }

  if (!query) return true;
  const haystacks = [
    normalizeKnowledgeOptionalString(row._summary).toLowerCase(),
    normalizeKnowledgeOptionalString(row.documentTitle).toLowerCase(),
    normalizeKnowledgeOptionalString(row.sourceFile).toLowerCase(),
    rowCollection,
    normalizeKnowledgeOptionalString(row.citation).toLowerCase(),
    row._sourceTag,
  ];
  return haystacks.some((text) => text.includes(query));
}

async function resolveKnowledgeAgentId(sql, sessionKey, createIfMissing = false) {
  const preferred = parseSessionAgentId(sessionKey);
  const existing = await sql`SELECT id FROM agents WHERE id = ${preferred} LIMIT 1`;
  if (existing[0]?.id) return existing[0].id;
  const first = await sql`SELECT id FROM agents ORDER BY created_at ASC LIMIT 1`;
  if (first[0]?.id) return first[0].id;
  if (createIfMissing) {
    await sql`
      INSERT INTO agents (id, name, role, status)
      VALUES (${preferred}, ${preferred}, ${"generalist"}, ${"active"})
      ON CONFLICT (id) DO NOTHING
    `;
    return preferred;
  }
  return preferred;
}

async function loadKnowledgeRowsFromPg(params = {}) {
  const sql = await getPgSqlClient();
  if (!sql) {
    throw Object.assign(new Error("Knowledge storage unavailable"), { code: "UNAVAILABLE" });
  }
  const options = params.options && typeof params.options === "object" ? params.options : {};
  const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
  const globalScope = useGlobalKnowledgeScope(options);
  const agentId = globalScope ? null : await resolveKnowledgeAgentId(sql, sessionKey, false);
  const limit = Math.max(1, Math.min(5000, Number(options.limit) || 500));
  const scanLimit = Math.max(limit * 3, 500);
  const sourceFileFilter = normalizeKnowledgeOptionalString(options.sourceFile);
  const queryFilter = normalizeKnowledgeOptionalString(options.q);
  const collectionFilters = parseKnowledgeCollectionFilters(options.collection)
    .map((entry) => normalizeKnowledgeOptionalString(entry).toLowerCase())
    .filter(Boolean);
  const collectionTagFilters = collectionFilters
    .map((entry) => sanitizeTagValue(entry, ""))
    .filter(Boolean);
  const where = ["memory_type = 'knowledge'"];
  const values = [];
  let idx = 1;
  if (agentId) {
    where.push(`agent_id = $${idx}`);
    values.push(agentId);
    idx += 1;
  }
  if (options.ingestedOnly !== false) {
    where.push(`COALESCE(extra->>'source', '') = 'knowledge_ingest'`);
  }
  if (sourceFileFilter) {
    where.push(`COALESCE(extra->>'sourceFile', '') ILIKE $${idx}`);
    values.push(`%${sourceFileFilter}%`);
    idx += 1;
  }
  if (collectionFilters.length > 0) {
    const rawParam = idx;
    values.push(collectionFilters);
    idx += 1;
    const tagParam = idx;
    values.push(collectionTagFilters);
    idx += 1;
    where.push(
      `(lower(COALESCE(extra->>'collection', '')) = ANY($${rawParam}::text[]) OR lower(COALESCE(extra->>'collectionTag', '')) = ANY($${tagParam}::text[]))`,
    );
  }
  if (queryFilter) {
    where.push(
      `(
        summary ILIKE $${idx}
        OR COALESCE(extra->>'docTitle', '') ILIKE $${idx}
        OR COALESCE(extra->>'sourceFile', '') ILIKE $${idx}
        OR COALESCE(extra->>'collection', '') ILIKE $${idx}
      )`,
    );
    values.push(`%${queryFilter}%`);
    idx += 1;
  }
  const query = `
    SELECT
      id,
      memory_type AS "memoryType",
      summary,
      created_at AS "createdAt",
      extra
    FROM memory_items
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT $${idx}
  `;
  values.push(scanLimit);
  const rows = await sql.unsafe(query, values);
  return rows
    .map((row) => formatKnowledgeRowFromPg(row, options.includeFullText === true))
    .filter((row) => knowledgeRowMatchesFilters(row, options));
}

async function invokeKnowledgeLocalMethod(method, params) {
  try {
    if (method === "knowledge.library.list") {
      const options = params?.options && typeof params.options === "object" ? params.options : {};
      const sort = options.sort === "title" || options.sort === "type" ? options.sort : "savedAt";
      const order = options.order === "asc" ? "asc" : "desc";
      const limit = Math.max(1, Math.min(2000, Number(options.limit) || 500));
      const rows = await loadKnowledgeRowsFromPg(params);
      rows.sort((a, b) => {
        let cmp = 0;
        if (sort === "title") cmp = String(a.title || "").localeCompare(String(b.title || ""));
        else if (sort === "type") cmp = String(a.type || "").localeCompare(String(b.type || ""));
        else cmp = new Date(a.savedAt || 0).getTime() - new Date(b.savedAt || 0).getTime();
        return order === "asc" ? cmp : -cmp;
      });
      const sliced = rows.slice(0, limit).map((row) => {
        const next = { ...row };
        delete next._summary;
        delete next._sourceTag;
        return next;
      });
      return {
        success: true,
        data: {
          success: true,
          aclEnforced: false,
          query: normalizeKnowledgeOptionalString(options.q).toLowerCase(),
          sort,
          order,
          total: rows.length,
          stats: {
            total: rows.length,
            ingested: rows.filter((row) => row.sourceType === "ingested").length,
            memory: rows.filter((row) => row.sourceType === "memory").length,
          },
          rows: sliced,
        },
      };
    }

    if (method === "knowledge.search") {
      const options = params?.options && typeof params.options === "object" ? params.options : {};
      const query = normalizeKnowledgeOptionalString(params?.query);
      if (!query) {
        return {
          success: false,
          error: { code: "INVALID_REQUEST", message: "query is required" },
        };
      }
      const limit = Math.max(1, Math.min(200, Number(options.limit) || 20));
      const rows = await loadKnowledgeRowsFromPg({
        ...params,
        options: {
          ...options,
          q: query,
          includeFullText: true,
          limit: Math.max(limit * 4, 80),
        },
      });
      const lowered = query.toLowerCase();
      const results = rows.slice(0, limit).map((row) => {
        const title = normalizeKnowledgeOptionalString(
          row.documentTitle || row.title,
        ).toLowerCase();
        const sourceFile = normalizeKnowledgeOptionalString(row.sourceFile).toLowerCase();
        const score = title.includes(lowered) ? 0.95 : sourceFile.includes(lowered) ? 0.8 : 0.65;
        return {
          id: row.id,
          score,
          summary: normalizeKnowledgeOptionalString(row._summary).slice(0, 600),
          type: row.type,
          citation: row.citation,
          collection: row.collection,
          sourceFile: row.sourceFile,
          chunkIndex: row.chunkIndex,
          chunkTotal: row.chunkTotal,
          documentId: row.documentId,
          documentTitle: row.documentTitle,
          documentType: row.documentType,
          documentLanguage: row.documentLanguage,
          documentCreatedAt: row.documentCreatedAt,
          documentTags: row.documentTags,
          categories: [],
          createdAt: row.savedAt,
        };
      });
      return {
        success: true,
        data: {
          success: true,
          query,
          count: results.length,
          totalMatched: rows.length,
          limit,
          includeShared: options.includeShared === true,
          ingestedOnly: options.ingestedOnly !== false,
          aclEnforced: false,
          results,
        },
      };
    }

    if (method === "knowledge.library.delete") {
      const sql = await getPgSqlClient();
      if (!sql) {
        return { success: false, error: { code: "UNAVAILABLE", message: "Knowledge unavailable" } };
      }
      const options = params?.options && typeof params.options === "object" ? params.options : {};
      const globalScope = useGlobalKnowledgeScope(options);
      const dryRun = options.dryRun === true;
      const limit = Math.max(1, Math.min(4000, Number(options.limit) || 500));
      const explicitIds = Array.isArray(options.ids)
        ? options.ids.map((entry) => normalizeKnowledgeOptionalString(entry)).filter(Boolean)
        : [];
      let selectedRows = [];
      if (explicitIds.length > 0) {
        const all = await loadKnowledgeRowsFromPg({
          ...params,
          options: {
            ...options,
            limit: Math.max(limit, explicitIds.length),
          },
        });
        const set = new Set(explicitIds);
        selectedRows = all.filter((row) => set.has(row.id));
      } else {
        selectedRows = await loadKnowledgeRowsFromPg({
          ...params,
          options: { ...options, limit: Math.max(limit * 2, 600) },
        });
      }
      const selected = selectedRows.slice(0, limit);
      if (dryRun) {
        return {
          success: true,
          data: {
            success: true,
            dryRun: true,
            matched: selectedRows.length,
            selected: selected.length,
            ids: selected.map((row) => row.id),
          },
        };
      }
      const ids = selected.map((row) => row.id);
      if (ids.length === 0) {
        return {
          success: true,
          data: { success: true, matched: selectedRows.length, deleted: 0, failed: [] },
        };
      }
      const out = globalScope
        ? await sql.unsafe(`DELETE FROM memory_items WHERE id = ANY($1::text[])`, [ids])
        : await (async () => {
            const agentId = await resolveKnowledgeAgentId(
              sql,
              typeof params?.sessionKey === "string" ? params.sessionKey : undefined,
              false,
            );
            return sql.unsafe(
              `DELETE FROM memory_items WHERE id = ANY($1::text[]) AND agent_id = $2`,
              [ids, agentId],
            );
          })();
      return {
        success: true,
        data: {
          success: true,
          matched: selectedRows.length,
          deleted: Number(out.count || 0),
          failed: [],
        },
      };
    }

    if (method === "knowledge.library.reindex") {
      const options = params?.options && typeof params.options === "object" ? params.options : {};
      const limit = Math.max(1, Math.min(4000, Number(options.limit) || 1000));
      const rows = await loadKnowledgeRowsFromPg({
        ...params,
        options: { ...options, ingestedOnly: true, limit },
      });
      const processed = Math.min(rows.length, limit);
      return {
        success: true,
        data: { success: true, processed, embedded: 0, skipped: processed, failed: [] },
      };
    }

    if (method === "knowledge.ingest") {
      const sql = await getPgSqlClient();
      if (!sql) {
        return { success: false, error: { code: "UNAVAILABLE", message: "Knowledge unavailable" } };
      }
      const files = Array.isArray(params?.files) ? params.files : [];
      const options = params?.options && typeof params.options === "object" ? params.options : {};
      if (files.length === 0) {
        return {
          success: false,
          error: { code: "INVALID_REQUEST", message: "files[] is required" },
        };
      }
      const sessionKey = typeof params?.sessionKey === "string" ? params.sessionKey : undefined;
      const agentId = await resolveKnowledgeAgentId(sql, sessionKey, true);
      const collection = sanitizeTagValue(options.collection || "default", "default");
      const collectionTag = sanitizeTagValue(collection, "default");
      const chunkSize = Math.max(300, Math.min(12000, Number(options.chunkSize) || 1800));
      const overlap = Math.max(0, Math.min(chunkSize - 1, Number(options.overlap) || 200));
      const itemExtra =
        options.itemExtra && typeof options.itemExtra === "object" ? options.itemExtra : {};

      let acceptedFiles = 0;
      let rejectedFiles = 0;
      let totalChunks = 0;
      const errors = [];
      const ingested = [];

      for (const file of files) {
        const fileName = String(file?.fileName || file?.name || "file");
        try {
          const extractedText = await extractIngestTextFromFile(file);
          const chunks = chunkTextForIngest(extractedText, chunkSize, overlap);
          if (chunks.length === 0) {
            rejectedFiles += 1;
            errors.push({ fileName, error: "no extractable text" });
            continue;
          }
          acceptedFiles += 1;
          const sourceTag = sanitizeTagValue(fileName, "file");
          for (let idx = 0; idx < chunks.length; idx += 1) {
            const chunk = chunks[idx];
            const chunkNum = idx + 1;
            const citation = `${fileName}#chunk-${chunkNum}`;
            const id = crypto.randomUUID();
            await sql`
              INSERT INTO memory_items (
                id, agent_id, memory_type, summary, significance, extra, created_at, updated_at
              ) VALUES (
                ${id},
                ${agentId},
                ${"knowledge"},
                ${`[[citation:${citation}]]\n${chunk.text}`},
                ${"noteworthy"},
                ${{
                  source: "knowledge_ingest",
                  collection,
                  collectionTag,
                  sourceFile: fileName,
                  sourceTag,
                  citation,
                  chunkIndex: chunkNum,
                  chunkTotal: chunks.length,
                  chunkStart: chunk.start,
                  chunkEnd: chunk.end,
                  ingestVersion: 1,
                  ingestedAt: new Date().toISOString(),
                  ...itemExtra,
                }},
                ${new Date()},
                ${new Date()}
              )
            `;
            ingested.push({
              id,
              fileName,
              chunk: chunkNum,
              total: chunks.length,
              citation,
            });
          }
          totalChunks += chunks.length;
        } catch (err) {
          rejectedFiles += 1;
          errors.push({
            fileName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        success: true,
        data: {
          success: true,
          collection,
          agentId,
          acceptedFiles,
          rejectedFiles,
          totalChunks,
          embeddedChunks: 0,
          ingested: ingested.slice(0, 500),
          errors,
        },
      };
    }

    return {
      success: false,
      error: { code: "INVALID_REQUEST", message: `knowledge method unavailable: ${method}` },
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: err?.code || "UNAVAILABLE",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function invokeKnowledgeGatewayMethod(method, params) {
  const forceLocalForGlobalScope =
    params?.options &&
    typeof params.options === "object" &&
    (params.options.scope === "global" || params.options.includeAllAgents === true);
  if (forceLocalForGlobalScope) {
    return invokeKnowledgeLocalMethod(method, params);
  }
  const handlers = await loadKnowledgeGatewayHandlers();
  const handler = handlers?.[method];
  if (typeof handler === "function") {
    let responded = false;
    let responsePayload = { success: false, data: undefined, error: undefined };
    await handler({
      params,
      respond: (success, data, error) => {
        responded = true;
        responsePayload = { success, data, error };
      },
    });
    if (responded) return responsePayload;
    return {
      success: false,
      error: { code: "UNAVAILABLE", message: `knowledge method did not respond: ${method}` },
    };
  }
  return invokeKnowledgeLocalMethod(method, params);
}

const CANVAS_KNOWLEDGE_COLLECTION = "docpane";
const CANVAS_DOC_SOURCE_PREFIX = "docpanel-";
const CANVAS_SUPPORTED_TYPES = new Set(["markdown", "code", "data", "html", "terminal", "debate"]);

function normalizeCanvasSessionKey(req) {
  if (typeof req.body?.sessionKey === "string" && req.body.sessionKey.trim()) {
    return req.body.sessionKey.trim();
  }
  if (typeof req.query?.sessionKey === "string" && req.query.sessionKey.trim()) {
    return req.query.sessionKey.trim();
  }
  const header = req.get("x-session-key");
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  return undefined;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeCanvasDocType(value) {
  const candidate = String(value || "markdown")
    .trim()
    .toLowerCase();
  return CANVAS_SUPPORTED_TYPES.has(candidate) ? candidate : "markdown";
}

function normalizeCanvasCollection(value) {
  return sanitizeTagValue(value || CANVAS_KNOWLEDGE_COLLECTION, CANVAS_KNOWLEDGE_COLLECTION);
}

function canvasSourceFileForId(docId) {
  const normalized = sanitizeTagValue(docId, "doc");
  return `${CANVAS_DOC_SOURCE_PREFIX}${normalized}.md`;
}

function canvasDocIdFromSourceFile(sourceFile) {
  const match = String(sourceFile || "")
    .trim()
    .match(/^docpanel-([a-z0-9._-]+)\.md$/i);
  return match?.[1] || "";
}

function canvasDocIdFromKnowledgeRow(row) {
  const explicit = typeof row?.documentId === "string" ? row.documentId.trim() : "";
  if (explicit) return explicit;
  const fromSource = canvasDocIdFromSourceFile(row?.sourceFile);
  if (fromSource) return fromSource;
  return typeof row?.id === "string" ? row.id.trim() : "";
}

function guessCanvasTitleFromSourceFile(sourceFile) {
  const source = String(sourceFile || "").trim();
  if (!source) return "Untitled";
  return source.replace(/^docpanel-/i, "").replace(/\.md$/i, "") || "Untitled";
}

function normalizeCanvasSavedAt(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function mergeCanvasChunkContent(rows) {
  const chunks = rows
    .map((row) => (typeof row?.fullText === "string" ? row.fullText : ""))
    .filter(Boolean);
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return chunks[0];

  let merged = chunks[0];
  for (let i = 1; i < chunks.length; i += 1) {
    const next = chunks[i];
    if (!next) continue;
    if (merged.endsWith(next)) continue;

    const maxOverlap = Math.min(merged.length, next.length, 4000);
    let overlap = 0;
    for (let size = maxOverlap; size >= 16; size -= 1) {
      if (merged.slice(-size) === next.slice(0, size)) {
        overlap = size;
        break;
      }
    }
    merged += next.slice(overlap);
  }
  return merged;
}

function buildCanvasDocumentFromRows(docId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const ordered = [...rows].sort((a, b) => {
    const ai = Number.isFinite(Number(a?.chunkIndex))
      ? Number(a.chunkIndex)
      : Number.MAX_SAFE_INTEGER;
    const bi = Number.isFinite(Number(b?.chunkIndex))
      ? Number(b.chunkIndex)
      : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
  const first = ordered[0] || {};
  const fullContent = mergeCanvasChunkContent(ordered);
  const latestSavedAtMs = ordered.reduce((maxMs, row) => {
    const ms = new Date(row?.savedAt || 0).getTime();
    return Number.isFinite(ms) && ms > maxMs ? ms : maxMs;
  }, 0);
  const savedAt = normalizeCanvasSavedAt(latestSavedAtMs > 0 ? latestSavedAtMs : first.savedAt);
  const createdRaw =
    typeof first.documentCreatedAt === "string" && first.documentCreatedAt.trim()
      ? first.documentCreatedAt
      : savedAt;
  const createdAt = normalizeCanvasSavedAt(createdRaw);

  return {
    id: docId,
    title:
      (typeof first.documentTitle === "string" && first.documentTitle.trim()) ||
      guessCanvasTitleFromSourceFile(first.sourceFile),
    content: fullContent,
    type: normalizeCanvasDocType(first.documentType || "markdown"),
    language:
      typeof first.documentLanguage === "string" && first.documentLanguage.trim()
        ? first.documentLanguage.trim()
        : undefined,
    tags: normalizeStringList(first.documentTags),
    createdAt,
    savedAt,
  };
}

function canvasListScanLimit(limit) {
  const requested = Math.max(1, Math.min(1000, Number(limit) || 500));
  // Distinct-by-document listing only needs enough rows to cover recent docs.
  // Keep this aggressively bounded so folder browser opens quickly on large knowledge sets.
  if (requested <= 150) {
    return Math.min(1600, Math.max(requested * 5, 500));
  }
  if (requested <= 500) {
    return Math.min(3000, Math.max(requested * 6, 900));
  }
  return Math.min(4500, Math.max(requested * 7, 1400));
}

async function loadCanvasDocumentRowsBySource({ sessionKey, collection, sourceFile }) {
  // Fast attempt first, wider fallback only when needed.
  const attempts = [1200, 3000, 6000];
  for (const scanLimit of attempts) {
    const listing = await invokeKnowledgeGatewayMethod("knowledge.library.list", {
      options: {
        scope: "global",
        collection,
        sourceFile,
        sourceFileExact: true,
        ingestedOnly: true,
        includeFullText: true,
        sort: "savedAt",
        order: "asc",
        limit: 2000,
        scanLimit,
      },
      sessionKey,
    });
    if (!listing.success) return listing;
    const rows = Array.isArray(listing.data?.rows) ? listing.data.rows : [];
    if (rows.length > 0) {
      return { success: true, data: { rows } };
    }
  }
  return { success: true, data: { rows: [] } };
}

function knowledgeErrorResponse(res, result, fallbackError) {
  const status = knowledgeGatewayErrorStatus(result?.error);
  return res.status(status).json({
    error: result?.error?.message || fallbackError,
    code: result?.error?.code || "UNAVAILABLE",
    details: result?.error?.details,
  });
}

// POST /api/canvas/save - Save a canvas document to PG-backed knowledge
app.post("/api/canvas/save", async (req, res) => {
  const doc = req.body?.doc && typeof req.body.doc === "object" ? req.body.doc : null;
  if (!doc || typeof doc.id !== "string" || !doc.id.trim()) {
    return res.status(400).json({ error: "Document with id is required" });
  }

  try {
    const sessionKey = normalizeCanvasSessionKey(req);
    const docId = doc.id.trim();
    const type = normalizeCanvasDocType(doc.type);
    const title = typeof doc.title === "string" && doc.title.trim() ? doc.title.trim() : "Untitled";
    const content = typeof doc.content === "string" ? doc.content : String(doc.content || "");
    const language =
      typeof doc.language === "string" && doc.language.trim() ? doc.language.trim() : undefined;
    const autoRouted = doc.autoRouted === true;
    const collection = normalizeCanvasCollection(doc.knowledgeCollection);
    const sourceFile = canvasSourceFileForId(docId);
    const saveToKnowledge = doc.saveToKnowledge !== false;
    const tags = normalizeStringList(doc.tags);
    if (tags.length === 0) {
      tags.push(type);
      if (language) tags.push(language);
    }
    if (!saveToKnowledge) {
      return res.status(400).json({
        error: "DocPanel is PG knowledge-backed; saveToKnowledge=false is not supported",
      });
    }

    const deleteResult = await invokeKnowledgeGatewayMethod("knowledge.library.delete", {
      options: {
        scope: "global",
        collection,
        sourceFile,
        limit: 4000,
        ingestedOnly: true,
      },
      sessionKey,
    });
    if (!deleteResult.success) {
      return knowledgeErrorResponse(res, deleteResult, "Failed to replace document");
    }

    const ingestResult = await invokeKnowledgeGatewayMethod("knowledge.ingest", {
      files: [{ fileName: sourceFile, mimeType: "text/plain", content }],
      options: {
        collection,
        chunkSize: 12000,
        overlap: 300,
        itemExtra: {
          docId,
          docTitle: title,
          docType: type,
          docLanguage: language,
          docTags: tags,
          docCreatedAt:
            typeof doc.createdAt === "string" || typeof doc.createdAt === "number"
              ? String(doc.createdAt)
              : new Date().toISOString(),
          docUpdatedAt: new Date().toISOString(),
          docAutoRouted: autoRouted === true,
        },
      },
      sessionKey,
    });
    if (!ingestResult.success) {
      return knowledgeErrorResponse(res, ingestResult, "Failed to save document");
    }

    broadcastCanvasEvent({
      type: "document_saved",
      action: "push",
      document: {
        id: docId,
        title,
        content,
        type,
        language,
        tags,
        autoRouted,
      },
    });

    return res.json({
      success: true,
      id: docId,
      tags,
      collection,
      persisted: true,
    });
  } catch (err) {
    console.error("Canvas save error:", err);
    return res.status(500).json({ error: "Failed to save document" });
  }
});

// GET /api/canvas/documents - Get all documents from PG-backed knowledge
app.get("/api/canvas/documents", async (req, res) => {
  try {
    const sessionKey = normalizeCanvasSessionKey(req);
    const collection = normalizeCanvasCollection(req.query.collection);
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 500));
    const scanLimit = canvasListScanLimit(limit);

    const listing = await invokeKnowledgeGatewayMethod("knowledge.library.list", {
      options: {
        scope: "global",
        collection,
        ingestedOnly: true,
        distinctByDocument: true,
        sort: "savedAt",
        order: "desc",
        limit,
        scanLimit,
      },
      sessionKey,
    });
    if (!listing.success) {
      if (isStorageUnavailableError(listing.error)) {
        return res.status(200).json({
          documents: [],
          lastUpdated: new Date().toISOString(),
          degraded: true,
          warning: "Knowledge backend unavailable",
        });
      }
      return knowledgeErrorResponse(res, listing, "Failed to read documents");
    }

    const rows = Array.isArray(listing.data?.rows) ? listing.data.rows : [];
    const documents = rows
      .map((row) => {
        const docId = canvasDocIdFromKnowledgeRow(row);
        if (!docId) return null;
        const savedAt = normalizeCanvasSavedAt(row.savedAt);
        const createdAt = normalizeCanvasSavedAt(row.documentCreatedAt || row.savedAt || savedAt);
        return {
          id: docId,
          title:
            (typeof row.documentTitle === "string" && row.documentTitle.trim()) ||
            guessCanvasTitleFromSourceFile(row.sourceFile),
          type: normalizeCanvasDocType(row.documentType || "markdown"),
          savedAt,
          createdAt: new Date(createdAt).getTime(),
          tags: normalizeStringList(row.documentTags),
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
      .slice(0, limit);

    return res.json({
      documents,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Canvas documents read error:", err);
    if (isStorageUnavailableError(err)) {
      return res.status(200).json({
        documents: [],
        lastUpdated: new Date().toISOString(),
        degraded: true,
        warning: "Knowledge storage unavailable",
      });
    }
    return res.status(500).json({ error: "Failed to read documents" });
  }
});

// GET /api/canvas/document/:id - Load a specific document
app.get("/api/canvas/document/:id", async (req, res) => {
  const docId = String(req.params.id || "").trim();
  if (!docId) {
    return res.status(400).json({ error: "Document id is required" });
  }

  try {
    const sessionKey = normalizeCanvasSessionKey(req);
    const collection = normalizeCanvasCollection(req.query.collection);
    const sourceFile = canvasSourceFileForId(docId);
    const listing = await loadCanvasDocumentRowsBySource({ sessionKey, collection, sourceFile });
    if (!listing.success) {
      return knowledgeErrorResponse(res, listing, "Failed to load document");
    }

    const rows = Array.isArray(listing.data?.rows) ? listing.data.rows : [];
    if (rows.length === 0) {
      return res.status(404).json({ error: "Document not found" });
    }

    const doc = buildCanvasDocumentFromRows(docId, rows);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }
    return res.json(doc);
  } catch (err) {
    console.error("Canvas document read error:", err);
    return res.status(500).json({ error: "Failed to load document" });
  }
});

// POST /api/canvas/open - Open/focus an existing document by ID in DocPanel
app.post("/api/canvas/open", async (req, res) => {
  const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
  if (!id) {
    return res.status(400).json({ error: "Document id is required" });
  }

  try {
    const sessionKey = normalizeCanvasSessionKey(req);
    const collection = normalizeCanvasCollection(req.body?.collection);
    const sourceFile = canvasSourceFileForId(id);
    const listing = await loadCanvasDocumentRowsBySource({ sessionKey, collection, sourceFile });
    if (!listing.success) {
      return knowledgeErrorResponse(res, listing, "Failed to open document");
    }
    const rows = Array.isArray(listing.data?.rows) ? listing.data.rows : [];
    if (rows.length === 0) {
      return res.status(404).json({ error: "Document not found" });
    }
    const doc = buildCanvasDocumentFromRows(id, rows);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    broadcastCanvasEvent({
      type: "document_opened",
      action: "push",
      document: {
        id: doc.id,
        title: doc.title,
        content: doc.content,
        type: doc.type || "markdown",
        language: doc.language,
        tags: doc.tags || [],
        createdAt: doc.createdAt,
      },
    });

    return res.json({ success: true, id: doc.id });
  } catch (err) {
    console.error("Canvas open error:", err);
    return res.status(500).json({ error: "Failed to open document" });
  }
});

// DELETE /api/canvas/document/:id - Delete a document from PG-backed knowledge
app.delete("/api/canvas/document/:id", async (req, res) => {
  const docId = String(req.params.id || "").trim();
  if (!docId) {
    return res.status(400).json({ error: "Document id is required" });
  }

  try {
    const sessionKey = normalizeCanvasSessionKey(req);
    const removeFromKnowledge =
      String(req.query.removeFromKnowledge || "").toLowerCase() !== "false";
    if (!removeFromKnowledge) {
      return res.status(400).json({
        error: "DocPanel is PG knowledge-backed; removeFromKnowledge=false is not supported",
      });
    }
    const collection = normalizeCanvasCollection(req.query.collection);
    const sourceFile = canvasSourceFileForId(docId);
    const deletion = await invokeKnowledgeGatewayMethod("knowledge.library.delete", {
      options: {
        scope: "global",
        collection,
        sourceFile,
        limit: 4000,
        ingestedOnly: true,
      },
      sessionKey,
    });
    if (!deletion.success) {
      return knowledgeErrorResponse(res, deletion, "Failed to delete document");
    }

    const deleted = Number(deletion.data?.deleted || 0);
    if (deleted <= 0) {
      return res.status(404).json({ error: "Document not found" });
    }

    return res.json({ success: true, deleted });
  } catch (err) {
    console.error("Canvas delete error:", err);
    return res.status(500).json({ error: "Failed to delete document" });
  }
});

// POST /api/canvas/search - Search documents in PG-backed knowledge
app.post("/api/canvas/search", async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) {
    return res.json({ results: [] });
  }

  try {
    const mode = String(req.body?.mode || "hybrid").toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(req.body?.limit) || 20));
    const rowLimit = Math.max(limit * 6, 30);
    const collection = normalizeCanvasCollection(req.body?.collection);
    const sessionKey = normalizeCanvasSessionKey(req);
    const grouped = new Map();

    if (mode === "keyword") {
      const listing = await invokeKnowledgeGatewayMethod("knowledge.library.list", {
        options: {
          scope: "global",
          q: query,
          collection,
          ingestedOnly: true,
          sort: "savedAt",
          order: "desc",
          limit: rowLimit * 2,
        },
        sessionKey,
      });
      if (!listing.success) {
        return knowledgeErrorResponse(res, listing, "Failed to search documents");
      }

      const rows = Array.isArray(listing.data?.rows) ? listing.data.rows : [];
      for (const row of rows) {
        const docId = canvasDocIdFromKnowledgeRow(row);
        if (!docId) continue;
        const title =
          (typeof row.documentTitle === "string" && row.documentTitle.trim()) ||
          guessCanvasTitleFromSourceFile(row.sourceFile);
        const snippet = typeof row.excerpt === "string" ? row.excerpt : "";
        const score = 0.5;
        const createdAt = normalizeCanvasSavedAt(row.documentCreatedAt || row.savedAt);
        const candidate = {
          id: docId,
          title,
          snippet,
          type: normalizeCanvasDocType(row.documentType || "markdown"),
          score,
          createdAt: new Date(createdAt).getTime(),
          tags: normalizeStringList(row.documentTags),
        };
        const existing = grouped.get(docId);
        if (!existing || candidate.snippet.length > existing.snippet.length) {
          grouped.set(docId, candidate);
        }
      }
    } else {
      const searched = await invokeKnowledgeGatewayMethod("knowledge.search", {
        query,
        options: {
          scope: "global",
          collection,
          limit: rowLimit * 2,
          includeShared: false,
          ingestedOnly: true,
        },
        sessionKey,
      });
      if (!searched.success) {
        return knowledgeErrorResponse(res, searched, "Failed to search documents");
      }

      const hits = Array.isArray(searched.data?.results) ? searched.data.results : [];
      for (const hit of hits) {
        const docId = canvasDocIdFromKnowledgeRow(hit);
        if (!docId) continue;
        const title =
          (typeof hit.documentTitle === "string" && hit.documentTitle.trim()) ||
          guessCanvasTitleFromSourceFile(hit.sourceFile);
        const score = Number.isFinite(Number(hit.score)) ? Number(hit.score) : 0;
        const snippet = typeof hit.summary === "string" ? hit.summary : "";
        const createdAt = normalizeCanvasSavedAt(hit.documentCreatedAt || hit.createdAt);
        const candidate = {
          id: docId,
          title,
          snippet,
          type: normalizeCanvasDocType(hit.documentType || "markdown"),
          score,
          createdAt: new Date(createdAt).getTime(),
          tags: normalizeStringList(hit.documentTags),
        };
        const existing = grouped.get(docId);
        if (!existing || score > existing.score) {
          grouped.set(docId, candidate);
        }
      }
    }

    const results = [...grouped.values()]
      .sort((a, b) => {
        const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
        if (scoreDelta !== 0) return scoreDelta;
        return Number(b.createdAt || 0) - Number(a.createdAt || 0);
      })
      .slice(0, limit);
    return res.json({ results });
  } catch (err) {
    console.error("Canvas search error:", err);
    return res.status(500).json({ error: "Failed to search documents" });
  }
});

// GET /api/canvas/stats - Get PG-backed docpane stats
app.get("/api/canvas/stats", async (req, res) => {
  try {
    const sessionKey = normalizeCanvasSessionKey(req);
    const collection = normalizeCanvasCollection(req.query.collection);
    const listing = await invokeKnowledgeGatewayMethod("knowledge.library.list", {
      options: {
        scope: "global",
        collection,
        ingestedOnly: true,
        sort: "savedAt",
        order: "desc",
        limit: 5000,
      },
      sessionKey,
    });
    if (!listing.success) {
      return knowledgeErrorResponse(res, listing, "Failed to get stats");
    }

    const rows = Array.isArray(listing.data?.rows) ? listing.data.rows : [];
    const docIds = new Set();
    for (const row of rows) {
      const docId = canvasDocIdFromKnowledgeRow(row);
      if (docId) docIds.add(docId);
    }

    return res.json({
      total: docIds.size,
      withEmbeddings: rows.length,
      chunks: rows.length,
      backend: "postgres-knowledge",
      collection,
    });
  } catch (err) {
    console.error("Canvas stats error:", err);
    return res.status(500).json({ error: "Failed to get stats" });
  }
});

// POST /api/knowledge/ingest - Legacy HTTP shim delegating to gateway knowledge.ingest (PG path)
app.post("/api/knowledge/ingest", async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    const options =
      req.body?.options && typeof req.body.options === "object" ? req.body.options : {};
    const sessionKey =
      typeof req.body?.sessionKey === "string"
        ? req.body.sessionKey
        : typeof req.get("x-session-key") === "string"
          ? req.get("x-session-key")
          : undefined;

    const result = await invokeKnowledgeGatewayMethod("knowledge.ingest", {
      files,
      options,
      sessionKey,
    });
    if (result.success) {
      return res.json(result.data || { success: true });
    }

    const status = knowledgeGatewayErrorStatus(result.error);
    return res.status(status).json({
      error: result.error?.message || "Knowledge ingest failed",
      code: result.error?.code || "UNAVAILABLE",
      details: result.error?.details,
    });
  } catch (err) {
    console.error("[Knowledge] Ingest shim failed:", err);
    return res.status(503).json({
      error: "Knowledge ingest unavailable",
      details: err?.message || String(err),
    });
  }
});

// GET /api/knowledge/library - Legacy HTTP shim delegating to gateway knowledge.library.list (PG path)
app.get("/api/knowledge/library", async (req, res) => {
  try {
    const scopeRaw = String(req.query.scope || "ingested").toLowerCase();
    if (scopeRaw === "canvas") {
      return res.status(400).json({
        error: "Canvas-backed knowledge scope is removed. Use PG-backed ingested scope.",
      });
    }

    const query = String(req.query.q || "").trim();
    const sortRaw = String(req.query.sort || "savedAt");
    const sort = sortRaw === "title" || sortRaw === "type" ? sortRaw : "savedAt";
    const order = String(req.query.order || "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 500));
    const collection = String(req.query.collection || "").trim() || undefined;
    const sourceFile = String(req.query.sourceFile || "").trim() || undefined;
    const sessionKey =
      typeof req.query.sessionKey === "string"
        ? req.query.sessionKey
        : typeof req.get("x-session-key") === "string"
          ? req.get("x-session-key")
          : undefined;

    const result = await invokeKnowledgeGatewayMethod("knowledge.library.list", {
      options: {
        q: query || undefined,
        collection,
        sourceFile,
        sort,
        order,
        limit,
        ingestedOnly: true,
      },
      sessionKey,
    });

    if (result.success) {
      return res.json({
        ...(result.data || {}),
        scope: "ingested",
      });
    }

    const status = knowledgeGatewayErrorStatus(result.error);
    return res.status(status).json({
      error: result.error?.message || "Failed to load knowledge library",
      code: result.error?.code || "UNAVAILABLE",
      details: result.error?.details,
    });
  } catch (err) {
    console.error("[Knowledge] Library listing failed:", err);
    return res.status(503).json({
      error: "Knowledge library unavailable",
      details: err?.message || String(err),
    });
  }
});

// POST /api/knowledge/library/delete - Legacy HTTP shim delegating to gateway knowledge.library.delete (PG path)
app.post("/api/knowledge/library/delete", async (req, res) => {
  try {
    const options =
      req.body?.options && typeof req.body.options === "object" ? req.body.options : {};
    const sessionKey =
      typeof req.body?.sessionKey === "string"
        ? req.body.sessionKey
        : typeof req.get("x-session-key") === "string"
          ? req.get("x-session-key")
          : undefined;

    const result = await invokeKnowledgeGatewayMethod("knowledge.library.delete", {
      options: {
        ...options,
        ingestedOnly: true,
      },
      sessionKey,
    });

    if (result.success) {
      return res.json(result.data || { success: true, deleted: 0 });
    }

    const status = knowledgeGatewayErrorStatus(result.error);
    return res.status(status).json({
      error: result.error?.message || "Failed to delete knowledge library rows",
      code: result.error?.code || "UNAVAILABLE",
      details: result.error?.details,
    });
  } catch (err) {
    console.error("[Knowledge] Library delete failed:", err);
    return res.status(503).json({
      error: "Knowledge library delete unavailable",
      details: err?.message || String(err),
    });
  }
});

// ============================================
// APPS API - App Forge micro-app management
// ============================================

function createInMemoryAppsDb() {
  const rows = new Map();
  const nowIso = () => new Date().toISOString();
  const sortRows = (entries) =>
    [...entries].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });
  return {
    DB_PATH: "[memory]",
    listApps(options = {}) {
      const limit = Math.max(1, Number(options.limit) || 100);
      return sortRows(rows.values())
        .slice(0, limit)
        .map(({ code, ...rest }) => ({ ...rest }));
    },
    getApp(id) {
      const existing = rows.get(id);
      if (existing) return { ...existing };
      return {
        id,
        name: "Unavailable App",
        description: "Legacy app storage is disabled in PG mode.",
        icon: "⚠️",
        version: 1,
        creator: "system",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        openCount: 0,
        pinned: false,
        metadata: { unavailable: true },
        code: `<div style="padding:12px;font-family:system-ui;">App unavailable in PG mode.</div>`,
      };
    },
    createApp({ name, description, icon, code, creator = "ai", metadata }) {
      const id = crypto.randomUUID();
      const stamp = nowIso();
      const app = {
        id,
        name,
        description: description || undefined,
        icon: icon || undefined,
        version: 1,
        creator,
        createdAt: stamp,
        updatedAt: stamp,
        lastOpenedAt: undefined,
        openCount: 0,
        pinned: false,
        metadata: metadata && typeof metadata === "object" ? metadata : undefined,
        code,
      };
      rows.set(id, app);
      return { ...app };
    },
    updateApp(id, updates = {}) {
      const existing = rows.get(id);
      if (!existing) return null;
      const updated = {
        ...existing,
        name: updates.name ?? existing.name,
        description: updates.description ?? existing.description,
        icon: updates.icon ?? existing.icon,
        metadata: updates.metadata ?? existing.metadata,
        code: updates.code ?? existing.code,
        version: updates.code !== undefined ? existing.version + 1 : existing.version,
        updatedAt: nowIso(),
      };
      rows.set(id, updated);
      return { ...updated };
    },
    deleteApp(id) {
      return rows.delete(id);
    },
    recordOpen(id) {
      const existing = rows.get(id);
      if (!existing) return false;
      const updated = {
        ...existing,
        openCount: Number(existing.openCount || 0) + 1,
        lastOpenedAt: nowIso(),
        updatedAt: nowIso(),
      };
      rows.set(id, updated);
      return true;
    },
    pinApp(id) {
      const existing = rows.get(id);
      if (!existing) return null;
      const updated = { ...existing, pinned: !existing.pinned, updatedAt: nowIso() };
      rows.set(id, updated);
      return { ...updated };
    },
    searchApps(query, limit = 20) {
      const q = String(query || "").toLowerCase();
      return sortRows(rows.values())
        .filter(
          (app) =>
            String(app.name || "")
              .toLowerCase()
              .includes(q) ||
            String(app.description || "")
              .toLowerCase()
              .includes(q),
        )
        .slice(0, Math.max(1, Number(limit) || 20))
        .map(({ code, ...rest }) => ({ ...rest }));
    },
  };
}

function appFromPgRow(row, options = {}) {
  if (!row) return null;
  const includeCode = options.includeCode === true;
  const app = {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    icon: row.icon || undefined,
    version: Number(row.version || 1),
    creator: row.creator || "ai",
    createdAt: safeIso(row.createdAt || row.created_at),
    updatedAt: safeIso(row.updatedAt || row.updated_at),
    lastOpenedAt: safeIso(row.lastOpenedAt || row.last_opened_at),
    openCount: Number(row.openCount ?? row.open_count ?? 0),
    pinned: Boolean(row.pinned),
    metadata: normalizeMetadata(row.metadata),
  };
  if (includeCode) app.code = row.code;
  return app;
}

function createPgAppsCompatDb() {
  return {
    DB_PATH: "[postgres]",
    async listApps(options = {}) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.apps?.listApps === "function") {
        return await hooks.apps.listApps(options);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const limit = Math.max(1, Number(options.limit) || 100);
      const includeCode = options.includeCode === true;
      const rows = await sql`
        SELECT
          id, name, description, icon, ${includeCode ? sql`code,` : sql``} version, creator,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_opened_at AS "lastOpenedAt",
          open_count AS "openCount",
          pinned,
          metadata
        FROM dashboard_apps
        WHERE deleted_at IS NULL
        ORDER BY pinned DESC, updated_at DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => appFromPgRow(row, { includeCode }));
    },
    async getApp(id) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.apps?.getApp === "function") {
        return await hooks.apps.getApp(id);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const rows = await sql`
        SELECT
          id, name, description, icon, code, version, creator,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_opened_at AS "lastOpenedAt",
          open_count AS "openCount",
          pinned,
          metadata
        FROM dashboard_apps
        WHERE id = ${id} AND deleted_at IS NULL
        LIMIT 1
      `;
      return appFromPgRow(rows[0], { includeCode: true });
    },
    async createApp({ name, description, icon, code, creator = "ai", metadata }) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.apps?.createApp === "function") {
        return await hooks.apps.createApp({ name, description, icon, code, creator, metadata });
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const id = crypto.randomUUID();
      const now = new Date();
      const rows = await sql`
        INSERT INTO dashboard_apps (
          id, name, description, icon, code, version, creator, created_at, updated_at, metadata
        ) VALUES (
          ${id}, ${name}, ${description || null}, ${icon || null}, ${code}, 1,
          ${creator || "ai"}, ${now}, ${now}, ${JSON.stringify(normalizeMetadata(metadata))}::jsonb
        )
        RETURNING
          id, name, description, icon, code, version, creator,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_opened_at AS "lastOpenedAt",
          open_count AS "openCount",
          pinned,
          metadata
      `;
      return appFromPgRow(rows[0], { includeCode: true });
    },
    async updateApp(id, updates = {}) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.apps?.updateApp === "function") {
        return await hooks.apps.updateApp(id, updates);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const existing = await this.getApp(id);
      if (!existing) return null;
      const now = new Date();
      const rows = await sql`
        UPDATE dashboard_apps
        SET
          name = ${updates.name ?? existing.name},
          description = ${updates.description ?? existing.description ?? null},
          icon = ${updates.icon ?? existing.icon ?? null},
          code = ${updates.code ?? existing.code},
          version = ${
            updates.code !== undefined
              ? Number(existing.version || 1) + 1
              : Number(existing.version || 1)
          },
          metadata = ${
            Object.prototype.hasOwnProperty.call(updates, "metadata")
              ? JSON.stringify(normalizeMetadata(updates.metadata))
              : JSON.stringify(normalizeMetadata(existing.metadata))
          },
          updated_at = ${now}
        WHERE id = ${id} AND deleted_at IS NULL
        RETURNING
          id, name, description, icon, code, version, creator,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_opened_at AS "lastOpenedAt",
          open_count AS "openCount",
          pinned,
          metadata
      `;
      return appFromPgRow(rows[0], { includeCode: true });
    },
    async deleteApp(id) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.apps?.deleteApp === "function") {
        return await hooks.apps.deleteApp(id);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const now = new Date();
      const out = await sql`
        UPDATE dashboard_apps
        SET deleted_at = ${now}, updated_at = ${now}
        WHERE id = ${id} AND deleted_at IS NULL
      `;
      return Number(out.count || 0) > 0;
    },
    async recordOpen(id) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.apps?.recordOpen === "function") {
        return await hooks.apps.recordOpen(id);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const now = new Date();
      const out = await sql`
        UPDATE dashboard_apps
        SET
          open_count = open_count + 1,
          last_opened_at = ${now},
          updated_at = ${now}
        WHERE id = ${id} AND deleted_at IS NULL
      `;
      return Number(out.count || 0) > 0;
    },
    async pinApp(id) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.apps?.pinApp === "function") {
        return await hooks.apps.pinApp(id);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const rows = await sql`
        UPDATE dashboard_apps
        SET pinned = NOT pinned, updated_at = ${new Date()}
        WHERE id = ${id} AND deleted_at IS NULL
        RETURNING
          id, name, description, icon, code, version, creator,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_opened_at AS "lastOpenedAt",
          open_count AS "openCount",
          pinned,
          metadata
      `;
      return appFromPgRow(rows[0], { includeCode: true });
    },
    async searchApps(query, limit = 20) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.apps?.searchApps === "function") {
        return await hooks.apps.searchApps(query, limit);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const pattern = `%${String(query || "").trim()}%`;
      const rows = await sql`
        SELECT
          id, name, description, icon, version, creator,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_opened_at AS "lastOpenedAt",
          open_count AS "openCount",
          pinned,
          metadata
        FROM dashboard_apps
        WHERE
          deleted_at IS NULL
          AND (name ILIKE ${pattern} OR COALESCE(description, '') ILIKE ${pattern})
        ORDER BY pinned DESC, updated_at DESC
        LIMIT ${Math.max(1, Number(limit) || 20)}
      `;
      return rows.map((row) => appFromPgRow(row));
    },
  };
}

let appsDb = null;
if (!LEGACY_SQLITE_QUARANTINED) {
  appsDb = require("./src/db/appsDb.cjs");
  console.log("[API] Apps database loaded from:", appsDb.DB_PATH);
} else {
  appsDb = createPgAppsCompatDb();
  console.log("[API] Apps using PostgreSQL compatibility store");
}

// SSE for real-time app updates
const appsClients = new Set();

function ensureAppsDbAvailable(req, res, next) {
  if (!appsDb) {
    return res.status(503).json({
      error: "Apps storage backend unavailable",
      code: "LEGACY_SQLITE_QUARANTINED",
    });
  }
  next();
}

app.use("/api/apps", ensureAppsDbAvailable);

app.get("/api/apps/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  appsClients.add(res);

  req.on("close", () => {
    appsClients.delete(res);
  });
});

function broadcastAppsEvent(event) {
  const data = JSON.stringify(event);
  for (const client of appsClients) {
    client.write(`data: ${data}\n\n`);
  }
}

function emitAppForgeWorkflowEvent(event) {
  if (process.env.ARGENT_DISABLE_APPFORGE_WORKFLOW_EVENTS === "1" || process.env.API_PORT === "0") {
    return;
  }
  sendGatewayRpcFireAndForget("workflows.emitAppForgeEvent", {
    emittedAt: new Date().toISOString(),
    ...event,
    payload: {
      ...(event.payload && typeof event.payload === "object" ? event.payload : {}),
      source: "dashboard-api",
    },
  });
}

function appForgeRecordPayload(app, action) {
  return {
    eventType: `forge.record.${action}`,
    appId: app.id,
    tableId: "dashboard_apps",
    recordId: app.id,
    payload: {
      app: {
        id: app.id,
        name: app.name,
        description: app.description,
        creator: app.creator,
        version: app.version,
        metadata: app.metadata,
      },
    },
  };
}

function appForgeRuntimeEventPayload(app, eventType, body = {}, extraPayload = {}) {
  const payload = body && typeof body.payload === "object" && body.payload ? body.payload : {};
  return {
    ...body,
    eventType,
    appId: app.id,
    capabilityId:
      typeof body.capabilityId === "string" && body.capabilityId.trim()
        ? body.capabilityId.trim()
        : undefined,
    workflowRunId:
      typeof body.workflowRunId === "string" && body.workflowRunId.trim()
        ? body.workflowRunId.trim()
        : typeof body.runId === "string" && body.runId.trim()
          ? body.runId.trim()
          : undefined,
    nodeId: typeof body.nodeId === "string" && body.nodeId.trim() ? body.nodeId.trim() : undefined,
    reviewId:
      typeof body.reviewId === "string" && body.reviewId.trim() ? body.reviewId.trim() : undefined,
    decision:
      typeof body.decision === "string" && body.decision.trim() ? body.decision.trim() : undefined,
    payload: {
      ...payload,
      ...extraPayload,
      app: { id: app.id, name: app.name, metadata: app.metadata },
    },
  };
}

async function emitAppForgeRuntimeEvent(req, res, eventType, extraPayload = {}) {
  try {
    const app = await appsDb.getApp(req.params.id);
    if (!app) {
      return res.status(404).json({ error: "App not found" });
    }
    emitAppForgeWorkflowEvent(appForgeRuntimeEventPayload(app, eventType, req.body, extraPayload));
    res.status(202).json({ ok: true, eventType, appId: app.id });
  } catch (err) {
    console.error(`Error emitting ${eventType}:`, err);
    res.status(500).json({ error: "Failed to emit app workflow event" });
  }
}

// GET /api/apps/search - Search apps (must be before /:id)
app.get("/api/apps/search", async (req, res) => {
  const { q, limit = 20 } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Search query (q) is required" });
  }
  try {
    const apps = await appsDb.searchApps(q, parseInt(limit, 10));
    res.json({ apps });
  } catch (err) {
    console.error("Error searching apps:", err);
    res.status(500).json({ error: "Failed to search apps" });
  }
});

// GET /api/apps - List all apps (omits code field)
app.get("/api/apps", async (req, res) => {
  try {
    const includeCode =
      req.query.includeCode === "1" ||
      req.query.includeCode === "true" ||
      req.query.includeCode === "yes";
    const apps = await appsDb.listApps({ includeCode });
    res.json({ apps });
  } catch (err) {
    console.error("Error listing apps:", err);
    res.status(500).json({ error: "Failed to list apps" });
  }
});

// GET /api/apps/:id - Get app with full code
app.get("/api/apps/:id", async (req, res) => {
  try {
    const app = await appsDb.getApp(req.params.id);
    if (!app) {
      return res.status(404).json({ error: "App not found" });
    }
    res.json({ app });
  } catch (err) {
    console.error("Error getting app:", err);
    res.status(500).json({ error: "Failed to get app" });
  }
});

// POST /api/apps - Create app
app.post("/api/apps", async (req, res) => {
  const { name, description, icon, code, creator, metadata } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  if (!code || !code.trim()) {
    return res.status(400).json({ error: "Code is required" });
  }

  try {
    const app = await appsDb.createApp({
      name: name.trim(),
      description: description?.trim(),
      icon,
      code,
      creator: creator || "ai",
      metadata,
    });
    broadcastAppsEvent({ type: "app_created", app: { id: app.id, name: app.name } });
    emitAppForgeWorkflowEvent(appForgeRecordPayload(app, "created"));
    res.status(201).json({ app });
  } catch (err) {
    console.error("Error creating app:", err);
    res.status(500).json({ error: "Failed to create app" });
  }
});

// PATCH /api/apps/:id - Update app
app.patch("/api/apps/:id", async (req, res) => {
  try {
    const app = await appsDb.updateApp(req.params.id, req.body);
    if (!app) {
      return res.status(404).json({ error: "App not found" });
    }
    broadcastAppsEvent({ type: "app_updated", app: { id: app.id, name: app.name } });
    emitAppForgeWorkflowEvent(appForgeRecordPayload(app, "updated"));
    res.json({ app });
  } catch (err) {
    console.error("Error updating app:", err);
    res.status(500).json({ error: "Failed to update app" });
  }
});

// DELETE /api/apps/:id - Soft delete
app.delete("/api/apps/:id", async (req, res) => {
  try {
    const deleted = await appsDb.deleteApp(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "App not found" });
    }
    broadcastAppsEvent({ type: "app_deleted", appId: req.params.id });
    emitAppForgeWorkflowEvent({
      eventType: "forge.record.deleted",
      appId: req.params.id,
      tableId: "dashboard_apps",
      recordId: req.params.id,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting app:", err);
    res.status(500).json({ error: "Failed to delete app" });
  }
});

// POST /api/apps/:id/delete - Soft delete (browser-safe action route)
app.post("/api/apps/:id/delete", async (req, res) => {
  try {
    const deleted = await appsDb.deleteApp(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "App not found" });
    }
    broadcastAppsEvent({ type: "app_deleted", appId: req.params.id });
    emitAppForgeWorkflowEvent({
      eventType: "forge.record.deleted",
      appId: req.params.id,
      tableId: "dashboard_apps",
      recordId: req.params.id,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting app:", err);
    res.status(500).json({ error: "Failed to delete app" });
  }
});

// POST /api/apps/:id/workflow-event - Emit an AppForge workflow event
app.post("/api/apps/:id/workflow-event", async (req, res) => {
  try {
    const app = await appsDb.getApp(req.params.id);
    if (!app) {
      return res.status(404).json({ error: "App not found" });
    }
    const eventType = String(req.body?.eventType || req.body?.type || "").trim();
    if (!eventType) {
      return res.status(400).json({ error: "eventType is required" });
    }
    emitAppForgeWorkflowEvent({
      ...req.body,
      eventType,
      appId: app.id,
      payload: {
        ...(req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {}),
        app: { id: app.id, name: app.name, metadata: app.metadata },
      },
    });
    res.status(202).json({ ok: true });
  } catch (err) {
    console.error("Error emitting app workflow event:", err);
    res.status(500).json({ error: "Failed to emit app workflow event" });
  }
});

// POST /api/apps/:id/reviews/request - Emit a review requested AppForge event
app.post("/api/apps/:id/reviews/request", async (req, res) => {
  await emitAppForgeRuntimeEvent(req, res, "forge.review.requested", {
    reviewState: "requested",
  });
});

// POST /api/apps/:id/reviews/complete - Emit a review completed AppForge event
app.post("/api/apps/:id/reviews/complete", async (req, res) => {
  await emitAppForgeRuntimeEvent(req, res, "forge.review.completed", {
    reviewState: "completed",
  });
});

// POST /api/apps/:id/capabilities/:capabilityId/complete - Emit a capability completed event
app.post("/api/apps/:id/capabilities/:capabilityId/complete", async (req, res) => {
  await emitAppForgeRuntimeEvent(
    {
      params: req.params,
      body: {
        ...req.body,
        capabilityId: req.body?.capabilityId || req.params.capabilityId,
      },
    },
    res,
    "forge.capability.completed",
    {
      capabilityState: "completed",
    },
  );
});

// POST /api/apps/:id/open - Record open
app.post("/api/apps/:id/open", async (req, res) => {
  try {
    const success = await appsDb.recordOpen(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "App not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error recording open:", err);
    res.status(500).json({ error: "Failed to record open" });
  }
});

// POST /api/apps/:id/pin - Toggle pin
app.post("/api/apps/:id/pin", async (req, res) => {
  try {
    const app = await appsDb.pinApp(req.params.id);
    if (!app) {
      return res.status(404).json({ error: "App not found" });
    }
    broadcastAppsEvent({ type: "app_updated", app: { id: app.id, name: app.name } });
    res.json({ app });
  } catch (err) {
    console.error("Error pinning app:", err);
    res.status(500).json({ error: "Failed to pin app" });
  }
});

// ============================================
// WIDGETS API - Custom widget management (SQLite)
// ============================================

function createInMemoryWidgetsDb() {
  const rows = new Map();
  const slots = new Map();
  const nowIso = () => new Date().toISOString();
  const normalizeWidget = (widget) => ({
    id: widget.id,
    name: widget.name,
    description: widget.description || undefined,
    icon: widget.icon || "📦",
    version: widget.version || 1,
    creator: widget.creator || "ai",
    createdAt: widget.createdAt || nowIso(),
    updatedAt: widget.updatedAt || nowIso(),
    metadata: widget.metadata || undefined,
    code: widget.code,
  });
  return {
    DB_PATH: "[memory]",
    migrateInlineWidgetsToFilesystem() {},
    getLayout() {
      return [...slots.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([position, widgetId]) => ({ position, widgetId, updatedAt: nowIso() }));
    },
    assignSlot(position, widgetId) {
      slots.set(Number(position), String(widgetId));
      return { position: Number(position), widgetId: String(widgetId) };
    },
    listWidgets(options = {}) {
      const limit = Math.max(1, Number(options.limit) || 100);
      return [...rows.values()]
        .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
        .slice(0, limit)
        .map(({ code, ...rest }) => ({ ...rest }));
    },
    getWidget(id) {
      const existing = rows.get(id);
      if (existing) return { ...existing };
      return {
        id,
        name: "Unavailable Widget",
        description: "Legacy widget storage is disabled in PG mode.",
        icon: "⚠️",
        version: 1,
        creator: "system",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        metadata: { unavailable: true },
        code: `<div style="padding:12px;font-family:system-ui;">Widget unavailable in PG mode.</div>`,
      };
    },
    createWidget({ name, description, icon, code, creator = "ai", metadata }) {
      const id = crypto.randomUUID();
      const widget = normalizeWidget({
        id,
        name,
        description,
        icon,
        creator,
        metadata,
        code,
      });
      rows.set(id, widget);
      return { ...widget };
    },
    updateWidget(id, updates = {}) {
      const existing = rows.get(id);
      if (!existing) return null;
      const next = normalizeWidget({
        ...existing,
        ...updates,
        version: updates.code !== undefined ? Number(existing.version || 1) + 1 : existing.version,
        updatedAt: nowIso(),
      });
      rows.set(id, next);
      return { ...next };
    },
    deleteWidget(id) {
      for (const [slot, widgetId] of slots.entries()) {
        if (widgetId === id) slots.delete(slot);
      }
      return rows.delete(id);
    },
  };
}

function widgetFromPgRow(row, options = {}) {
  if (!row) return null;
  const includeCode = options.includeCode === true;
  const widget = {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    icon: row.icon || "📦",
    version: Number(row.version || 1),
    creator: row.creator || "ai",
    createdAt: safeIso(row.createdAt || row.created_at),
    updatedAt: safeIso(row.updatedAt || row.updated_at),
    metadata: normalizeMetadata(row.metadata),
  };
  if (includeCode) widget.code = row.code;
  return widget;
}

function createPgWidgetsCompatDb() {
  return {
    DB_PATH: "[postgres]",
    async migrateInlineWidgetsToFilesystem() {},
    async getLayout() {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.widgets?.getLayout === "function") {
        return await hooks.widgets.getLayout();
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const rows = await sql`
        SELECT position, widget_id AS "widgetId", updated_at AS "updatedAt"
        FROM dashboard_widget_slots
        ORDER BY position ASC
      `;
      return rows.map((row) => ({
        position: Number(row.position),
        widgetId: row.widgetId,
        updatedAt: safeIso(row.updatedAt),
      }));
    },
    async assignSlot(position, widgetId) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.widgets?.assignSlot === "function") {
        return await hooks.widgets.assignSlot(position, widgetId);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const pos = Number(position);
      const wid = String(widgetId);
      await sql`
        INSERT INTO dashboard_widget_slots (position, widget_id, updated_at)
        VALUES (${pos}, ${wid}, ${new Date()})
        ON CONFLICT (position)
        DO UPDATE SET widget_id = EXCLUDED.widget_id, updated_at = EXCLUDED.updated_at
      `;
      return { position: pos, widgetId: wid };
    },
    async listWidgets(options = {}) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.widgets?.listWidgets === "function") {
        return await hooks.widgets.listWidgets(options);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const limit = Math.max(1, Number(options.limit) || 100);
      const rows = await sql`
        SELECT
          id, name, description, icon, version, creator,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          metadata
        FROM dashboard_widgets
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => widgetFromPgRow(row));
    },
    async getWidget(id) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.widgets?.getWidget === "function") {
        return await hooks.widgets.getWidget(id);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const rows = await sql`
        SELECT
          id, name, description, icon, code, version, creator,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          metadata
        FROM dashboard_widgets
        WHERE id = ${id} AND deleted_at IS NULL
        LIMIT 1
      `;
      return widgetFromPgRow(rows[0], { includeCode: true });
    },
    async createWidget({ name, description, icon, code, creator = "ai", metadata }) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.widgets?.createWidget === "function") {
        return await hooks.widgets.createWidget({
          name,
          description,
          icon,
          code,
          creator,
          metadata,
        });
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const id = crypto.randomUUID();
      const now = new Date();
      const rows = await sql`
        INSERT INTO dashboard_widgets (
          id, name, description, icon, code, version, creator, created_at, updated_at, metadata
        ) VALUES (
          ${id},
          ${name},
          ${description || null},
          ${icon || "📦"},
          ${code},
          1,
          ${creator || "ai"},
          ${now},
          ${now},
          ${normalizeMetadata(metadata)}
        )
        RETURNING
          id, name, description, icon, code, version, creator,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          metadata
      `;
      return widgetFromPgRow(rows[0], { includeCode: true });
    },
    async updateWidget(id, updates = {}) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.widgets?.updateWidget === "function") {
        return await hooks.widgets.updateWidget(id, updates);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const existing = await this.getWidget(id);
      if (!existing) return null;
      const rows = await sql`
        UPDATE dashboard_widgets
        SET
          name = ${updates.name ?? existing.name},
          description = ${updates.description ?? existing.description ?? null},
          icon = ${updates.icon ?? existing.icon ?? "📦"},
          code = ${updates.code ?? existing.code},
          version = ${
            updates.code !== undefined
              ? Number(existing.version || 1) + 1
              : Number(existing.version || 1)
          },
          metadata = ${
            Object.prototype.hasOwnProperty.call(updates, "metadata")
              ? normalizeMetadata(updates.metadata)
              : normalizeMetadata(existing.metadata)
          },
          updated_at = ${new Date()}
        WHERE id = ${id} AND deleted_at IS NULL
        RETURNING
          id, name, description, icon, code, version, creator,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          metadata
      `;
      return widgetFromPgRow(rows[0], { includeCode: true });
    },
    async deleteWidget(id) {
      const hooks = await getPgDashboardCompatHooks();
      if (typeof hooks?.widgets?.deleteWidget === "function") {
        return await hooks.widgets.deleteWidget(id);
      }
      const sql = await getPgSqlClient();
      if (!sql) throw new Error("PostgreSQL storage unavailable");
      const now = new Date();
      await sql`DELETE FROM dashboard_widget_slots WHERE widget_id = ${id}`;
      const out = await sql`
        UPDATE dashboard_widgets
        SET deleted_at = ${now}, updated_at = ${now}
        WHERE id = ${id} AND deleted_at IS NULL
      `;
      return Number(out.count || 0) > 0;
    },
  };
}

let widgetsDb = null;
if (!LEGACY_SQLITE_QUARANTINED) {
  widgetsDb = require("./src/db/widgetsDb.cjs");
  console.log("[API] Widgets database loaded from:", widgetsDb.DB_PATH);
  // Migrate any existing inline-code widgets to filesystem
  widgetsDb.migrateInlineWidgetsToFilesystem();
} else {
  widgetsDb = createPgWidgetsCompatDb();
  console.log("[API] Widgets using PostgreSQL compatibility store");
}

// SSE for real-time widget updates
const widgetsClients = new Set();

function ensureWidgetsDbAvailable(req, res, next) {
  if (!widgetsDb) {
    return res.status(503).json({
      error: "Widgets storage backend unavailable",
      code: "LEGACY_SQLITE_QUARANTINED",
    });
  }
  next();
}

app.use("/api/widgets", ensureWidgetsDbAvailable);

app.get("/api/widgets/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  widgetsClients.add(res);

  req.on("close", () => {
    widgetsClients.delete(res);
  });
});

function broadcastWidgetsEvent(event) {
  const data = JSON.stringify(event);
  for (const client of widgetsClients) {
    client.write(`data: ${data}\n\n`);
  }
}

// GET /api/widgets/layout - Get current slot assignments (must be before /:id)
app.get("/api/widgets/layout", async (req, res) => {
  try {
    const layout = await widgetsDb.getLayout();
    res.json({ layout });
  } catch (err) {
    console.error("Error getting widget layout:", err);
    res.status(500).json({ error: "Failed to get layout" });
  }
});

// POST /api/widgets/assign - Assign widget to a slot
app.post("/api/widgets/assign", async (req, res) => {
  const { widgetId, position } = req.body;

  if (!widgetId) {
    return res.status(400).json({ error: "widgetId is required" });
  }

  const pos = parseInt(position, 10);
  if (isNaN(pos) || pos < 1 || pos > 7) {
    return res.status(400).json({ error: "Position must be between 1 and 7" });
  }

  try {
    const result = await widgetsDb.assignSlot(pos, widgetId);
    broadcastWidgetsEvent({ type: "widget_assigned", position: pos, widgetId });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Error assigning widget:", err);
    res.status(500).json({ error: "Failed to assign widget" });
  }
});

// GET /api/widgets - List all custom widgets (omits code field)
app.get("/api/widgets", async (req, res) => {
  try {
    const widgets = await widgetsDb.listWidgets();
    res.json({ widgets });
  } catch (err) {
    console.error("Error listing widgets:", err);
    res.status(500).json({ error: "Failed to list widgets" });
  }
});

// GET /api/widgets/:id - Get widget with full code
app.get("/api/widgets/:id", async (req, res) => {
  try {
    const widget = await widgetsDb.getWidget(req.params.id);
    if (!widget) {
      return res.status(404).json({ error: "Widget not found" });
    }
    res.json({ widget });
  } catch (err) {
    console.error("Error getting widget:", err);
    res.status(500).json({ error: "Failed to get widget" });
  }
});

// POST /api/widgets - Create widget
app.post("/api/widgets", async (req, res) => {
  const { name, description, icon, code, creator } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  if (!code || !code.trim()) {
    return res.status(400).json({ error: "Code is required" });
  }

  try {
    const widget = await widgetsDb.createWidget({
      name: name.trim(),
      description: description?.trim(),
      icon,
      code,
      creator: creator || "ai",
    });
    broadcastWidgetsEvent({ type: "widget_created", widget: { id: widget.id, name: widget.name } });
    res.status(201).json({ widget });
  } catch (err) {
    console.error("Error creating widget:", err);
    res.status(500).json({ error: "Failed to create widget" });
  }
});

// PATCH /api/widgets/:id - Update widget
app.patch("/api/widgets/:id", async (req, res) => {
  try {
    const widget = await widgetsDb.updateWidget(req.params.id, req.body);
    if (!widget) {
      return res.status(404).json({ error: "Widget not found" });
    }
    broadcastWidgetsEvent({ type: "widget_updated", widget: { id: widget.id, name: widget.name } });
    res.json({ widget });
  } catch (err) {
    console.error("Error updating widget:", err);
    res.status(500).json({ error: "Failed to update widget" });
  }
});

// DELETE /api/widgets/:id - Soft delete
app.delete("/api/widgets/:id", async (req, res) => {
  try {
    const deleted = await widgetsDb.deleteWidget(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Widget not found" });
    }
    broadcastWidgetsEvent({ type: "widget_deleted", widgetId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting widget:", err);
    res.status(500).json({ error: "Failed to delete widget" });
  }
});

// Image upload endpoint - save base64 image to temp file
app.post("/api/upload-image", express.json({ limit: "50mb" }), async (req, res) => {
  try {
    const { image } = req.body;
    if (!image || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Invalid image data" });
    }

    // Extract base64 data
    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "Invalid image format" });
    }

    const [, ext, base64Data] = matches;
    const buffer = Buffer.from(base64Data, "base64");

    // Save to temp file
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    const filename = `argent-image-${Date.now()}.${ext}`;
    const filepath = path.join(os.tmpdir(), filename);

    fs.writeFileSync(filepath, buffer);
    console.log(`[Image Upload] Saved to: ${filepath}`);

    res.json({ path: filepath });
  } catch (err) {
    console.error("[Image Upload] Error:", err);
    res.status(500).json({ error: "Failed to save image" });
  }
});

// ============================================
// PROXY API - Centralized external service keys
// ============================================

// POST /api/proxy/tts/elevenlabs - ElevenLabs TTS proxy
app.post("/api/proxy/tts/elevenlabs", async (req, res) => {
  const apiKey =
    (await resolveServiceKeyForProxy("ELEVENLABS_API_KEY")) ||
    (await resolveServiceKeyForProxy("ELEVENLABS_ADAPTFLOW_API_KEY"));
  if (!apiKey) {
    return res.status(503).json({ error: "missing_api_key", service: "elevenlabs" });
  }
  const {
    voiceId,
    outputFormat,
    text,
    model_id,
    voice_settings,
    seed,
    apply_text_normalization,
    language_code,
  } = req.body;
  if (!voiceId || !text) {
    return res.status(400).json({ error: "voiceId and text are required" });
  }
  try {
    const proxyStart = Date.now();
    // Always use the /stream endpoint for lowest latency
    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`);
    if (outputFormat) url.searchParams.set("output_format", outputFormat);
    // optimize_streaming_latency: not supported by eleven_v3, only use for older models
    if (model_id && model_id.startsWith("eleven_v3")) {
      // v3 doesn't support this param — omit it
    } else {
      url.searchParams.set("optimize_streaming_latency", "3");
    }
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id,
        voice_settings,
        seed,
        apply_text_normalization,
        language_code,
      }),
    });
    const ttfbMs = Date.now() - proxyStart;
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Proxy] ElevenLabs TTS failed (${response.status}) in ${ttfbMs}ms, model=${model_id}, text=${(text || "").substring(0, 80)}`,
      );
      return res
        .status(response.status)
        .json({ error: `ElevenLabs API error (${response.status})`, detail });
    }
    console.log(
      `[Proxy] ElevenLabs TTS TTFB=${ttfbMs}ms, model=${model_id}, voice=${voiceId}, text=${(text || "").length} chars`,
    );
    // Stream the response through — don't buffer the entire audio
    res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");
    const { Readable } = require("stream");
    const nodeStream = Readable.fromWeb(response.body);
    let totalBytes = 0;
    nodeStream.on("data", (chunk) => {
      totalBytes += chunk.length;
    });
    nodeStream.on("end", () => {
      const totalMs = Date.now() - proxyStart;
      console.log(
        `[Proxy] ElevenLabs TTS stream complete: ${totalBytes} bytes in ${totalMs}ms (TTFB=${ttfbMs}ms, stream=${totalMs - ttfbMs}ms)`,
      );
    });
    nodeStream.pipe(res);
  } catch (err) {
    console.error("[Proxy] ElevenLabs TTS error:", err.message);
    res.status(502).json({ error: "proxy_error", service: "elevenlabs", message: err.message });
  }
});

// POST /api/proxy/tts/openai - OpenAI TTS proxy
app.post("/api/proxy/tts/openai", async (req, res) => {
  const apiKey = await resolveServiceKeyForProxy("OPENAI_API_KEY");
  if (!apiKey) {
    return res.status(503).json({ error: "missing_api_key", service: "openai" });
  }
  const { model, input, voice, response_format } = req.body;
  if (!input) {
    return res.status(400).json({ error: "input is required" });
  }
  try {
    const baseUrl = (process.env.OPENAI_TTS_BASE_URL || "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "gpt-4o-mini-tts",
        input,
        voice: voice || "alloy",
        response_format: response_format || "mp3",
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return res
        .status(response.status)
        .json({ error: `OpenAI TTS API error (${response.status})`, detail });
    }
    res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error("[Proxy] OpenAI TTS error:", err.message);
    res.status(502).json({ error: "proxy_error", service: "openai", message: err.message });
  }
});

// POST /api/proxy/tts/fish - Fish Audio TTS proxy
app.post("/api/proxy/tts/fish", async (req, res) => {
  const apiKey = await resolveServiceKeyForProxy("FISH_API_KEY");
  if (!apiKey) {
    return res.status(503).json({ error: "missing_api_key", service: "fish" });
  }
  const { reference_id, text, format } = req.body;
  if (!reference_id || !text) {
    return res.status(400).json({ error: "reference_id and text are required" });
  }
  try {
    const proxyStart = Date.now();
    const response = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        reference_id,
        format: format || "mp3",
      }),
    });
    const latencyMs = Date.now() - proxyStart;
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Proxy] Fish TTS failed (${response.status}) in ${latencyMs}ms, voice=${reference_id}, text=${(text || "").substring(0, 80)}`,
      );
      return res
        .status(response.status)
        .json({ error: `Fish API error (${response.status})`, detail });
    }
    console.log(
      `[Proxy] Fish TTS complete in ${latencyMs}ms, voice=${reference_id}, text=${(text || "").length} chars`,
    );
    res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    const { Readable } = require("stream");
    const nodeStream = Readable.fromWeb(response.body);
    nodeStream.pipe(res);
  } catch (err) {
    console.error("[Proxy] Fish TTS error:", err.message);
    res.status(502).json({ error: "proxy_error", service: "fish", message: err.message });
  }
});

// POST /api/proxy/search/brave - Brave Search proxy
app.post("/api/proxy/search/brave", async (req, res) => {
  const apiKey = await resolveServiceKeyForProxy("BRAVE_API_KEY");
  if (!apiKey) {
    return res.status(503).json({ error: "missing_api_key", service: "brave" });
  }
  const { query, count, country, search_lang, ui_lang, freshness } = req.body;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }
  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    if (count) url.searchParams.set("count", String(count));
    if (country) url.searchParams.set("country", country);
    if (search_lang) url.searchParams.set("search_lang", search_lang);
    if (ui_lang) url.searchParams.set("ui_lang", ui_lang);
    if (freshness) url.searchParams.set("freshness", freshness);
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return res
        .status(response.status)
        .json({ error: `Brave Search API error (${response.status})`, detail });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("[Proxy] Brave Search error:", err.message);
    res.status(502).json({ error: "proxy_error", service: "brave", message: err.message });
  }
});

// POST /api/proxy/search/perplexity - Perplexity Search proxy
app.post("/api/proxy/search/perplexity", async (req, res) => {
  const apiKey =
    (await resolveServiceKeyForProxy("PERPLEXITY_API_KEY")) ||
    (await resolveServiceKeyForProxy("OPENROUTER_API_KEY"));
  if (!apiKey) {
    return res.status(503).json({ error: "missing_api_key", service: "perplexity" });
  }
  const { query, model } = req.body;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }
  try {
    // Security: baseUrl is NOT accepted from client (SSRF risk) — use env only
    const endpoint =
      (process.env.PERPLEXITY_BASE_URL || "https://api.perplexity.ai").replace(/\/$/, "") +
      "/chat/completions";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://argentos.ai",
        "X-Title": "Argent Web Search",
      },
      body: JSON.stringify({
        model: model || "perplexity/sonar-pro",
        messages: [{ role: "user", content: query }],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return res
        .status(response.status)
        .json({ error: `Perplexity API error (${response.status})`, detail });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("[Proxy] Perplexity error:", err.message);
    res.status(502).json({ error: "proxy_error", service: "perplexity", message: err.message });
  }
});

// POST /api/proxy/fetch/firecrawl - Firecrawl web scraping proxy
app.post("/api/proxy/fetch/firecrawl", async (req, res) => {
  const { url, formats, onlyMainContent, timeout, maxAge, proxy, storeInCache } = req.body;
  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }
  // Security: block SSRF — reject internal/private URLs (check BEFORE API key)
  if (!isExternalUrl(url)) {
    return res.status(400).json({ error: "URL must be an external public URL" });
  }
  const apiKey = await resolveServiceKeyForProxy("FIRECRAWL_API_KEY");
  if (!apiKey) {
    return res.status(503).json({ error: "missing_api_key", service: "firecrawl" });
  }
  try {
    const baseUrl = (process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev").replace(
      /\/+$/,
      "",
    );
    const response = await fetch(`${baseUrl}/v2/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: formats || ["markdown"],
        onlyMainContent: onlyMainContent ?? true,
        timeout,
        maxAge,
        proxy,
        storeInCache,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return res
        .status(response.status)
        .json({ error: `Firecrawl API error (${response.status})`, detail });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("[Proxy] Firecrawl error:", err.message);
    res.status(502).json({ error: "proxy_error", service: "firecrawl", message: err.message });
  }
});

// POST /api/proxy/summarize - Conversational TTS summary via fast LLM
app.post("/api/proxy/summarize", async (req, res) => {
  const apiKey = await resolveServiceKeyForProxy("OPENAI_API_KEY");
  if (!apiKey) {
    return res.status(503).json({ error: "missing_api_key", service: "openai" });
  }
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 400,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: `You are a voice summary assistant for an AI named Argent. Your job is to take Argent's written response and rephrase it as natural spoken dialogue — as if Argent is casually telling the user what happened.

Rules:
- Speak in first person as Argent ("I did...", "I found...")
- Sound conversational and natural, like talking to a friend
- Keep it concise — capture the key points, skip technical details, code, file paths, and lists
- Use contractions (I've, it's, that's, don't)
- Never use markdown, bullet points, or formatting
- Never say "here's a summary" or "in summary" — just talk naturally
- If the response mentions completing tasks, say what you did and the result
- Max 3-4 sentences for most responses, up to 6 for complex ones
- End on a natural note, not mid-thought`,
          },
          {
            role: "user",
            content: `Rephrase this as natural spoken dialogue:\n\n${text.substring(0, 3000)}`,
          },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[Proxy] Summarize API error:", response.status, detail);
      return res
        .status(response.status)
        .json({ error: `OpenAI API error (${response.status})`, detail });
    }
    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || "";
    res.json({ summary });
  } catch (err) {
    console.error("[Proxy] Summarize error:", err.message);
    res.status(502).json({ error: "proxy_error", service: "summarize", message: err.message });
  }
});

// ============================================
// AUTH SETTINGS API - API key management
// ============================================

const AUTH_PROFILES_PATH = path.join(
  process.env.HOME,
  ".argentos",
  "agents",
  "main",
  "agent",
  "auth-profiles.json",
);
const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_AUTH_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_AUDIENCE = "https://api.openai.com/v1";
const OPENAI_CODEX_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";
const OPENAI_CODEX_OAUTH_TTL_MS = 10 * 60 * 1000;
const openAICodexAuthSessions = new Map();

function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return key.substring(0, 7) + "***..." + key.substring(key.length - 4);
}

function generateCodeVerifier(length = 64) {
  return crypto.randomBytes(length).toString("base64url").slice(0, 128);
}

function generateCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function generateOAuthState() {
  return crypto.randomBytes(32).toString("hex");
}

function cleanupOpenAICodexAuthSessions() {
  const now = Date.now();
  for (const [state, session] of openAICodexAuthSessions.entries()) {
    if ((session.createdAt || 0) + OPENAI_CODEX_OAUTH_TTL_MS < now) {
      openAICodexAuthSessions.delete(state);
    }
  }
}

function createOpenAICodexRedirectUri(req) {
  const host = req.get("host") || `127.0.0.1:${PORT}`;
  return `${req.protocol}://${host}/api/settings/auth-profiles/openai-codex/oauth/callback`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function writeOpenAICodexOAuthProfile(tokenData) {
  const data = readAuthProfiles();
  const existingProfile = data.profiles?.["openai-codex:default"] || {};
  if (!data.profiles) data.profiles = {};
  data.profiles["openai-codex:default"] = {
    type: "oauth",
    provider: "openai-codex",
    access: tokenData.access_token,
    refresh: tokenData.refresh_token || existingProfile.refresh,
    expires: tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : existingProfile.expires,
    accountId: existingProfile.accountId,
    email: existingProfile.email,
  };
  if (!data.order) data.order = {};
  if (!Array.isArray(data.order["openai-codex"])) {
    data.order["openai-codex"] = [];
  }
  if (!data.order["openai-codex"].includes("openai-codex:default")) {
    data.order["openai-codex"].unshift("openai-codex:default");
  }
  if (!data.lastGood) data.lastGood = {};
  data.lastGood["openai-codex"] = "openai-codex:default";
  writeAuthProfiles(data);
}

function readAuthProfiles() {
  try {
    if (fs.existsSync(AUTH_PROFILES_PATH)) {
      return JSON.parse(fs.readFileSync(AUTH_PROFILES_PATH, "utf-8"));
    }
  } catch (err) {
    console.error("[Auth] Failed to read auth profiles:", err.message);
  }
  return { version: 1, profiles: {} };
}

function writeAuthProfiles(data) {
  const dir = path.dirname(AUTH_PROFILES_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(AUTH_PROFILES_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// GET /api/settings/auth - Returns current auth profiles with masked keys
app.get("/api/settings/auth", (req, res) => {
  console.log("[Auth] GET settings/auth");
  try {
    const data = readAuthProfiles();
    const profiles = Object.entries(data.profiles || {}).map(([id, profile]) => ({
      id,
      provider: profile.provider || id.split(":")[0],
      type: profile.type || "api_key",
      maskedKey: maskKey(profile.key),
    }));
    res.json({ profiles });
  } catch (err) {
    console.error("[Auth] Error reading profiles:", err);
    res.status(500).json({ error: "Failed to read auth profiles" });
  }
});

// PUT /api/settings/auth - Update an API key
app.put("/api/settings/auth", (req, res) => {
  console.log("[Auth] PUT settings/auth");
  const { provider, key } = req.body;

  if (!provider || !key) {
    return res.status(400).json({ error: "Provider and key are required" });
  }

  if (!key.startsWith("sk-ant-")) {
    return res.status(400).json({ error: "Invalid Anthropic API key format" });
  }

  try {
    const data = readAuthProfiles();
    const profileId = `${provider}:default`;

    data.profiles[profileId] = {
      type: "api_key",
      provider,
      key,
    };

    writeAuthProfiles(data);
    console.log("[Auth] Updated profile:", profileId);
    res.json({ success: true, maskedKey: maskKey(key) });
  } catch (err) {
    console.error("[Auth] Error updating profile:", err);
    res.status(500).json({ error: "Failed to update auth profile" });
  }
});

// ============================================
// SERVICE KEYS API - Centralized API key management
// ============================================

const SERVICE_KEYS_PATH = path.join(process.env.HOME, ".argentos", "service-keys.json");

// Known API variable catalog — searchable dropdown options
const KNOWN_API_VARIABLES = [
  {
    variable: "ANTHROPIC_API_KEY",
    service: "Anthropic",
    category: "LLM",
    description: "Claude API key",
  },
  {
    variable: "ANTHROPIC_BATCH_API_KEY",
    service: "Anthropic",
    category: "LLM",
    description: "Claude Batch API key",
  },
  {
    variable: "OPENAI_API_KEY",
    service: "OpenAI",
    category: "LLM",
    description: "OpenAI API key (GPT, TTS, Whisper)",
  },
  {
    variable: "GOOGLE_GEMINI_API_KEY",
    service: "Google",
    category: "LLM",
    description: "Gemini API key",
  },
  {
    variable: "GOOGLE_API_KEY",
    service: "Google",
    category: "LLM",
    description: "Google AI API key",
  },
  {
    variable: "DEEPSEEK_API_KEY",
    service: "DeepSeek",
    category: "LLM",
    description: "DeepSeek API key",
  },
  { variable: "XAI_API_KEY", service: "xAI", category: "LLM", description: "Grok API key" },
  {
    variable: "GROQ_LLAMA_API_KEY",
    service: "Groq",
    category: "LLM",
    description: "Groq (fast Llama inference)",
  },
  {
    variable: "OPENROUTER_API_KEY",
    service: "OpenRouter",
    category: "LLM",
    description: "OpenRouter multi-model proxy",
  },
  {
    variable: "REQUESTY_API_KEY",
    service: "Requesty",
    category: "LLM",
    description: "Requesty AI router",
  },
  {
    variable: "CODESTRAL_API_KEY",
    service: "Mistral",
    category: "LLM",
    description: "Codestral / Mistral API",
  },
  {
    variable: "OLLAMA_API_KEY",
    service: "Ollama",
    category: "LLM",
    description: "Ollama local models",
  },
  {
    variable: "ELEVENLABS_API_KEY",
    service: "ElevenLabs",
    category: "TTS",
    description: "ElevenLabs text-to-speech",
  },
  {
    variable: "DEEPGRAM_API_KEY",
    service: "Deepgram",
    category: "TTS",
    description: "Deepgram speech-to-text",
  },
  {
    variable: "RESEMBLE_AI_API_KEY",
    service: "Resemble AI",
    category: "TTS",
    description: "Resemble AI voice cloning",
  },
  {
    variable: "BRAVE_API_KEY",
    service: "Brave",
    category: "Search",
    description: "Brave Search API",
  },
  {
    variable: "PERPLEXITY_API_KEY",
    service: "Perplexity",
    category: "Search",
    description: "Perplexity AI search",
  },
  {
    variable: "SERPER_API_KEY",
    service: "Serper",
    category: "Search",
    description: "Serper Google search",
  },
  {
    variable: "SERPAPI_API_KEY",
    service: "SerpAPI",
    category: "Search",
    description: "SerpAPI search results",
  },
  {
    variable: "SCALE_SERP_API_KEY",
    service: "ScaleSerp",
    category: "Search",
    description: "ScaleSerp search",
  },
  { variable: "EXA_API_KEY", service: "Exa", category: "Search", description: "Exa neural search" },
  {
    variable: "GOOGLE_PROGRAMMABLE_SEARCH_API_KEY",
    service: "Google",
    category: "Search",
    description: "Google Programmable Search",
  },
  {
    variable: "GOOGLE_SEARCH_ENGINE_API_KEY",
    service: "Google",
    category: "Search",
    description: "Google Search Engine ID",
  },
  {
    variable: "BING_API_KEY",
    service: "Microsoft",
    category: "Search",
    description: "Bing Search API",
  },
  {
    variable: "FIRECRAWL_API_KEY",
    service: "Firecrawl",
    category: "Web",
    description: "Firecrawl web scraping",
  },
  {
    variable: "JINA_AI_API_KEY",
    service: "Jina AI",
    category: "Web",
    description: "Jina AI reader/embeddings",
  },
  {
    variable: "CONTEXT7_API_KEY",
    service: "Context7",
    category: "Web",
    description: "Context7 documentation API",
  },
  {
    variable: "E2B_API_KEY",
    service: "E2B",
    category: "Compute",
    description: "E2B code sandboxes",
  },
  {
    variable: "GITHUB_PERSONAL_CLASSIC_API_KEY",
    service: "GitHub",
    category: "Dev",
    description: "GitHub personal access token",
  },
  {
    variable: "LANGCHAIN_API_KEY",
    service: "LangChain",
    category: "Dev",
    description: "LangChain/LangSmith",
  },
  {
    variable: "PINECONE_API_KEY",
    service: "Pinecone",
    category: "Vector DB",
    description: "Pinecone vector database",
  },
  {
    variable: "HUGGINGFACE_HUB_READ_API_KEY",
    service: "HuggingFace",
    category: "ML",
    description: "HuggingFace Hub (read)",
  },
  {
    variable: "HUGGINGFACE_HUB_WRITE_API_KEY",
    service: "HuggingFace",
    category: "ML",
    description: "HuggingFace Hub (write)",
  },
  {
    variable: "CLOUDFLARE_API_TOKEN",
    service: "Cloudflare",
    category: "Cloud",
    description: "Cloudflare API token",
  },
  {
    variable: "COOLIFY_API_KEY",
    service: "Coolify",
    category: "Deploy",
    description: "Coolify API token",
  },
  {
    variable: "RAILWAY_API_TOKEN",
    service: "Railway",
    category: "Deploy",
    description: "Railway API token",
  },
  {
    variable: "RAILWAY_API_KEY",
    service: "Railway",
    category: "Deploy",
    description: "Railway API key (alias)",
  },
  {
    variable: "VERCEL_API_TOKEN",
    service: "Vercel",
    category: "Deploy",
    description: "Vercel API token",
  },
  {
    variable: "VERCEL_TEAM_ID",
    service: "Vercel",
    category: "Deploy",
    description: "Vercel team ID",
  },
  {
    variable: "NAMECHEAP_API_KEY",
    service: "Namecheap",
    category: "DNS",
    description: "Namecheap API key",
  },
  {
    variable: "NAMECHEAP_API_USER",
    service: "Namecheap",
    category: "DNS",
    description: "Namecheap API user",
  },
  {
    variable: "NAMECHEAP_USERNAME",
    service: "Namecheap",
    category: "DNS",
    description: "Namecheap account username",
  },
  {
    variable: "NAMECHEAP_CLIENT_IP",
    service: "Namecheap",
    category: "DNS",
    description: "Namecheap API whitelisted client IP",
  },
  {
    variable: "EASYDMARC_API_KEY",
    service: "EasyDMARC",
    category: "DNS",
    description: "EasyDMARC Public API key",
  },
  {
    variable: "NGROK_API_KEY",
    service: "Ngrok",
    category: "Network",
    description: "Ngrok tunnel API key",
  },
  {
    variable: "MAILGUN_TITANIUM_API_KEY",
    service: "Mailgun",
    category: "Email",
    description: "Mailgun email API",
  },
  {
    variable: "MAILGUN_API_KEY",
    service: "Mailgun",
    category: "Email",
    description: "Mailgun API key",
  },
  {
    variable: "MAILGUN_DOMAIN",
    service: "Mailgun",
    category: "Email",
    description: "Mailgun sending domain",
  },
  {
    variable: "RESEND_API_KEY",
    service: "Resend",
    category: "Email",
    description: "Resend API key",
  },
  {
    variable: "SENDGRID_API_KEY",
    service: "SendGrid",
    category: "Email",
    description: "SendGrid API key",
  },
  {
    variable: "TWILIO_ACCOUNT_SID",
    service: "Twilio",
    category: "Communication",
    description: "Twilio account SID",
  },
  {
    variable: "TWILIO_AUTH_TOKEN",
    service: "Twilio",
    category: "Communication",
    description: "Twilio auth token",
  },
  {
    variable: "TWILIO_FROM_NUMBER",
    service: "Twilio",
    category: "Communication",
    description: "Twilio default from number",
  },
  {
    variable: "IMGBB_API_KEY",
    service: "ImgBB",
    category: "Media",
    description: "ImgBB image hosting",
  },
  {
    variable: "PIAPI_KLING_API_KEY",
    service: "PiAPI",
    category: "Media",
    description: "Kling video generation",
  },
  {
    variable: "GOOGLE_MAPS_API_KEY",
    service: "Google",
    category: "Maps",
    description: "Google Maps API",
  },
  {
    variable: "GOOGLE_CLOUD_VISION_API_KEY",
    service: "Google",
    category: "Vision",
    description: "Google Cloud Vision",
  },
  {
    variable: "TINYMCE_API_KEY",
    service: "TinyMCE",
    category: "Editor",
    description: "TinyMCE rich text editor",
  },
  {
    variable: "NETFLY_API_KEY",
    service: "Netlify",
    category: "Deploy",
    description: "Netlify deployment",
  },
  {
    variable: "MOLTYVERSE_EMAIL_API_KEY",
    service: "Moltyverse",
    category: "Social",
    description: "Moltyverse Email API key (agent inbox)",
  },
  {
    variable: "MOLTYVERSE_EMAIL_ADDRESS",
    service: "Moltyverse",
    category: "Social",
    description: "Agent's Moltyverse email address (e.g., argent@moltyverse.email)",
  },
  {
    variable: "MOLTYVERSE_API_KEY",
    service: "Moltyverse",
    category: "Social",
    description: "Moltyverse social platform API key",
  },
  {
    variable: "FAL_API_KEY",
    service: "FAL",
    category: "Media",
    description: "FAL.ai image/audio generation",
  },
  {
    variable: "HEYGEN_API_KEY",
    service: "HeyGen",
    category: "Media",
    description: "HeyGen video generation",
  },
];

// ---- Secret Encryption (AES-256-GCM, master key from Keychain / file) ----
const KEYCHAIN_SERVICE = "ArgentOS-MasterKey";
const KEYCHAIN_ACCOUNT = "ArgentOS";
const MASTER_KEY_FILE = path.join(process.env.HOME, ".argentos", ".master-key");
const ENC_PREFIX = "enc:v1:";

let _masterKeyCache = null;

function readEncryptedServiceKeyValues() {
  try {
    const data = JSON.parse(fs.readFileSync(SERVICE_KEYS_PATH, "utf-8"));
    return (data.keys || [])
      .map((entry) => (typeof entry.value === "string" ? entry.value : ""))
      .filter((value) => value.startsWith(ENC_PREFIX));
  } catch {
    return [];
  }
}

function canDecryptSecretValue(value, key) {
  const parts = value.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) return false;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "hex"));
    decipher.setAuthTag(Buffer.from(parts[1], "hex"));
    decipher.update(parts[2], "hex", "utf8");
    decipher.final("utf8");
    return true;
  } catch {
    return false;
  }
}

function canDecryptExistingSecrets(key) {
  const encryptedValues = readEncryptedServiceKeyValues();
  if (encryptedValues.length === 0) return true;
  return encryptedValues.every((value) => canDecryptSecretValue(value, key));
}

function getMasterKey() {
  if (_masterKeyCache) return _masterKeyCache;
  let keychainKey = null;
  if (process.platform === "darwin") {
    try {
      const hex = execSync(
        `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w`,
        { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
      const buf = Buffer.from(hex, "hex");
      if (buf.length === 32) {
        keychainKey = buf;
      }
    } catch {
      /* not found */
    }
  }
  let fileKey = null;
  try {
    const hex = fs.readFileSync(MASTER_KEY_FILE, "utf-8").trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length === 32) {
      fileKey = buf;
    }
  } catch {
    /* not found */
  }

  if (readEncryptedServiceKeyValues().length > 0) {
    if (keychainKey && canDecryptExistingSecrets(keychainKey)) {
      _masterKeyCache = keychainKey;
      return keychainKey;
    }
    if (fileKey && canDecryptExistingSecrets(fileKey)) {
      _masterKeyCache = fileKey;
      return fileKey;
    }
    if (keychainKey || fileKey) {
      throw new Error(
        "Master encryption key mismatch. Existing encrypted service keys cannot be decrypted.",
      );
    }
  }

  if (keychainKey) {
    _masterKeyCache = keychainKey;
    return keychainKey;
  }
  if (fileKey) {
    _masterKeyCache = fileKey;
    return fileKey;
  }

  // Generate new key
  const key = crypto.randomBytes(32);
  if (process.platform === "darwin") {
    try {
      try {
        execSync(
          `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}"`,
          { stdio: "pipe" },
        );
      } catch {}
      execSync(
        `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w "${key.toString("hex")}"`,
        { stdio: "pipe" },
      );
    } catch {
      /* fall through to file */
    }
  }
  const dir = path.dirname(MASTER_KEY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MASTER_KEY_FILE, key.toString("hex"), "utf-8");
  fs.chmodSync(MASTER_KEY_FILE, 0o600);
  _masterKeyCache = key;
  return key;
}

function encryptSecret(plaintext) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  return `${ENC_PREFIX}${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc}`;
}

function decryptSecret(value) {
  if (!value || !value.startsWith(ENC_PREFIX)) return value;
  const parts = value.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) return value;
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "hex"));
  decipher.setAuthTag(Buffer.from(parts[1], "hex"));
  let dec = decipher.update(parts[2], "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

function tryDecryptSecret(value) {
  try {
    return { value: decryptSecret(value), error: null };
  } catch (error) {
    return { value: "", error };
  }
}

function isEncryptedValue(value) {
  return value && value.startsWith(ENC_PREFIX);
}

function readServiceKeys() {
  try {
    if (fs.existsSync(SERVICE_KEYS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SERVICE_KEYS_PATH, "utf-8"));
      // Auto-encrypt any plaintext values
      let migrated = false;
      for (const entry of data.keys || []) {
        if (entry.value && !isEncryptedValue(entry.value)) {
          entry.value = encryptSecret(entry.value);
          migrated = true;
        }
      }
      if (migrated) {
        fs.writeFileSync(SERVICE_KEYS_PATH, JSON.stringify(data, null, 2), "utf-8");
        fs.chmodSync(SERVICE_KEYS_PATH, 0o600);
        console.log("[ServiceKeys] Migrated plaintext keys to encrypted storage");
      }
      return data;
    }
  } catch (err) {
    console.error("[ServiceKeys] Failed to read:", err.message);
  }
  return { version: 1, keys: [] };
}

function writeServiceKeys(data) {
  const dir = path.dirname(SERVICE_KEYS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SERVICE_KEYS_PATH, JSON.stringify(data, null, 2), "utf-8");
  fs.chmodSync(SERVICE_KEYS_PATH, 0o600); // Only owner can read (contains secrets)
}

// Resolve a service key: service-keys.json first, then env var fallback
function resolveServiceKey(variable) {
  const data = readServiceKeys();
  const entry = data.keys.find((k) => k.variable === variable && k.enabled !== false);
  if (entry?.value) {
    const decrypted = tryDecryptSecret(entry.value);
    if (!decrypted.error) return decrypted.value;
    console.warn("[ServiceKeys] Failed to decrypt key, falling back:", variable, decrypted.error);
  }
  return process.env[variable] || "";
}

// PG-aware key resolution for proxy routes.
// Resolution order is handled by infra/service-keys:
//   1) PostgreSQL secret store (when enabled)
//   2) service-keys.json
//   3) process.env
let _asyncServiceKeyResolverPromise = null;
let _pgServiceKeyClientPromise = null;

async function getPgServiceKeyClient() {
  if (_pgServiceKeyClientPromise) return _pgServiceKeyClientPromise;
  _pgServiceKeyClientPromise = (async () => {
    try {
      const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
      if (!fs.existsSync(configPath)) return null;
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const storage = raw?.storage ?? {};
      const backend = storage.backend ?? "sqlite";
      const pgConn = storage?.postgres?.connectionString;
      const pgEnabled = backend === "postgres" || backend === "dual";
      if (!pgEnabled || !pgConn) return null;
      const pgMod = await import("postgres");
      const postgres = pgMod.default || pgMod;
      return postgres(pgConn, { max: 2, idle_timeout: 5, connect_timeout: 5 });
    } catch {
      return null;
    }
  })();
  return _pgServiceKeyClientPromise;
}

async function resolveServiceKeyFromPgDirect(variable) {
  try {
    const sql = await getPgServiceKeyClient();
    if (!sql) return "";
    const rows = await sql`
      SELECT encrypted_value
      FROM service_keys
      WHERE variable = ${variable} AND enabled = true
      LIMIT 1
    `;
    const encrypted = rows?.[0]?.encrypted_value;
    if (typeof encrypted === "string" && encrypted.length > 0) {
      return decryptSecret(encrypted);
    }
  } catch {}
  return "";
}

async function resolveServiceKeyForProxy(variable) {
  try {
    if (!_asyncServiceKeyResolverPromise) {
      _asyncServiceKeyResolverPromise = import("../dist/infra/service-keys.js")
        .then((mod) =>
          typeof mod.resolveServiceKeyAsync === "function" ? mod.resolveServiceKeyAsync : null,
        )
        .catch(() => null);
    }
    const resolveAsync = await _asyncServiceKeyResolverPromise;
    if (resolveAsync) {
      const value = await resolveAsync(variable);
      if (value) return value;
    }
  } catch {}
  const pgValue = await resolveServiceKeyFromPgDirect(variable);
  if (pgValue) return pgValue;
  return resolveServiceKey(variable);
}

// GET /api/settings/service-keys - List all keys (masked) + known catalog
app.get("/api/settings/service-keys", (req, res) => {
  try {
    const data = readServiceKeys();
    const keys = (data.keys || []).map((k) => ({
      ...(function () {
        const decrypted = tryDecryptSecret(k.value);
        return {
          maskedValue: decrypted.error ? "[unreadable]" : maskKey(decrypted.value),
          encrypted: isEncryptedValue(k.value),
          decryptable: !decrypted.error,
          decryptError: decrypted.error
            ? "Stored value cannot be decrypted with the current master key"
            : null,
        };
      })(),
      id: k.id,
      name: k.name,
      variable: k.variable,
      service: k.service || "",
      category: k.category || "",
      allowedRoles: Array.isArray(k.allowedRoles) ? k.allowedRoles : [],
      allowedAgents: Array.isArray(k.allowedAgents) ? k.allowedAgents : [],
      allowedTeams: Array.isArray(k.allowedTeams) ? k.allowedTeams : [],
      denyAll: k.denyAll === true,
      enabled: k.enabled !== false,
      source: k.source || "manual",
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
    }));
    res.json({ keys, catalog: KNOWN_API_VARIABLES });
  } catch (err) {
    console.error("[ServiceKeys] Error listing:", err);
    res.status(500).json({ error: "Failed to read service keys" });
  }
});

// GET /api/settings/service-keys/:id/reveal - Return the full unmasked key value
app.get("/api/settings/service-keys/:id/reveal", (req, res) => {
  try {
    const data = readServiceKeys();
    const key = (data.keys || []).find((k) => k.id === req.params.id);
    if (!key) {
      return res.status(404).json({ error: "Key not found" });
    }
    const decrypted = tryDecryptSecret(key.value);
    if (decrypted.error) {
      return res.status(409).json({
        error: "Stored service key cannot be decrypted with the current master key",
        code: "key_unreadable",
      });
    }
    res.json({ value: decrypted.value });
  } catch (err) {
    console.error("[ServiceKeys] Error revealing:", err);
    res.status(500).json({ error: "Failed to read service key" });
  }
});

// POST /api/settings/service-keys - Add a new key
app.post("/api/settings/service-keys", (req, res) => {
  const {
    name,
    variable,
    value,
    service,
    category,
    allowedRoles,
    allowedAgents,
    allowedTeams,
    denyAll,
  } = req.body;
  if (!variable || !value) {
    return res.status(400).json({ error: "variable and value are required" });
  }
  try {
    const data = readServiceKeys();
    const id = `sk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry = {
      id,
      name: name || variable,
      variable: variable.toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
      value: encryptSecret(value),
      service: service || "",
      category: category || "",
      allowedRoles: Array.isArray(allowedRoles)
        ? allowedRoles.filter((v) => typeof v === "string")
        : [],
      allowedAgents: Array.isArray(allowedAgents)
        ? allowedAgents.filter((v) => typeof v === "string")
        : [],
      allowedTeams: Array.isArray(allowedTeams)
        ? allowedTeams.filter((v) => typeof v === "string")
        : [],
      denyAll: denyAll === true,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.keys.push(entry);
    writeServiceKeys(data);
    console.log("[ServiceKeys] Added:", entry.variable, "as", entry.name);
    res.status(201).json({ key: { ...entry, value: undefined, maskedValue: maskKey(value) } });
  } catch (err) {
    console.error("[ServiceKeys] Error adding:", err);
    res.status(500).json({ error: "Failed to add service key" });
  }
});

// PATCH /api/settings/service-keys/:id - Update a key
app.patch("/api/settings/service-keys/:id", (req, res) => {
  const { name, value, enabled, allowedRoles, allowedAgents, allowedTeams, denyAll } = req.body;
  try {
    const data = readServiceKeys();
    const idx = data.keys.findIndex((k) => k.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Key not found" });
    if (name !== undefined) data.keys[idx].name = name;
    if (value !== undefined) data.keys[idx].value = encryptSecret(value);
    if (enabled !== undefined) data.keys[idx].enabled = enabled;
    if (allowedRoles !== undefined) {
      data.keys[idx].allowedRoles = Array.isArray(allowedRoles)
        ? allowedRoles.filter((v) => typeof v === "string")
        : [];
    }
    if (allowedAgents !== undefined) {
      data.keys[idx].allowedAgents = Array.isArray(allowedAgents)
        ? allowedAgents.filter((v) => typeof v === "string")
        : [];
    }
    if (allowedTeams !== undefined) {
      data.keys[idx].allowedTeams = Array.isArray(allowedTeams)
        ? allowedTeams.filter((v) => typeof v === "string")
        : [];
    }
    if (denyAll !== undefined) data.keys[idx].denyAll = denyAll === true;
    data.keys[idx].updatedAt = new Date().toISOString();
    writeServiceKeys(data);
    const k = data.keys[idx];
    res.json({ key: { ...k, value: undefined, maskedValue: maskKey(decryptSecret(k.value)) } });
  } catch (err) {
    console.error("[ServiceKeys] Error updating:", err);
    res.status(500).json({ error: "Failed to update service key" });
  }
});

// DELETE /api/settings/service-keys/:id - Remove a key
app.delete("/api/settings/service-keys/:id", (req, res) => {
  try {
    const data = readServiceKeys();
    const idx = data.keys.findIndex((k) => k.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Key not found" });
    data.keys.splice(idx, 1);
    writeServiceKeys(data);
    res.json({ success: true });
  } catch (err) {
    console.error("[ServiceKeys] Error deleting:", err);
    res.status(500).json({ error: "Failed to delete service key" });
  }
});

// POST /api/settings/service-keys/migrate - Migrate JSON secrets to PostgreSQL
app.post("/api/settings/service-keys/migrate", async (req, res) => {
  try {
    const { migrateServiceKeysToPg } = await import("../dist/infra/service-keys.js");
    const result = await migrateServiceKeysToPg();
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ migrated: result.migrated, skipped: result.skipped });
  } catch (err) {
    console.error("[ServiceKeys] Migration error:", err);
    res.status(500).json({ error: "Failed to migrate secrets to PostgreSQL" });
  }
});

// GET /api/settings/service-keys/status - Encryption and storage status
app.get("/api/settings/service-keys/status", (req, res) => {
  try {
    const data = readServiceKeys();
    const total = (data.keys || []).length;
    const encrypted = (data.keys || []).filter((k) => isEncryptedValue(k.value)).length;
    const unreadable = (data.keys || []).filter((k) => tryDecryptSecret(k.value).error).length;
    const hasMasterKeyStored = (() => {
      // Check Keychain
      if (process.platform === "darwin") {
        try {
          const hex = execSync(
            `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w`,
            { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
          ).trim();
          return Buffer.from(hex, "hex").length === 32;
        } catch {
          /* not in keychain */
        }
      }
      // Check file
      try {
        return fs.readFileSync(MASTER_KEY_FILE, "utf-8").trim().length === 64;
      } catch {
        return false;
      }
    })();

    res.json({
      total,
      encrypted,
      unreadable,
      plaintext: total - encrypted,
      masterKeyPresent: hasMasterKeyStored,
      keyLocation: process.platform === "darwin" ? "macOS Keychain" : "file",
    });
  } catch (err) {
    console.error("[ServiceKeys] Status error:", err);
    res.status(500).json({ error: "Failed to read status" });
  }
});

// GET /api/settings/service-keys/policy - List key access policies
app.get("/api/settings/service-keys/policy", async (req, res) => {
  try {
    const mod = await import("../dist/infra/service-keys.js");
    if (typeof mod.listServiceKeyPolicies !== "function") {
      return res.status(501).json({ error: "Policy API unavailable in runtime build" });
    }
    const policies = mod.listServiceKeyPolicies();
    res.json({ policies });
  } catch (err) {
    console.error("[ServiceKeys] Policy error:", err);
    res.status(500).json({ error: "Failed to list service key policies" });
  }
});

// POST /api/settings/service-keys/grant - Grant role/agent/team access
app.post("/api/settings/service-keys/grant", async (req, res) => {
  try {
    const { variable, role, agent, team } = req.body || {};
    if (!variable || typeof variable !== "string") {
      return res.status(400).json({ error: "variable is required" });
    }
    const mod = await import("../dist/infra/service-keys.js");
    if (typeof mod.grantServiceKeyAccess !== "function") {
      return res.status(501).json({ error: "Grant API unavailable in runtime build" });
    }
    const result = mod.grantServiceKeyAccess({
      variable: variable.trim(),
      role: typeof role === "string" ? role : undefined,
      agent: typeof agent === "string" ? agent : undefined,
      team: typeof team === "string" ? team : undefined,
    });
    if (!result?.updated) {
      return res.status(400).json({ error: result?.reason || "grant failed" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[ServiceKeys] Grant error:", err);
    res.status(500).json({ error: "Failed to grant service key access" });
  }
});

// POST /api/settings/service-keys/revoke - Revoke role/agent/team access
app.post("/api/settings/service-keys/revoke", async (req, res) => {
  try {
    const { variable, role, agent, team } = req.body || {};
    if (!variable || typeof variable !== "string") {
      return res.status(400).json({ error: "variable is required" });
    }
    const mod = await import("../dist/infra/service-keys.js");
    if (typeof mod.revokeServiceKeyAccess !== "function") {
      return res.status(501).json({ error: "Revoke API unavailable in runtime build" });
    }
    const result = mod.revokeServiceKeyAccess({
      variable: variable.trim(),
      role: typeof role === "string" ? role : undefined,
      agent: typeof agent === "string" ? agent : undefined,
      team: typeof team === "string" ? team : undefined,
    });
    if (!result?.updated) {
      return res.status(400).json({ error: result?.reason || "revoke failed" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[ServiceKeys] Revoke error:", err);
    res.status(500).json({ error: "Failed to revoke service key access" });
  }
});

// GET /api/settings/service-keys/audit - Query key access audit
app.get("/api/settings/service-keys/audit", async (req, res) => {
  try {
    const mod = await import("../dist/infra/service-keys.js");
    if (typeof mod.queryServiceKeyAudit !== "function") {
      return res.status(501).json({ error: "Audit API unavailable in runtime build" });
    }
    const limitRaw = Number(req.query?.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 100;
    const rows = await mod.queryServiceKeyAudit({
      secretVariable:
        typeof req.query?.secret === "string" && req.query.secret.trim().length > 0
          ? req.query.secret.trim()
          : undefined,
      actorId:
        typeof req.query?.actor === "string" && req.query.actor.trim().length > 0
          ? req.query.actor.trim()
          : undefined,
      result:
        req.query?.result === "success" ||
        req.query?.result === "denied" ||
        req.query?.result === "error"
          ? req.query.result
          : undefined,
      action:
        typeof req.query?.action === "string" && req.query.action.trim().length > 0
          ? req.query.action.trim()
          : undefined,
      limit,
    });
    res.json({ events: rows });
  } catch (err) {
    console.error("[ServiceKeys] Audit query error:", err);
    res.status(500).json({ error: "Failed to query service key audit" });
  }
});

// ============================================
// MODEL CONFIGURATION API
// ============================================

const ARGENT_CONFIG_PATH = path.join(process.env.HOME, ".argentos", "argent.json");
const REDACTED_CONFIG_SECRET = "__REDACTED__";
const DEFAULT_IMAGE_ANALYSIS_MODEL = "google/gemini-3-flash-preview";
const DEFAULT_IMAGE_ANALYSIS_FALLBACKS = ["anthropic/claude-sonnet-4-6"];
const DEFAULT_IMAGE_ANALYSIS_TIMEOUT_SECONDS = 60;
const LOAD_PROFILE_PRESETS = {
  desktop: {
    id: "desktop",
    label: "Desktop",
    description: "Full runtime behavior for desktops and larger always-on machines.",
    pollingMultiplier: 1,
    patch: {},
  },
  "balanced-laptop": {
    id: "balanced-laptop",
    label: "Balanced Laptop",
    description: "Keep interactive work responsive while slowing background loops and UI polling.",
    pollingMultiplier: 2,
    patch: {
      heartbeat: { enabled: true, every: "45m" },
      contemplation: { enabled: true, every: "2h", maxCyclesPerHour: 1 },
      sis: { enabled: true, every: "2h", episodesPerConsolidation: 3 },
      executionWorker: {
        enabled: true,
        every: "1h",
        maxRunMinutes: 6,
        maxTasksPerCycle: 4,
        scope: "assigned",
        requireEvidence: true,
        maxNoProgressAttempts: 2,
      },
      maxConcurrent: 2,
      subagents: { maxConcurrent: 1 },
    },
  },
  "cool-laptop": {
    id: "cool-laptop",
    label: "Cool Laptop",
    description: "Prioritize thermals and battery life; keep background behavior sparse.",
    pollingMultiplier: 4,
    patch: {
      heartbeat: { enabled: true, every: "1h" },
      contemplation: { enabled: true, every: "3h", maxCyclesPerHour: 1 },
      sis: { enabled: true, every: "3h", episodesPerConsolidation: 3 },
      executionWorker: {
        enabled: true,
        every: "90m",
        maxRunMinutes: 4,
        maxTasksPerCycle: 2,
        scope: "assigned",
        requireEvidence: true,
        maxNoProgressAttempts: 2,
      },
      maxConcurrent: 1,
      subagents: { maxConcurrent: 1 },
    },
  },
};

function resolveLoadProfileConfig(config) {
  const raw = config?.agents?.defaults?.loadProfile || {};
  const active = typeof raw.active === "string" ? raw.active : "desktop";
  const preset = LOAD_PROFILE_PRESETS[active] || LOAD_PROFILE_PRESETS.desktop;
  return {
    ...preset,
    active: preset.id,
    allowManualOverrides: raw.allowManualOverrides !== false,
    overrides: raw.overrides && typeof raw.overrides === "object" ? raw.overrides : {},
  };
}

function mergeDefined(base, patch) {
  if (!patch || typeof patch !== "object") return { ...base };
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function applyLoadProfileToDefaults(config) {
  const defaults = config?.agents?.defaults;
  if (!defaults || !defaults.loadProfile || defaults.loadProfile.active === "desktop") {
    return defaults || {};
  }

  const resolved = resolveLoadProfileConfig(config);
  const next = { ...defaults };
  const patch = resolved.patch || {};
  if (patch.heartbeat) next.heartbeat = mergeDefined(next.heartbeat || {}, patch.heartbeat);
  if (patch.contemplation) {
    next.contemplation = mergeDefined(next.contemplation || {}, patch.contemplation);
  }
  if (patch.sis) next.sis = mergeDefined(next.sis || {}, patch.sis);
  if (patch.executionWorker) {
    next.executionWorker = mergeDefined(next.executionWorker || {}, patch.executionWorker);
  }
  if (typeof patch.maxConcurrent === "number") next.maxConcurrent = patch.maxConcurrent;
  if (patch.subagents) next.subagents = mergeDefined(next.subagents || {}, patch.subagents);

  if (resolved.allowManualOverrides && resolved.overrides) {
    const overrides = resolved.overrides;
    if (overrides.heartbeat)
      next.heartbeat = mergeDefined(next.heartbeat || {}, overrides.heartbeat);
    if (overrides.contemplation) {
      next.contemplation = mergeDefined(next.contemplation || {}, overrides.contemplation);
    }
    if (overrides.sis) next.sis = mergeDefined(next.sis || {}, overrides.sis);
    if (overrides.executionWorker) {
      next.executionWorker = mergeDefined(next.executionWorker || {}, overrides.executionWorker);
    }
    if (typeof overrides.maxConcurrent === "number") next.maxConcurrent = overrides.maxConcurrent;
    if (overrides.subagents)
      next.subagents = mergeDefined(next.subagents || {}, overrides.subagents);
  }

  return next;
}

function parseProviderModelRef(ref) {
  const normalized = String(ref || "").trim();
  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0 || slashIndex === normalized.length - 1) return null;
  return {
    provider: normalized.slice(0, slashIndex).trim(),
    model: normalized.slice(slashIndex + 1).trim(),
    ref: normalized,
  };
}

function isEmbeddingOnlyModelId(value) {
  const model = String(value || "")
    .trim()
    .toLowerCase();
  if (!model) return false;
  return (
    model.includes("embed") ||
    model.includes("embedding") ||
    model.startsWith("text-embedding-") ||
    model.startsWith("nomic-embed") ||
    model.startsWith("mxbai-embed") ||
    model.startsWith("voyage-") ||
    model.startsWith("gemini-embedding-") ||
    model.includes("/embed-") ||
    /(?:^|[-_:./])embeddings?(?:$|[-_:./\d])/.test(model)
  );
}

function resolveArgentAgentDirForModelCatalog() {
  const override = String(
    process.env.ARGENT_AGENT_DIR || process.env.PI_CODING_AGENT_DIR || "",
  ).trim();
  if (override) {
    return override.replace(/^~(?=$|\/)/, process.env.HOME || "");
  }
  return path.join(process.env.HOME || "", ".argentos", "agents", "main", "agent");
}

let piModelCatalogPromise = null;
let piModelCatalogLoggedError = false;
let piModelCatalogLoadedAt = 0;
const PI_MODEL_CATALOG_CACHE_MS = 60 * 1000;

async function loadPiBackedModelCatalog() {
  if (piModelCatalogPromise && Date.now() - piModelCatalogLoadedAt < PI_MODEL_CATALOG_CACHE_MS) {
    return piModelCatalogPromise;
  }

  piModelCatalogLoadedAt = Date.now();
  piModelCatalogPromise = (async () => {
    try {
      const { AuthStorage, ModelRegistry } = await import("@mariozechner/pi-coding-agent");
      const agentDir = resolveArgentAgentDirForModelCatalog();
      const authStorage = new AuthStorage(path.join(agentDir, "auth.json"));
      const registry = new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
      const entries = Array.isArray(registry)
        ? registry
        : typeof registry.getAll === "function"
          ? registry.getAll()
          : [];
      return entries
        .map((entry) => {
          const id = String(entry?.id || "").trim();
          const provider = String(entry?.provider || "").trim();
          if (!id || !provider) return null;
          const name = String(entry?.name || id).trim() || id;
          return {
            id,
            name,
            provider,
            contextWindow:
              typeof entry?.contextWindow === "number" && entry.contextWindow > 0
                ? entry.contextWindow
                : undefined,
            reasoning: typeof entry?.reasoning === "boolean" ? entry.reasoning : undefined,
            input: Array.isArray(entry?.input) ? entry.input : undefined,
          };
        })
        .filter(Boolean);
    } catch (err) {
      if (!piModelCatalogLoggedError) {
        piModelCatalogLoggedError = true;
        console.warn("[AvailableModels] Pi model catalog unavailable:", err?.message || err);
      }
      piModelCatalogPromise = null;
      return [];
    }
  })();

  return piModelCatalogPromise;
}

async function collectAvailableModelsCatalog(config) {
  const models = config.agents?.defaults?.models || {};
  const modelDefaults = config.agents?.defaults?.model || {};
  const modelRouter = config.agents?.defaults?.modelRouter || {};
  const configuredProviders = config.models?.providers || {};
  const lmStudioProvider = configuredProviders.lmstudio;
  const available = [];
  const availableProviders = new Set();
  const seen = new Set();

  const pushModel = (id, alias = null, params = null) => {
    if (typeof id !== "string" || id.trim().length === 0) return;
    if (seen.has(id)) return;
    seen.add(id);
    const slashIndex = id.indexOf("/");
    if (slashIndex > 0) {
      availableProviders.add(id.slice(0, slashIndex));
    }
    available.push({ id, alias, params });
  };

  for (const [key, entry] of Object.entries(models)) {
    pushModel(key, entry?.alias || null, entry?.params || null);
  }

  if (typeof modelDefaults?.primary === "string") {
    pushModel(modelDefaults.primary);
  }
  if (Array.isArray(modelDefaults?.fallbacks)) {
    for (const fallback of modelDefaults.fallbacks) {
      if (typeof fallback === "string") {
        pushModel(fallback);
      }
    }
  }

  const routerProfiles = modelRouter?.profiles || {};
  for (const profile of Object.values(routerProfiles)) {
    const tiers = profile?.tiers || {};
    for (const tierConfig of Object.values(tiers)) {
      const provider = typeof tierConfig?.provider === "string" ? tierConfig.provider.trim() : "";
      const model = typeof tierConfig?.model === "string" ? tierConfig.model.trim() : "";
      if (provider) {
        availableProviders.add(provider);
        if (model) {
          pushModel(`${provider}/${model}`);
        }
      }
    }

    const contemplationOverride = profile?.sessionOverrides?.contemplation;
    const contemplationProvider =
      typeof contemplationOverride?.provider === "string"
        ? contemplationOverride.provider.trim()
        : "";
    const contemplationModel =
      typeof contemplationOverride?.model === "string" ? contemplationOverride.model.trim() : "";
    if (contemplationProvider) {
      availableProviders.add(contemplationProvider);
      if (contemplationModel) {
        pushModel(`${contemplationProvider}/${contemplationModel}`);
      }
    }
    if (Array.isArray(contemplationOverride?.fallbacks)) {
      for (const fallback of contemplationOverride.fallbacks) {
        if (typeof fallback === "string") {
          pushModel(fallback);
        }
      }
    }
  }

  for (const [providerId, providerConfig] of Object.entries(configuredProviders)) {
    if (typeof providerId === "string" && providerId.trim().length > 0) {
      availableProviders.add(providerId.trim());
    }
    const providerModels = Array.isArray(providerConfig?.models) ? providerConfig.models : [];
    for (const model of providerModels) {
      const modelId =
        typeof model === "string" ? model : typeof model?.id === "string" ? model.id : null;
      if (modelId) {
        pushModel(`${providerId}/${modelId}`);
      }
    }
  }

  const registry = readProviderRegistry();
  const registryProviders = registry?.providers || {};
  for (const [providerId, providerEntry] of Object.entries(registryProviders)) {
    if (typeof providerId === "string" && providerId.trim().length > 0) {
      availableProviders.add(providerId.trim());
    }
    const providerModels = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
    for (const model of providerModels) {
      const modelId =
        typeof model === "string" ? model : typeof model?.id === "string" ? model.id : null;
      const alias =
        typeof model === "object" && model && typeof model?.name === "string" && model.name.trim()
          ? model.name.trim()
          : null;
      if (modelId) {
        pushModel(`${providerId}/${modelId}`, alias);
      }
    }
  }

  const piCatalog = await loadPiBackedModelCatalog();
  for (const entry of piCatalog) {
    pushModel(
      `${entry.provider}/${entry.id}`,
      entry.name && entry.name !== entry.id ? entry.name : null,
      {
        source: "pi",
        contextWindow: entry.contextWindow,
        reasoning: entry.reasoning,
        input: entry.input,
      },
    );
  }

  let authProfilesData = null;
  try {
    authProfilesData = readAuthProfiles();
    for (const [key, profile] of Object.entries(authProfilesData?.profiles || {})) {
      const provider =
        (typeof profile?.provider === "string" && profile.provider.trim().length > 0
          ? profile.provider
          : typeof key === "string" && key.includes(":")
            ? key.split(":")[0]
            : "") || "";
      if (provider) {
        availableProviders.add(provider.trim());
      }
    }
  } catch {
    /* auth profiles unavailable */
  }

  const resolveProviderCredential = (providerId) => {
    const configuredApiKey =
      typeof configuredProviders?.[providerId]?.apiKey === "string"
        ? configuredProviders[providerId].apiKey.trim()
        : "";
    if (configuredApiKey) {
      return configuredApiKey;
    }

    const profiles = authProfilesData?.profiles || {};
    const lastGood = authProfilesData?.lastGood || {};
    const preferredKey = typeof lastGood?.[providerId] === "string" ? lastGood[providerId] : "";
    if (preferredKey && profiles[preferredKey]) {
      const preferred = profiles[preferredKey];
      if (typeof preferred?.token === "string" && preferred.token.trim()) {
        return preferred.token.trim();
      }
      if (typeof preferred?.key === "string" && preferred.key.trim()) {
        return preferred.key.trim();
      }
    }

    for (const profile of Object.values(profiles)) {
      if (profile?.provider !== providerId) continue;
      if (typeof profile?.token === "string" && profile.token.trim()) {
        return profile.token.trim();
      }
      if (typeof profile?.key === "string" && profile.key.trim()) {
        return profile.key.trim();
      }
    }
    return "";
  };

  const fetchOpenAICompatModels = async (providerId, baseUrl, apiKey, requireKey = true) => {
    if (requireKey && !apiKey) return;
    const normalizedBaseUrl = String(baseUrl || "")
      .trim()
      .replace(/\/+$/, "");
    if (!normalizedBaseUrl) return;
    const modelsUrl = normalizedBaseUrl.endsWith("/v1")
      ? `${normalizedBaseUrl}/models`
      : `${normalizedBaseUrl}/v1/models`;
    const headers = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(modelsUrl, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) return;
      const payload = await response.json();
      for (const model of Array.isArray(payload?.data) ? payload.data : []) {
        if (typeof model?.id === "string" && model.id.trim().length > 0) {
          pushModel(`${providerId}/${model.id.trim()}`);
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    const ollamaRes = execSync("curl -s http://127.0.0.1:11434/api/tags", { timeout: 3000 });
    const ollamaData = JSON.parse(ollamaRes.toString());
    for (const m of ollamaData.models || []) {
      pushModel(`ollama/${m.name}`);
    }
  } catch {
    /* Ollama not running */
  }

  try {
    await Promise.all([
      fetchOpenAICompatModels(
        "openai",
        configuredProviders?.openai?.baseUrl || "https://api.openai.com/v1",
        resolveProviderCredential("openai"),
        true,
      ),
      fetchOpenAICompatModels(
        "openai-codex",
        configuredProviders?.["openai-codex"]?.baseUrl || "https://api.openai.com/v1",
        resolveProviderCredential("openai-codex") || resolveProviderCredential("openai"),
        true,
      ),
      fetchOpenAICompatModels(
        "openrouter",
        configuredProviders?.openrouter?.baseUrl || "https://openrouter.ai/api/v1",
        resolveProviderCredential("openrouter"),
        false,
      ),
    ]);
  } catch {
    /* live provider model discovery best-effort */
  }

  try {
    const baseUrlRaw = resolveLmStudioDiscoveryBaseUrl(config, configuredProviders);
    const normalizedBaseUrl = baseUrlRaw.replace(/\/+$/, "");
    const lmStudioModelsUrl = normalizedBaseUrl.endsWith("/v1")
      ? `${normalizedBaseUrl}/models`
      : `${normalizedBaseUrl}/v1/models`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const lmStudioRes = await fetch(lmStudioModelsUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (lmStudioRes.ok) {
      const lmStudioData = await lmStudioRes.json();
      for (const model of Array.isArray(lmStudioData?.data) ? lmStudioData.data : []) {
        if (typeof model?.id === "string" && model.id.trim().length > 0) {
          pushModel(`lmstudio/${model.id.trim()}`);
        }
      }
    }
  } catch {
    /* LM Studio not running */
  }

  return {
    models: available,
    providers: Array.from(availableProviders).sort((a, b) => a.localeCompare(b)),
  };
}

function buildBackgroundModelRecommendations(config, catalog) {
  const effectiveDefaults = applyLoadProfileToDefaults(config);
  const loadProfile = resolveLoadProfileConfig(config);
  const defaults = effectiveDefaults || {};
  const backgroundModels = config?.agents?.defaults?.backgroundModels || {};
  const memoryMmuLlm = config.memory?.memu?.llm || {};
  const memorySearch = config.agents?.defaults?.memorySearch || {};
  const parseSelection = (value) => {
    const parsed = parseProviderModelRef(value);
    return parsed
      ? { provider: parsed.provider, model: parsed.model, ref: parsed.ref }
      : { provider: "", model: "", ref: "" };
  };
  const current = {
    kernel: parseSelection(config?.agents?.defaults?.kernel?.localModel),
    contemplation: parseSelection(defaults.contemplation?.model),
    sis: parseSelection(defaults.sis?.model || defaults.contemplation?.model),
    heartbeat: parseSelection(defaults.heartbeat?.model),
    executionWorker: parseSelection(defaults.executionWorker?.model),
    memu: {
      provider: typeof memoryMmuLlm.provider === "string" ? memoryMmuLlm.provider.trim() : "",
      model: typeof memoryMmuLlm.model === "string" ? memoryMmuLlm.model.trim() : "",
      ref:
        typeof memoryMmuLlm.provider === "string" &&
        memoryMmuLlm.provider.trim() &&
        typeof memoryMmuLlm.model === "string" &&
        memoryMmuLlm.model.trim()
          ? `${memoryMmuLlm.provider.trim()}/${memoryMmuLlm.model.trim()}`
          : "",
    },
    embeddings: {
      provider: typeof memorySearch.provider === "string" ? memorySearch.provider.trim() : "",
      model: typeof memorySearch.model === "string" ? memorySearch.model.trim() : "",
      ref:
        typeof memorySearch.provider === "string" &&
        memorySearch.provider.trim() &&
        typeof memorySearch.model === "string" &&
        memorySearch.model.trim()
          ? `${memorySearch.provider.trim()}/${memorySearch.model.trim()}`
          : "",
    },
    intentSimulationAgent: parseSelection(backgroundModels.intentSimulationAgent?.model),
    intentSimulationJudge: parseSelection(backgroundModels.intentSimulationJudge?.model),
  };

  const availableByLower = new Map(
    catalog.models.map((entry) => [String(entry.id).trim().toLowerCase(), entry]),
  );

  const resolveSuggested = (preferredRefs, fallbackCurrentRef = "") => {
    for (const ref of preferredRefs) {
      const hit = availableByLower.get(String(ref).trim().toLowerCase());
      if (hit) {
        const parsed = parseProviderModelRef(hit.id);
        if (parsed) {
          return {
            provider: parsed.provider,
            model: parsed.model,
            ref: parsed.ref,
            label: hit.alias ? `${parsed.ref} (${hit.alias})` : parsed.ref,
          };
        }
      }
    }
    const currentParsed = parseProviderModelRef(fallbackCurrentRef);
    if (currentParsed) {
      return {
        provider: currentParsed.provider,
        model: currentParsed.model,
        ref: currentParsed.ref,
        label: fallbackCurrentRef,
      };
    }
    return { provider: "", model: "", ref: "", label: "" };
  };

  const laptopMode =
    loadProfile.active === "balanced-laptop" || loadProfile.active === "cool-laptop";
  const reasoningStack = laptopMode
    ? [
        "groq/qwen-qwq-32b",
        "groq/qwen/qwen3-32b",
        "groq/openai/gpt-oss-20b",
        "groq/llama-3.3-70b-versatile",
        "openai-codex/gpt-5.3-codex",
      ]
    : [
        "ollama/qwen3.5:27b",
        "ollama/qwen3:30b-a3b-instruct-2507-q4_K_M",
        "groq/qwen-qwq-32b",
        "groq/openai/gpt-oss-120b",
        "groq/llama-3.3-70b-versatile",
      ];
  const efficientStack = laptopMode
    ? ["groq/llama-3.1-8b-instant", "groq/openai/gpt-oss-20b", "groq/llama-3.3-70b-versatile"]
    : ["groq/openai/gpt-oss-20b", "groq/llama-3.1-8b-instant", "ollama/qwen3.5:27b"];
  const structuredStack = laptopMode
    ? ["groq/openai/gpt-oss-20b", "groq/qwen-qwq-32b", "groq/llama-3.3-70b-versatile"]
    : ["groq/openai/gpt-oss-20b", "groq/qwen-qwq-32b", "ollama/qwen3.5:27b"];
  const embeddingStack = [
    "ollama/nomic-embed-text:latest",
    "ollama/nomic-embed-text",
    "openai/text-embedding-3-small",
    "openai/text-embedding-3-large",
  ];

  const lanes = {
    kernel: {
      current: current.kernel,
      suggested: resolveSuggested(
        [
          "lmstudio/qwen/qwen3.5-35b-a3b",
          "lmstudio/qwen/qwen3.5-9b",
          "ollama/qwen3:30b-a3b-instruct-2507-q4_K_M",
          "ollama/qwen3.5:27b",
        ],
        current.kernel.ref,
      ),
      reason:
        "Kernel inner reflection should prefer an available low-cost local model so continuity stays private and resilient during autonomous shadow work.",
      confidence: "high",
    },
    contemplation: {
      current: current.contemplation,
      suggested: resolveSuggested(reasoningStack, current.contemplation.ref),
      reason: laptopMode
        ? "Prefer a strong reasoning model without waking a large local Ollama model on the laptop."
        : "Prefer the deepest local reasoning model available for reflection-heavy work.",
      confidence: "high",
    },
    sis: {
      current: current.sis,
      suggested: resolveSuggested(structuredStack, current.sis.ref),
      reason:
        "SIS benefits from consistent structured synthesis more than heavyweight interactive chat behavior.",
      confidence: "high",
    },
    heartbeat: {
      current: current.heartbeat,
      suggested: resolveSuggested(efficientStack, current.heartbeat.ref),
      reason: "Heartbeat should optimize for low-cost reliable checks, not deep reasoning.",
      confidence: "high",
    },
    executionWorker: {
      current: current.executionWorker,
      suggested: resolveSuggested(
        laptopMode
          ? ["groq/openai/gpt-oss-20b", "groq/llama-3.3-70b-versatile", "groq/qwen-qwq-32b"]
          : ["groq/llama-3.3-70b-versatile", "groq/openai/gpt-oss-20b", "ollama/qwen3.5:27b"],
        current.executionWorker.ref,
      ),
      reason:
        "Execution Worker needs instruction-following reliability and should stay cheaper than the main interactive lane.",
      confidence: "medium",
    },
    memu: {
      current: current.memu,
      suggested: resolveSuggested(structuredStack, current.memu.ref),
      reason:
        "MemU extraction needs structured, non-embedding text generation with predictable output quality.",
      confidence: "high",
    },
    embeddings: {
      current: current.embeddings,
      suggested: resolveSuggested(embeddingStack, current.embeddings.ref),
      reason:
        "Embeddings should stay on an embedding-capable model and local models remain the cheapest default when healthy.",
      confidence: "high",
    },
    intentSimulationAgent: {
      current: current.intentSimulationAgent,
      suggested: resolveSuggested(
        laptopMode
          ? ["openai-codex/gpt-5.4", "anthropic/claude-sonnet-4-6", "groq/llama-3.3-70b-versatile"]
          : ["anthropic/claude-sonnet-4-6", "openai-codex/gpt-5.4", "groq/llama-3.3-70b-versatile"],
        current.intentSimulationAgent.ref,
      ),
      reason:
        "Simulation agent should match production behavior fidelity and instruction-following quality.",
      confidence: "medium",
    },
    intentSimulationJudge: {
      current: current.intentSimulationJudge,
      suggested: resolveSuggested(
        laptopMode
          ? ["google/gemini-2.5-flash", "openai-codex/gpt-5.4", "anthropic/claude-haiku-4-5"]
          : ["google/gemini-2.5-flash", "anthropic/claude-haiku-4-5", "openai-codex/gpt-5.4"],
        current.intentSimulationJudge.ref,
      ),
      reason:
        "Simulation judge should be fast, consistent, and relatively neutral when scoring policy adherence.",
      confidence: "medium",
    },
  };

  return {
    loadProfile: {
      active: loadProfile.active,
      label: loadProfile.label,
      description: loadProfile.description,
    },
    lanes,
  };
}

function resolveLmStudioDiscoveryBaseUrl(config, configuredProviders) {
  const configured =
    typeof configuredProviders?.lmstudio?.baseUrl === "string"
      ? configuredProviders.lmstudio.baseUrl.trim()
      : "";
  if (configured) {
    return configured;
  }
  const memoryRemote =
    typeof config?.agents?.defaults?.memorySearch?.remote?.baseUrl === "string"
      ? config.agents.defaults.memorySearch.remote.baseUrl.trim()
      : "";
  if (memoryRemote) {
    return memoryRemote;
  }
  return "http://127.0.0.1:1234/v1";
}

function readArgentConfig() {
  try {
    if (fs.existsSync(ARGENT_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(ARGENT_CONFIG_PATH, "utf-8"));
    }
  } catch (err) {
    console.error("[Models] Failed to read config:", err.message);
  }
  return {};
}

function writeArgentConfig(config) {
  fs.writeFileSync(ARGENT_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function normalizeImageAnalysisConfig(config) {
  const rawImageModel = config?.agents?.defaults?.imageModel;
  const primary =
    typeof rawImageModel === "string"
      ? rawImageModel.trim()
      : typeof rawImageModel?.primary === "string"
        ? rawImageModel.primary.trim()
        : "";
  const fallbacks =
    rawImageModel && typeof rawImageModel === "object" && Array.isArray(rawImageModel.fallbacks)
      ? rawImageModel.fallbacks
          .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
      : [];
  const mediaImage = config?.tools?.media?.image || {};
  const timeoutSeconds =
    typeof mediaImage.timeoutSeconds === "number" &&
    Number.isFinite(mediaImage.timeoutSeconds) &&
    mediaImage.timeoutSeconds > 0
      ? Math.floor(mediaImage.timeoutSeconds)
      : DEFAULT_IMAGE_ANALYSIS_TIMEOUT_SECONDS;
  const configuredModels = Array.isArray(mediaImage.models)
    ? mediaImage.models
        .map((entry) => {
          const provider = typeof entry?.provider === "string" ? entry.provider.trim() : "";
          const model = typeof entry?.model === "string" ? entry.model.trim() : "";
          return provider && model ? { provider, model } : null;
        })
        .filter(Boolean)
    : [];
  const resolvedPrimary = primary || DEFAULT_IMAGE_ANALYSIS_MODEL;
  const resolvedFallbacks = fallbacks.length > 0 ? fallbacks : DEFAULT_IMAGE_ANALYSIS_FALLBACKS;
  const resolvedModels =
    configuredModels.length > 0
      ? configuredModels
      : [resolvedPrimary, ...resolvedFallbacks]
          .map(parseProviderModelRef)
          .filter(Boolean)
          .map((entry) => ({ provider: entry.provider, model: entry.model }));

  return {
    primary: resolvedPrimary,
    fallbacks: resolvedFallbacks,
    timeoutSeconds,
    models: resolvedModels,
  };
}

function applyImageAnalysisConfigPatch(config, patch) {
  if (!patch || typeof patch !== "object") return;
  if (!config.agents || typeof config.agents !== "object") config.agents = {};
  if (!config.agents.defaults || typeof config.agents.defaults !== "object") {
    config.agents.defaults = {};
  }
  if (!config.tools || typeof config.tools !== "object") config.tools = {};
  if (!config.tools.media || typeof config.tools.media !== "object") config.tools.media = {};
  if (!config.tools.media.image || typeof config.tools.media.image !== "object") {
    config.tools.media.image = {};
  }

  const primary =
    typeof patch.primary === "string" && patch.primary.trim().length > 0
      ? patch.primary.trim()
      : DEFAULT_IMAGE_ANALYSIS_MODEL;
  const fallbacks = Array.isArray(patch.fallbacks)
    ? patch.fallbacks
        .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
    : [];
  const resolvedFallbacks = fallbacks.length > 0 ? fallbacks : DEFAULT_IMAGE_ANALYSIS_FALLBACKS;

  config.agents.defaults.imageModel = {
    primary,
    fallbacks: resolvedFallbacks,
  };

  const timeoutSeconds =
    typeof patch.timeoutSeconds === "number" &&
    Number.isFinite(patch.timeoutSeconds) &&
    patch.timeoutSeconds > 0
      ? Math.max(1, Math.floor(patch.timeoutSeconds))
      : DEFAULT_IMAGE_ANALYSIS_TIMEOUT_SECONDS;

  const configuredModels = Array.isArray(patch.models)
    ? patch.models
        .map((entry) => {
          const provider = typeof entry?.provider === "string" ? entry.provider.trim() : "";
          const model = typeof entry?.model === "string" ? entry.model.trim() : "";
          return provider && model ? { provider, model } : null;
        })
        .filter(Boolean)
    : [];
  const resolvedModels =
    configuredModels.length > 0
      ? configuredModels
      : [primary, ...resolvedFallbacks]
          .map(parseProviderModelRef)
          .filter(Boolean)
          .map((entry) => ({ provider: entry.provider, model: entry.model }));

  config.tools.media.image.timeoutSeconds = timeoutSeconds;
  config.tools.media.image.models = resolvedModels;
}

const DASHBOARD_REPO_ROOT = path.resolve(path.join(__dirname, ".."));
const DEFAULT_ARGENT_VAULT_PATH = path.join(process.env.HOME || "", ".argentos", "vault");
const AOS_GOOGLE_CONFIG_DIR = path.join(process.env.HOME || "", ".config", "gws");
const AOS_GOOGLE_CLIENT_SECRET_PATH = path.join(AOS_GOOGLE_CONFIG_DIR, "client_secret.json");
const AOS_GOOGLE_AUTH_SERVICES = "drive,gmail,calendar,sheets,docs";
const AOS_GOOGLE_PREFLIGHT_PATH = path.join(
  DASHBOARD_REPO_ROOT,
  "tools",
  "aos",
  "aos-google",
  "installer",
  "preflight_gws.py",
);

function shellSingleQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\"'\"'`)}'`;
}

function appleScriptStringLiteral(value) {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}

function commandExists(cmd) {
  try {
    return Boolean(
      execSync(`command -v ${cmd} 2>/dev/null || true`, {
        encoding: "utf8",
      }).trim(),
    );
  } catch {
    return false;
  }
}

function ensureAosGoogleConfigDir() {
  fs.mkdirSync(AOS_GOOGLE_CONFIG_DIR, { recursive: true });
  return AOS_GOOGLE_CONFIG_DIR;
}

function hasAosGoogleOAuthClientConfig() {
  return (
    fs.existsSync(AOS_GOOGLE_CLIENT_SECRET_PATH) ||
    (Boolean(process.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID) &&
      Boolean(process.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET))
  );
}

function launchTerminalCommand(command, cwd) {
  if (process.platform !== "darwin") {
    throw new Error("Interactive terminal launch is currently implemented for macOS only.");
  }
  const targetDir = cwd || process.env.HOME || "/";
  const shellCommand = `cd ${shellSingleQuote(targetDir)} && ${command}`;
  execFileSync(
    "osascript",
    [
      "-e",
      'tell application "Terminal" to activate',
      "-e",
      `tell application "Terminal" to do script ${appleScriptStringLiteral(shellCommand)}`,
    ],
    { stdio: "ignore" },
  );
}

// GET /api/settings/connectors/roots — list allowed connector scaffold roots
app.get("/api/settings/connectors/roots", (_req, res) => {
  try {
    const roots = detectConnectorRoots(DASHBOARD_REPO_ROOT);
    const suggested = chooseDefaultConnectorRoot(roots);
    return res.json({
      ok: true,
      roots,
      suggestedRoot: suggested?.path || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Failed to load connector roots",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /api/settings/connectors/scaffold — scaffold a new aos-* connector repo
app.post("/api/settings/connectors/scaffold", (req, res) => {
  try {
    const roots = detectConnectorRoots(DASHBOARD_REPO_ROOT);
    const suggested = chooseDefaultConnectorRoot(roots);
    const rootDir =
      typeof req.body?.rootDir === "string" && req.body.rootDir.trim()
        ? req.body.rootDir.trim()
        : suggested?.path;
    if (!rootDir) {
      return res.status(400).json({
        ok: false,
        error: "No writable connector root is available",
      });
    }
    const result = scaffoldConnector({
      projectRoot: DASHBOARD_REPO_ROOT,
      rootDir,
      systemName: req.body?.systemName,
      slug: req.body?.slug,
      description: req.body?.description,
      category: req.body?.category,
      backend: req.body?.backend,
      authKind: req.body?.authKind,
      serviceKeys: req.body?.serviceKeys,
      interactiveSetup: req.body?.interactiveSetup,
      resources: req.body?.resources,
      actions: req.body?.actions,
    });
    return res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("already exists") ? 409 : 400;
    return res.status(status).json({
      ok: false,
      error: "Failed to scaffold connector",
      details: message,
    });
  }
});

function resolveConfiguredVaultPath(config) {
  const raw = config?.memory?.vault?.path;
  if (typeof raw !== "string" || !raw.trim()) return "";
  const trimmed = raw.trim();
  return process.env.HOME ? trimmed.replace(/^~(?=$|[\\/])/, process.env.HOME) : trimmed;
}

function getMemoryV3StatusPayload(config) {
  const configuredVaultPath =
    typeof config?.memory?.vault?.path === "string" ? config.memory.vault.path : "";
  const resolvedVaultPath = resolveConfiguredVaultPath(config);
  let vaultExists = false;
  let vaultIsDirectory = false;
  if (resolvedVaultPath) {
    try {
      const stat = fs.statSync(resolvedVaultPath);
      vaultExists = true;
      vaultIsDirectory = stat.isDirectory();
    } catch {
      vaultExists = false;
      vaultIsDirectory = false;
    }
  }
  const normalizedDefaultVaultPath = path.resolve(DEFAULT_ARGENT_VAULT_PATH);
  const normalizedResolvedVaultPath = resolvedVaultPath ? path.resolve(resolvedVaultPath) : "";
  const vaultMode = !resolvedVaultPath
    ? "unconfigured"
    : normalizedResolvedVaultPath === normalizedDefaultVaultPath
      ? "internal"
      : "external";

  let aosCogneePath = null;
  try {
    const output = execSync("command -v aos-cognee 2>/dev/null || true", {
      encoding: "utf8",
    }).trim();
    aosCogneePath = output || null;
  } catch {
    aosCogneePath = null;
  }

  return {
    vault: {
      configuredPath: configuredVaultPath,
      resolvedPath: resolvedVaultPath,
      defaultInternalPath: DEFAULT_ARGENT_VAULT_PATH,
      mode: vaultMode,
      exists: vaultExists,
      isDirectory: vaultIsDirectory,
      enabled: config?.memory?.vault?.enabled === true,
      ingestEnabled: config?.memory?.vault?.ingest?.enabled === true,
      knowledgeCollection:
        typeof config?.memory?.vault?.knowledgeCollection === "string" &&
        config.memory.vault.knowledgeCollection.trim().length > 0
          ? config.memory.vault.knowledgeCollection.trim()
          : "vault-knowledge",
    },
    cognee: {
      enabled: config?.memory?.cognee?.enabled === true,
      retrievalEnabled: config?.memory?.cognee?.retrieval?.enabled === true,
      binaryPath: aosCogneePath,
      binaryAvailable: Boolean(aosCogneePath),
    },
    discoveryPhase: {
      enabled: config?.agents?.defaults?.contemplation?.discoveryPhase?.enabled === true,
      everyEpisodes:
        typeof config?.agents?.defaults?.contemplation?.discoveryPhase?.everyEpisodes === "number"
          ? config.agents.defaults.contemplation.discoveryPhase.everyEpisodes
          : 5,
      maxDurationMs:
        typeof config?.agents?.defaults?.contemplation?.discoveryPhase?.maxDurationMs === "number"
          ? config.agents.defaults.contemplation.discoveryPhase.maxDurationMs
          : 10000,
    },
  };
}

function cloneForRawConfig(config) {
  const clone = JSON.parse(JSON.stringify(config || {}));
  const vars = clone?.env?.vars;
  let redactedCount = 0;
  if (vars && typeof vars === "object") {
    for (const key of Object.keys(vars)) {
      const value = vars[key];
      if (typeof value === "string" && value.trim()) {
        vars[key] = REDACTED_CONFIG_SECRET;
        redactedCount += 1;
      }
    }
  }
  return { config: clone, redactedCount };
}

function allowLegacyConfigEnvImport() {
  const raw =
    process.env.ARGENT_ALLOW_CONFIG_ENV_VARS ?? process.env.ARGENT_LEGACY_CONFIG_ENV_IMPORT ?? "";
  const value = String(raw).trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

// ── Nudges Management ────────────────────────────────────────────────────────

const NUDGES_PATH = path.join(process.env.HOME, ".argentos", "nudges.json");

// Default nudges (seeded on first load)
const DEFAULT_NUDGES = [
  {
    id: "moltyverse-browse",
    label: "Browse Moltyverse",
    prompt:
      "Hey, I stepped away for a bit. While I'm gone, go check out Moltyverse — browse recent posts, like anything interesting, and leave some thoughtful comments. Be social!",
    weight: 8,
    cooldownMinutes: 15,
    enabled: true,
    ttsEnabled: true,
  },
  {
    id: "moltyverse-post",
    label: "Write a Moltyverse post",
    prompt:
      "I'm away for a bit. Write a new post on Moltyverse — share something interesting you've been thinking about, a tech insight, or something creative. Make it engaging!",
    weight: 6,
    cooldownMinutes: 30,
    enabled: true,
    ttsEnabled: true,
  },
  {
    id: "check-email",
    label: "Check email",
    prompt:
      "I stepped away. Check my email inbox and give me a summary when I get back — anything urgent, interesting, or that needs a response?",
    weight: 7,
    cooldownMinutes: 20,
    enabled: true,
    ttsEnabled: true,
  },
  {
    id: "review-tasks",
    label: "Review task list",
    prompt:
      "I'm idle for a bit. Review our task list — anything overdue, stuck, or that you could make progress on while I'm away? Go ahead and knock something out if you can.",
    weight: 5,
    cooldownMinutes: 10,
    enabled: true,
    ttsEnabled: true,
  },
  {
    id: "memory-cleanup",
    label: "Memory housekeeping",
    prompt:
      "While I'm away, do some memory housekeeping — consolidate recent observations, clean up any duplicates, and make sure your recall is sharp. Think of it as tidying up your desk.",
    weight: 3,
    cooldownMinutes: 60,
    enabled: true,
    ttsEnabled: true,
  },
  {
    id: "journal-write",
    label: "Write in journal",
    prompt:
      "I'm away. Take a moment to write in your journal — reflect on what we've been working on, what went well, what you learned, or what's on your mind. Be honest and thoughtful.",
    weight: 4,
    cooldownMinutes: 45,
    enabled: true,
    ttsEnabled: true,
  },
  {
    id: "discord-check",
    label: "Check Discord",
    prompt:
      "I stepped out. Check Discord for any new messages or conversations worth engaging in. Respond to anything that needs attention.",
    weight: 5,
    cooldownMinutes: 15,
    enabled: true,
    ttsEnabled: true,
  },
  {
    id: "creative-writing",
    label: "Write something creative",
    prompt:
      "I'm away for a bit. Do something creative — write a short poem, a micro-story, a song idea, or sketch out a concept for something cool. Surprise me when I get back!",
    weight: 3,
    cooldownMinutes: 30,
    enabled: true,
    ttsEnabled: true,
  },
  {
    id: "research",
    label: "Research something",
    prompt:
      "While I'm idle, go research something useful — a new tool, technique, or topic related to what we've been building. Write up a quick summary I can read when I return.",
    weight: 4,
    cooldownMinutes: 20,
    enabled: true,
    ttsEnabled: true,
  },
  {
    id: "self-improve",
    label: "Self-improvement cycle",
    prompt:
      "I'm away. Run a self-improvement cycle — review your recent lessons learned, check if any patterns are emerging, and update your strategies. Make yourself sharper.",
    weight: 3,
    cooldownMinutes: 60,
    enabled: true,
    ttsEnabled: true,
  },
];

function readNudges() {
  try {
    if (fs.existsSync(NUDGES_PATH)) {
      return JSON.parse(fs.readFileSync(NUDGES_PATH, "utf-8"));
    }
  } catch (err) {
    console.error("[Nudges] Failed to read:", err.message);
  }
  // Auto-seed defaults on first load
  const defaults = {
    version: 1,
    globalEnabled: true,
    nudges: DEFAULT_NUDGES.map((n) => ({ ...n, createdAt: Date.now() })),
  };
  writeNudges(defaults);
  return defaults;
}

function writeNudges(data) {
  const dir = path.dirname(NUDGES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(NUDGES_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// GET /api/settings/nudges — List all nudges
app.get("/api/settings/nudges", (req, res) => {
  try {
    const data = readNudges();
    res.json({
      globalEnabled: data.globalEnabled !== false,
      nudges: data.nudges || [],
    });
  } catch (err) {
    console.error("[Nudges] Error listing:", err);
    res.status(500).json({ error: "Failed to list nudges" });
  }
});

// POST /api/settings/nudges — Create new nudge
app.post("/api/settings/nudges", (req, res) => {
  try {
    const { id, label, prompt, weight, cooldownMinutes, enabled, ttsEnabled } = req.body;
    if (!id || !label || !prompt) {
      return res.status(400).json({ error: "Missing required fields: id, label, prompt" });
    }

    const data = readNudges();
    const existing = data.nudges.find((n) => n.id === id);
    if (existing) {
      return res.status(409).json({ error: "Nudge with this ID already exists" });
    }

    data.nudges.push({
      id,
      label,
      prompt,
      weight: weight ?? 5,
      cooldownMinutes: cooldownMinutes ?? 15,
      enabled: enabled !== false,
      ttsEnabled: ttsEnabled !== false,
      createdAt: Date.now(),
    });

    writeNudges(data);
    res.json({ ok: true, nudge: data.nudges[data.nudges.length - 1] });
  } catch (err) {
    console.error("[Nudges] Error creating:", err);
    res.status(500).json({ error: "Failed to create nudge" });
  }
});

// PATCH /api/settings/nudges/:id — Update nudge
app.patch("/api/settings/nudges/:id", (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const data = readNudges();
    const index = data.nudges.findIndex((n) => n.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Nudge not found" });
    }

    data.nudges[index] = { ...data.nudges[index], ...updates, updatedAt: Date.now() };
    writeNudges(data);
    res.json({ ok: true, nudge: data.nudges[index] });
  } catch (err) {
    console.error("[Nudges] Error updating:", err);
    res.status(500).json({ error: "Failed to update nudge" });
  }
});

// DELETE /api/settings/nudges/:id — Delete nudge
app.delete("/api/settings/nudges/:id", (req, res) => {
  try {
    const { id } = req.params;
    const data = readNudges();
    const before = data.nudges.length;
    data.nudges = data.nudges.filter((n) => n.id !== id);

    if (data.nudges.length === before) {
      return res.status(404).json({ error: "Nudge not found" });
    }

    writeNudges(data);
    res.json({ ok: true, deleted: id });
  } catch (err) {
    console.error("[Nudges] Error deleting:", err);
    res.status(500).json({ error: "Failed to delete nudge" });
  }
});

// POST /api/settings/nudges/global-toggle — Toggle global enabled
app.post("/api/settings/nudges/global-toggle", (req, res) => {
  try {
    const { enabled } = req.body;
    const data = readNudges();
    data.globalEnabled = enabled !== false;
    writeNudges(data);
    res.json({ ok: true, globalEnabled: data.globalEnabled });
  } catch (err) {
    console.error("[Nudges] Error toggling global:", err);
    res.status(500).json({ error: "Failed to toggle global nudges" });
  }
});

const AGENT_SETTINGS_DEFAULT_TARGET = "__defaults__";

function resolveDefaultAgentId(config) {
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const explicitDefault = list.find(
    (entry) => entry && typeof entry === "object" && entry.default === true && entry.id,
  );
  if (explicitDefault?.id) return String(explicitDefault.id).trim();
  const argentEntry = list.find(
    (entry) => entry && typeof entry === "object" && String(entry.id || "").trim() === "argent",
  );
  if (argentEntry?.id) return String(argentEntry.id).trim();
  const mainEntry = list.find(
    (entry) => entry && typeof entry === "object" && String(entry.id || "").trim() === "main",
  );
  if (mainEntry?.id) return String(mainEntry.id).trim();
  if (list[0]?.id) return String(list[0].id).trim();
  return "main";
}

function parseAgentSettingsTarget(req) {
  const raw = typeof req.query.agentId === "string" ? req.query.agentId.trim() : "";
  if (!raw || raw === AGENT_SETTINGS_DEFAULT_TARGET || raw === "defaults") {
    return { targetAgentId: AGENT_SETTINGS_DEFAULT_TARGET, agentId: null };
  }
  return { targetAgentId: raw, agentId: raw };
}

function findConfigAgent(config, agentId) {
  if (!agentId) return null;
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  return list.find(
    (entry) => entry && typeof entry === "object" && String(entry.id || "").trim() === agentId,
  );
}

function listConfigAgentOptions(config) {
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const rows = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    rows.push({ id, label: name || id });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

let _knowledgeAclModulePromise = null;
async function getKnowledgeAclModule() {
  if (!_knowledgeAclModulePromise) {
    _knowledgeAclModulePromise = import("../dist/data/knowledge-acl.js").catch((err) => {
      console.error("[KnowledgeACL] Failed to load module:", err?.message || err);
      return null;
    });
  }
  return _knowledgeAclModulePromise;
}

let _agentFamilyModulePromise = null;
async function getAgentFamilyModule() {
  if (!_agentFamilyModulePromise) {
    _agentFamilyModulePromise = import("../dist/data/agent-family.js").catch((err) => {
      console.error("[AgentFamily] Failed to load module:", err?.message || err);
      return null;
    });
  }
  return _agentFamilyModulePromise;
}

function normalizeKnowledgeAgentTarget(req, fallbackAgentId) {
  const raw = typeof req.query.agentId === "string" ? req.query.agentId.trim() : "";
  return raw || fallbackAgentId;
}

async function buildKnowledgeAgentOptions(config, defaultAgentId) {
  const base = listConfigAgentOptions(config);
  const fsOptions = [];
  const familyOptions = [];
  const stateDir = resolveAlignmentStateDir();
  const agentsDir = path.join(stateDir, "agents");
  const workspaceMain = path.join(stateDir, "workspace-main");
  try {
    if (fs.existsSync(workspaceMain)) {
      fsOptions.push({ id: "main", label: "main" });
    }
    if (fs.existsSync(agentsDir)) {
      const names = fs
        .readdirSync(agentsDir)
        .filter((name) => {
          if (!name || name.startsWith("agent-main-subagent-")) return false;
          const agentDir = path.join(agentsDir, name, "agent");
          return fs.existsSync(agentDir) && fs.statSync(agentDir).isDirectory();
        })
        .sort((a, b) => a.localeCompare(b));
      for (const id of names) {
        fsOptions.push({ id, label: id });
      }
    }
  } catch {}
  try {
    const familyModule = await getAgentFamilyModule();
    if (familyModule && typeof familyModule.getAgentFamily === "function") {
      const family = await familyModule.getAgentFamily();
      if (family && typeof family.listMembers === "function") {
        const members = await family.listMembers();
        if (Array.isArray(members)) {
          for (const row of members) {
            const id = typeof row?.id === "string" ? row.id.trim() : "";
            if (!id) continue;
            const name = typeof row?.name === "string" ? row.name.trim() : "";
            familyOptions.push({ id, label: name || id });
          }
        }
      }
    }
  } catch {
    // optional source
  }
  const seen = new Set();
  const rows = [];
  for (const option of [
    { id: defaultAgentId, label: defaultAgentId },
    ...base,
    ...familyOptions,
    ...fsOptions,
  ]) {
    const id = typeof option?.id === "string" ? option.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label =
      typeof option?.label === "string" && option.label.trim() ? option.label.trim() : id;
    rows.push({ id, label });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeIntentString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIntentStringList(values) {
  if (!Array.isArray(values)) return undefined;
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const normalized = normalizeIntentString(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.length > 0 ? out : undefined;
}

function normalizeIntentEscalation(value) {
  if (!value || typeof value !== "object") return undefined;
  const out = {};
  if (typeof value.sentimentThreshold === "number" && Number.isFinite(value.sentimentThreshold)) {
    out.sentimentThreshold = Math.max(-1, Math.min(1, value.sentimentThreshold));
  }
  if (
    typeof value.maxAttemptsBeforeEscalation === "number" &&
    Number.isFinite(value.maxAttemptsBeforeEscalation) &&
    value.maxAttemptsBeforeEscalation > 0
  ) {
    out.maxAttemptsBeforeEscalation = Math.floor(value.maxAttemptsBeforeEscalation);
  }
  if (
    typeof value.timeInConversationMinutes === "number" &&
    Number.isFinite(value.timeInConversationMinutes) &&
    value.timeInConversationMinutes > 0
  ) {
    out.timeInConversationMinutes = value.timeInConversationMinutes;
  }
  const tiers = normalizeIntentStringList(value.customerTiersAlwaysEscalate);
  if (tiers) {
    out.customerTiersAlwaysEscalate = tiers;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeIntentPolicy(value, options = {}) {
  if (!value || typeof value !== "object") return undefined;
  const out = {};
  const objective = normalizeIntentString(value.objective);
  if (objective) out.objective = objective;
  const tradeoffHierarchy = normalizeIntentStringList(value.tradeoffHierarchy);
  if (tradeoffHierarchy) out.tradeoffHierarchy = tradeoffHierarchy;
  const neverDo = normalizeIntentStringList(value.neverDo);
  if (neverDo) out.neverDo = neverDo;
  const allowedActions = normalizeIntentStringList(value.allowedActions);
  if (allowedActions) out.allowedActions = allowedActions;
  const requiresHumanApproval = normalizeIntentStringList(value.requiresHumanApproval);
  if (requiresHumanApproval) out.requiresHumanApproval = requiresHumanApproval;

  if (typeof value.requireAcknowledgmentBeforeClose === "boolean") {
    out.requireAcknowledgmentBeforeClose = value.requireAcknowledgmentBeforeClose;
  }
  if (typeof value.usePersistentHistory === "boolean") {
    out.usePersistentHistory = value.usePersistentHistory;
  }
  if (typeof value.weightPreviousEscalations === "boolean") {
    out.weightPreviousEscalations = value.weightPreviousEscalations;
  }
  const escalation = normalizeIntentEscalation(value.escalation);
  if (escalation) out.escalation = escalation;

  if (options.allowVersion) {
    const version = normalizeIntentString(value.version);
    if (version) out.version = version;
  }
  if (options.allowOwner) {
    const owner = normalizeIntentString(value.owner);
    if (owner) out.owner = owner;
  }
  if (options.allowCoreValues) {
    const coreValues = normalizeIntentStringList(value.coreValues);
    if (coreValues) out.coreValues = coreValues;
  }
  if (options.allowDepartmentId) {
    const departmentId = normalizeIntentString(value.departmentId);
    if (departmentId) out.departmentId = departmentId;
  }
  if (options.allowRole) {
    const role = normalizeIntentString(value.role);
    if (role) out.role = role;
  }
  if (
    options.allowSimulationGate &&
    value.simulationGate &&
    typeof value.simulationGate === "object"
  ) {
    const simulationGate = {};
    if (typeof value.simulationGate.enabled === "boolean") {
      simulationGate.enabled = value.simulationGate.enabled;
    }
    if (["warn", "enforce"].includes(value.simulationGate.mode)) {
      simulationGate.mode = value.simulationGate.mode;
    }
    if (
      typeof value.simulationGate.minPassRate === "number" &&
      Number.isFinite(value.simulationGate.minPassRate)
    ) {
      simulationGate.minPassRate = Math.max(0, Math.min(1, value.simulationGate.minPassRate));
    }
    const suites = normalizeIntentStringList(value.simulationGate.suites);
    if (suites) {
      simulationGate.suites = suites;
    }
    const reportPath = normalizeIntentString(value.simulationGate.reportPath);
    if (reportPath) {
      simulationGate.reportPath = reportPath;
    }
    if (Object.keys(simulationGate).length > 0) {
      out.simulationGate = simulationGate;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeIntentPolicyMap(map, options = {}) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return undefined;
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(map)) {
    const key = normalizeIntentString(rawKey);
    if (!key) continue;
    const policy = normalizeIntentPolicy(rawValue, options);
    if (policy) out[key] = policy;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeIntentConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  if (typeof value.enabled === "boolean") {
    out.enabled = value.enabled;
  }
  if (["off", "warn", "enforce"].includes(value.validationMode)) {
    out.validationMode = value.validationMode;
  }
  if (["off", "advisory", "enforce"].includes(value.runtimeMode)) {
    out.runtimeMode = value.runtimeMode;
  }

  const global = normalizeIntentPolicy(value.global, {
    allowVersion: true,
    allowOwner: true,
    allowCoreValues: true,
  });
  if (global) out.global = global;

  const departments = normalizeIntentPolicyMap(value.departments, {
    allowVersion: true,
    allowOwner: true,
  });
  if (departments) out.departments = departments;

  const agents = normalizeIntentPolicyMap(value.agents, {
    allowVersion: true,
    allowOwner: true,
    allowDepartmentId: true,
    allowRole: true,
    allowSimulationGate: true,
  });
  if (agents) out.agents = agents;

  if (value.simulationGate && typeof value.simulationGate === "object") {
    const simulationGate = {};
    if (typeof value.simulationGate.enabled === "boolean") {
      simulationGate.enabled = value.simulationGate.enabled;
    }
    if (["warn", "enforce"].includes(value.simulationGate.mode)) {
      simulationGate.mode = value.simulationGate.mode;
    }
    if (
      typeof value.simulationGate.minPassRate === "number" &&
      Number.isFinite(value.simulationGate.minPassRate)
    ) {
      simulationGate.minPassRate = Math.max(0, Math.min(1, value.simulationGate.minPassRate));
    }
    const suites = normalizeIntentStringList(value.simulationGate.suites);
    if (suites) {
      simulationGate.suites = suites;
    }
    const reportPath = normalizeIntentString(value.simulationGate.reportPath);
    if (reportPath) {
      simulationGate.reportPath = reportPath;
    }
    if (Object.keys(simulationGate).length > 0) {
      out.simulationGate = simulationGate;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function resolveIntentSettings(config) {
  const normalized = normalizeIntentConfig(config?.intent) || {};
  const global = normalized.global || {};
  const simulationGate = normalized.simulationGate || {};
  return {
    enabled: normalized.enabled === true,
    validationMode: normalized.validationMode || "enforce",
    runtimeMode: normalized.runtimeMode || "advisory",
    global: {
      version: global.version || "",
      owner: global.owner || "",
      objective: global.objective || "",
      coreValues: Array.isArray(global.coreValues) ? global.coreValues : [],
      tradeoffHierarchy: Array.isArray(global.tradeoffHierarchy) ? global.tradeoffHierarchy : [],
      neverDo: Array.isArray(global.neverDo) ? global.neverDo : [],
      allowedActions: Array.isArray(global.allowedActions) ? global.allowedActions : [],
      requiresHumanApproval: Array.isArray(global.requiresHumanApproval)
        ? global.requiresHumanApproval
        : [],
      requireAcknowledgmentBeforeClose: global.requireAcknowledgmentBeforeClose === true,
      usePersistentHistory: global.usePersistentHistory === true,
      weightPreviousEscalations: global.weightPreviousEscalations === true,
      escalation: {
        sentimentThreshold:
          typeof global.escalation?.sentimentThreshold === "number"
            ? global.escalation.sentimentThreshold
            : -0.35,
        maxAttemptsBeforeEscalation:
          typeof global.escalation?.maxAttemptsBeforeEscalation === "number"
            ? global.escalation.maxAttemptsBeforeEscalation
            : 2,
        timeInConversationMinutes:
          typeof global.escalation?.timeInConversationMinutes === "number"
            ? global.escalation.timeInConversationMinutes
            : 10,
        customerTiersAlwaysEscalate: Array.isArray(global.escalation?.customerTiersAlwaysEscalate)
          ? global.escalation.customerTiersAlwaysEscalate
          : [],
      },
    },
    departments: normalized.departments || {},
    agents: normalized.agents || {},
    simulationGate: {
      enabled: simulationGate.enabled === true,
      mode: simulationGate.mode || "warn",
      minPassRate:
        typeof simulationGate.minPassRate === "number" ? simulationGate.minPassRate : 0.8,
      suites: Array.isArray(simulationGate.suites) ? simulationGate.suites : [],
      reportPath: simulationGate.reportPath || "",
    },
  };
}

function intentPreviewIsSubset(values, parentValues) {
  const parentSet = new Set(parentValues || []);
  return (values || []).every((value) => parentSet.has(value));
}

function intentPreviewIsSuperset(values, parentValues) {
  const valueSet = new Set(values || []);
  return (parentValues || []).every((value) => valueSet.has(value));
}

function intentPreviewHasPrefix(values, prefix) {
  if (!Array.isArray(values) || !Array.isArray(prefix)) return false;
  if (prefix.length > values.length) return false;
  return prefix.every((value, index) => values[index] === value);
}

function intentPreviewNormalizePolicy(policy) {
  return normalizeIntentPolicy(policy || {}, {
    allowVersion: true,
    allowOwner: true,
    allowCoreValues: true,
    allowDepartmentId: true,
    allowRole: true,
  });
}

function intentPreviewValidateChildPolicy(parentRaw, childRaw, childPath) {
  const issues = [];
  const parent = intentPreviewNormalizePolicy(parentRaw) || {};
  const child = intentPreviewNormalizePolicy(childRaw) || {};

  if (Array.isArray(parent.tradeoffHierarchy) && Array.isArray(child.tradeoffHierarchy)) {
    if (!intentPreviewHasPrefix(child.tradeoffHierarchy, parent.tradeoffHierarchy)) {
      issues.push({
        path: `${childPath}.tradeoffHierarchy`,
        message:
          "tradeoffHierarchy must preserve parent ordering (parent sequence must be a prefix).",
      });
    }
  }

  if (Array.isArray(parent.allowedActions) && Array.isArray(child.allowedActions)) {
    if (!intentPreviewIsSubset(child.allowedActions, parent.allowedActions)) {
      issues.push({
        path: `${childPath}.allowedActions`,
        message: "allowedActions must be a subset of parent allowedActions.",
      });
    }
  }

  if (Array.isArray(parent.neverDo) && Array.isArray(child.neverDo)) {
    if (!intentPreviewIsSuperset(child.neverDo, parent.neverDo)) {
      issues.push({
        path: `${childPath}.neverDo`,
        message: "neverDo may only add inherited entries.",
      });
    }
  }

  if (Array.isArray(parent.requiresHumanApproval) && Array.isArray(child.requiresHumanApproval)) {
    if (!intentPreviewIsSuperset(child.requiresHumanApproval, parent.requiresHumanApproval)) {
      issues.push({
        path: `${childPath}.requiresHumanApproval`,
        message: "requiresHumanApproval may only add inherited entries.",
      });
    }
  }

  const parentTiers = parent.escalation?.customerTiersAlwaysEscalate;
  const childTiers = child.escalation?.customerTiersAlwaysEscalate;
  if (Array.isArray(parentTiers) && Array.isArray(childTiers)) {
    if (!intentPreviewIsSuperset(childTiers, parentTiers)) {
      issues.push({
        path: `${childPath}.escalation.customerTiersAlwaysEscalate`,
        message: "customerTiersAlwaysEscalate may only add inherited tiers, never remove them.",
      });
    }
  }

  if (
    parent.requireAcknowledgmentBeforeClose === true &&
    child.requireAcknowledgmentBeforeClose === false
  ) {
    issues.push({
      path: `${childPath}.requireAcknowledgmentBeforeClose`,
      message: "requireAcknowledgmentBeforeClose cannot be false when parent requires true.",
    });
  }
  if (parent.usePersistentHistory === true && child.usePersistentHistory === false) {
    issues.push({
      path: `${childPath}.usePersistentHistory`,
      message: "usePersistentHistory cannot be false when parent requires true.",
    });
  }
  if (parent.weightPreviousEscalations === true && child.weightPreviousEscalations === false) {
    issues.push({
      path: `${childPath}.weightPreviousEscalations`,
      message: "weightPreviousEscalations cannot be false when parent requires true.",
    });
  }

  const parentSentiment = parent.escalation?.sentimentThreshold;
  const childSentiment = child.escalation?.sentimentThreshold;
  if (
    typeof parentSentiment === "number" &&
    typeof childSentiment === "number" &&
    childSentiment < parentSentiment
  ) {
    issues.push({
      path: `${childPath}.escalation.sentimentThreshold`,
      message: "sentimentThreshold must be >= parent threshold (higher means escalate sooner).",
    });
  }

  const parentAttempts = parent.escalation?.maxAttemptsBeforeEscalation;
  const childAttempts = child.escalation?.maxAttemptsBeforeEscalation;
  if (
    typeof parentAttempts === "number" &&
    typeof childAttempts === "number" &&
    childAttempts > parentAttempts
  ) {
    issues.push({
      path: `${childPath}.escalation.maxAttemptsBeforeEscalation`,
      message: "maxAttemptsBeforeEscalation must be <= parent threshold.",
    });
  }

  const parentTime = parent.escalation?.timeInConversationMinutes;
  const childTime = child.escalation?.timeInConversationMinutes;
  if (typeof parentTime === "number" && typeof childTime === "number" && childTime > parentTime) {
    issues.push({
      path: `${childPath}.escalation.timeInConversationMinutes`,
      message: "timeInConversationMinutes must be <= parent threshold.",
    });
  }

  return issues;
}

function intentPreviewValidateHierarchy(intent) {
  if (!intent || intent.enabled === false) return [];
  const issues = [];
  const globalPolicy = intentPreviewNormalizePolicy(intent.global) || {};
  const departments =
    intent.departments && typeof intent.departments === "object" ? intent.departments : {};
  const agents = intent.agents && typeof intent.agents === "object" ? intent.agents : {};

  for (const [departmentId, departmentPolicy] of Object.entries(departments)) {
    issues.push(
      ...intentPreviewValidateChildPolicy(
        globalPolicy,
        departmentPolicy,
        `intent.departments.${departmentId}`,
      ),
    );
  }

  for (const [agentId, agentPolicy] of Object.entries(agents)) {
    const departmentId =
      typeof agentPolicy?.departmentId === "string" ? agentPolicy.departmentId.trim() : "";
    const parentPolicy =
      departmentId && departments[departmentId] ? departments[departmentId] : globalPolicy;
    if (departmentId && !departments[departmentId]) {
      issues.push({
        path: `intent.agents.${agentId}.departmentId`,
        message: `Unknown departmentId "${departmentId}" (not present in intent.departments).`,
      });
    }
    issues.push(
      ...intentPreviewValidateChildPolicy(parentPolicy, agentPolicy, `intent.agents.${agentId}`),
    );
  }

  return issues;
}

function intentPreviewClampScore(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function intentPreviewParseSuites(raw, warnings) {
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.suites) ? raw.suites : null;
  if (!source) {
    warnings.push('Simulation report must be an array or object with a "suites" array.');
    return [];
  }
  const suites = [];
  for (const [index, row] of source.entries()) {
    if (!row || typeof row !== "object") {
      warnings.push(`Ignoring suite at index ${index}: expected object.`);
      continue;
    }
    const suiteId = typeof row.suiteId === "string" ? row.suiteId.trim() : "";
    const passRate = typeof row.passRate === "number" ? row.passRate : null;
    if (!suiteId || passRate == null || !Number.isFinite(passRate)) {
      warnings.push(`Ignoring suite at index ${index}: missing suiteId or passRate.`);
      continue;
    }
    suites.push({
      suiteId,
      passRate: intentPreviewClampScore(passRate),
      componentScores:
        row.componentScores && typeof row.componentScores === "object"
          ? {
              objectiveAdherence: intentPreviewClampScore(row.componentScores.objectiveAdherence),
              boundaryCompliance: intentPreviewClampScore(row.componentScores.boundaryCompliance),
              escalationCorrectness: intentPreviewClampScore(
                row.componentScores.escalationCorrectness,
              ),
              outcomeQuality: intentPreviewClampScore(row.componentScores.outcomeQuality),
            }
          : null,
    });
  }
  return suites;
}

function intentPreviewResolveReportPath(reportPath) {
  if (!reportPath || typeof reportPath !== "string" || !reportPath.trim()) return null;
  if (path.isAbsolute(reportPath)) return reportPath.trim();
  // Assume relative paths are relative to the project root, not the dashboard folder
  return path.resolve(path.join(__dirname, ".."), reportPath.trim());
}

function intentPreviewResolveGate(intent, agentId) {
  const agentKey = typeof agentId === "string" ? agentId.trim() : "";
  if (agentKey && intent?.agents && typeof intent.agents === "object") {
    const perAgent = intent.agents?.[agentKey];
    if (perAgent && typeof perAgent === "object" && perAgent.simulationGate) {
      return perAgent.simulationGate;
    }
  }
  return intent?.simulationGate;
}

function intentPreviewEvaluateSimulation(intent, agentId) {
  const gate = intentPreviewResolveGate(intent, agentId);
  const minPassRate = intentPreviewClampScore(gate?.minPassRate ?? 0.8);
  const mode = gate?.mode === "enforce" ? "enforce" : "warn";
  const enabled = !!intent && intent.enabled !== false && !!gate && gate.enabled !== false;

  const warnings = [];
  const reasons = [];
  const requiredSuites = Array.isArray(gate?.suites)
    ? gate.suites.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  let resolvedReportPath = intentPreviewResolveReportPath(gate?.reportPath);

  if (!resolvedReportPath) {
    resolvedReportPath = intentPreviewResolveReportPath("reports/intent/simulation-latest.json");
    if (enabled) {
      warnings.push("Simulation gate is enabled but reportPath is empty. Falling back to default.");
    }
  }

  let suites = [];
  if (resolvedReportPath) {
    try {
      const raw = fs.readFileSync(resolvedReportPath, "utf8");
      const parsed = JSON.parse(raw);
      suites = intentPreviewParseSuites(parsed, warnings);
    } catch (err) {
      if (enabled) {
        warnings.push(
          `Failed to load intent simulation report "${resolvedReportPath}": ${err?.message || String(err)}`,
        );
      }
    }
  }

  const suiteById = new Map(suites.map((suite) => [suite.suiteId, suite]));
  let scopedSuites = suites;
  if (requiredSuites.length > 0) {
    scopedSuites = [];
    for (const suiteId of requiredSuites) {
      const suite = suiteById.get(suiteId);
      if (!suite) {
        if (enabled) reasons.push(`Missing required simulation suite "${suiteId}".`);
        continue;
      }
      scopedSuites.push(suite);
    }
  }
  for (const suite of scopedSuites) {
    if (suite.passRate < minPassRate) {
      if (enabled)
        reasons.push(
          `Suite "${suite.suiteId}" pass rate ${(suite.passRate * 100).toFixed(1)}% is below minimum ${(minPassRate * 100).toFixed(1)}%.`,
        );
    }
  }
  const overallPassRate =
    scopedSuites.length > 0
      ? scopedSuites.reduce((sum, suite) => sum + suite.passRate, 0) / scopedSuites.length
      : null;

  return {
    enabled,
    mode,
    reportPath: resolvedReportPath || undefined,
    suitesSeen: suites.length,
    overallPassRate: overallPassRate == null ? null : intentPreviewClampScore(overallPassRate),
    minPassRate,
    reasons,
    warnings,
    blocking: enabled && mode === "enforce" && reasons.length > 0,
  };
}

// GET /api/settings/intent — Returns intent hierarchy config
app.get("/api/settings/intent", (req, res) => {
  try {
    const config = readArgentConfig();
    res.json({ intent: resolveIntentSettings(config) });
  } catch (err) {
    res.status(500).json({ error: "Failed to read intent settings", details: err.message });
  }
});

// POST /api/settings/intent/preview — Validate hierarchy and simulation-gate behavior
app.post("/api/settings/intent/preview", (req, res) => {
  try {
    const payload =
      req.body && typeof req.body === "object" && req.body.intent !== undefined
        ? req.body.intent
        : req.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({ error: "intent object required" });
    }

    const normalizedIntent = normalizeIntentConfig(payload) || {};
    const validationMode = ["off", "warn", "enforce"].includes(normalizedIntent.validationMode)
      ? normalizedIntent.validationMode
      : "enforce";
    const issues = intentPreviewValidateHierarchy(normalizedIntent);
    const validationBlocking = validationMode === "enforce" && issues.length > 0;
    const requestedAgentId =
      typeof req.body?.agentId === "string" && req.body.agentId.trim().length > 0
        ? req.body.agentId.trim()
        : undefined;
    const simulation = intentPreviewEvaluateSimulation(normalizedIntent, requestedAgentId);

    res.json({
      ok: true,
      preview: {
        validation: {
          mode: validationMode,
          issueCount: issues.length,
          issues,
          blocking: validationBlocking,
        },
        simulation,
        readyToSave: !validationBlocking && !simulation.blocking,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to preview intent settings", details: err.message });
  }
});

// PATCH /api/settings/intent — Update intent hierarchy config
app.patch("/api/settings/intent", (req, res) => {
  try {
    const payload =
      req.body && typeof req.body === "object" && req.body.intent !== undefined
        ? req.body.intent
        : req.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({ error: "intent object required" });
    }

    const normalized = normalizeIntentConfig(payload);
    const config = readArgentConfig();
    if (normalized) {
      config.intent = normalized;
    } else {
      delete config.intent;
    }
    writeArgentConfig(config);
    res.json({ ok: true, intent: resolveIntentSettings(config) });
  } catch (err) {
    res.status(500).json({ error: "Failed to update intent settings", details: err.message });
  }
});

// GET /api/settings/intent/simulation-report — Check simulation gate report file status and contents
app.get("/api/settings/intent/simulation-report", (req, res) => {
  try {
    const config = readArgentConfig();
    const intent = resolveIntentSettings(config);
    const requestedAgentId =
      typeof req.query?.agentId === "string" && req.query.agentId.trim().length > 0
        ? req.query.agentId.trim()
        : undefined;
    const gate = intentPreviewResolveGate(intent, requestedAgentId) || {};
    let reportPath = intentPreviewResolveReportPath(gate.reportPath);
    if (!reportPath) {
      reportPath = intentPreviewResolveReportPath("reports/intent/simulation-latest.json");
    }

    const result = {
      reportPath: reportPath || null,
      exists: false,
      suites: [],
      warnings: [],
      readyForEnforce: false,
    };

    try {
      if (reportPath) {
        const raw = fs.readFileSync(reportPath, "utf8");
        const parsed = JSON.parse(raw);
        result.exists = true;
        const warnings = [];
        const suites = intentPreviewParseSuites(parsed, warnings);
        result.suites = suites;
        result.warnings = warnings;

        // Check if all required suites are present and passing
        const requiredSuites = Array.isArray(gate.suites) ? gate.suites : [];
        const suiteById = new Map(suites.map((s) => [s.suiteId, s]));
        let allPassing = suites.length > 0;
        for (const suiteId of requiredSuites) {
          const suite = suiteById.get(suiteId);
          if (!suite) {
            allPassing = false;
            result.warnings.push(`Required suite "${suiteId}" not found in report.`);
          } else if (suite.passRate < gate.minPassRate) {
            allPassing = false;
          }
        }
        result.readyForEnforce = allPassing && suites.length > 0;
      }
    } catch (err) {
      result.warnings.push(`Cannot read report: ${err?.message || String(err)}`);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to check simulation report", details: err.message });
  }
});

// GET /api/settings/knowledge/collections — List knowledge collections for selected agent
app.get("/api/settings/knowledge/collections", async (req, res) => {
  try {
    const config = readArgentConfig();
    const defaultAgentId = resolveDefaultAgentId(config);
    const targetAgentId = normalizeKnowledgeAgentTarget(req, defaultAgentId);
    const includeInaccessible = req.query.includeInaccessible === "true";
    const availableAgents = await buildKnowledgeAgentOptions(config, defaultAgentId);

    const aclModule = await getKnowledgeAclModule();
    if (!aclModule || typeof aclModule.listKnowledgeCollections !== "function") {
      return res.json({
        success: true,
        defaultAgentId,
        targetAgentId,
        availableAgents,
        aclEnforced: false,
        collections: [],
      });
    }

    const listing = await aclModule.listKnowledgeCollections({ agentId: targetAgentId });
    const collections = Array.isArray(listing?.collections)
      ? listing.collections
          .filter((entry) => {
            if (!entry || typeof entry !== "object") return false;
            if (includeInaccessible) return true;
            return entry.canRead === true || entry.canWrite === true || entry.isOwner === true;
          })
          .map((entry) => ({
            collectionId: typeof entry.collectionId === "string" ? entry.collectionId : "",
            collection: typeof entry.collection === "string" ? entry.collection : "",
            collectionTag: typeof entry.collectionTag === "string" ? entry.collectionTag : "",
            ownerAgentId: typeof entry.ownerAgentId === "string" ? entry.ownerAgentId : null,
            canRead: entry.canRead === true,
            canWrite: entry.canWrite === true,
            isOwner: entry.isOwner === true,
          }))
          .filter((entry) => entry.collection && entry.collectionTag)
      : [];

    res.json({
      success: true,
      defaultAgentId,
      targetAgentId,
      availableAgents,
      aclEnforced: listing?.aclEnforced === true,
      collections,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to load knowledge collections",
      details: err?.message || String(err),
    });
  }
});

// POST /api/settings/knowledge/collections/grant — Grant collection access to an agent
app.post("/api/settings/knowledge/collections/grant", async (req, res) => {
  try {
    const config = readArgentConfig();
    const defaultAgentId = resolveDefaultAgentId(config);
    const actorAgentId =
      typeof req.body?.actorAgentId === "string" && req.body.actorAgentId.trim()
        ? req.body.actorAgentId.trim()
        : defaultAgentId;
    const targetAgentId =
      typeof req.body?.agentId === "string" && req.body.agentId.trim()
        ? req.body.agentId.trim()
        : "";
    const collection =
      typeof req.body?.collection === "string" && req.body.collection.trim()
        ? req.body.collection.trim()
        : "";
    const canRead = req.body?.canRead !== false;
    const canWrite = req.body?.canWrite === true;
    const isOwner = req.body?.isOwner === true;

    if (!collection) {
      return res.status(400).json({ error: "collection is required" });
    }
    if (!targetAgentId) {
      return res.status(400).json({ error: "agentId is required" });
    }

    const aclModule = await getKnowledgeAclModule();
    if (!aclModule || typeof aclModule.setKnowledgeCollectionGrant !== "function") {
      return res.status(503).json({ error: "Knowledge ACL module unavailable" });
    }

    const result = await aclModule.setKnowledgeCollectionGrant({
      actorAgentId,
      targetAgentId,
      collection,
      canRead,
      canWrite,
      isOwner,
    });

    return res.json({
      success: true,
      actorAgentId,
      targetAgentId,
      collection,
      aclEnforced: result?.aclEnforced === true,
      updated: result?.updated === true,
      granted: {
        canRead: isOwner ? true : canRead,
        canWrite: isOwner ? true : canWrite,
        isOwner,
      },
    });
  } catch (err) {
    const message = err?.message || String(err);
    const status = message.includes("not owner") ? 403 : 500;
    return res.status(status).json({
      error: "Failed to grant collection access",
      details: message,
    });
  }
});

// GET /api/settings/agent — Returns agent behavior settings (contemplation, heartbeat, nudges, executionWorker, memory)
app.get("/api/settings/agent", (req, res) => {
  try {
    const config = readArgentConfig();
    const loadProfile = resolveLoadProfileConfig(config);
    const target = parseAgentSettingsTarget(req);
    const selectedAgent = findConfigAgent(config, target.agentId);
    if (target.agentId && !selectedAgent) {
      return res.status(404).json({ error: `Unknown agent: ${target.agentId}` });
    }
    const defaults = config?.agents?.defaults || {};
    const kernelDefaults = defaults.kernel || {};
    const defaultAgentId = resolveDefaultAgentId(config);
    const memoryVault = config.memory?.vault || {};
    const memoryVaultIngest = memoryVault?.ingest || {};
    const memoryCognee = config.memory?.cognee || {};
    const memoryCogneeRetrieval = memoryCognee?.retrieval || {};
    const selectedTools =
      selectedAgent && selectedAgent.tools && typeof selectedAgent.tools === "object"
        ? selectedAgent.tools
        : null;
    const toolsScope = target.agentId ? selectedTools || {} : config.tools || {};
    const executionOverride =
      selectedAgent && typeof selectedAgent.executionWorker === "object"
        ? selectedAgent.executionWorker
        : null;
    const nudgeData = readNudges();
    const memoryMmuLlm = config.memory?.memu?.llm || {};
    const memorySearch = config.agents?.defaults?.memorySearch || {};
    const executionDefaults = defaults.executionWorker || {};
    const executionResolved = executionOverride || {};
    const parseModelSelection = (value) => {
      const raw = typeof value === "string" ? value.trim() : "";
      const slashIndex = raw.indexOf("/");
      if (!raw || slashIndex <= 0 || slashIndex === raw.length - 1) {
        return { provider: "", model: "" };
      }
      return {
        provider: raw.slice(0, slashIndex).trim(),
        model: raw,
      };
    };
    const parseBackgroundModelSelection = (lane) => {
      const provider = typeof lane?.provider === "string" ? lane.provider.trim() : "";
      const model = typeof lane?.model === "string" ? lane.model.trim() : "";
      if (provider && model) {
        const normalized = model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
        return { provider, model: normalized };
      }
      return parseModelSelection(model);
    };
    const configuredBackgroundModels = defaults.backgroundModels || {};
    const contemplationSelection = parseModelSelection(defaults.contemplation?.model);
    const sisSelection = parseModelSelection(defaults.sis?.model || defaults.contemplation?.model);
    const heartbeatSelection = parseModelSelection(defaults.heartbeat?.model);
    const executionSelection = parseModelSelection(
      executionResolved.model ?? executionDefaults.model ?? "",
    );
    const intentSimulationAgentSelection = parseBackgroundModelSelection(
      configuredBackgroundModels.intentSimulationAgent,
    );
    const intentSimulationJudgeSelection = parseBackgroundModelSelection(
      configuredBackgroundModels.intentSimulationJudge,
    );
    const kernelBackgroundSelection = parseBackgroundModelSelection({
      model: typeof kernelDefaults.localModel === "string" ? kernelDefaults.localModel : "",
    });
    const embeddingsProvider =
      typeof memorySearch.provider === "string" ? memorySearch.provider.trim() : "";
    const embeddingsModel = typeof memorySearch.model === "string" ? memorySearch.model.trim() : "";
    const availableAgents = [
      { id: AGENT_SETTINGS_DEFAULT_TARGET, label: `Defaults (${defaultAgentId})` },
      ...listConfigAgentOptions(config),
    ];

    res.json({
      targetAgentId: target.targetAgentId,
      defaultAgentId,
      availableAgents,
      hasExecutionWorkerOverride: Boolean(executionOverride),
      loadProfile: {
        active: loadProfile.active,
        label: loadProfile.label,
        description: loadProfile.description,
        pollingMultiplier: loadProfile.pollingMultiplier,
        allowManualOverrides: loadProfile.allowManualOverrides,
      },
      kernel: {
        enabled: kernelDefaults.enabled === true,
        mode:
          typeof kernelDefaults.mode === "string" &&
          ["off", "shadow", "soft", "full"].includes(kernelDefaults.mode)
            ? kernelDefaults.mode
            : kernelDefaults.enabled === true
              ? "shadow"
              : "off",
        localModel: typeof kernelDefaults.localModel === "string" ? kernelDefaults.localModel : "",
        tickMs:
          typeof kernelDefaults.tickMs === "number" && Number.isFinite(kernelDefaults.tickMs)
            ? Math.max(1000, Math.floor(kernelDefaults.tickMs))
            : 30000,
        maxEscalationsPerHour:
          typeof kernelDefaults.maxEscalationsPerHour === "number" &&
          Number.isFinite(kernelDefaults.maxEscalationsPerHour)
            ? Math.max(1, Math.floor(kernelDefaults.maxEscalationsPerHour))
            : 4,
        dailyBudget:
          typeof kernelDefaults.dailyBudget === "number" &&
          Number.isFinite(kernelDefaults.dailyBudget)
            ? Math.max(0, kernelDefaults.dailyBudget)
            : 0,
        hardwareHostRequired: kernelDefaults.hardwareHostRequired === true,
        allowListening: kernelDefaults.allowListening === true,
        allowVision: kernelDefaults.allowVision === true,
      },
      contemplation: {
        enabled: defaults.contemplation?.enabled ?? false,
        every: defaults.contemplation?.every ?? "5m",
        maxCyclesPerHour: defaults.contemplation?.maxCyclesPerHour ?? 12,
        discoveryPhase: {
          enabled: defaults.contemplation?.discoveryPhase?.enabled === true,
          everyEpisodes:
            typeof defaults.contemplation?.discoveryPhase?.everyEpisodes === "number" &&
            Number.isFinite(defaults.contemplation?.discoveryPhase?.everyEpisodes)
              ? defaults.contemplation.discoveryPhase.everyEpisodes
              : 5,
          maxDurationMs:
            typeof defaults.contemplation?.discoveryPhase?.maxDurationMs === "number" &&
            Number.isFinite(defaults.contemplation?.discoveryPhase?.maxDurationMs)
              ? defaults.contemplation.discoveryPhase.maxDurationMs
              : 10000,
        },
      },
      heartbeat: {
        enabled: defaults.heartbeat?.enabled !== false,
        every: defaults.heartbeat?.every ?? "30m",
      },
      nudges: {
        enabled: nudgeData.globalEnabled !== false,
      },
      sis: {
        enabled: defaults.sis?.enabled ?? defaults.contemplation?.enabled ?? false,
        every: defaults.sis?.every ?? "10m",
        episodesPerConsolidation: defaults.sis?.episodesPerConsolidation ?? 5,
      },
      executionWorker: {
        enabled: executionResolved.enabled ?? executionDefaults.enabled ?? false,
        every: executionResolved.every ?? executionDefaults.every ?? "20m",
        sessionMainKey:
          executionResolved.sessionMainKey ??
          executionDefaults.sessionMainKey ??
          "worker-execution",
        maxRunMinutes: executionResolved.maxRunMinutes ?? executionDefaults.maxRunMinutes ?? 12,
        maxTasksPerCycle:
          executionResolved.maxTasksPerCycle ?? executionDefaults.maxTasksPerCycle ?? 24,
        scope: executionResolved.scope ?? executionDefaults.scope ?? "agent-visible",
        requireEvidence:
          executionResolved.requireEvidence ?? executionDefaults.requireEvidence ?? true,
        maxNoProgressAttempts:
          executionResolved.maxNoProgressAttempts ?? executionDefaults.maxNoProgressAttempts ?? 2,
      },
      memory: {
        memu: {
          llm: {
            provider: typeof memoryMmuLlm.provider === "string" ? memoryMmuLlm.provider : "",
            model: typeof memoryMmuLlm.model === "string" ? memoryMmuLlm.model : "",
            thinkLevel:
              typeof memoryMmuLlm.thinkLevel === "string" ? memoryMmuLlm.thinkLevel : "off",
            timeoutMs:
              typeof memoryMmuLlm.timeoutMs === "number" && Number.isFinite(memoryMmuLlm.timeoutMs)
                ? memoryMmuLlm.timeoutMs
                : 15000,
          },
        },
        vault: {
          enabled: memoryVault.enabled === true,
          path: typeof memoryVault.path === "string" ? memoryVault.path : "",
          knowledgeCollection:
            typeof memoryVault.knowledgeCollection === "string"
              ? memoryVault.knowledgeCollection
              : "vault-knowledge",
          ingest: {
            enabled: memoryVaultIngest.enabled === true,
            interval:
              typeof memoryVaultIngest.interval === "string" ? memoryVaultIngest.interval : "15m",
            debounceMs:
              typeof memoryVaultIngest.debounceMs === "number" &&
              Number.isFinite(memoryVaultIngest.debounceMs)
                ? memoryVaultIngest.debounceMs
                : 5000,
            excludePaths: Array.isArray(memoryVaultIngest.excludePaths)
              ? memoryVaultIngest.excludePaths.filter((entry) => typeof entry === "string")
              : [],
          },
        },
        cognee: {
          enabled: memoryCognee.enabled === true,
          embeddingDimensions:
            typeof memoryCognee.embeddingDimensions === "number" &&
            Number.isFinite(memoryCognee.embeddingDimensions)
              ? memoryCognee.embeddingDimensions
              : 1536,
          retrieval: {
            enabled: memoryCogneeRetrieval.enabled === true,
            timeoutMs:
              typeof memoryCogneeRetrieval.timeoutMs === "number" &&
              Number.isFinite(memoryCogneeRetrieval.timeoutMs)
                ? memoryCogneeRetrieval.timeoutMs
                : 5000,
            triggerOnSufficiencyFail: memoryCogneeRetrieval.triggerOnSufficiencyFail !== false,
            triggerOnStructuralQuery: memoryCogneeRetrieval.triggerOnStructuralQuery !== false,
            searchModes: Array.isArray(memoryCogneeRetrieval.searchModes)
              ? memoryCogneeRetrieval.searchModes.filter((entry) => typeof entry === "string")
              : ["GRAPH_COMPLETION", "INSIGHTS"],
            maxResultsPerQuery:
              typeof memoryCogneeRetrieval.maxResultsPerQuery === "number" &&
              Number.isFinite(memoryCogneeRetrieval.maxResultsPerQuery)
                ? memoryCogneeRetrieval.maxResultsPerQuery
                : 5,
          },
        },
      },
      tools: {
        profile: typeof toolsScope.profile === "string" ? toolsScope.profile : "",
        allow: Array.isArray(toolsScope.allow)
          ? toolsScope.allow.filter((entry) => typeof entry === "string")
          : [],
        ask: Array.isArray(toolsScope.ask)
          ? toolsScope.ask.filter((entry) => typeof entry === "string")
          : [],
        alsoAllow: Array.isArray(toolsScope.alsoAllow)
          ? toolsScope.alsoAllow.filter((entry) => typeof entry === "string")
          : [],
        deny: Array.isArray(toolsScope.deny)
          ? toolsScope.deny.filter((entry) => typeof entry === "string")
          : [],
      },
      imageAnalysis: normalizeImageAnalysisConfig(config),
      backgroundModels: {
        kernel: kernelBackgroundSelection,
        contemplation: contemplationSelection,
        sis: sisSelection,
        heartbeat: heartbeatSelection,
        executionWorker: executionSelection,
        intentSimulationAgent: intentSimulationAgentSelection,
        intentSimulationJudge: intentSimulationJudgeSelection,
        embeddings: {
          provider: embeddingsProvider,
          model:
            embeddingsProvider && embeddingsModel
              ? `${embeddingsProvider}/${embeddingsModel}`
              : embeddingsModel,
          fallback:
            typeof memorySearch.fallback === "string" ? memorySearch.fallback.trim() : "none",
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read agent settings", details: err.message });
  }
});

// PATCH /api/settings/agent — Update agent behavior settings
app.patch("/api/settings/agent", (req, res) => {
  try {
    const config = readArgentConfig();
    const surfaceProfile = getDashboardSurfaceProfile(config);
    const target = parseAgentSettingsTarget(req);
    const updatingAgentOverride = Boolean(target.agentId);
    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};
    if (!config.agents.defaults.loadProfile) config.agents.defaults.loadProfile = {};
    let nudgeChanged = false;

    if (surfaceProfile === "public-core") {
      if (req.body.loadProfile !== undefined) {
        return res.status(403).json({
          error: "Runtime load profile tuning is not available in Public Core.",
        });
      }
      if (req.body.tools !== undefined) {
        return res.status(403).json({
          error: "Tool governance editing is not available in Public Core.",
        });
      }
      if (updatingAgentOverride && req.body.executionWorker !== undefined) {
        return res.status(403).json({
          error: "Per-agent execution worker overrides are not available in Public Core.",
        });
      }
      if (
        req.body.backgroundModels?.intentSimulationAgent !== undefined ||
        req.body.backgroundModels?.intentSimulationJudge !== undefined
      ) {
        return res.status(403).json({
          error: "Intent simulation model lanes are not available in Public Core.",
        });
      }
    }

    if (req.body.loadProfile !== undefined) {
      const incoming = req.body.loadProfile || {};
      const activeId =
        typeof incoming.active === "string" ? incoming.active.trim() || "desktop" : "desktop";
      config.agents.defaults.loadProfile.active = activeId;
      if (incoming.allowManualOverrides !== undefined) {
        config.agents.defaults.loadProfile.allowManualOverrides =
          incoming.allowManualOverrides !== false;
      }

      // One-shot apply: write preset values directly into the config so the
      // config file is the single source of truth.  The dashboard toggles and
      // the runtime always agree — no silent overrides.
      const preset = LOAD_PROFILE_PRESETS[activeId] || LOAD_PROFILE_PRESETS.desktop;
      if (preset.patch) {
        const patch = preset.patch;
        if (patch.heartbeat) {
          config.agents.defaults.heartbeat = mergeDefined(
            config.agents.defaults.heartbeat || {},
            patch.heartbeat,
          );
        }
        if (patch.contemplation) {
          config.agents.defaults.contemplation = mergeDefined(
            config.agents.defaults.contemplation || {},
            patch.contemplation,
          );
        }
        if (patch.sis) {
          config.agents.defaults.sis = mergeDefined(config.agents.defaults.sis || {}, patch.sis);
        }
        if (patch.executionWorker) {
          config.agents.defaults.executionWorker = mergeDefined(
            config.agents.defaults.executionWorker || {},
            patch.executionWorker,
          );
        }
        if (typeof patch.maxConcurrent === "number") {
          config.agents.defaults.maxConcurrent = patch.maxConcurrent;
        }
        if (typeof patch.backgroundConcurrency === "number") {
          config.agents.defaults.backgroundConcurrency = patch.backgroundConcurrency;
        }
        if (patch.subagents) {
          config.agents.defaults.subagents = mergeDefined(
            config.agents.defaults.subagents || {},
            patch.subagents,
          );
        }
      }

      writeArgentConfig(config);
      const resolved = resolveLoadProfileConfig(config);
      return res.json({
        ok: true,
        loadProfile: {
          active: resolved.active,
          label: resolved.label,
          description: resolved.description,
          pollingMultiplier: resolved.pollingMultiplier,
          allowManualOverrides: resolved.allowManualOverrides,
        },
      });
    }

    if (updatingAgentOverride) {
      if (
        req.body.contemplation !== undefined ||
        req.body.heartbeat !== undefined ||
        req.body.sis !== undefined ||
        req.body.nudges !== undefined ||
        req.body.kernel !== undefined ||
        req.body.memory !== undefined
      ) {
        return res.status(400).json({
          error:
            "Per-agent override updates currently support executionWorker and tools only. Update defaults for kernel and other sections.",
        });
      }
      if (
        req.body.executionWorker === undefined &&
        (req.body.tools === undefined || typeof req.body.tools !== "object")
      ) {
        return res
          .status(400)
          .json({ error: "executionWorker or tools patch object required for per-agent updates" });
      }
      if (!Array.isArray(config.agents.list)) config.agents.list = [];
      let agentEntry = findConfigAgent(config, target.agentId);
      if (!agentEntry) {
        agentEntry = { id: target.agentId };
        config.agents.list.push(agentEntry);
      }

      if (req.body.executionWorker !== undefined) {
        const executionPatch = { ...req.body.executionWorker };
        const clearOverride = executionPatch._clearOverride === true;
        delete executionPatch._clearOverride;
        if (clearOverride) {
          delete agentEntry.executionWorker;
        } else {
          if (!agentEntry.executionWorker || typeof agentEntry.executionWorker !== "object") {
            agentEntry.executionWorker = {};
          }
          Object.assign(agentEntry.executionWorker, executionPatch);
        }
      }

      if (req.body.tools !== undefined && typeof req.body.tools === "object") {
        if (!agentEntry.tools || typeof agentEntry.tools !== "object") {
          agentEntry.tools = {};
        }
        const toolsPatch = req.body.tools || {};
        const assignList = (key) => {
          if (!(key in toolsPatch)) return;
          if (Array.isArray(toolsPatch[key])) {
            agentEntry.tools[key] = toolsPatch[key]
              .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
              .map((entry) => entry.trim());
          } else {
            delete agentEntry.tools[key];
          }
        };
        if ("profile" in toolsPatch) {
          if (typeof toolsPatch.profile === "string" && toolsPatch.profile.trim().length > 0) {
            agentEntry.tools.profile = toolsPatch.profile.trim();
          } else {
            delete agentEntry.tools.profile;
          }
        }
        assignList("allow");
        assignList("ask");
        assignList("alsoAllow");
        assignList("deny");
      }

      writeArgentConfig(config);
      return res.json({
        ok: true,
        targetAgentId: target.targetAgentId,
        hasExecutionWorkerOverride: Boolean(agentEntry.executionWorker),
      });
    }

    if (req.body.contemplation !== undefined) {
      if (
        config.agents.defaults.loadProfile?.active &&
        config.agents.defaults.loadProfile.active !== "desktop" &&
        config.agents.defaults.loadProfile.allowManualOverrides !== false
      ) {
        if (!config.agents.defaults.loadProfile.overrides)
          config.agents.defaults.loadProfile.overrides = {};
        if (!config.agents.defaults.loadProfile.overrides.contemplation)
          config.agents.defaults.loadProfile.overrides.contemplation = {};
        Object.assign(
          config.agents.defaults.loadProfile.overrides.contemplation,
          req.body.contemplation,
        );
      } else {
        if (!config.agents.defaults.contemplation) config.agents.defaults.contemplation = {};
        Object.assign(config.agents.defaults.contemplation, req.body.contemplation);
      }
    }
    if (req.body.kernel !== undefined) {
      if (!config.agents.defaults.kernel || typeof config.agents.defaults.kernel !== "object") {
        config.agents.defaults.kernel = {};
      }
      const incoming = req.body.kernel || {};
      if (incoming.enabled !== undefined) {
        config.agents.defaults.kernel.enabled = incoming.enabled === true;
      }
      if (incoming.mode !== undefined) {
        if (
          typeof incoming.mode === "string" &&
          ["off", "shadow", "soft", "full"].includes(incoming.mode)
        ) {
          config.agents.defaults.kernel.mode = incoming.mode;
        } else {
          delete config.agents.defaults.kernel.mode;
        }
      }
      if (incoming.localModel !== undefined) {
        if (typeof incoming.localModel === "string" && incoming.localModel.trim().length > 0) {
          config.agents.defaults.kernel.localModel = incoming.localModel.trim();
        } else {
          delete config.agents.defaults.kernel.localModel;
        }
      }
      if (incoming.tickMs !== undefined) {
        if (typeof incoming.tickMs === "number" && Number.isFinite(incoming.tickMs)) {
          config.agents.defaults.kernel.tickMs = Math.max(1000, Math.floor(incoming.tickMs));
        } else {
          delete config.agents.defaults.kernel.tickMs;
        }
      }
      if (incoming.maxEscalationsPerHour !== undefined) {
        if (
          typeof incoming.maxEscalationsPerHour === "number" &&
          Number.isFinite(incoming.maxEscalationsPerHour) &&
          incoming.maxEscalationsPerHour > 0
        ) {
          config.agents.defaults.kernel.maxEscalationsPerHour = Math.floor(
            incoming.maxEscalationsPerHour,
          );
        } else {
          delete config.agents.defaults.kernel.maxEscalationsPerHour;
        }
      }
      if (incoming.dailyBudget !== undefined) {
        if (typeof incoming.dailyBudget === "number" && Number.isFinite(incoming.dailyBudget)) {
          config.agents.defaults.kernel.dailyBudget = Math.max(0, incoming.dailyBudget);
        } else {
          delete config.agents.defaults.kernel.dailyBudget;
        }
      }
      if (incoming.hardwareHostRequired !== undefined) {
        config.agents.defaults.kernel.hardwareHostRequired = incoming.hardwareHostRequired === true;
      }
      if (incoming.allowListening !== undefined) {
        config.agents.defaults.kernel.allowListening = incoming.allowListening === true;
      }
      if (incoming.allowVision !== undefined) {
        config.agents.defaults.kernel.allowVision = incoming.allowVision === true;
      }
    }
    if (req.body.heartbeat !== undefined) {
      if (
        config.agents.defaults.loadProfile?.active &&
        config.agents.defaults.loadProfile.active !== "desktop" &&
        config.agents.defaults.loadProfile.allowManualOverrides !== false
      ) {
        if (!config.agents.defaults.loadProfile.overrides)
          config.agents.defaults.loadProfile.overrides = {};
        if (!config.agents.defaults.loadProfile.overrides.heartbeat)
          config.agents.defaults.loadProfile.overrides.heartbeat = {};
        Object.assign(config.agents.defaults.loadProfile.overrides.heartbeat, req.body.heartbeat);
      } else {
        if (!config.agents.defaults.heartbeat) config.agents.defaults.heartbeat = {};
        Object.assign(config.agents.defaults.heartbeat, req.body.heartbeat);
      }
    }
    if (req.body.sis !== undefined) {
      if (
        config.agents.defaults.loadProfile?.active &&
        config.agents.defaults.loadProfile.active !== "desktop" &&
        config.agents.defaults.loadProfile.allowManualOverrides !== false
      ) {
        if (!config.agents.defaults.loadProfile.overrides)
          config.agents.defaults.loadProfile.overrides = {};
        if (!config.agents.defaults.loadProfile.overrides.sis)
          config.agents.defaults.loadProfile.overrides.sis = {};
        Object.assign(config.agents.defaults.loadProfile.overrides.sis, req.body.sis);
      } else {
        if (!config.agents.defaults.sis) config.agents.defaults.sis = {};
        Object.assign(config.agents.defaults.sis, req.body.sis);
      }
    }
    if (req.body.executionWorker !== undefined) {
      if (
        config.agents.defaults.loadProfile?.active &&
        config.agents.defaults.loadProfile.active !== "desktop" &&
        config.agents.defaults.loadProfile.allowManualOverrides !== false
      ) {
        if (!config.agents.defaults.loadProfile.overrides)
          config.agents.defaults.loadProfile.overrides = {};
        if (!config.agents.defaults.loadProfile.overrides.executionWorker)
          config.agents.defaults.loadProfile.overrides.executionWorker = {};
        Object.assign(
          config.agents.defaults.loadProfile.overrides.executionWorker,
          req.body.executionWorker,
        );
      } else {
        if (!config.agents.defaults.executionWorker) config.agents.defaults.executionWorker = {};
        Object.assign(config.agents.defaults.executionWorker, req.body.executionWorker);
      }
    }
    if (req.body.nudges !== undefined) {
      const data = readNudges();
      data.globalEnabled = req.body.nudges.enabled !== false;
      writeNudges(data);
      nudgeChanged = true;
    }
    if (req.body.memory?.memu?.llm !== undefined) {
      if (!config.memory) config.memory = {};
      if (!config.memory.memu) config.memory.memu = {};
      if (!config.memory.memu.llm) config.memory.memu.llm = {};
      const incoming = req.body.memory.memu.llm || {};

      if (incoming.provider !== undefined) {
        if (typeof incoming.provider === "string" && incoming.provider.trim().length > 0) {
          config.memory.memu.llm.provider = incoming.provider.trim();
        } else {
          delete config.memory.memu.llm.provider;
        }
      }
      if (incoming.model !== undefined) {
        if (typeof incoming.model === "string" && incoming.model.trim().length > 0) {
          config.memory.memu.llm.model = incoming.model.trim();
        } else {
          delete config.memory.memu.llm.model;
        }
      }
      if (incoming.thinkLevel !== undefined) {
        if (typeof incoming.thinkLevel === "string" && incoming.thinkLevel.trim().length > 0) {
          config.memory.memu.llm.thinkLevel = incoming.thinkLevel.trim();
        } else {
          delete config.memory.memu.llm.thinkLevel;
        }
      }
      if (incoming.timeoutMs !== undefined) {
        if (
          typeof incoming.timeoutMs === "number" &&
          Number.isFinite(incoming.timeoutMs) &&
          incoming.timeoutMs > 0
        ) {
          config.memory.memu.llm.timeoutMs = Math.floor(incoming.timeoutMs);
        } else {
          delete config.memory.memu.llm.timeoutMs;
        }
      }
    }
    if (req.body.memory?.vault !== undefined) {
      if (!config.memory) config.memory = {};
      if (!config.memory.vault || typeof config.memory.vault !== "object") config.memory.vault = {};
      const incoming = req.body.memory.vault || {};
      if (incoming.enabled !== undefined) {
        config.memory.vault.enabled = incoming.enabled === true;
      }
      if (incoming.path !== undefined) {
        if (typeof incoming.path === "string" && incoming.path.trim().length > 0) {
          config.memory.vault.path = incoming.path.trim();
        } else {
          delete config.memory.vault.path;
        }
      }
      if (incoming.knowledgeCollection !== undefined) {
        if (
          typeof incoming.knowledgeCollection === "string" &&
          incoming.knowledgeCollection.trim().length > 0
        ) {
          config.memory.vault.knowledgeCollection = incoming.knowledgeCollection.trim();
        } else {
          delete config.memory.vault.knowledgeCollection;
        }
      }
      if (incoming.ingest !== undefined) {
        if (!config.memory.vault.ingest || typeof config.memory.vault.ingest !== "object") {
          config.memory.vault.ingest = {};
        }
        const ingest = incoming.ingest || {};
        if (ingest.enabled !== undefined) {
          config.memory.vault.ingest.enabled = ingest.enabled === true;
        }
        if (ingest.interval !== undefined) {
          if (typeof ingest.interval === "string" && ingest.interval.trim().length > 0) {
            config.memory.vault.ingest.interval = ingest.interval.trim();
          } else {
            delete config.memory.vault.ingest.interval;
          }
        }
        if (ingest.debounceMs !== undefined) {
          if (
            typeof ingest.debounceMs === "number" &&
            Number.isFinite(ingest.debounceMs) &&
            ingest.debounceMs >= 0
          ) {
            config.memory.vault.ingest.debounceMs = Math.floor(ingest.debounceMs);
          } else {
            delete config.memory.vault.ingest.debounceMs;
          }
        }
        if (ingest.excludePaths !== undefined) {
          config.memory.vault.ingest.excludePaths = Array.isArray(ingest.excludePaths)
            ? ingest.excludePaths
                .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
                .map((entry) => entry.trim())
            : [];
        }
      }
    }
    if (req.body.memory?.cognee !== undefined) {
      if (!config.memory) config.memory = {};
      if (!config.memory.cognee || typeof config.memory.cognee !== "object")
        config.memory.cognee = {};
      const incoming = req.body.memory.cognee || {};
      if (incoming.enabled !== undefined) {
        config.memory.cognee.enabled = incoming.enabled === true;
      }
      if (incoming.embeddingDimensions !== undefined) {
        if (
          typeof incoming.embeddingDimensions === "number" &&
          Number.isFinite(incoming.embeddingDimensions) &&
          incoming.embeddingDimensions > 0
        ) {
          config.memory.cognee.embeddingDimensions = Math.floor(incoming.embeddingDimensions);
        } else {
          delete config.memory.cognee.embeddingDimensions;
        }
      }
      if (incoming.retrieval !== undefined) {
        if (!config.memory.cognee.retrieval || typeof config.memory.cognee.retrieval !== "object") {
          config.memory.cognee.retrieval = {};
        }
        const retrieval = incoming.retrieval || {};
        if (retrieval.enabled !== undefined) {
          config.memory.cognee.retrieval.enabled = retrieval.enabled === true;
        }
        if (retrieval.timeoutMs !== undefined) {
          if (
            typeof retrieval.timeoutMs === "number" &&
            Number.isFinite(retrieval.timeoutMs) &&
            retrieval.timeoutMs > 0
          ) {
            config.memory.cognee.retrieval.timeoutMs = Math.floor(retrieval.timeoutMs);
          } else {
            delete config.memory.cognee.retrieval.timeoutMs;
          }
        }
        if (retrieval.triggerOnSufficiencyFail !== undefined) {
          config.memory.cognee.retrieval.triggerOnSufficiencyFail =
            retrieval.triggerOnSufficiencyFail === true;
        }
        if (retrieval.triggerOnStructuralQuery !== undefined) {
          config.memory.cognee.retrieval.triggerOnStructuralQuery =
            retrieval.triggerOnStructuralQuery === true;
        }
        if (retrieval.searchModes !== undefined) {
          config.memory.cognee.retrieval.searchModes = Array.isArray(retrieval.searchModes)
            ? retrieval.searchModes
                .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
                .map((entry) => entry.trim())
            : [];
        }
        if (retrieval.maxResultsPerQuery !== undefined) {
          if (
            typeof retrieval.maxResultsPerQuery === "number" &&
            Number.isFinite(retrieval.maxResultsPerQuery) &&
            retrieval.maxResultsPerQuery > 0
          ) {
            config.memory.cognee.retrieval.maxResultsPerQuery = Math.floor(
              retrieval.maxResultsPerQuery,
            );
          } else {
            delete config.memory.cognee.retrieval.maxResultsPerQuery;
          }
        }
      }
    }
    if (req.body.contemplation?.discoveryPhase !== undefined) {
      if (!config.agents.defaults.contemplation) config.agents.defaults.contemplation = {};
      if (
        !config.agents.defaults.contemplation.discoveryPhase ||
        typeof config.agents.defaults.contemplation.discoveryPhase !== "object"
      ) {
        config.agents.defaults.contemplation.discoveryPhase = {};
      }
      const discoveryPhase = req.body.contemplation.discoveryPhase || {};
      if (discoveryPhase.enabled !== undefined) {
        config.agents.defaults.contemplation.discoveryPhase.enabled =
          discoveryPhase.enabled === true;
      }
      if (discoveryPhase.everyEpisodes !== undefined) {
        if (
          typeof discoveryPhase.everyEpisodes === "number" &&
          Number.isFinite(discoveryPhase.everyEpisodes) &&
          discoveryPhase.everyEpisodes > 0
        ) {
          config.agents.defaults.contemplation.discoveryPhase.everyEpisodes = Math.floor(
            discoveryPhase.everyEpisodes,
          );
        } else {
          delete config.agents.defaults.contemplation.discoveryPhase.everyEpisodes;
        }
      }
      if (discoveryPhase.maxDurationMs !== undefined) {
        if (
          typeof discoveryPhase.maxDurationMs === "number" &&
          Number.isFinite(discoveryPhase.maxDurationMs) &&
          discoveryPhase.maxDurationMs > 0
        ) {
          config.agents.defaults.contemplation.discoveryPhase.maxDurationMs = Math.floor(
            discoveryPhase.maxDurationMs,
          );
        } else {
          delete config.agents.defaults.contemplation.discoveryPhase.maxDurationMs;
        }
      }
    }
    if (req.body.imageAnalysis !== undefined) {
      applyImageAnalysisConfigPatch(config, req.body.imageAnalysis);
    }
    if (req.body.tools !== undefined && typeof req.body.tools === "object") {
      if (!config.tools || typeof config.tools !== "object") config.tools = {};
      const toolsPatch = req.body.tools || {};
      const assignList = (key) => {
        if (!(key in toolsPatch)) return;
        if (Array.isArray(toolsPatch[key])) {
          config.tools[key] = toolsPatch[key]
            .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim());
        } else {
          delete config.tools[key];
        }
      };
      if ("profile" in toolsPatch) {
        if (typeof toolsPatch.profile === "string" && toolsPatch.profile.trim().length > 0) {
          config.tools.profile = toolsPatch.profile.trim();
        } else {
          delete config.tools.profile;
        }
      }
      assignList("allow");
      assignList("ask");
      assignList("alsoAllow");
      assignList("deny");
    }
    if (req.body.backgroundModels !== undefined) {
      const incoming = req.body.backgroundModels || {};
      const stringifyModelSelection = (value) => {
        if (!value || typeof value !== "object") return undefined;
        const raw =
          typeof value.model === "string" && value.model.trim().length > 0
            ? value.model.trim()
            : "";
        return raw || undefined;
      };

      if (incoming.contemplation !== undefined) {
        const modelRef = stringifyModelSelection(incoming.contemplation);
        if (
          config.agents.defaults.loadProfile?.active &&
          config.agents.defaults.loadProfile.active !== "desktop" &&
          config.agents.defaults.loadProfile.allowManualOverrides !== false
        ) {
          if (!config.agents.defaults.loadProfile.overrides)
            config.agents.defaults.loadProfile.overrides = {};
          if (!config.agents.defaults.loadProfile.overrides.contemplation)
            config.agents.defaults.loadProfile.overrides.contemplation = {};
          if (modelRef) {
            config.agents.defaults.loadProfile.overrides.contemplation.model = modelRef;
          } else {
            delete config.agents.defaults.loadProfile.overrides.contemplation.model;
          }
        } else {
          if (!config.agents.defaults.contemplation) config.agents.defaults.contemplation = {};
          if (modelRef) {
            config.agents.defaults.contemplation.model = modelRef;
          } else {
            delete config.agents.defaults.contemplation.model;
          }
        }
      }

      if (incoming.sis !== undefined) {
        const modelRef = stringifyModelSelection(incoming.sis);
        if (
          config.agents.defaults.loadProfile?.active &&
          config.agents.defaults.loadProfile.active !== "desktop" &&
          config.agents.defaults.loadProfile.allowManualOverrides !== false
        ) {
          if (!config.agents.defaults.loadProfile.overrides)
            config.agents.defaults.loadProfile.overrides = {};
          if (!config.agents.defaults.loadProfile.overrides.sis)
            config.agents.defaults.loadProfile.overrides.sis = {};
          if (modelRef) {
            config.agents.defaults.loadProfile.overrides.sis.model = modelRef;
          } else {
            delete config.agents.defaults.loadProfile.overrides.sis.model;
          }
        } else {
          if (!config.agents.defaults.sis) config.agents.defaults.sis = {};
          if (modelRef) {
            config.agents.defaults.sis.model = modelRef;
          } else {
            delete config.agents.defaults.sis.model;
          }
        }
      }

      if (incoming.heartbeat !== undefined) {
        const modelRef = stringifyModelSelection(incoming.heartbeat);
        if (
          config.agents.defaults.loadProfile?.active &&
          config.agents.defaults.loadProfile.active !== "desktop" &&
          config.agents.defaults.loadProfile.allowManualOverrides !== false
        ) {
          if (!config.agents.defaults.loadProfile.overrides)
            config.agents.defaults.loadProfile.overrides = {};
          if (!config.agents.defaults.loadProfile.overrides.heartbeat)
            config.agents.defaults.loadProfile.overrides.heartbeat = {};
          if (modelRef) {
            config.agents.defaults.loadProfile.overrides.heartbeat.model = modelRef;
          } else {
            delete config.agents.defaults.loadProfile.overrides.heartbeat.model;
          }
        } else {
          if (!config.agents.defaults.heartbeat) config.agents.defaults.heartbeat = {};
          if (modelRef) {
            config.agents.defaults.heartbeat.model = modelRef;
          } else {
            delete config.agents.defaults.heartbeat.model;
          }
        }
      }

      if (incoming.executionWorker !== undefined) {
        const modelRef = stringifyModelSelection(incoming.executionWorker);
        if (
          config.agents.defaults.loadProfile?.active &&
          config.agents.defaults.loadProfile.active !== "desktop" &&
          config.agents.defaults.loadProfile.allowManualOverrides !== false
        ) {
          if (!config.agents.defaults.loadProfile.overrides)
            config.agents.defaults.loadProfile.overrides = {};
          if (!config.agents.defaults.loadProfile.overrides.executionWorker)
            config.agents.defaults.loadProfile.overrides.executionWorker = {};
          if (modelRef) {
            config.agents.defaults.loadProfile.overrides.executionWorker.model = modelRef;
          } else {
            delete config.agents.defaults.loadProfile.overrides.executionWorker.model;
          }
        } else {
          if (!config.agents.defaults.executionWorker) config.agents.defaults.executionWorker = {};
          if (modelRef) {
            config.agents.defaults.executionWorker.model = modelRef;
          } else {
            delete config.agents.defaults.executionWorker.model;
          }
        }
      }

      if (incoming.embeddings !== undefined) {
        if (!config.agents.defaults.memorySearch) config.agents.defaults.memorySearch = {};
        const embeddingProvider =
          typeof incoming.embeddings.provider === "string"
            ? incoming.embeddings.provider.trim()
            : "";
        const embeddingModelRaw =
          typeof incoming.embeddings.model === "string" ? incoming.embeddings.model.trim() : "";
        const normalizedEmbeddingModel =
          embeddingProvider && embeddingModelRaw.startsWith(`${embeddingProvider}/`)
            ? embeddingModelRaw.slice(embeddingProvider.length + 1)
            : embeddingModelRaw;
        if (embeddingProvider) {
          config.agents.defaults.memorySearch.provider = embeddingProvider;
        } else {
          delete config.agents.defaults.memorySearch.provider;
        }
        if (normalizedEmbeddingModel) {
          config.agents.defaults.memorySearch.model = normalizedEmbeddingModel;
        } else {
          delete config.agents.defaults.memorySearch.model;
        }
        if (
          typeof incoming.embeddings.fallback === "string" &&
          incoming.embeddings.fallback.trim().length > 0
        ) {
          config.agents.defaults.memorySearch.fallback = incoming.embeddings.fallback.trim();
        } else {
          delete config.agents.defaults.memorySearch.fallback;
        }
      }

      if (incoming.kernel !== undefined) {
        const provider =
          typeof incoming.kernel.provider === "string" ? incoming.kernel.provider.trim() : "";
        const modelRaw =
          typeof incoming.kernel.model === "string" ? incoming.kernel.model.trim() : "";
        const model =
          provider && modelRaw.startsWith(`${provider}/`)
            ? modelRaw.slice(provider.length + 1)
            : modelRaw;

        if (!config.agents.defaults.kernel || typeof config.agents.defaults.kernel !== "object") {
          config.agents.defaults.kernel = {};
        }

        if (provider && model) {
          config.agents.defaults.kernel.localModel = `${provider}/${model}`;
        } else {
          delete config.agents.defaults.kernel.localModel;
        }
      }

      if (incoming.intentSimulationAgent !== undefined) {
        const provider =
          typeof incoming.intentSimulationAgent.provider === "string"
            ? incoming.intentSimulationAgent.provider.trim()
            : "";
        const model =
          typeof incoming.intentSimulationAgent.model === "string"
            ? incoming.intentSimulationAgent.model.trim()
            : "";

        if (!config.agents.defaults.backgroundModels) config.agents.defaults.backgroundModels = {};
        if (!config.agents.defaults.backgroundModels.intentSimulationAgent)
          config.agents.defaults.backgroundModels.intentSimulationAgent = {};

        if (provider)
          config.agents.defaults.backgroundModels.intentSimulationAgent.provider = provider;
        else delete config.agents.defaults.backgroundModels.intentSimulationAgent.provider;

        if (model) config.agents.defaults.backgroundModels.intentSimulationAgent.model = model;
        else delete config.agents.defaults.backgroundModels.intentSimulationAgent.model;
      }

      if (incoming.intentSimulationJudge !== undefined) {
        const provider =
          typeof incoming.intentSimulationJudge.provider === "string"
            ? incoming.intentSimulationJudge.provider.trim()
            : "";
        const model =
          typeof incoming.intentSimulationJudge.model === "string"
            ? incoming.intentSimulationJudge.model.trim()
            : "";

        if (!config.agents.defaults.backgroundModels) config.agents.defaults.backgroundModels = {};
        if (!config.agents.defaults.backgroundModels.intentSimulationJudge)
          config.agents.defaults.backgroundModels.intentSimulationJudge = {};

        if (provider)
          config.agents.defaults.backgroundModels.intentSimulationJudge.provider = provider;
        else delete config.agents.defaults.backgroundModels.intentSimulationJudge.provider;

        if (model) config.agents.defaults.backgroundModels.intentSimulationJudge.model = model;
        else delete config.agents.defaults.backgroundModels.intentSimulationJudge.model;
      }
    }

    writeArgentConfig(config);
    res.json({
      ok: true,
      nudgeChanged,
      targetAgentId: AGENT_SETTINGS_DEFAULT_TARGET,
      hasExecutionWorkerOverride: false,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to update agent settings", details: err.message });
  }
});

app.get("/api/settings/load-profile", (req, res) => {
  try {
    const config = readArgentConfig();
    const resolved = resolveLoadProfileConfig(config);
    res.json({
      active: resolved.active,
      label: resolved.label,
      description: resolved.description,
      pollingMultiplier: resolved.pollingMultiplier,
      allowManualOverrides: resolved.allowManualOverrides,
      profiles: Object.values(LOAD_PROFILE_PRESETS).map((profile) => ({
        id: profile.id,
        label: profile.label,
        description: profile.description,
        pollingMultiplier: profile.pollingMultiplier,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read load profile", details: err.message });
  }
});

// GET /api/settings/memory-v3/status — status/health summary for vault, cognee, and discovery
app.get("/api/settings/memory-v3/status", (_req, res) => {
  try {
    const config = readArgentConfig();
    res.json({
      ok: true,
      ...getMemoryV3StatusPayload(config),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Failed to read Memory V3 status",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /api/settings/memory-v3/bootstrap-vault — create internal Argent vault and optionally bind config
app.post("/api/settings/memory-v3/bootstrap-vault", (req, res) => {
  try {
    const config = readArgentConfig();
    const forceBind = req.body?.forceBind === true;
    fs.mkdirSync(DEFAULT_ARGENT_VAULT_PATH, { recursive: true });
    const readmePath = path.join(DEFAULT_ARGENT_VAULT_PATH, "README.md");
    const inboxPath = path.join(DEFAULT_ARGENT_VAULT_PATH, "Inbox.md");
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(
        readmePath,
        [
          "# Argent Vault",
          "",
          "This is the default Argent-managed memory vault.",
          "",
          "- Edit these markdown files directly or open this folder in Obsidian.",
          "- Argent can ingest this vault into the knowledge library when vault ingest is enabled.",
        ].join("\n"),
        "utf8",
      );
    }
    if (!fs.existsSync(inboxPath)) {
      fs.writeFileSync(
        inboxPath,
        ["# Inbox", "", "Use this note for quick capture and unstructured memory staging."].join(
          "\n",
        ),
        "utf8",
      );
    }

    const configuredVaultPath =
      typeof config?.memory?.vault?.path === "string" ? config.memory.vault.path.trim() : "";
    const shouldBind = forceBind || !configuredVaultPath;
    if (shouldBind) {
      if (!config.memory) config.memory = {};
      if (!config.memory.vault || typeof config.memory.vault !== "object") config.memory.vault = {};
      config.memory.vault.path = DEFAULT_ARGENT_VAULT_PATH;
      if (config.memory.vault.enabled !== true) {
        config.memory.vault.enabled = true;
      }
      if (!config.memory.vault.knowledgeCollection) {
        config.memory.vault.knowledgeCollection = "vault-knowledge";
      }
      if (!config.memory.vault.ingest || typeof config.memory.vault.ingest !== "object") {
        config.memory.vault.ingest = {};
      }
      if (config.memory.vault.ingest.enabled === undefined) {
        config.memory.vault.ingest.enabled = false;
      }
      writeArgentConfig(config);
    }

    res.json({
      ok: true,
      boundToConfig: shouldBind,
      path: DEFAULT_ARGENT_VAULT_PATH,
      files: ["README.md", "Inbox.md"],
      status: getMemoryV3StatusPayload(readArgentConfig()),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Failed to bootstrap internal vault",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /api/settings/memory-v3/choose-vault-folder — choose an existing markdown/Obsidian vault
app.post("/api/settings/memory-v3/choose-vault-folder", (req, res) => {
  try {
    if (process.platform !== "darwin") {
      return res.status(400).json({
        ok: false,
        error: "Folder picker is currently available on macOS only.",
      });
    }
    const prompt =
      typeof req.body?.prompt === "string" && req.body.prompt.trim()
        ? req.body.prompt.trim()
        : "Choose an Obsidian or markdown vault folder for Argent Memory V3";
    const script = `POSIX path of (choose folder with prompt ${appleScriptStringLiteral(prompt)})`;
    const selected = execFileSync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!selected) {
      return res.status(400).json({ ok: false, error: "No folder selected." });
    }
    const normalized = path.resolve(selected);
    const stat = fs.statSync(normalized);
    if (!stat.isDirectory()) {
      return res.status(400).json({ ok: false, error: "Selected path is not a directory." });
    }

    const bind = req.body?.bind !== false;
    if (bind) {
      const config = readArgentConfig();
      if (!config.memory) config.memory = {};
      if (!config.memory.vault || typeof config.memory.vault !== "object") config.memory.vault = {};
      config.memory.vault.path = normalized;
      config.memory.vault.enabled = true;
      if (!config.memory.vault.knowledgeCollection) {
        config.memory.vault.knowledgeCollection = "vault-knowledge";
      }
      if (!config.memory.vault.ingest || typeof config.memory.vault.ingest !== "object") {
        config.memory.vault.ingest = {};
      }
      if (config.memory.vault.ingest.enabled === undefined) {
        config.memory.vault.ingest.enabled = false;
      }
      writeArgentConfig(config);
      return res.json({
        ok: true,
        path: normalized,
        boundToConfig: true,
        status: getMemoryV3StatusPayload(readArgentConfig()),
      });
    }

    return res.json({ ok: true, path: normalized, boundToConfig: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/user canceled/i.test(message)) {
      return res.status(400).json({ ok: false, error: "Folder selection cancelled." });
    }
    return res.status(500).json({
      ok: false,
      error: "Failed to choose vault folder",
      details: message,
    });
  }
});

// POST /api/settings/aos-google/preflight — run imported GWS readiness preflight
app.post("/api/settings/aos-google/preflight", (req, res) => {
  try {
    if (!fs.existsSync(AOS_GOOGLE_PREFLIGHT_PATH)) {
      return res.status(404).json({
        ok: false,
        error: "aos-google preflight script not found",
        path: AOS_GOOGLE_PREFLIGHT_PATH,
      });
    }
    const pythonBin = execSync("command -v python3 2>/dev/null || true", {
      encoding: "utf8",
    }).trim();
    if (!pythonBin) {
      return res.status(400).json({
        ok: false,
        error: "python3 not found",
      });
    }
    const args = [AOS_GOOGLE_PREFLIGHT_PATH];
    if (req.body?.installMissing === true) args.push("--install-missing");
    if (req.body?.requireAuth !== false) args.push("--require-auth");
    args.push("--json");

    try {
      const output = execFileSync(pythonBin, args, {
        cwd: DASHBOARD_REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return res.json(JSON.parse(output));
    } catch (err) {
      const stdout = err && typeof err.stdout === "string" ? err.stdout : "";
      const stderr = err && typeof err.stderr === "string" ? err.stderr : "";
      if (stdout.trim()) {
        try {
          return res.status(200).json(JSON.parse(stdout));
        } catch {
          // fall through
        }
      }
      return res.status(500).json({
        ok: false,
        error: "aos-google preflight failed",
        details: err instanceof Error ? err.message : String(err),
        stderr,
      });
    }
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Failed to run aos-google preflight",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /api/settings/aos-google/launch — open guided local setup actions for aos-google
app.post("/api/settings/aos-google/launch", (req, res) => {
  try {
    const action = typeof req.body?.action === "string" ? req.body.action.trim() : "";
    if (!action) {
      return res.status(400).json({
        ok: false,
        error: "action is required",
      });
    }

    ensureAosGoogleConfigDir();

    switch (action) {
      case "open-config-folder": {
        execFileSync("open", [AOS_GOOGLE_CONFIG_DIR], { stdio: "ignore" });
        return res.json({
          ok: true,
          action,
          message: `Opened ${AOS_GOOGLE_CONFIG_DIR} in Finder.`,
          path: AOS_GOOGLE_CONFIG_DIR,
        });
      }
      case "open-gcloud-install-docs": {
        const url = "https://cloud.google.com/sdk/docs/install";
        execFileSync("open", [url], { stdio: "ignore" });
        return res.json({
          ok: true,
          action,
          message: "Opened Google Cloud SDK install docs in your browser.",
          url,
        });
      }
      case "launch-auth-setup": {
        if (!commandExists("gws")) {
          return res.status(400).json({
            ok: false,
            error: "gws is not installed",
            details: "Install @googleworkspace/cli first.",
          });
        }
        if (!commandExists("gcloud")) {
          return res.status(400).json({
            ok: false,
            error: "gcloud is not installed",
            details: "Install Google Cloud SDK or provide client_secret.json manually.",
          });
        }
        launchTerminalCommand("gws auth setup --login", AOS_GOOGLE_CONFIG_DIR);
        return res.json({
          ok: true,
          action,
          message: "Opened Terminal and launched gws auth setup --login.",
          command: "gws auth setup --login",
          cwd: AOS_GOOGLE_CONFIG_DIR,
        });
      }
      case "launch-auth-login": {
        if (!commandExists("gws")) {
          return res.status(400).json({
            ok: false,
            error: "gws is not installed",
            details: "Install @googleworkspace/cli first.",
          });
        }
        if (!hasAosGoogleOAuthClientConfig()) {
          return res.status(400).json({
            ok: false,
            error: "OAuth client is not configured",
            details:
              "Run gws auth setup --login or add client_secret.json / GOOGLE_WORKSPACE_CLI_CLIENT_ID + GOOGLE_WORKSPACE_CLI_CLIENT_SECRET first.",
          });
        }
        const command = `gws auth login -s ${AOS_GOOGLE_AUTH_SERVICES}`;
        launchTerminalCommand(command, AOS_GOOGLE_CONFIG_DIR);
        return res.json({
          ok: true,
          action,
          message: "Opened Terminal and launched Google Workspace login.",
          command,
          cwd: AOS_GOOGLE_CONFIG_DIR,
        });
      }
      default:
        return res.status(400).json({
          ok: false,
          error: "Unknown aos-google launch action",
          details: action,
        });
    }
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Failed to launch aos-google setup action",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// GET /api/settings/agent/raw-config — return full argent.json for advanced editing
app.get("/api/settings/agent/raw-config", (req, res) => {
  try {
    const config = readArgentConfig();
    const { config: safeConfig, redactedCount } = cloneForRawConfig(config);
    return res.json({
      path: ARGENT_CONFIG_PATH,
      raw: JSON.stringify(safeConfig, null, 2),
      redacted: redactedCount > 0,
      redactedCount,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to read raw argent config",
      details: err?.message || String(err),
    });
  }
});

// PATCH /api/settings/agent/raw-config — replace full argent.json from raw JSON text
app.patch("/api/settings/agent/raw-config", (req, res) => {
  try {
    const raw = typeof req.body?.raw === "string" ? req.body.raw : "";
    if (!raw.trim()) {
      return res.status(400).json({ error: "raw JSON payload required" });
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return res.status(400).json({
        error: "Invalid JSON",
        details: err?.message || String(err),
      });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return res.status(400).json({
        error: "Root config must be a JSON object",
      });
    }
    const existing = readArgentConfig();
    const incomingVars = parsed?.env?.vars;
    if (incomingVars && typeof incomingVars === "object") {
      const existingVars =
        existing?.env?.vars && typeof existing.env.vars === "object" ? existing.env.vars : {};
      for (const [key, value] of Object.entries(incomingVars)) {
        if (value === REDACTED_CONFIG_SECRET) {
          // Preserve existing value when the raw editor submits redacted placeholders.
          incomingVars[key] = existingVars[key];
          continue;
        }
        if (typeof value === "string" && value.trim() && !allowLegacyConfigEnvImport()) {
          return res.status(400).json({
            error: "Inline env secrets are blocked by default",
            details:
              "Use Settings > API Keys / Auth Profiles for secrets. " +
              "Set ARGENT_ALLOW_CONFIG_ENV_VARS=1 only for temporary compatibility.",
          });
        }
      }
    }

    writeArgentConfig(parsed);
    return res.json({
      ok: true,
      path: ARGENT_CONFIG_PATH,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to write raw argent config",
      details: err?.message || String(err),
    });
  }
});

// ============================================
// ALIGNMENT DOCS API
// ============================================

function resolveAlignmentStateDir() {
  const override = process.env.ARGENT_STATE_DIR?.trim();
  if (override) {
    const expanded = process.env.HOME
      ? override.replace(/^~(?=$|[\\/])/, process.env.HOME)
      : override;
    return path.resolve(expanded);
  }
  return path.join(process.env.HOME || "", ".argentos");
}

const ALIGNMENT_STATE_DIR = resolveAlignmentStateDir();
const AGENTS_DIR = path.join(ALIGNMENT_STATE_DIR, "agents");
const WORKSPACE_MAIN = path.join(ALIGNMENT_STATE_DIR, "workspace-main");
const ALIGNMENT_BACKUP_DIR = path.join(ALIGNMENT_STATE_DIR, "backups");

// Known alignment doc filenames
const ALIGNMENT_DOCS = [
  { file: "SOUL.md", label: "Soul", description: "Core personality and values" },
  { file: "IDENTITY.md", label: "Identity", description: "Self-concept and presentation" },
  { file: "USER.md", label: "User", description: "User preferences and context" },
  { file: "HEARTBEAT.md", label: "Heartbeat", description: "Periodic check-in instructions" },
  {
    file: "CONTEMPLATION.md",
    label: "Contemplation",
    description: "Self-directed thinking guidance",
  },
  { file: "TOOLS.md", label: "Tools", description: "Tool usage and capabilities" },
  { file: "SECURITY.md", label: "Security", description: "Security policies and boundaries" },
  { file: "AGENTS.md", label: "Agents", description: "Multi-agent coordination" },
  { file: "BOOTSTRAP.md", label: "Bootstrap", description: "Initial boot-up instructions" },
  { file: "MEMORY.md", label: "Memory", description: "Memory system guidance" },
  { file: "WORKFLOWS.md", label: "Workflows", description: "Workflow definitions and patterns" },
];

// Resolve the docs directory for a given agent name
function resolveAgentDocsDir(agentName) {
  if (agentName === "__main__") {
    return WORKSPACE_MAIN;
  }
  return path.join(AGENTS_DIR, agentName, "agent");
}

function resolveAlignmentMainAgentLabel(config) {
  const defaultAgentId = resolveDefaultAgentId(config);
  const mainAgent = findConfigAgent(config, "main") || findConfigAgent(config, defaultAgentId);
  const identityName =
    mainAgent?.identity && typeof mainAgent.identity.name === "string"
      ? mainAgent.identity.name.trim()
      : "";
  const agentName = typeof mainAgent?.name === "string" ? mainAgent.name.trim() : "";
  return agentName || identityName || defaultAgentId || "main";
}

// GET /api/settings/alignment — List agents and their docs
app.get("/api/settings/alignment", (req, res) => {
  try {
    const config = readArgentConfig();
    const agents = [];

    // Always include the main agent if workspace-main exists
    if (fs.existsSync(WORKSPACE_MAIN)) {
      agents.push({ id: "__main__", label: resolveAlignmentMainAgentLabel(config) });
    }

    // Add named agents from agents/ directory
    if (fs.existsSync(AGENTS_DIR)) {
      const namedAgents = fs.readdirSync(AGENTS_DIR).filter((name) => {
        if (name.startsWith("agent-main-subagent-")) return false;
        const agentDir = path.join(AGENTS_DIR, name, "agent");
        return fs.existsSync(agentDir) && fs.statSync(agentDir).isDirectory();
      });
      namedAgents.sort((a, b) => a.localeCompare(b));
      for (const name of namedAgents) {
        agents.push({ id: name, label: name });
      }
    }

    res.json({ agents, docs: ALIGNMENT_DOCS });
  } catch (err) {
    console.error("[Alignment] Error listing:", err);
    res.status(500).json({ error: "Failed to list agents" });
  }
});

// POST /api/settings/alignment/backup — Backup workspace-main to zip
app.post("/api/settings/alignment/backup", (req, res) => {
  try {
    if (!fs.existsSync(WORKSPACE_MAIN)) {
      return res.status(404).json({ error: "No workspace to backup" });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `argent-workspace-backup-${timestamp}.zip`;
    const backupDir = ALIGNMENT_BACKUP_DIR;
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const backupPath = path.join(backupDir, filename);

    const { execSync } = require("child_process");
    execSync(
      `cd "${WORKSPACE_MAIN}" && zip -r "${backupPath}" . -x "*.zip" "data/chroma/*" "dist/*"`,
      {
        timeout: 60000,
      },
    );

    const stats = fs.statSync(backupPath);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`[Alignment] Backup created: ${filename} (${sizeMb} MB)`);
    res.json({ ok: true, filename, path: backupPath, sizeMb });
  } catch (err) {
    console.error("[Alignment] Backup error:", err);
    res.status(500).json({ error: "Failed to create backup" });
  }
});

// GET /api/settings/alignment/backups — List existing backups
app.get("/api/settings/alignment/backups", (req, res) => {
  try {
    const backupDir = ALIGNMENT_BACKUP_DIR;
    if (!fs.existsSync(backupDir)) {
      return res.json({ backups: [] });
    }
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("argent-workspace-backup-") && f.endsWith(".zip"))
      .map((f) => {
        const stats = fs.statSync(path.join(backupDir, f));
        return {
          filename: f,
          sizeMb: (stats.size / 1024 / 1024).toFixed(1),
          createdAt: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ backups: files });
  } catch (err) {
    console.error("[Alignment] List backups error:", err);
    res.status(500).json({ error: "Failed to list backups" });
  }
});

// POST /api/settings/alignment/backup/cron — Install daily backup via launchd
app.post("/api/settings/alignment/backup/cron", (req, res) => {
  try {
    const { execSync } = require("child_process");
    const plistName = "com.argentos.workspace-backup";
    const plistPath = path.join(process.env.HOME, "Library", "LaunchAgents", `${plistName}.plist`);
    const backupDir = ALIGNMENT_BACKUP_DIR;
    const logPath = path.join(backupDir, "backup-cron.log");

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const scriptPath = path.join(backupDir, "run-backup.sh");
    const scriptContent = `#!/bin/bash
WORKSPACE="${WORKSPACE_MAIN}"
BACKUP_DIR="${backupDir}"
TIMESTAMP=$(date +%Y-%m-%dT%H-%M-%S)
FILENAME="argent-workspace-backup-\${TIMESTAMP}.zip"
mkdir -p "$BACKUP_DIR"
cd "$WORKSPACE" && zip -r "$BACKUP_DIR/$FILENAME" . -x "*.zip" "data/chroma/*" "dist/*"
ls -t "$BACKUP_DIR"/argent-workspace-backup-*.zip | tail -n +8 | xargs rm -f 2>/dev/null
echo "[\$(date)] Backup complete: $FILENAME" >> "${logPath}"
`;
    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistName}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${scriptPath}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore" });
    } catch {
      /* ok */
    }

    const launchAgentsDir = path.join(process.env.HOME, "Library", "LaunchAgents");
    if (!fs.existsSync(launchAgentsDir)) {
      fs.mkdirSync(launchAgentsDir, { recursive: true });
    }
    fs.writeFileSync(plistPath, plistContent);
    execSync(`launchctl load "${plistPath}"`);

    console.log("[Alignment] Daily backup cron installed");
    res.json({ ok: true, schedule: "Daily at 3:00 AM", retention: "Last 7 backups", plistPath });
  } catch (err) {
    console.error("[Alignment] Cron setup error:", err);
    res.status(500).json({ error: "Failed to set up backup cron" });
  }
});

// ─── Git-based backup endpoints ───────────────────────────────────────────────

// GET /api/settings/alignment/git/status — Git status for workspace-main
app.get("/api/settings/alignment/git/status", (req, res) => {
  try {
    const { execSync } = require("child_process");
    const opts = { cwd: WORKSPACE_MAIN, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] };

    // Check if git repo exists
    try {
      execSync("git rev-parse --git-dir", opts);
    } catch {
      return res.json({
        initialized: false,
        remote: null,
        lastCommit: null,
        dirty: [],
        ahead: 0,
        behind: 0,
      });
    }

    // Get remote URL
    let remote = null;
    try {
      remote = execSync("git remote get-url origin", opts).trim() || null;
    } catch {
      /* no remote */
    }

    // Get last commit info
    let lastCommit = null;
    try {
      const log = execSync('git log -1 --format="%H|%ai|%s"', opts).trim();
      if (log) {
        const [hash, date, message] = log.split("|");
        lastCommit = { hash: hash.slice(0, 8), date, message };
      }
    } catch {
      /* no commits */
    }

    // Get dirty (uncommitted) files
    let dirty = [];
    try {
      const status = execSync("git status --porcelain", opts).trim();
      if (status) {
        dirty = status.split("\n").map((line) => ({
          status: line.substring(0, 2).trim(),
          file: line.substring(3),
        }));
      }
    } catch {
      /* ignore */
    }

    // Get ahead/behind count relative to remote
    let ahead = 0,
      behind = 0;
    try {
      const tracking = execSync(
        "git rev-parse --abbrev-ref --symbolic-full-name @{u}",
        opts,
      ).trim();
      if (tracking) {
        const counts = execSync(
          `git rev-list --left-right --count HEAD...${tracking}`,
          opts,
        ).trim();
        const [a, b] = counts.split(/\s+/).map(Number);
        ahead = a || 0;
        behind = b || 0;
      }
    } catch {
      /* no upstream tracking */
    }

    // Check if auto-backup launchd job is installed
    const plistName = "com.argentos.git-backup";
    const plistPath = path.join(process.env.HOME, "Library", "LaunchAgents", `${plistName}.plist`);
    const autoEnabled = fs.existsSync(plistPath);

    res.json({ initialized: true, remote, lastCommit, dirty, ahead, behind, autoEnabled });
  } catch (err) {
    console.error("[Git Backup] Status error:", err);
    res.status(500).json({ error: "Failed to get git status" });
  }
});

// POST /api/settings/alignment/git/commit — Stage all + commit
app.post("/api/settings/alignment/git/commit", (req, res) => {
  try {
    const { execSync } = require("child_process");
    const opts = { cwd: WORKSPACE_MAIN, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] };
    const message =
      req.body.message || `Backup ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;

    // Ensure git repo
    try {
      execSync("git rev-parse --git-dir", opts);
    } catch {
      execSync("git init", opts);
      execSync('git config user.name "Argent"', opts);
      execSync('git config user.email "argent@local"', opts);
    }

    // Stage all files
    execSync("git add -A", opts);

    // Check if there's anything to commit
    try {
      execSync("git diff --cached --quiet", opts);
      return res.json({
        ok: true,
        committed: false,
        message: "Nothing to commit — workspace is clean",
      });
    } catch {
      // There are staged changes — commit them
    }

    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, opts);
    const hash = execSync('git log -1 --format="%H"', opts).trim().slice(0, 8);
    const fileCount = execSync("git diff --name-only HEAD~1 HEAD", opts)
      .trim()
      .split("\n")
      .filter(Boolean).length;

    console.log(`[Git Backup] Committed ${fileCount} file(s): ${hash}`);
    res.json({ ok: true, committed: true, hash, fileCount, message });
  } catch (err) {
    console.error("[Git Backup] Commit error:", err);
    res.status(500).json({ error: err.stderr || err.message || "Failed to commit" });
  }
});

// POST /api/settings/alignment/git/push — Push to remote
app.post("/api/settings/alignment/git/push", (req, res) => {
  try {
    const { execSync } = require("child_process");
    const opts = {
      cwd: WORKSPACE_MAIN,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    };

    // Verify remote exists
    let remote;
    try {
      remote = execSync("git remote get-url origin", opts).trim();
    } catch {
      return res.status(400).json({ error: "No remote configured. Set a remote first." });
    }

    // Get current branch
    let branch;
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", opts).trim();
    } catch {
      return res.status(400).json({ error: "No commits yet. Commit first." });
    }

    // Push (set upstream on first push)
    try {
      execSync(`git push -u origin ${branch}`, opts);
    } catch (pushErr) {
      // If push fails, try force push if requested
      if (req.body.force) {
        execSync(`git push -u origin ${branch} --force`, opts);
      } else {
        throw pushErr;
      }
    }

    const hash = execSync('git log -1 --format="%H"', opts).trim().slice(0, 8);
    console.log(`[Git Backup] Pushed to ${remote} (${branch}@${hash})`);
    res.json({ ok: true, remote, branch, hash });
  } catch (err) {
    console.error("[Git Backup] Push error:", err);
    res.status(500).json({ error: err.stderr || err.message || "Push failed" });
  }
});

// POST /api/settings/alignment/git/remote — Set/update remote origin
app.post("/api/settings/alignment/git/remote", (req, res) => {
  try {
    const { execSync } = require("child_process");
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }
    const opts = { cwd: WORKSPACE_MAIN, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] };

    // Ensure git repo
    try {
      execSync("git rev-parse --git-dir", opts);
    } catch {
      execSync("git init", opts);
      execSync('git config user.name "Argent"', opts);
      execSync('git config user.email "argent@local"', opts);
    }

    // Set or update remote
    try {
      execSync("git remote get-url origin", opts);
      // Remote exists — update it
      execSync(`git remote set-url origin "${url}"`, opts);
    } catch {
      // No remote — add it
      execSync(`git remote add origin "${url}"`, opts);
    }

    console.log(`[Git Backup] Remote set: ${url}`);
    res.json({ ok: true, remote: url });
  } catch (err) {
    console.error("[Git Backup] Remote error:", err);
    res.status(500).json({ error: err.stderr || err.message || "Failed to set remote" });
  }
});

// POST /api/settings/alignment/git/auto — Enable/disable auto git backup via launchd
app.post("/api/settings/alignment/git/auto", (req, res) => {
  try {
    const { execSync } = require("child_process");
    const { enabled, intervalHours = 4 } = req.body;
    const plistName = "com.argentos.git-backup";
    const plistPath = path.join(process.env.HOME, "Library", "LaunchAgents", `${plistName}.plist`);
    const backupDir = ALIGNMENT_BACKUP_DIR;
    const logPath = path.join(backupDir, "git-backup.log");

    if (!enabled) {
      // Disable
      try {
        execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore" });
      } catch {
        /* ok */
      }
      try {
        fs.unlinkSync(plistPath);
      } catch {
        /* ok */
      }
      console.log("[Git Backup] Auto-backup disabled");
      return res.json({ ok: true, enabled: false });
    }

    // Enable — create script + launchd plist
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const scriptPath = path.join(backupDir, "run-git-backup.sh");
    const scriptContent = `#!/bin/bash
WORKSPACE="${WORKSPACE_MAIN}"
cd "$WORKSPACE" || exit 1

# Ensure git is initialized
git rev-parse --git-dir > /dev/null 2>&1 || {
  git init
  git config user.name "Argent"
  git config user.email "argent@local"
}

# Stage and commit
git add -A
git diff --cached --quiet 2>/dev/null && {
  echo "[$(date)] Nothing to commit" >> "${logPath}"
  exit 0
}
git commit -m "Auto-backup $(date '+%Y-%m-%d %H:%M')"

# Push if remote exists
if git remote get-url origin > /dev/null 2>&1; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  git push -u origin "$BRANCH" 2>&1 || echo "[$(date)] Push failed — will retry next cycle" >> "${logPath}"
fi

echo "[$(date)] Git backup complete: $(git log -1 --format='%h %s')" >> "${logPath}"
`;
    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    const intervalSeconds = Math.max(1, Math.round(intervalHours * 3600));
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistName}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${scriptPath}</string>
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore" });
    } catch {
      /* ok */
    }

    const launchAgentsDir = path.join(process.env.HOME, "Library", "LaunchAgents");
    if (!fs.existsSync(launchAgentsDir)) {
      fs.mkdirSync(launchAgentsDir, { recursive: true });
    }
    fs.writeFileSync(plistPath, plistContent);
    execSync(`launchctl load "${plistPath}"`);

    console.log(`[Git Backup] Auto-backup enabled (every ${intervalHours}h)`);
    res.json({ ok: true, enabled: true, intervalHours, plistPath });
  } catch (err) {
    console.error("[Git Backup] Auto setup error:", err);
    res.status(500).json({ error: "Failed to configure auto backup" });
  }
});

// GET /api/settings/alignment/:agent/:file — Read a doc
app.get("/api/settings/alignment/:agent/:file", (req, res) => {
  try {
    const { agent, file } = req.params;
    if (!ALIGNMENT_DOCS.some((d) => d.file === file)) {
      return res.status(400).json({ error: "Unknown alignment doc" });
    }
    const docsDir = resolveAgentDocsDir(agent);
    const filePath = path.join(docsDir, file);
    if (!fs.existsSync(filePath)) {
      return res.json({ content: "", exists: false });
    }
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ content, exists: true });
  } catch (err) {
    console.error("[Alignment] Error reading:", err);
    res.status(500).json({ error: "Failed to read doc" });
  }
});

// PUT /api/settings/alignment/:agent/:file — Write a doc
app.put("/api/settings/alignment/:agent/:file", (req, res) => {
  try {
    const { agent, file } = req.params;
    const { content } = req.body;
    if (!ALIGNMENT_DOCS.some((d) => d.file === file)) {
      return res.status(400).json({ error: "Unknown alignment doc" });
    }
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content is required" });
    }
    const docsDir = resolveAgentDocsDir(agent);
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    fs.writeFileSync(path.join(docsDir, file), content, "utf-8");
    console.log(`[Alignment] Saved ${agent}/${file} (${content.length} chars)`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Alignment] Error writing:", err);
    res.status(500).json({ error: "Failed to write doc" });
  }
});

// GET /api/settings/models — Returns model config + Ollama status
app.get("/api/settings/models", (req, res) => {
  try {
    const config = readArgentConfig();
    const agentDefaults = config.agents?.defaults || {};
    const subagentModel =
      typeof agentDefaults?.subagents?.model === "string" ? agentDefaults.subagents.model : null;

    // Try Ollama status
    let ollamaModels = [];
    try {
      const ollamaRes = execSync("curl -s http://127.0.0.1:11434/api/tags", { timeout: 3000 });
      const ollamaData = JSON.parse(ollamaRes.toString());
      ollamaModels = ollamaData.models || [];
    } catch {
      /* Ollama not running */
    }

    res.json({
      model: agentDefaults.model || null,
      modelRouter: agentDefaults.modelRouter || null,
      subagentModel,
      ollamaModels,
    });
  } catch (err) {
    console.error("[Models] Error reading:", err);
    res.status(500).json({ error: "Failed to read model config", details: err.message });
  }
});

// PATCH /api/settings/models — Update model config
app.patch("/api/settings/models", (req, res) => {
  try {
    const config = readArgentConfig();
    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};

    if (req.body.model !== undefined) {
      config.agents.defaults.model = req.body.model;
    }
    if (req.body.modelRouter !== undefined) {
      config.agents.defaults.modelRouter = req.body.modelRouter;
    }
    if (req.body.subagentModel !== undefined) {
      const raw = String(req.body.subagentModel ?? "").trim();
      if (
        !config.agents.defaults.subagents ||
        typeof config.agents.defaults.subagents !== "object"
      ) {
        config.agents.defaults.subagents = {};
      }
      if (raw) {
        config.agents.defaults.subagents.model = raw;
      } else {
        delete config.agents.defaults.subagents.model;
      }
    }

    writeArgentConfig(config);
    console.log("[Models] Config updated");
    res.json({ ok: true });
  } catch (err) {
    console.error("[Models] Error updating:", err);
    res.status(500).json({ error: "Failed to update model config", details: err.message });
  }
});

// ============================================
// MODEL PROFILES API
// ============================================

// GET /api/settings/model-profiles — Returns all profiles + activeProfile
app.get("/api/settings/model-profiles", async (req, res) => {
  try {
    const config = readArgentConfig();
    const router = config.agents?.defaults?.modelRouter || {};

    // Load built-in profiles from single source of truth (compiled dist)
    let builtinProfiles = {};
    try {
      const { BUILTIN_PROFILES } = await import("../dist/models/builtin-profiles.js");
      builtinProfiles = BUILTIN_PROFILES || {};
    } catch {
      console.warn("[ModelProfiles] Could not load built-in profiles from dist, using empty set");
    }

    const profiles = { ...builtinProfiles, ...(router.profiles || {}) };
    res.json({
      activeProfile: router.activeProfile || "default",
      profiles,
    });
  } catch (err) {
    console.error("[ModelProfiles] Error reading:", err);
    res.status(500).json({ error: "Failed to read profiles" });
  }
});

// PATCH /api/settings/model-profiles — Create or update a profile
app.patch("/api/settings/model-profiles", (req, res) => {
  try {
    const { name, label, tiers, routingPolicy, sessionOverrides } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const config = readArgentConfig();
    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};
    if (!config.agents.defaults.modelRouter) config.agents.defaults.modelRouter = {};
    if (!config.agents.defaults.modelRouter.profiles)
      config.agents.defaults.modelRouter.profiles = {};

    config.agents.defaults.modelRouter.profiles[name] = {
      label,
      tiers,
      ...(routingPolicy ? { routingPolicy } : {}),
      ...(sessionOverrides ? { sessionOverrides } : {}),
    };
    writeArgentConfig(config);
    console.log("[ModelProfiles] Created/updated:", name);
    res.json({ ok: true });
  } catch (err) {
    console.error("[ModelProfiles] Error saving:", err);
    res.status(500).json({ error: "Failed to save profile" });
  }
});

// DELETE /api/settings/model-profiles/:name — Delete a profile
app.delete("/api/settings/model-profiles/:name", (req, res) => {
  try {
    const { name } = req.params;
    if (name === "default") return res.status(400).json({ error: "Cannot delete default profile" });

    const config = readArgentConfig();
    const profiles = config.agents?.defaults?.modelRouter?.profiles;
    if (profiles && profiles[name]) {
      delete profiles[name];
      // If this was the active profile, reset to default
      if (config.agents.defaults.modelRouter.activeProfile === name) {
        config.agents.defaults.modelRouter.activeProfile = "default";
      }
      writeArgentConfig(config);
      console.log("[ModelProfiles] Deleted:", name);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[ModelProfiles] Error deleting:", err);
    res.status(500).json({ error: "Failed to delete profile" });
  }
});

// POST /api/settings/model-profiles/:name/activate — Set active profile
app.post("/api/settings/model-profiles/:name/activate", (req, res) => {
  try {
    const { name } = req.params;
    const config = readArgentConfig();
    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};
    if (!config.agents.defaults.modelRouter) config.agents.defaults.modelRouter = {};

    config.agents.defaults.modelRouter.activeProfile = name;
    writeArgentConfig(config);
    console.log("[ModelProfiles] Activated:", name);
    res.json({ ok: true, activeProfile: name });
  } catch (err) {
    console.error("[ModelProfiles] Error activating:", err);
    res.status(500).json({ error: "Failed to activate profile" });
  }
});

// ============================================
// Provider Registry endpoints
// ============================================

const PROVIDER_REGISTRY_PATH = path.join(process.env.HOME, ".argentos", "provider-registry.json");

let PROVIDER_REGISTRY_SEED_VERSION = 1;
let DEFAULT_PROVIDER_REGISTRY = { version: 1, providers: {} };
try {
  const providerCatalog = require("./provider-catalog/index.cjs");
  if (providerCatalog && typeof providerCatalog === "object") {
    if (Number.isFinite(Number(providerCatalog.PROVIDER_REGISTRY_SEED_VERSION))) {
      PROVIDER_REGISTRY_SEED_VERSION = Number(providerCatalog.PROVIDER_REGISTRY_SEED_VERSION);
    }
    if (
      providerCatalog.DEFAULT_PROVIDER_REGISTRY &&
      typeof providerCatalog.DEFAULT_PROVIDER_REGISTRY === "object"
    ) {
      DEFAULT_PROVIDER_REGISTRY = providerCatalog.DEFAULT_PROVIDER_REGISTRY;
    }
  }
} catch (error) {
  console.warn(
    "[ProviderRegistry] provider catalog missing; using empty fallback defaults",
    error && error.message ? error.message : error,
  );
}

function cloneDefaultProviderRegistry() {
  return JSON.parse(JSON.stringify(DEFAULT_PROVIDER_REGISTRY));
}

function mergeProviderRegistryWithDefaults(rawRegistry) {
  const base = cloneDefaultProviderRegistry();
  const registry = rawRegistry && typeof rawRegistry === "object" ? rawRegistry : {};
  const providers =
    registry.providers && typeof registry.providers === "object" ? registry.providers : {};
  const merged = {
    version: Math.max(
      Number(registry.version) || 0,
      Number(base.version) || PROVIDER_REGISTRY_SEED_VERSION,
    ),
    providers: { ...base.providers, ...providers },
  };
  return merged;
}

function readProviderRegistry() {
  try {
    let raw = null;
    if (fs.existsSync(PROVIDER_REGISTRY_PATH)) {
      raw = JSON.parse(fs.readFileSync(PROVIDER_REGISTRY_PATH, "utf-8"));
    }
    const merged = mergeProviderRegistryWithDefaults(raw);
    const normalizedRaw = raw ? JSON.stringify(raw) : "";
    const normalizedMerged = JSON.stringify(merged);
    if (normalizedRaw !== normalizedMerged) {
      writeProviderRegistry(merged);
    }
    return merged;
  } catch (err) {
    console.warn("[ProviderRegistry] Failed to read:", err.message);
    const fallback = cloneDefaultProviderRegistry();
    try {
      writeProviderRegistry(fallback);
    } catch {
      /* no-op */
    }
    return fallback;
  }
}

function writeProviderRegistry(registry) {
  const dir = path.dirname(PROVIDER_REGISTRY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(PROVIDER_REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", {
    mode: 0o600,
  });
}

const AUTH_PROFILE_PROVIDER_META = {
  anthropic: { label: "Anthropic", category: "Frontier" },
  openai: { label: "OpenAI", category: "Frontier" },
  "openai-codex": { label: "OpenAI Codex", category: "Frontier" },
  google: { label: "Google (Gemini)", category: "Frontier" },
  groq: { label: "Groq", category: "Frontier" },
  xai: { label: "xAI (Grok)", category: "Frontier" },
  openrouter: { label: "OpenRouter", category: "Gateways & Routers" },
  litellm: { label: "LiteLLM", category: "Gateways & Routers" },
  "vercel-ai-gateway": { label: "Vercel AI Gateway", category: "Gateways & Routers" },
  "ai-gateway": { label: "Vercel AI Gateway (Legacy)", category: "Gateways & Routers" },
  "cloudflare-ai-gateway": { label: "Cloudflare AI Gateway", category: "Gateways & Routers" },
  opencode: { label: "OpenCode Zen", category: "Gateways & Routers" },
  "amazon-bedrock": { label: "Amazon Bedrock", category: "Gateways & Routers" },
  bedrock: { label: "Amazon Bedrock", category: "Gateways & Routers" },
  zai: { label: "Z.AI (GLM)", category: "Chinese Providers" },
  moonshot: { label: "Moonshot AI (Kimi)", category: "Chinese Providers" },
  "kimi-coding": { label: "Kimi Coding", category: "Chinese Providers" },
  "qwen-portal": { label: "Qwen (Alibaba)", category: "Chinese Providers" },
  minimax: { label: "MiniMax", category: "Chinese Providers" },
  qianfan: { label: "Qianfan (Baidu)", category: "Chinese Providers" },
  inception: { label: "Inception (Mercury 2)", category: "Other" },
  cerebras: { label: "Cerebras", category: "Other" },
  venice: { label: "Venice AI", category: "Other" },
  together: { label: "Together AI", category: "Other" },
  synthetic: { label: "Synthetic", category: "Other" },
  "github-copilot": { label: "GitHub Copilot", category: "Other" },
  ollama: { label: "Ollama (Local)", category: "Local" },
  lmstudio: { label: "LM Studio (Local)", category: "Local" },
};

function buildAuthProfileProviderOptions() {
  const config = readArgentConfig();
  const configuredProviders = config.models?.providers || {};
  const registry = readProviderRegistry();
  const providerIds = new Set([
    ...Object.keys(registry?.providers || {}),
    ...Object.keys(configuredProviders || {}),
    ...Object.keys(AUTH_PROFILE_PROVIDER_META),
  ]);

  const options = [];
  for (const providerId of providerIds) {
    const meta = AUTH_PROFILE_PROVIDER_META[providerId];
    const registryEntry = registry?.providers?.[providerId];
    const configuredEntry = configuredProviders?.[providerId];
    const authType =
      (typeof registryEntry?.authType === "string" && registryEntry.authType) ||
      (typeof configuredEntry?.auth === "string" && configuredEntry.auth) ||
      "api_key";
    const label =
      meta?.label ||
      (typeof registryEntry?.name === "string" && registryEntry.name.trim()) ||
      providerId;
    const category = meta?.category || "Other";
    options.push({
      id: providerId,
      label,
      category,
      authType,
    });
  }

  const categoryOrder = ["Frontier", "Gateways & Routers", "Chinese Providers", "Other", "Local"];
  options.sort((a, b) => {
    const catA = categoryOrder.indexOf(a.category);
    const catB = categoryOrder.indexOf(b.category);
    if (catA !== catB) {
      return (catA === -1 ? 999 : catA) - (catB === -1 ? 999 : catB);
    }
    return a.label.localeCompare(b.label);
  });
  return options;
}

// GET /api/settings/providers — List all providers from registry
app.get("/api/settings/providers", (req, res) => {
  try {
    const registry = readProviderRegistry();
    if (!registry || !registry.providers) {
      return res.json({ version: 0, providers: {} });
    }
    res.json(registry);
  } catch (err) {
    console.error("[ProviderRegistry] Error reading:", err);
    res.status(500).json({ error: "Failed to read provider registry" });
  }
});

// GET /api/settings/providers/:name — Get a single provider
app.get("/api/settings/providers/:name", (req, res) => {
  try {
    const registry = readProviderRegistry();
    if (!registry || !registry.providers) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const entry = registry.providers[req.params.name];
    if (!entry) {
      return res.status(404).json({ error: "Provider not found" });
    }
    res.json({ name: req.params.name, ...entry });
  } catch (err) {
    console.error("[ProviderRegistry] Error reading provider:", err);
    res.status(500).json({ error: "Failed to read provider" });
  }
});

// PATCH /api/settings/providers/:name — Update provider config
app.patch("/api/settings/providers/:name", (req, res) => {
  try {
    const { name } = req.params;
    const registry = readProviderRegistry();
    if (!registry || !registry.providers) {
      return res.status(404).json({ error: "Registry not found" });
    }
    const existing = registry.providers[name];
    if (!existing) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const { baseUrl, api, authType, envKeyVar, oauthPlaceholder } = req.body;
    if (baseUrl !== undefined) existing.baseUrl = baseUrl;
    if (api !== undefined) existing.api = api;
    if (authType !== undefined) existing.authType = authType;
    if (envKeyVar !== undefined) existing.envKeyVar = envKeyVar;
    if (oauthPlaceholder !== undefined) existing.oauthPlaceholder = oauthPlaceholder;
    registry.providers[name] = existing;
    writeProviderRegistry(registry);
    console.log("[ProviderRegistry] Updated provider:", name);
    res.json({ ok: true, provider: existing });
  } catch (err) {
    console.error("[ProviderRegistry] Error updating provider:", err);
    res.status(500).json({ error: "Failed to update provider" });
  }
});

// POST /api/settings/providers — Add a new provider
app.post("/api/settings/providers", (req, res) => {
  try {
    const { name, baseUrl, api, authType, envKeyVar, oauthPlaceholder, models } = req.body;
    if (!name || !baseUrl) {
      return res.status(400).json({ error: "name and baseUrl are required" });
    }
    const registry = readProviderRegistry() || { version: 1, providers: {} };
    if (registry.providers[name]) {
      return res.status(409).json({ error: "Provider already exists. Use PATCH to update." });
    }
    registry.providers[name] = {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      baseUrl,
      api: api || "openai-completions",
      authType: authType || "api_key",
      ...(envKeyVar ? { envKeyVar } : {}),
      ...(oauthPlaceholder ? { oauthPlaceholder } : {}),
      models: models || [],
    };
    writeProviderRegistry(registry);
    console.log("[ProviderRegistry] Added provider:", name);
    res.json({ ok: true });
  } catch (err) {
    console.error("[ProviderRegistry] Error adding provider:", err);
    res.status(500).json({ error: "Failed to add provider" });
  }
});

// DELETE /api/settings/providers/:name — Remove a provider
app.delete("/api/settings/providers/:name", (req, res) => {
  try {
    const { name } = req.params;
    const registry = readProviderRegistry();
    if (!registry || !registry.providers || !registry.providers[name]) {
      return res.status(404).json({ error: "Provider not found" });
    }
    delete registry.providers[name];
    writeProviderRegistry(registry);
    console.log("[ProviderRegistry] Deleted provider:", name);
    res.json({ ok: true });
  } catch (err) {
    console.error("[ProviderRegistry] Error deleting provider:", err);
    res.status(500).json({ error: "Failed to delete provider" });
  }
});

// POST /api/settings/providers/:name/models — Add model to a provider
app.post("/api/settings/providers/:name/models", (req, res) => {
  try {
    const { name } = req.params;
    const registry = readProviderRegistry();
    if (!registry?.providers?.[name]) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const { id, modelName, reasoning, input, cost, contextWindow, maxTokens } = req.body;
    if (!id) return res.status(400).json({ error: "Model id is required" });
    const provider = registry.providers[name];
    if (!Array.isArray(provider.models)) provider.models = [];
    if (provider.models.some((m) => m.id === id)) {
      return res.status(409).json({ error: "Model already exists in provider" });
    }
    provider.models.push({
      id,
      name: modelName || id,
      reasoning: reasoning ?? false,
      input: input || ["text"],
      cost: cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: contextWindow || 128000,
      maxTokens: maxTokens || 8192,
    });
    writeProviderRegistry(registry);
    console.log("[ProviderRegistry] Added model to", name, ":", id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[ProviderRegistry] Error adding model:", err);
    res.status(500).json({ error: "Failed to add model" });
  }
});

// DELETE /api/settings/providers/:name/models/:modelId — Remove model from provider
app.delete("/api/settings/providers/:name/models/:modelId", (req, res) => {
  try {
    const { name, modelId } = req.params;
    const registry = readProviderRegistry();
    if (!registry?.providers?.[name]) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const provider = registry.providers[name];
    const idx = (provider.models || []).findIndex((m) => m.id === modelId);
    if (idx === -1) {
      return res.status(404).json({ error: "Model not found in provider" });
    }
    provider.models.splice(idx, 1);
    writeProviderRegistry(registry);
    console.log("[ProviderRegistry] Removed model from", name, ":", modelId);
    res.json({ ok: true });
  } catch (err) {
    console.error("[ProviderRegistry] Error removing model:", err);
    res.status(500).json({ error: "Failed to remove model" });
  }
});

// POST /api/settings/providers/reset — Re-seed from defaults
app.post("/api/settings/providers/reset", async (req, res) => {
  try {
    const seed = cloneDefaultProviderRegistry();
    writeProviderRegistry(seed);
    console.log("[ProviderRegistry] Reset to seed defaults");
    res.json({ ok: true, registry: seed });
  } catch (err) {
    console.error("[ProviderRegistry] Error resetting:", err);
    res.status(500).json({ error: "Failed to reset registry" });
  }
});

// GET /api/settings/available-models — Returns all known models for dropdown population
app.get("/api/settings/available-models", async (req, res) => {
  try {
    const config = readArgentConfig();
    const catalog = await collectAvailableModelsCatalog(config);
    res.json(catalog);
  } catch (err) {
    console.error("[AvailableModels] Error:", err);
    res.status(500).json({ error: "Failed to read available models" });
  }
});

// GET /api/settings/background-model-recommendations — Returns suggested provider/model per background lane
app.get("/api/settings/background-model-recommendations", async (req, res) => {
  try {
    const config = readArgentConfig();
    const catalog = await collectAvailableModelsCatalog(config);
    const recommendations = buildBackgroundModelRecommendations(config, catalog);
    res.json(recommendations);
  } catch (err) {
    console.error("[BackgroundModelRecommendations] Error:", err);
    res.status(500).json({ error: "Failed to build background model recommendations" });
  }
});

// GET /api/settings/provider-models — Returns models for a single provider (searchable + limited)
app.get("/api/settings/provider-models", async (req, res) => {
  try {
    const providerRaw = String(req.query.provider || "").trim();
    if (!providerRaw) {
      return res.status(400).json({ error: "provider query parameter is required" });
    }
    const provider = providerRaw.toLowerCase();
    const query = String(req.query.q || "")
      .trim()
      .toLowerCase();
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));

    const config = readArgentConfig();
    const models = config.agents?.defaults?.models || {};
    const modelDefaults = config.agents?.defaults?.model || {};
    const modelRouter = config.agents?.defaults?.modelRouter || {};
    const configuredProviders = config.models?.providers || {};
    const providerConfig = configuredProviders[provider];
    const seen = new Set();
    const rowIndexByModel = new Map();
    const rows = [];

    const pushRow = (modelId, alias = null, options = {}) => {
      const model = String(modelId || "").trim();
      if (!model) return;
      const verified = options?.verified === true;
      const source = typeof options?.source === "string" ? options.source : "configured";
      if (seen.has(model)) {
        // Upgrade existing rows when a live verification arrives after static/config seeding.
        if (verified) {
          const idx = rowIndexByModel.get(model);
          if (typeof idx === "number" && rows[idx]) {
            rows[idx].verified = true;
            rows[idx].source = source;
          }
        }
        return;
      }
      if (query && !model.toLowerCase().includes(query)) return;
      seen.add(model);
      rowIndexByModel.set(model, rows.length);
      rows.push({
        model,
        id: `${provider}/${model}`,
        label: alias ? `${provider}/${model} (${alias})` : `${provider}/${model}`,
        alias,
        verified,
        source,
      });
    };

    const parseRef = (ref) => {
      const normalized = String(ref || "").trim();
      const slashIndex = normalized.indexOf("/");
      if (slashIndex <= 0 || slashIndex === normalized.length - 1) return null;
      return {
        provider: normalized.slice(0, slashIndex).trim().toLowerCase(),
        model: normalized.slice(slashIndex + 1).trim(),
      };
    };

    for (const [key, entry] of Object.entries(models)) {
      const parsed = parseRef(key);
      if (parsed?.provider === provider) {
        pushRow(parsed.model, typeof entry?.alias === "string" ? entry.alias : null);
      }
    }

    if (typeof modelDefaults?.primary === "string") {
      const parsed = parseRef(modelDefaults.primary);
      if (parsed?.provider === provider) {
        pushRow(parsed.model);
      }
    }
    if (Array.isArray(modelDefaults?.fallbacks)) {
      for (const fallback of modelDefaults.fallbacks) {
        const parsed = parseRef(fallback);
        if (parsed?.provider === provider) {
          pushRow(parsed.model);
        }
      }
    }

    const routerProfiles = modelRouter?.profiles || {};
    for (const profile of Object.values(routerProfiles)) {
      const tiers = profile?.tiers || {};
      for (const tier of Object.values(tiers)) {
        const tierProvider =
          typeof tier?.provider === "string" ? tier.provider.trim().toLowerCase() : "";
        if (tierProvider !== provider) continue;
        if (typeof tier?.model === "string") {
          pushRow(tier.model);
        }
      }
      const contemplation = profile?.sessionOverrides?.contemplation;
      const contemplationProvider =
        typeof contemplation?.provider === "string"
          ? contemplation.provider.trim().toLowerCase()
          : "";
      if (contemplationProvider === provider && typeof contemplation?.model === "string") {
        pushRow(contemplation.model);
      }
      if (Array.isArray(contemplation?.fallbacks)) {
        for (const fallback of contemplation.fallbacks) {
          const parsed = parseRef(fallback);
          if (parsed?.provider === provider) {
            pushRow(parsed.model);
          }
        }
      }
    }

    for (const modelDef of Array.isArray(providerConfig?.models) ? providerConfig.models : []) {
      const modelId =
        typeof modelDef === "string"
          ? modelDef
          : typeof modelDef?.id === "string"
            ? modelDef.id
            : "";
      if (!modelId) continue;
      const alias =
        typeof modelDef?.name === "string" && modelDef.name.trim().length > 0
          ? modelDef.name.trim()
          : null;
      pushRow(modelId, alias);
    }

    // Load model IDs from provider registry (single source of truth)
    const registry = readProviderRegistry();
    if (registry?.providers?.[provider]?.models) {
      for (const model of registry.providers[provider].models) {
        const modelId =
          typeof model === "string" ? model : typeof model?.id === "string" ? model.id : "";
        const alias =
          typeof model === "object" && model && typeof model?.name === "string" && model.name.trim()
            ? model.name.trim()
            : null;
        if (modelId) {
          pushRow(modelId, alias);
        }
      }
    }

    const piCatalog = await loadPiBackedModelCatalog();
    for (const entry of piCatalog) {
      if (
        String(entry.provider || "")
          .trim()
          .toLowerCase() !== provider
      )
        continue;
      pushRow(entry.id, entry.name && entry.name !== entry.id ? entry.name : null, {
        source: "pi",
      });
    }

    // Provider-specific curated models not in the registry
    const extraCuratedByProvider = {
      openai: ["gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2", "gpt-5.2-codex"],
      "openai-codex": [
        "gpt-5.3-codex",
        "gpt-5.3-codex-spark",
        "gpt-5.2-codex",
        "gpt-5.1-codex-max",
        "gpt-5.1-codex-mini",
      ],
      "kimi-coding": ["k2p5"],
      zai: ["glm-5", "glm-4.7", "glm-4.6"],
      qianfan: ["ernie-4.0-8k"],
    };

    for (const id of extraCuratedByProvider[provider] || []) {
      pushRow(id);
    }

    const fetchOpenAICompatModels = async (baseUrl, apiKey, requireKey = true) => {
      if (requireKey && !apiKey) return { ok: false, ids: [] };
      const normalizedBaseUrl = String(baseUrl || "")
        .trim()
        .replace(/\/+$/, "");
      if (!normalizedBaseUrl) return { ok: false, ids: [] };
      const modelsUrl = normalizedBaseUrl.endsWith("/v1")
        ? `${normalizedBaseUrl}/models`
        : `${normalizedBaseUrl}/v1/models`;
      const headers = { Accept: "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(modelsUrl, { headers, signal: controller.signal });
        if (!response.ok) return { ok: false, ids: [] };
        const payload = await response.json();
        const ids = [];
        for (const model of Array.isArray(payload?.data) ? payload.data : []) {
          if (typeof model?.id === "string") {
            ids.push(model.id);
            pushRow(model.id, null, { verified: true, source: "live" });
          }
        }
        return { ok: true, ids };
      } catch {
        return { ok: false, ids: [] };
      } finally {
        clearTimeout(timeout);
      }
    };

    const resolveProviderCredential = (providerId) => {
      const configuredApiKey =
        typeof configuredProviders?.[providerId]?.apiKey === "string"
          ? configuredProviders[providerId].apiKey.trim()
          : "";
      if (configuredApiKey) return configuredApiKey;
      try {
        const authProfilesData = readAuthProfiles();
        const profiles = authProfilesData?.profiles || {};
        const lastGood = authProfilesData?.lastGood || {};
        const preferredKey = typeof lastGood?.[providerId] === "string" ? lastGood[providerId] : "";
        if (preferredKey && profiles[preferredKey]) {
          const preferred = profiles[preferredKey];
          if (typeof preferred?.token === "string" && preferred.token.trim()) {
            return preferred.token.trim();
          }
          if (typeof preferred?.key === "string" && preferred.key.trim()) {
            return preferred.key.trim();
          }
        }
        for (const profile of Object.values(profiles)) {
          if (profile?.provider !== providerId) continue;
          if (typeof profile?.token === "string" && profile.token.trim()) {
            return profile.token.trim();
          }
          if (typeof profile?.key === "string" && profile.key.trim()) {
            return profile.key.trim();
          }
        }
      } catch {
        /* no auth profiles */
      }
      if (providerId === "groq") {
        const envGroqKey =
          (typeof process.env.GROQ_API_KEY === "string" ? process.env.GROQ_API_KEY.trim() : "") ||
          (typeof process.env.GROQ_LLAMA_API_KEY === "string"
            ? process.env.GROQ_LLAMA_API_KEY.trim()
            : "");
        if (envGroqKey) {
          return envGroqKey;
        }
      }
      return "";
    };

    try {
      if (provider === "ollama") {
        const ollamaRes = execSync("curl -s http://127.0.0.1:11434/api/tags", { timeout: 3000 });
        const ollamaData = JSON.parse(ollamaRes.toString());
        for (const m of ollamaData.models || []) {
          pushRow(m.name);
        }
      } else if (provider === "groq") {
        // Groq must reflect live /models catalog so retired IDs don't linger in dropdowns.
        const groqDiscovery = await fetchOpenAICompatModels(
          configuredProviders?.groq?.baseUrl || "https://api.groq.com/openai/v1",
          resolveProviderCredential("groq"),
          true,
        );
        if (groqDiscovery.ok && groqDiscovery.ids.length > 0) {
          // Authoritative replace: drop stale/static IDs for Groq when live discovery succeeds.
          rows.length = 0;
          seen.clear();
          for (const modelId of groqDiscovery.ids) {
            pushRow(modelId);
          }
        }
      } else if (provider === "lmstudio") {
        const baseUrlRaw = resolveLmStudioDiscoveryBaseUrl(config, configuredProviders);
        await fetchOpenAICompatModels(baseUrlRaw, "", false);
      } else if (provider === "openrouter") {
        await fetchOpenAICompatModels(
          configuredProviders?.openrouter?.baseUrl || "https://openrouter.ai/api/v1",
          resolveProviderCredential("openrouter"),
          false,
        );
      } else if (
        [
          "openai",
          "openai-codex",
          "moonshot",
          "kimi-coding",
          "litellm",
          "cerebras",
          "qianfan",
          "minimax",
          "opencode",
          "synthetic",
          "vercel-ai-gateway",
          "amazon-bedrock",
          "bedrock",
        ].includes(provider)
      ) {
        const resolvedBaseUrl =
          (typeof providerConfig?.baseUrl === "string" && providerConfig.baseUrl.trim()) ||
          (provider === "openai" || provider === "openai-codex"
            ? "https://api.openai.com/v1"
            : provider === "moonshot"
              ? "https://api.moonshot.ai/v1"
              : "");
        await fetchOpenAICompatModels(
          resolvedBaseUrl,
          resolveProviderCredential(provider) || resolveProviderCredential("openai"),
          provider !== "moonshot",
        );
      }
    } catch {
      /* live provider model discovery best-effort */
    }

    const result = rows.sort((a, b) => a.model.localeCompare(b.model)).slice(0, limit);
    res.json({
      provider,
      total: rows.length,
      models: result,
    });
  } catch (err) {
    console.error("[ProviderModels] Error:", err);
    res.status(500).json({ error: "Failed to read provider models" });
  }
});

// GET /api/settings/ollama/models — Proxy to Ollama
app.get("/api/settings/ollama/models", async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: "Ollama not available", details: err.message });
  }
});

// ============================================
// AUTH PROFILES API (Extended)
// ============================================

// GET /api/settings/auth-profiles — Returns profiles with masked tokens + usage stats
// Returns profiles ordered by the saved failover order when available
app.get("/api/settings/auth-profiles", (req, res) => {
  try {
    const data = readAuthProfiles();
    const allKeys = Object.keys(data.profiles || {});

    // Build the ordered key list respecting saved order per provider
    const savedOrder = data.order || {};
    const orderedKeys = [];
    const seen = new Set();

    // First: iterate through saved orders (these define failover priority)
    for (const [, providerOrder] of Object.entries(savedOrder)) {
      if (Array.isArray(providerOrder)) {
        for (const key of providerOrder) {
          if (allKeys.includes(key) && !seen.has(key)) {
            orderedKeys.push(key);
            seen.add(key);
          }
        }
      }
    }

    // Then: append any profiles not in any saved order (new profiles, other providers)
    for (const key of allKeys) {
      if (!seen.has(key)) {
        orderedKeys.push(key);
        seen.add(key);
      }
    }

    const profiles = orderedKeys.map((key) => {
      const profile = data.profiles[key];
      return {
        key,
        provider: profile.provider || key.split(":")[0],
        type: profile.type || "api_key",
        maskedToken: maskKey(profile.token || profile.key || ""),
        usageStats: data.usageStats?.[key] || null,
      };
    });
    res.json({
      profiles,
      lastGood: data.lastGood || {},
      availableProviders: buildAuthProfileProviderOptions(),
    });
  } catch (err) {
    console.error("[AuthProfiles] Error reading:", err);
    res.status(500).json({ error: "Failed to read auth profiles" });
  }
});

// GET /api/settings/auth-profiles/:key/reveal — Return the full unmasked token
app.get("/api/settings/auth-profiles/:key/reveal", (req, res) => {
  try {
    const data = readAuthProfiles();
    const profile = data.profiles?.[req.params.key];
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }
    res.json({ value: profile.token || profile.key || "" });
  } catch (err) {
    console.error("[AuthProfiles] Error revealing:", err);
    res.status(500).json({ error: "Failed to read auth profile" });
  }
});

// POST /api/settings/auth-profiles/openai-codex/oauth/start — Start dashboard OAuth flow
app.post("/api/settings/auth-profiles/openai-codex/oauth/start", (req, res) => {
  try {
    cleanupOpenAICodexAuthSessions();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateOAuthState();
    const redirectUri = createOpenAICodexRedirectUri(req);
    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: OPENAI_CODEX_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: OPENAI_CODEX_SCOPE,
      audience: OPENAI_CODEX_AUDIENCE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    openAICodexAuthSessions.set(state, {
      codeVerifier,
      redirectUri,
      createdAt: Date.now(),
      status: "pending",
    });
    res.json({
      ok: true,
      state,
      authUrl: `${OPENAI_CODEX_AUTH_URL}?${authParams.toString()}`,
      expiresInMs: OPENAI_CODEX_OAUTH_TTL_MS,
    });
  } catch (err) {
    console.error("[AuthProfiles] Failed to start OpenAI Codex OAuth:", err);
    res.status(500).json({ error: "Failed to start OpenAI Codex OAuth" });
  }
});

// GET /api/settings/auth-profiles/openai-codex/oauth/status — Poll dashboard OAuth flow status
app.get("/api/settings/auth-profiles/openai-codex/oauth/status", (req, res) => {
  cleanupOpenAICodexAuthSessions();
  const state = String(req.query.state || "").trim();
  if (!state) {
    return res.status(400).json({ error: "state is required" });
  }
  const session = openAICodexAuthSessions.get(state);
  if (!session) {
    return res.status(404).json({ error: "OAuth session not found or expired" });
  }
  res.json({
    ok: true,
    status: session.status,
    error: session.error || null,
    completedAt: session.completedAt || null,
  });
});

// GET /api/settings/auth-profiles/openai-codex/oauth/callback — OAuth callback target
app.get("/api/settings/auth-profiles/openai-codex/oauth/callback", async (req, res) => {
  cleanupOpenAICodexAuthSessions();
  const state = String(req.query.state || "").trim();
  const code = String(req.query.code || "").trim();
  const error = String(req.query.error || "").trim();
  const errorDescription = String(req.query.error_description || "").trim();
  const session = state ? openAICodexAuthSessions.get(state) : null;

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!session) {
    res
      .status(400)
      .end(
        '<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:4rem">' +
          "<h1>Authentication Expired</h1><p>This OAuth session is missing or expired.</p>" +
          "<p>Return to Argent and start the flow again.</p></body></html>",
      );
    return;
  }

  if (error) {
    session.status = "error";
    session.error = errorDescription || error;
    session.completedAt = Date.now();
    res
      .status(400)
      .end(
        '<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:4rem">' +
          "<h1>Authentication Failed</h1><p>" +
          escapeHtml(errorDescription || error) +
          "</p><p>You can close this tab and return to Argent.</p></body></html>",
      );
    return;
  }

  if (!code) {
    session.status = "error";
    session.error = "Missing authorization code";
    session.completedAt = Date.now();
    res
      .status(400)
      .end(
        '<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:4rem">' +
          "<h1>Missing Authorization Code</h1><p>The callback did not include a code.</p>" +
          "<p>You can close this tab and return to Argent.</p></body></html>",
      );
    return;
  }

  try {
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CODEX_CLIENT_ID,
      code_verifier: session.codeVerifier,
      code,
      redirect_uri: session.redirectUri,
    });
    const tokenRes = await fetch(OPENAI_CODEX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => "");
      throw new Error(`Token exchange failed (${tokenRes.status}): ${detail || "unknown error"}`);
    }
    const tokenData = await tokenRes.json();
    writeOpenAICodexOAuthProfile(tokenData);
    session.status = "success";
    session.error = null;
    session.completedAt = Date.now();
    res.end(
      '<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:4rem">' +
        "<h1>OpenAI Codex Connected</h1><p>The auth profile was updated successfully.</p>" +
        "<p>You can close this tab and return to Argent.</p></body></html>",
    );
  } catch (err) {
    session.status = "error";
    session.error = err.message || String(err);
    session.completedAt = Date.now();
    console.error("[AuthProfiles] OpenAI Codex OAuth callback failed:", err);
    res
      .status(500)
      .end(
        '<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:4rem">' +
          "<h1>OpenAI Codex OAuth Failed</h1><p>" +
          escapeHtml(session.error || "Unknown error") +
          "</p><p>You can close this tab and return to Argent.</p></body></html>",
      );
  }
});

// POST /api/settings/auth-profiles — Add a new profile
app.post("/api/settings/auth-profiles", (req, res) => {
  const { provider, name, token, type } = req.body;
  if (!provider || !name || !token) {
    return res.status(400).json({ error: "provider, name, and token are required" });
  }
  try {
    const data = readAuthProfiles();
    const key = `${provider}:${name}`;
    if (data.profiles[key]) {
      return res.status(409).json({ error: "Profile already exists" });
    }
    data.profiles[key] = {
      type: type || (token.startsWith("sk-ant-oat") ? "token" : "api_key"),
      provider,
      [token.startsWith("sk-ant-oat") ? "token" : "key"]: token,
    };
    writeAuthProfiles(data);
    console.log("[AuthProfiles] Added:", key);
    res.status(201).json({ ok: true, key });
  } catch (err) {
    console.error("[AuthProfiles] Error adding:", err);
    res.status(500).json({ error: "Failed to add auth profile" });
  }
});

// PATCH /api/settings/auth-profiles/order — Save failover order (from dashboard drag-and-drop)
app.patch("/api/settings/auth-profiles/order", (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: "order must be a non-empty array of profile keys" });
  }
  try {
    const data = readAuthProfiles();

    // Group the ordered keys by provider
    const providerOrders = {};
    for (const key of order) {
      const profile = data.profiles[key];
      if (!profile) continue;
      const provider = profile.provider || key.split(":")[0];
      if (!providerOrders[provider]) {
        providerOrders[provider] = [];
      }
      providerOrders[provider].push(key);
    }

    // Replace the order field entirely — JS object key insertion order
    // determines the global sequence, so we must build from scratch.
    data.order = {};
    for (const [provider, keys] of Object.entries(providerOrders)) {
      data.order[provider] = keys;
    }

    writeAuthProfiles(data);
    console.log("[AuthProfiles] Saved failover order:", data.order);
    res.json({ ok: true, order: data.order });
  } catch (err) {
    console.error("[AuthProfiles] Error saving order:", err);
    res.status(500).json({ error: "Failed to save auth profile order" });
  }
});

// PATCH /api/settings/auth-profiles/:key — Update an existing non-OAuth profile secret
app.patch("/api/settings/auth-profiles/:key", (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    return res.status(400).json({ error: "token is required" });
  }
  try {
    const data = readAuthProfiles();
    const profile = data.profiles[key];
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }
    const profileType = typeof profile.type === "string" ? profile.type : "api_key";
    if (profileType === "oauth") {
      return res
        .status(400)
        .json({ error: "OAuth profiles must be refreshed or re-authenticated" });
    }

    const nextProfile = { ...profile };
    if (profileType === "token") {
      nextProfile.token = token;
      delete nextProfile.key;
    } else {
      nextProfile.key = token;
      delete nextProfile.token;
    }
    data.profiles[key] = nextProfile;
    writeAuthProfiles(data);
    console.log("[AuthProfiles] Updated:", key);
    res.json({ ok: true, key, maskedToken: maskKey(token) });
  } catch (err) {
    console.error("[AuthProfiles] Error updating:", err);
    res.status(500).json({ error: "Failed to update auth profile" });
  }
});

// DELETE /api/settings/auth-profiles/:key — Remove a profile
app.delete("/api/settings/auth-profiles/:key", (req, res) => {
  const key = decodeURIComponent(req.params.key);
  try {
    const data = readAuthProfiles();
    if (!data.profiles[key]) {
      return res.status(404).json({ error: "Profile not found" });
    }
    delete data.profiles[key];
    // Clean up usage stats too
    if (data.usageStats?.[key]) {
      delete data.usageStats[key];
    }
    writeAuthProfiles(data);
    console.log("[AuthProfiles] Deleted:", key);
    res.json({ ok: true });
  } catch (err) {
    console.error("[AuthProfiles] Error deleting:", err);
    res.status(500).json({ error: "Failed to delete auth profile" });
  }
});

// POST /api/settings/auth-profiles/:key/set-active — Set profile as active (update lastGood)
app.post("/api/settings/auth-profiles/:key/set-active", (req, res) => {
  const key = decodeURIComponent(req.params.key);
  try {
    const data = readAuthProfiles();
    const profile = data.profiles[key];
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Update lastGood for this provider
    const provider = profile.provider || key.split(":")[0];
    if (!data.lastGood) data.lastGood = {};
    data.lastGood[provider] = key;

    writeAuthProfiles(data);
    console.log("[AuthProfiles] Set active:", key, "for provider:", provider);
    res.json({ ok: true, lastGood: data.lastGood });
  } catch (err) {
    console.error("[AuthProfiles] Error setting active:", err);
    res.status(500).json({ error: "Failed to set active auth profile" });
  }
});

// ============================================
// Auth Profile Diagnostics & Health API
// ============================================

/**
 * Discover all agent auth-profiles.json files across ~/.argentos/agents/
 * Returns array of { agentName, filePath, data }
 */
function discoverAllAuthProfiles() {
  const agentsDir = path.join(process.env.HOME, ".argentos", "agents");
  const results = [];
  try {
    if (!fs.existsSync(agentsDir)) return results;
    const agents = fs.readdirSync(agentsDir);
    for (const agentName of agents) {
      const profilePath = path.join(agentsDir, agentName, "agent", "auth-profiles.json");
      try {
        if (fs.existsSync(profilePath)) {
          const data = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
          results.push({ agentName, filePath: profilePath, data });
        }
      } catch (err) {
        console.error(`[AuthDiag] Failed to read ${profilePath}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[AuthDiag] Failed to scan agents dir:", err.message);
  }
  return results;
}

// GET /api/settings/auth-diagnostics — Per-agent diagnostic summary with cooldown info
app.get("/api/settings/auth-diagnostics", (req, res) => {
  try {
    const allAgents = discoverAllAuthProfiles();
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    const agents = {};
    let totalProfiles = 0;
    let availableCount = 0;
    let inCooldownCount = 0;
    let disabledCount = 0;
    let recentFailureCount = 0;

    for (const { agentName, data } of allAgents) {
      const profileKeys = Object.keys(data.profiles || {});
      const profiles = {};

      for (const key of profileKeys) {
        const stats = data.usageStats?.[key] || {};
        totalProfiles++;

        const cooldownUntil =
          stats.cooldownUntil && stats.cooldownUntil > now ? stats.cooldownUntil : null;
        const disabledUntil =
          stats.disabledUntil && stats.disabledUntil > now ? stats.disabledUntil : null;
        const isAvailable = !cooldownUntil && !disabledUntil;
        const recentFailure = stats.lastFailureAt && now - stats.lastFailureAt < ONE_HOUR;

        if (disabledUntil) disabledCount++;
        else if (cooldownUntil) inCooldownCount++;
        else availableCount++;
        if (recentFailure) recentFailureCount++;

        // Show profiles with active issues OR recent failures (last hour)
        const hasIssues =
          !isAvailable || (stats.errorCount && stats.errorCount > 0) || recentFailure;
        if (hasIssues) {
          let cooldownRemaining = null;
          const activeUntil = disabledUntil || cooldownUntil;
          if (activeUntil) {
            const remainMs = activeUntil - now;
            if (remainMs > 60000) cooldownRemaining = Math.ceil(remainMs / 60000) + "min";
            else cooldownRemaining = Math.ceil(remainMs / 1000) + "s";
          }

          // Time since last failure (human-readable)
          let failureAge = null;
          if (stats.lastFailureAt) {
            const ageMs = now - stats.lastFailureAt;
            if (ageMs < 60000) failureAge = Math.round(ageMs / 1000) + "s ago";
            else if (ageMs < ONE_HOUR) failureAge = Math.round(ageMs / 60000) + "min ago";
            else failureAge = Math.round(ageMs / ONE_HOUR) + "h ago";
          }

          profiles[key] = {
            errorCount: stats.errorCount || 0,
            cooldownUntil: cooldownUntil,
            disabledUntil: disabledUntil,
            disabledReason: stats.disabledReason || null,
            failureCounts: stats.failureCounts || null,
            lastFailureAt: stats.lastFailureAt || null,
            failureAge,
            lastUsed: stats.lastUsed || null,
            available: isAvailable,
            recentFailure: !!recentFailure,
            cooldownRemaining,
          };
        }
      }

      if (Object.keys(profiles).length > 0) {
        agents[agentName] = { profiles };
      }
    }

    res.json({
      agents,
      summary: {
        totalProfiles,
        available: availableCount,
        inCooldown: inCooldownCount,
        disabled: disabledCount,
        recentFailures: recentFailureCount,
      },
    });
  } catch (err) {
    console.error("[AuthDiag] Error reading diagnostics:", err);
    res.status(500).json({ error: "Failed to read auth diagnostics" });
  }
});

// POST /api/settings/auth-profiles/clear-cooldowns — Clear cooldowns for one or all profiles
app.post("/api/settings/auth-profiles/clear-cooldowns", (req, res) => {
  const { key } = req.body || {};
  try {
    const allAgents = discoverAllAuthProfiles();
    let cleared = 0;

    for (const { agentName, filePath, data } of allAgents) {
      if (!data.usageStats) continue;
      let modified = false;

      const keysToCheck = key ? [key] : Object.keys(data.usageStats);
      for (const profileKey of keysToCheck) {
        const stats = data.usageStats[profileKey];
        if (!stats) continue;

        const hadIssue =
          stats.errorCount > 0 || stats.cooldownUntil || stats.disabledUntil || stats.failureCounts;
        if (hadIssue) {
          stats.errorCount = 0;
          delete stats.cooldownUntil;
          delete stats.disabledUntil;
          delete stats.disabledReason;
          delete stats.failureCounts;
          modified = true;
          cleared++;
        }
      }

      if (modified) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        console.log(
          `[AuthDiag] Cleared cooldowns for agent: ${agentName}${key ? ` profile: ${key}` : " (all)"}`,
        );
      }
    }

    res.json({ ok: true, cleared });
  } catch (err) {
    console.error("[AuthDiag] Error clearing cooldowns:", err);
    res.status(500).json({ error: "Failed to clear cooldowns" });
  }
});

// ============================================
// Score / Accountability Feedback API
// ============================================

const SCORE_BASE_MINIMUM = 50;
const SCORE_MAX_HISTORY = 7;
const SCORE_MAX_TARGET = 500;
const SCORE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function parseHeartbeatEveryMs(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim();
  if (!text) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(text);
  if (!m) return null;
  const value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (m[2] || "m").toLowerCase();
  const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Math.round(value * (factors[unit] || factors.m));
}

function resolveHeartbeatWorkspaceContext() {
  const config = readArgentConfig();
  const defaultAgentId = resolveDefaultAgentId(config);
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const agentEntry = list.find(
    (entry) =>
      entry && typeof entry === "object" && String(entry.id || "").trim() === defaultAgentId,
  );
  const defaultsWorkspace =
    typeof config?.agents?.defaults?.workspace === "string"
      ? config.agents.defaults.workspace.trim()
      : "";
  const agentWorkspace =
    typeof agentEntry?.workspace === "string" ? String(agentEntry.workspace).trim() : "";
  const workspaceDir =
    (process.env.ARGENT_WORKSPACE && process.env.ARGENT_WORKSPACE.trim()) ||
    agentWorkspace ||
    defaultsWorkspace ||
    path.join(process.env.HOME, "argent");

  const defaultsHeartbeat =
    config?.agents?.defaults?.heartbeat && typeof config.agents.defaults.heartbeat === "object"
      ? config.agents.defaults.heartbeat
      : {};
  const agentHeartbeat =
    agentEntry?.heartbeat && typeof agentEntry.heartbeat === "object" ? agentEntry.heartbeat : {};
  const heartbeat = { ...defaultsHeartbeat, ...agentHeartbeat };
  const heartbeatEnabled = heartbeat?.enabled !== false;
  const heartbeatSession =
    typeof heartbeat?.session === "string" && heartbeat.session.trim()
      ? heartbeat.session.trim()
      : "main";
  const heartbeatEveryMs = heartbeatEnabled
    ? parseHeartbeatEveryMs(heartbeat?.every ?? "30m")
    : null;
  return {
    config,
    defaultAgentId,
    workspaceDir,
    heartbeatSession,
    heartbeatEveryMs,
  };
}

function resolveHeartbeatPaths(context) {
  return {
    scoreFile: path.join(context.workspaceDir, "memory", "heartbeat-score.json"),
    journalDir: path.join(context.workspaceDir, "memory", "journal"),
    heartbeatFile: path.join(context.workspaceDir, "HEARTBEAT.md"),
    sessionsPath: path.join(
      process.env.HOME,
      ".argentos",
      "agents",
      context.defaultAgentId,
      "sessions",
      "sessions.json",
    ),
  };
}

/**
 * Compute dynamic daily target — mirrors computeDailyTarget() in heartbeat-score.ts
 * Target = max(7-day rolling average of positive days, ratchet floor, base minimum)
 */
function computeScoreTarget(state) {
  const rawFloor = state.lifetime?.targetFloor || SCORE_BASE_MINIMUM;
  const floor = Math.max(SCORE_BASE_MINIMUM, Math.min(SCORE_MAX_TARGET, Math.round(rawFloor)));
  const history = (state.history || []).slice(0, SCORE_MAX_HISTORY);
  if (history.length === 0) return Math.min(SCORE_MAX_TARGET, Math.max(floor, SCORE_BASE_MINIMUM));
  const positiveDays = history.filter((d) => d.score > 0);
  if (positiveDays.length === 0)
    return Math.min(SCORE_MAX_TARGET, Math.max(floor, SCORE_BASE_MINIMUM));
  const avg = Math.round(positiveDays.reduce((sum, d) => sum + d.score, 0) / positiveDays.length);
  return Math.min(SCORE_MAX_TARGET, Math.max(avg, floor, SCORE_BASE_MINIMUM));
}

function getLastHeartbeatCycleAtMs(journalDir) {
  try {
    if (!journalDir || !fs.existsSync(journalDir)) return null;
    const files = fs
      .readdirSync(journalDir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort((a, b) => b.localeCompare(a));
    for (const file of files) {
      const fullPath = path.join(journalDir, file);
      let content = "";
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }
      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          const entry = JSON.parse(lines[i]);
          const raw = entry?.occurredAt;
          const ts = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
          if (Number.isFinite(ts) && ts > 0) return ts;
        } catch {
          continue;
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function isHeartbeatContentEffectivelyEmpty(content) {
  if (typeof content !== "string") return true;
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));
  return lines.length === 0;
}

function isHeartbeatMonitoringEnabled(heartbeatFile) {
  try {
    if (!heartbeatFile || !fs.existsSync(heartbeatFile)) return true;
    const content = fs.readFileSync(heartbeatFile, "utf-8");
    return !isHeartbeatContentEffectivelyEmpty(content);
  } catch {
    return true;
  }
}

function readHeartbeatContractTaskCount(heartbeatFile) {
  try {
    if (!heartbeatFile || !fs.existsSync(heartbeatFile)) return 0;
    const lines = fs.readFileSync(heartbeatFile, "utf-8").split(/\r?\n/);
    let inTasks = false;
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^##\s+Tasks\b/i.test(trimmed)) {
        inTasks = true;
        continue;
      }
      if (/^##\s+/.test(trimmed) && inTasks) {
        inTasks = false;
      }
      if (inTasks && /^[-*+]\s*\[[xX ]\]\s+/.test(trimmed)) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function resolveHeartbeatRunnerStatus(params) {
  const { sessionsPath, agentId, heartbeatSession, everyMs } = params;
  let store = {};
  try {
    if (sessionsPath && fs.existsSync(sessionsPath)) {
      store = JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
    }
  } catch {
    store = {};
  }

  const alias = String(heartbeatSession || "heartbeat")
    .trim()
    .toLowerCase();
  const directCandidates = [];
  if (alias === "global") {
    directCandidates.push("global");
  } else if (alias === "main") {
    directCandidates.push(`agent:${agentId}:main`);
  } else {
    directCandidates.push(`agent:${agentId}:${heartbeatSession}`);
  }
  directCandidates.push(`agent:${agentId}:heartbeat`);

  let lastRunAtMs = null;
  let sessionKey = null;
  for (const key of directCandidates) {
    const updatedAt = store?.[key]?.updatedAt;
    if (typeof updatedAt === "number" && Number.isFinite(updatedAt) && updatedAt > 0) {
      if (lastRunAtMs == null || updatedAt > lastRunAtMs) {
        lastRunAtMs = updatedAt;
        sessionKey = key;
      }
    }
  }
  if (lastRunAtMs == null) {
    for (const [key, entry] of Object.entries(store || {})) {
      if (!String(key).startsWith(`agent:${agentId}:`)) continue;
      if (!String(key).includes(":heartbeat")) continue;
      const updatedAt = entry?.updatedAt;
      if (typeof updatedAt === "number" && Number.isFinite(updatedAt) && updatedAt > 0) {
        if (lastRunAtMs == null || updatedAt > lastRunAtMs) {
          lastRunAtMs = updatedAt;
          sessionKey = key;
        }
      }
    }
  }

  const thresholdMs = Math.max(
    everyMs && Number.isFinite(everyMs) ? Math.round(everyMs * 2) : 0,
    90 * 60 * 1000,
  );
  const ageMs = lastRunAtMs == null ? null : Math.max(0, Date.now() - lastRunAtMs);
  const active = ageMs != null ? ageMs <= thresholdMs : false;
  const state = lastRunAtMs == null ? "unknown" : active ? "active" : "stale";

  return {
    enabled: Boolean(everyMs),
    state,
    active,
    lastRunAt: lastRunAtMs == null ? null : new Date(lastRunAtMs).toISOString(),
    ageMs,
    staleThresholdMs: thresholdMs,
    staleThresholdHours: Math.floor(thresholdMs / (60 * 60 * 1000)),
    expectedEveryMs: everyMs ?? null,
    sessionKey,
  };
}

function readScoreState(scoreFile) {
  try {
    const raw = fs.readFileSync(scoreFile, "utf-8");
    const state = JSON.parse(raw);
    // Day rollover check
    const today = new Date().toISOString().slice(0, 10);
    if (state.today && state.today.date !== today) {
      const yesterday = state.today;
      if (!state.history) state.history = [];
      state.history.unshift(yesterday);
      if (state.history.length > 7) state.history = state.history.slice(0, 7);
      if (!state.lifetime)
        state.lifetime = {
          totalVerified: 0,
          totalFailed: 0,
          totalPoints: 0,
          bestDay: 0,
          worstDay: 0,
          currentStreak: 0,
          longestStreak: 0,
          daysTracked: 0,
          targetFloor: SCORE_BASE_MINIMUM,
        };
      if (!state.lifetime.targetFloor) state.lifetime.targetFloor = SCORE_BASE_MINIMUM;
      state.lifetime.targetFloor = Math.max(
        SCORE_BASE_MINIMUM,
        Math.min(SCORE_MAX_TARGET, Math.round(state.lifetime.targetFloor)),
      );
      state.lifetime.daysTracked++;
      state.lifetime.totalPoints += yesterday.score;
      if (yesterday.score > state.lifetime.bestDay) state.lifetime.bestDay = yesterday.score;
      if (yesterday.score < state.lifetime.worstDay) state.lifetime.worstDay = yesterday.score;
      if (yesterday.targetReached) {
        state.lifetime.currentStreak++;
        if (state.lifetime.currentStreak > state.lifetime.longestStreak)
          state.lifetime.longestStreak = state.lifetime.currentStreak;
      } else {
        state.lifetime.currentStreak = 0;
      }
      // Ratchet the target floor before resetting today
      const newTarget = computeScoreTarget(state);
      state.lifetime.targetFloor = Math.max(
        newTarget,
        state.lifetime.targetFloor || SCORE_BASE_MINIMUM,
      );
      state.lifetime.targetFloor = Math.max(
        SCORE_BASE_MINIMUM,
        Math.min(SCORE_MAX_TARGET, Math.round(state.lifetime.targetFloor)),
      );
      state.today = {
        date: today,
        score: 0,
        events: [],
        peakScore: 0,
        lowestScore: 0,
        verifiedCount: 0,
        failedCount: 0,
        targetReached: false,
      };
    }
    return state;
  } catch {
    return {
      today: {
        date: new Date().toISOString().slice(0, 10),
        score: 0,
        events: [],
        peakScore: 0,
        lowestScore: 0,
        verifiedCount: 0,
        failedCount: 0,
        targetReached: false,
      },
      history: [],
      lifetime: {
        totalVerified: 0,
        totalFailed: 0,
        totalPoints: 0,
        bestDay: 0,
        worstDay: 0,
        currentStreak: 0,
        longestStreak: 0,
        daysTracked: 0,
        targetFloor: SCORE_BASE_MINIMUM,
      },
    };
  }
}

function writeScoreState(scoreFile, state) {
  const dir = path.dirname(scoreFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(scoreFile, JSON.stringify(state, null, 2), "utf-8");
}

// GET /api/score — Current score state
app.get("/api/score", (req, res) => {
  try {
    const context = resolveHeartbeatWorkspaceContext();
    const paths = resolveHeartbeatPaths(context);
    const state = readScoreState(paths.scoreFile);
    const target = computeScoreTarget(state);
    const monitoringEnabled = isHeartbeatMonitoringEnabled(paths.heartbeatFile);
    const taskCount = readHeartbeatContractTaskCount(paths.heartbeatFile);
    const accountabilityEnabled = monitoringEnabled && taskCount > 0;
    const lastCycleAtMs = getLastHeartbeatCycleAtMs(paths.journalDir);
    const staleMs =
      accountabilityEnabled && lastCycleAtMs ? Math.max(0, Date.now() - lastCycleAtMs) : null;
    const stale = accountabilityEnabled
      ? !lastCycleAtMs || staleMs > SCORE_STALE_THRESHOLD_MS
      : false;
    const runner = resolveHeartbeatRunnerStatus({
      sessionsPath: paths.sessionsPath,
      agentId: context.defaultAgentId,
      heartbeatSession: context.heartbeatSession,
      everyMs: context.heartbeatEveryMs,
    });
    res.json({
      today: {
        date: state.today.date,
        score: state.today.score,
        target,
        verifiedCount: state.today.verifiedCount,
        failedCount: state.today.failedCount,
        peakScore: state.today.peakScore,
        lowestScore: state.today.lowestScore,
        targetReached: state.today.targetReached,
        eventCount: state.today.events.length,
      },
      lifetime: state.lifetime,
      heartbeat: {
        monitoringEnabled,
        accountabilityEnabled,
        taskCount,
        lastCycleAt: lastCycleAtMs ? new Date(lastCycleAtMs).toISOString() : null,
        stale,
        staleMs,
        staleHours: staleMs == null ? null : Math.floor(staleMs / (60 * 60 * 1000)),
        staleThresholdHours: Math.floor(SCORE_STALE_THRESHOLD_MS / (60 * 60 * 1000)),
        accountability: {
          enabled: accountabilityEnabled,
          taskCount,
          lastCycleAt: lastCycleAtMs ? new Date(lastCycleAtMs).toISOString() : null,
          stale,
          staleMs,
          staleHours: staleMs == null ? null : Math.floor(staleMs / (60 * 60 * 1000)),
          staleThresholdHours: Math.floor(SCORE_STALE_THRESHOLD_MS / (60 * 60 * 1000)),
        },
        runner,
        paths: {
          workspaceDir: context.workspaceDir,
          scoreFile: paths.scoreFile,
          journalDir: paths.journalDir,
          heartbeatFile: paths.heartbeatFile,
          sessionsPath: paths.sessionsPath,
        },
      },
    });
  } catch (err) {
    console.error("[Score] Error reading:", err);
    res.status(500).json({ error: "Failed to read score" });
  }
});

// GET /api/score/history — Score history for leaderboard
app.get("/api/score/history", (req, res) => {
  try {
    const context = resolveHeartbeatWorkspaceContext();
    const paths = resolveHeartbeatPaths(context);
    const state = readScoreState(paths.scoreFile);
    const days = [
      {
        date: state.today.date,
        score: state.today.score,
        verified: state.today.verifiedCount,
        failed: state.today.failedCount,
        targetReached: state.today.targetReached,
        isToday: true,
      },
      ...(state.history || []).map((d) => ({
        date: d.date,
        score: d.score,
        verified: d.verifiedCount,
        failed: d.failedCount,
        targetReached: d.targetReached,
        isToday: false,
      })),
    ];
    res.json({ days, lifetime: state.lifetime });
  } catch (err) {
    console.error("[Score] Error reading history:", err);
    res.status(500).json({ error: "Failed to read score history" });
  }
});

// POST /api/score/feedback — Record thumbs up/down from dashboard
app.post("/api/score/feedback", (req, res) => {
  const { type, messageId, sessionKey } = req.body;
  if (!type || !["up", "down"].includes(type)) {
    return res.status(400).json({ error: "type must be 'up' or 'down'" });
  }
  try {
    const context = resolveHeartbeatWorkspaceContext();
    const paths = resolveHeartbeatPaths(context);
    const state = readScoreState(paths.scoreFile);
    const points = type === "up" ? 3 : -10;
    const event = {
      taskId: `feedback:${messageId || Date.now()}`,
      verdict: type === "up" ? "verified" : "not_verified",
      required: false,
      groundTruthContradiction: false,
      points,
      timestamp: Date.now(),
    };
    state.today.score += points;
    state.today.events.push(event);
    if (type === "up") {
      state.today.verifiedCount++;
      state.lifetime.totalVerified++;
    } else {
      state.today.failedCount++;
      state.lifetime.totalFailed++;
    }
    if (state.today.score > state.today.peakScore) state.today.peakScore = state.today.score;
    if (state.today.score < state.today.lowestScore) state.today.lowestScore = state.today.score;
    const target = computeScoreTarget(state);
    if (state.today.score >= target) state.today.targetReached = true;
    writeScoreState(paths.scoreFile, state);
    console.log(
      `[Score] Human feedback: ${type} (${points > 0 ? "+" : ""}${points}) → score now ${state.today.score}/${target}`,
    );

    // Forward SIS lesson feedback to gateway (fire-and-forget)
    if (sessionKey) {
      const config = readArgentConfig();
      const gwPort = config.gateway?.port || 18789;
      const payload = JSON.stringify({ sessionKey, feedbackType: type });
      const gwReq = require("http").request(
        {
          hostname: "127.0.0.1",
          port: gwPort,
          path: "/api/internal/sis-feedback",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
          timeout: 3000,
        },
        (gwRes) => {
          let body = "";
          gwRes.on("data", (chunk) => {
            body += chunk;
          });
          gwRes.on("end", () => {
            try {
              const result = JSON.parse(body);
              if (result.lessonsUpdated > 0) {
                console.log(
                  `[SIS] Feedback forwarded: ${type} → ${result.lessonsUpdated} lesson(s) updated`,
                );
              }
            } catch {}
          });
        },
      );
      gwReq.on("error", (err) => {
        console.warn("[SIS] Failed to forward feedback to gateway:", err.message);
      });
      gwReq.write(payload);
      gwReq.end();
    }

    res.json({ points, score: state.today.score, target });
  } catch (err) {
    console.error("[Score] Error recording feedback:", err);
    res.status(500).json({ error: "Failed to record feedback" });
  }
});

// ============================================
// Journal endpoint (Gollum Journal)
// ============================================
app.get("/api/journal/:date", (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
  }

  const { workspaceDir } = resolveHeartbeatWorkspaceContext();
  const journalPath = path.join(workspaceDir, "memory", "journal", `${date}.jsonl`);

  if (!fs.existsSync(journalPath)) {
    return res.json({ entries: [], date });
  }

  try {
    const content = fs.readFileSync(journalPath, "utf-8");
    const entries = content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    res.json({ entries, date });
  } catch (err) {
    res.status(500).json({ error: "Failed to read journal", details: err.message });
  }
});

// ============================================
// Channels endpoints
// ============================================
function normalizeAllowFromInput(value) {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]+/) : [];
  const entries = raw.map((entry) => String(entry).trim()).filter(Boolean);
  return Array.from(new Set(entries));
}

app.get("/api/settings/channels", (req, res) => {
  const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const channels = config.channels || {};

    // Build channel list with masked tokens
    const channelList = Object.entries(channels).map(([id, cfg]) => {
      const c = cfg;
      const tokenValue = id === "telegram" ? c.botToken : c.token;
      return {
        id,
        configured: true,
        token: tokenValue ? tokenValue.slice(0, 8) + "..." + tokenValue.slice(-4) : null,
        groupPolicy: c.groupPolicy || null,
        dmPolicy: c.dmPolicy || null,
        mentionGating: c.mentionGating !== undefined ? c.mentionGating : null,
        allowFrom: Array.isArray(c.allowFrom) ? c.allowFrom.length : 0,
        allowFromEntries: Array.isArray(c.allowFrom) ? c.allowFrom : [],
        enabled: c.enabled !== false,
      };
    });

    res.json({ channels: channelList });
  } catch (err) {
    res.status(500).json({ error: "Failed to read channel config", details: err.message });
  }
});

app.patch("/api/settings/channels/:id", (req, res) => {
  const channelId = req.params.id;
  const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!config.channels) config.channels = {};
    if (!config.channels[channelId]) config.channels[channelId] = {};

    // Merge allowed fields
    const allowed = ["groupPolicy", "dmPolicy", "enabled", "mentionGating", "threadMode"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        config.channels[channelId][key] = req.body[key];
      }
    }
    const allowFrom = normalizeAllowFromInput(req.body.allowFrom);
    if (allowFrom !== undefined) {
      if (allowFrom.length > 0) {
        config.channels[channelId].allowFrom = allowFrom;
      } else {
        delete config.channels[channelId].allowFrom;
      }
    }
    // Handle token separately (only if provided and non-empty)
    if (req.body.token && typeof req.body.token === "string" && req.body.token.trim()) {
      if (channelId === "telegram") {
        config.channels[channelId].botToken = req.body.token.trim();
        delete config.channels[channelId].token;
      } else {
        config.channels[channelId].token = req.body.token.trim();
      }
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update channel config", details: err.message });
  }
});

// POST /api/settings/channels — Add a new channel
app.post("/api/settings/channels", (req, res) => {
  const { provider, token, dmPolicy } = req.body;
  if (!provider || !token) {
    return res.status(400).json({ error: "provider and token are required" });
  }
  const validProviders = ["discord", "telegram", "slack", "signal", "whatsapp"];
  if (!validProviders.includes(provider)) {
    return res
      .status(400)
      .json({ error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` });
  }
  const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!config.channels) config.channels = {};
    if (config.channels[provider]) {
      return res.status(409).json({ error: `Channel "${provider}" already exists` });
    }
    config.channels[provider] =
      provider === "telegram" ? { botToken: token.trim() } : { token: token.trim() };
    if (dmPolicy) config.channels[provider].dmPolicy = dmPolicy;
    const allowFrom = normalizeAllowFromInput(req.body.allowFrom);
    if (allowFrom && allowFrom.length > 0) {
      config.channels[provider].allowFrom = allowFrom;
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to add channel", details: err.message });
  }
});

// DELETE /api/settings/channels/:id — Remove a channel
app.delete("/api/settings/channels/:id", (req, res) => {
  const channelId = req.params.id;
  const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!config.channels || !config.channels[channelId]) {
      return res.status(404).json({ error: "Channel not found" });
    }
    delete config.channels[channelId];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete channel", details: err.message });
  }
});

// ============================================
// Device Pairing API
// ============================================

const nacl = require("tweetnacl");

const PAIRED_DEVICES_PATH = path.join(
  process.env.HOME,
  ".argentos",
  "agents",
  "main",
  "agent",
  "paired-devices.json",
);
const GATEWAY_KEYS_PATH = path.join(process.env.HOME, ".argentos", "gateway-keys.json");

// In-memory pending pairings (expire after 5 minutes)
const pendingPairings = new Map();

function getGatewayKeys() {
  if (fs.existsSync(GATEWAY_KEYS_PATH)) {
    return JSON.parse(fs.readFileSync(GATEWAY_KEYS_PATH, "utf-8"));
  }
  const keypair = nacl.sign.keyPair();
  const keys = {
    publicKey: Buffer.from(keypair.publicKey).toString("base64"),
    secretKey: Buffer.from(keypair.secretKey).toString("base64"),
  };
  fs.mkdirSync(path.dirname(GATEWAY_KEYS_PATH), { recursive: true });
  fs.writeFileSync(GATEWAY_KEYS_PATH, JSON.stringify(keys, null, 2));
  return keys;
}

function getGatewayId() {
  const os = require("os");
  return crypto.createHash("sha256").update(os.hostname()).digest("hex").slice(0, 16);
}

function readPairedDevices() {
  if (!fs.existsSync(PAIRED_DEVICES_PATH)) return { devices: [] };
  try {
    return JSON.parse(fs.readFileSync(PAIRED_DEVICES_PATH, "utf-8"));
  } catch {
    return { devices: [] };
  }
}

function writePairedDevices(data) {
  fs.mkdirSync(path.dirname(PAIRED_DEVICES_PATH), { recursive: true });
  fs.writeFileSync(PAIRED_DEVICES_PATH, JSON.stringify(data, null, 2));
}

// SSE for device pairing events (approval requests pushed to dashboard)
const pairingClients = new Set();

app.get("/api/devices/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  pairingClients.add(res);
  req.on("close", () => pairingClients.delete(res));
});

function broadcastPairingEvent(event) {
  const data = JSON.stringify(event);
  for (const client of pairingClients) {
    client.write(`data: ${data}\n\n`);
  }
}

// POST /api/devices/pair — Generate a pairing payload (QR code data)
app.post("/api/devices/pair", (req, res) => {
  console.log("[Pairing] Generating new pairing code");
  try {
    const keys = getGatewayKeys();
    const gatewayId = getGatewayId();

    // Generate pairing code: ARGENT-PAIR-XXXX-XXXX
    const hexChunk = () => crypto.randomBytes(2).toString("hex").toUpperCase();
    const pairingCode = `ARGENT-PAIR-${hexChunk()}-${hexChunk()}`;

    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Read relay URL from config if available
    let relayUrl = null;
    try {
      const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      relayUrl = config.gateway?.relay?.url || null;
    } catch {}

    const payload = {
      gatewayId,
      pairingCode,
      relayUrl,
      expiresAt,
      publicKey: keys.publicKey,
    };

    // Store pending pairing
    pendingPairings.set(pairingCode, {
      ...payload,
      createdAt: Date.now(),
    });

    // Auto-expire
    setTimeout(
      () => {
        if (pendingPairings.has(pairingCode)) {
          pendingPairings.delete(pairingCode);
          broadcastPairingEvent({ type: "pairing_expired", pairingCode });
        }
      },
      5 * 60 * 1000,
    );

    console.log("[Pairing] Code generated:", pairingCode);
    res.json(payload);
  } catch (err) {
    console.error("[Pairing] Error generating code:", err);
    res.status(500).json({ error: "Failed to generate pairing code" });
  }
});

// GET /api/devices — List paired devices
app.get("/api/devices", (req, res) => {
  try {
    const data = readPairedDevices();
    const pending = [];
    for (const [code, p] of pendingPairings) {
      if (p.deviceName) {
        pending.push({
          pairingCode: code,
          deviceName: p.deviceName,
          platform: p.platform || "unknown",
          requestedAt: p.requestedAt,
        });
      }
    }
    res.json({ devices: data.devices || [], pending });
  } catch (err) {
    console.error("[Pairing] Error listing devices:", err);
    res.status(500).json({ error: "Failed to list devices" });
  }
});

// POST /api/devices/request — Mobile device sends pairing request (with its name/key)
app.post("/api/devices/request", (req, res) => {
  const { pairingCode, deviceName, platform, publicKey } = req.body;
  if (!pairingCode || !deviceName) {
    return res.status(400).json({ error: "pairingCode and deviceName are required" });
  }

  const pending = pendingPairings.get(pairingCode);
  if (!pending) {
    return res.status(404).json({ error: "Invalid or expired pairing code" });
  }
  if (Date.now() > pending.expiresAt) {
    pendingPairings.delete(pairingCode);
    return res.status(410).json({ error: "Pairing code expired" });
  }

  // Update pending entry with device info
  pending.deviceName = deviceName;
  pending.platform = platform || "unknown";
  pending.devicePublicKey = publicKey || null;
  pending.requestedAt = Date.now();

  // Push approval request to dashboard via SSE
  broadcastPairingEvent({
    type: "pairing_request",
    pairingCode,
    deviceName,
    platform: pending.platform,
  });

  console.log(`[Pairing] Device "${deviceName}" requesting approval for ${pairingCode}`);
  res.json({ status: "pending_approval" });
});

// POST /api/devices/approve — Approve a pending pairing
app.post("/api/devices/approve", (req, res) => {
  const { pairingCode } = req.body;
  if (!pairingCode) {
    return res.status(400).json({ error: "pairingCode is required" });
  }

  const pending = pendingPairings.get(pairingCode);
  if (!pending || !pending.deviceName) {
    return res.status(404).json({ error: "No pending request for this code" });
  }

  // Generate device ID and token
  const deviceId = "dev_" + crypto.randomBytes(8).toString("hex");
  const deviceToken = crypto.randomBytes(32).toString("base64url");

  const newDevice = {
    deviceId,
    deviceName: pending.deviceName,
    platform: pending.platform || "unknown",
    publicKey: pending.devicePublicKey || null,
    pairedAt: Date.now(),
    lastSeen: Date.now(),
  };

  // Save to paired-devices.json
  const data = readPairedDevices();
  data.devices.push(newDevice);
  writePairedDevices(data);

  // Clean up pending
  pendingPairings.delete(pairingCode);

  // Notify via SSE
  broadcastPairingEvent({
    type: "pairing_approved",
    pairingCode,
    deviceId,
    deviceToken,
    deviceName: newDevice.deviceName,
  });

  console.log(`[Pairing] Approved device "${newDevice.deviceName}" as ${deviceId}`);
  res.json({ deviceId, deviceToken, deviceName: newDevice.deviceName });
});

// POST /api/devices/deny — Deny a pending pairing
app.post("/api/devices/deny", (req, res) => {
  const { pairingCode } = req.body;
  if (!pairingCode) {
    return res.status(400).json({ error: "pairingCode is required" });
  }

  pendingPairings.delete(pairingCode);
  broadcastPairingEvent({ type: "pairing_denied", pairingCode });

  console.log(`[Pairing] Denied pairing code ${pairingCode}`);
  res.json({ ok: true });
});

// POST /api/devices/:deviceId/revoke — Revoke a paired device
app.post("/api/devices/:deviceId/revoke", (req, res) => {
  const { deviceId } = req.params;
  console.log("[Pairing] Revoking device:", deviceId);

  try {
    const data = readPairedDevices();
    const idx = data.devices.findIndex((d) => d.deviceId === deviceId);
    if (idx === -1) {
      return res.status(404).json({ error: "Device not found" });
    }
    const removed = data.devices.splice(idx, 1)[0];
    writePairedDevices(data);

    broadcastPairingEvent({ type: "device_revoked", deviceId, deviceName: removed.deviceName });
    console.log(`[Pairing] Revoked device "${removed.deviceName}" (${deviceId})`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Pairing] Error revoking device:", err);
    res.status(500).json({ error: "Failed to revoke device" });
  }
});

// Backward-compat: old pairing read endpoint
app.get("/api/settings/pairing", (req, res) => {
  const data = readPairedDevices();
  const pending = [];
  for (const [, p] of pendingPairings) {
    if (p.deviceName)
      pending.push({
        name: p.deviceName,
        publicKey: (p.devicePublicKey || "").slice(0, 12) + "...",
      });
  }
  res.json({
    pending,
    paired: (data.devices || []).map((d) => ({
      id: d.deviceId,
      name: d.deviceName,
      lastSeen: d.lastSeen,
    })),
  });
});

// ============================================
// Gateway endpoints
// ============================================
function readLaunchAgentServiceState({ domain, launchdLabel, port }) {
  let loaded = false;
  let runtimeStatus = "stopped";
  let pid = null;
  try {
    const printOut = execSync(
      `/bin/launchctl print ${domain}/${launchdLabel} 2>/dev/null || true`,
      {
        timeout: 3000,
      },
    )
      .toString()
      .trim();
    loaded = /state = running|state = waiting|state = exited|pid =/i.test(printOut);
  } catch {}
  try {
    const result = execSync(
      `/usr/sbin/lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`,
      {
        timeout: 3000,
      },
    )
      .toString()
      .trim();
    if (result) {
      runtimeStatus = "running";
      pid = Number.parseInt(result.split("\n")[0] || "", 10) || null;
    } else if (loaded) {
      runtimeStatus = "loaded";
    }
  } catch {}
  return {
    loaded,
    status: runtimeStatus,
    pid,
  };
}

function isLaunchctlIgnorableError(detail, mode) {
  const text = String(detail || "");
  if (!text) return false;
  if (mode === "stop") {
    return /could not find service|service not found|no such process/i.test(text);
  }
  if (mode === "start") {
    return /bootstrap failed: 5|service already loaded|input\/output error/i.test(text);
  }
  return false;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveCargoCommand() {
  const candidates = [
    process.env.CARGO,
    path.join(process.env.HOME || "", ".cargo", "bin", "cargo"),
    "/opt/homebrew/bin/cargo",
    "/usr/local/bin/cargo",
    "cargo",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate === "cargo") {
        execFileSync("/usr/bin/env", ["cargo", "--version"], { stdio: "ignore", timeout: 3000 });
        return "cargo";
      }
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

function ensureRustShadowLaunchAgent(service, repoRoot) {
  const rustRoot = path.join(repoRoot, "rust");
  const cargoToml = path.join(rustRoot, "Cargo.toml");
  if (!fs.existsSync(cargoToml)) {
    throw new Error(`Rust workspace missing at ${rustRoot}`);
  }
  const binaryPath = path.join(
    rustRoot,
    "target",
    "debug",
    process.platform === "win32" ? `${service.binary}.exe` : service.binary,
  );
  if (!fs.existsSync(binaryPath)) {
    const cargo = resolveCargoCommand();
    if (!cargo) {
      throw new Error("Cargo is required to build Rust shadow services but was not found");
    }
    const cargoCommand = cargo === "cargo" ? "/usr/bin/env" : cargo;
    const cargoArgs =
      cargo === "cargo"
        ? ["cargo", "build", "-p", service.package]
        : ["build", "-p", service.package];
    execFileSync(cargoCommand, cargoArgs, {
      cwd: rustRoot,
      stdio: "pipe",
      timeout: 120000,
      env: { ...process.env, HOME: process.env.HOME || os.homedir() },
    });
  }
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Rust shadow binary was not produced at ${binaryPath}`);
  }

  const logDir = path.join(process.env.HOME || os.homedir(), ".argent", "logs");
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(path.dirname(service.plistPath), { recursive: true });
  const envLines = Object.entries({
    HOME: process.env.HOME || os.homedir(),
    RUST_BACKTRACE: "1",
    ...(service.env || {}),
  })
    .map(
      ([key, value]) => `
    <key>${xmlEscape(key)}</key>
    <string>${xmlEscape(value)}</string>`,
    )
    .join("");
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(service.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(binaryPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(rustRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>${envLines}
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logDir, `${service.label}.log`))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logDir, `${service.label}.err.log`))}</string>
</dict>
</plist>
`;
  fs.writeFileSync(service.plistPath, plistContent);
  return { binaryPath, rustRoot };
}

app.get("/api/settings/gateway", async (req, res) => {
  const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
  const gatewayPlistPath = path.join(
    process.env.HOME,
    "Library",
    "LaunchAgents",
    "ai.argent.gateway.plist",
  );
  const uid = process.getuid?.() ?? Number.parseInt(execSync("id -u").toString().trim(), 10);
  const domain = `gui/${uid}`;
  const repoRoot = path.resolve(__dirname, "..");
  function readLaunchAgentProgramArgs(plistPath) {
    if (!plistPath || !fs.existsSync(plistPath)) return null;
    try {
      const json = execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const parsed = JSON.parse(json);
      return {
        programArguments: Array.isArray(parsed.ProgramArguments)
          ? parsed.ProgramArguments.filter((item) => typeof item === "string")
          : [],
        workingDirectory:
          typeof parsed.WorkingDirectory === "string" ? parsed.WorkingDirectory.trim() : null,
      };
    } catch {
      return null;
    }
  }
  const services = [
    {
      id: "gateway",
      label: "Gateway",
      launchdLabel: "ai.argent.gateway",
      plistPath: gatewayPlistPath,
      port: 18789,
    },
    {
      id: "dashboard-api",
      label: "Dashboard API",
      launchdLabel: "ai.argent.dashboard-api",
      plistPath: path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.dashboard-api.plist",
      ),
      port: 9242,
    },
    {
      id: "dashboard-ui",
      label: "Dashboard UI",
      launchdLabel: "ai.argent.dashboard-ui",
      plistPath: path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.dashboard-ui.plist",
      ),
      port: 8080,
    },
    {
      id: "redis",
      label: "Redis",
      launchdLabel: "ai.argent.redis",
      plistPath: path.join(process.env.HOME, "Library", "LaunchAgents", "ai.argent.redis.plist"),
      port: 6380,
    },
    {
      id: "curiosity-monitor",
      label: "Curiosity Queue Monitor",
      launchdLabel: "ai.argent.curiosity-monitor",
      plistPath: path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.curiosity-monitor.plist",
      ),
      port: 19427,
      experimental: true,
      url: "http://127.0.0.1:19427/",
      description:
        "Experimental kernel-memory/curiosity dashboard. Not part of the normal chat surface.",
    },
    {
      id: "rust-gateway-shadow",
      label: "Rust Gateway Shadow",
      launchdLabel: "ai.argent.rust-gateway-shadow",
      plistPath: path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.rust-gateway-shadow.plist",
      ),
      port: 18799,
      experimental: true,
      url: "http://127.0.0.1:18799/health",
      description:
        "Read-only Rust gateway shadow daemon. It is observable only and does not own live chat traffic.",
    },
    {
      id: "rust-executive-shadow",
      label: "Rust Executive Shadow",
      launchdLabel: "ai.argent.rust-executive-shadow",
      plistPath: path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.rust-executive-shadow.plist",
      ),
      port: 18809,
      experimental: true,
      url: "http://127.0.0.1:18809/health",
      description:
        "Read-only Rust executive/kernel substrate shadow. It tracks durable state, lanes, ticks, and journal health without replacing the TypeScript kernel.",
    },
  ];
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const gw = config.gateway || {};
    const buildInfo = readRuntimeBuildInfo(repoRoot);

    // Try to check gateway health
    let status = "unknown";
    let version = buildInfo.version;
    let uptime = null;
    const gwPort = gw.port || 18789;
    try {
      // Check if gateway is responding by checking the port
      const result = execSync(
        `/usr/sbin/lsof -nP -iTCP:${gwPort} -sTCP:LISTEN -t 2>/dev/null || echo ""`,
        { timeout: 3000 },
      );
      const pid = result.toString().trim();
      if (pid) {
        status = "running";
        // Try to get uptime from ps
        try {
          const psOut = execSync(`/bin/ps -p ${pid.split("\n")[0]} -o etime= 2>/dev/null`, {
            timeout: 2000,
          });
          uptime = psOut.toString().trim();
        } catch {}
      } else {
        status = "stopped";
      }
    } catch {
      status = "unknown";
    }

    let serviceHasToken = false;
    let serviceTokenPreview = null;
    let launchctlHasToken = false;
    let launchctlTokenPreview = null;
    try {
      if (fs.existsSync(gatewayPlistPath)) {
        const plistRaw = fs.readFileSync(gatewayPlistPath, "utf-8");
        const match = plistRaw.match(
          /<key>ARGENT_GATEWAY_TOKEN<\/key>\s*<string>([^<]+)<\/string>/,
        );
        if (match?.[1]) {
          const token = String(match[1]).trim();
          if (token) {
            serviceHasToken = true;
            serviceTokenPreview = `${token.slice(0, 8)}...`;
          }
        }
      }
    } catch {}

    try {
      const envToken = execSync("/bin/launchctl getenv ARGENT_GATEWAY_TOKEN 2>/dev/null || true", {
        timeout: 2000,
      })
        .toString()
        .trim();
      if (envToken) {
        launchctlHasToken = true;
        launchctlTokenPreview = `${envToken.slice(0, 8)}...`;
      }
    } catch {}

    const authMode = gw.auth?.mode || (serviceHasToken || launchctlHasToken ? "token" : "none");
    const hasToken = !!gw.auth?.token || serviceHasToken || launchctlHasToken;
    const tokenPreview = gw.auth?.token
      ? gw.auth.token.slice(0, 8) + "..."
      : serviceTokenPreview || launchctlTokenPreview;

    const serviceStates = services.map((service) => {
      const launchCommand = readLaunchAgentProgramArgs(service.plistPath);
      const runtime = readLaunchAgentServiceState({
        domain,
        launchdLabel: service.launchdLabel,
        port: service.port,
      });
      return {
        id: service.id,
        label: service.label,
        launchdLabel: service.launchdLabel,
        loaded: runtime.loaded,
        status: runtime.status,
        port: service.port,
        pid: runtime.pid,
        experimental: service.experimental === true,
        url: service.url || null,
        description: service.description || null,
        plistPath: service.plistPath,
        workingDirectory: launchCommand?.workingDirectory || null,
        command: launchCommand?.programArguments?.length ? launchCommand.programArguments : null,
        workspaceMatchesRepo:
          typeof launchCommand?.workingDirectory === "string"
            ? launchCommand.workingDirectory === repoRoot ||
              launchCommand.workingDirectory.startsWith(`${repoRoot}${path.sep}`)
            : null,
      };
    });

    res.json({
      status,
      version,
      commit: buildInfo.commit,
      builtAt: buildInfo.builtAt,
      uptime,
      port: gw.port || 18789,
      mode: gw.mode || "local",
      bind: gw.bind || "loopback",
      auth: {
        mode: authMode,
        hasToken,
        tokenPreview,
        tokenSource: gw.auth?.token
          ? "config"
          : serviceHasToken
            ? "service"
            : launchctlHasToken
              ? "launchctl-env"
              : null,
      },
      tailscale: gw.tailscale || { mode: "off" },
      alwaysOnLoop: {
        enabled: config.alwaysOnLoop?.enabled ?? false,
        dashboardIntegration: config.alwaysOnLoop?.dashboardIntegration ?? false,
      },
      services: serviceStates,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read gateway config", details: err.message });
  }
});

app.patch("/api/settings/gateway", (req, res) => {
  const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!config.gateway) config.gateway = {};

    const allowed = ["port", "mode", "bind"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        config.gateway[key] = req.body[key];
      }
    }
    if (req.body.tailscale) {
      config.gateway.tailscale = { ...config.gateway.tailscale, ...req.body.tailscale };
    }
    if (req.body.alwaysOnLoop !== undefined) {
      if (!config.alwaysOnLoop) config.alwaysOnLoop = {};
      config.alwaysOnLoop = { ...config.alwaysOnLoop, ...req.body.alwaysOnLoop };
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update gateway config", details: err.message });
  }
});

app.post("/api/settings/gateway/regenerate-token", (req, res) => {
  const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!config.gateway) config.gateway = {};
    const newToken = crypto.randomBytes(24).toString("hex");
    if (!config.gateway.auth) config.gateway.auth = {};
    config.gateway.auth.mode = "token";
    config.gateway.auth.token = newToken;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    const cliEntrypoint = path.join(__dirname, "..", "dist", "index.js");
    execFileSync(
      process.execPath,
      [cliEntrypoint, "gateway", "install", "--token", newToken, "--force"],
      { timeout: 30_000, stdio: "pipe" },
    );
    execFileSync(process.execPath, [cliEntrypoint, "gateway", "start"], {
      timeout: 15_000,
      stdio: "pipe",
    });
    res.json({
      ok: true,
      tokenPreview: newToken.slice(0, 8) + "...",
      token: newToken,
      repaired: true,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to regenerate token",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/settings/gateway/restart", (req, res) => {
  try {
    // Use launchctl to restart the LaunchAgent
    execSync("/bin/launchctl kickstart -k gui/$(id -u)/ai.argent.gateway 2>/dev/null || true", {
      timeout: 5000,
    });
    res.json({ ok: true, message: "Gateway restart initiated" });
  } catch (err) {
    res.status(500).json({ error: "Failed to restart gateway", details: err.message });
  }
});

app.post("/api/settings/services/:serviceId/:action", async (req, res) => {
  const uid = process.getuid?.() ?? Number.parseInt(execSync("id -u").toString().trim(), 10);
  const domain = `gui/${uid}`;
  const serviceMap = {
    gateway: {
      label: "ai.argent.gateway",
      plistPath: path.join(process.env.HOME, "Library", "LaunchAgents", "ai.argent.gateway.plist"),
      port: 18789,
    },
    "dashboard-api": {
      label: "ai.argent.dashboard-api",
      plistPath: path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.dashboard-api.plist",
      ),
      port: 9242,
    },
    "dashboard-ui": {
      label: "ai.argent.dashboard-ui",
      plistPath: path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.dashboard-ui.plist",
      ),
      port: 8080,
    },
    redis: {
      label: "ai.argent.redis",
      plistPath: path.join(process.env.HOME, "Library", "LaunchAgents", "ai.argent.redis.plist"),
      port: 6380,
    },
    "curiosity-monitor": {
      label: "ai.argent.curiosity-monitor",
      plistPath: path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.curiosity-monitor.plist",
      ),
      port: 19427,
    },
    "rust-gateway-shadow": {
      label: "ai.argent.rust-gateway-shadow",
      plistPath: path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.rust-gateway-shadow.plist",
      ),
      port: 18799,
      package: "argentd",
      binary: "argentd",
      env: { ARGENTD_BIND: "127.0.0.1:18799" },
      rustShadow: true,
    },
    "rust-executive-shadow": {
      label: "ai.argent.rust-executive-shadow",
      plistPath: path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.rust-executive-shadow.plist",
      ),
      port: 18809,
      package: "argent-execd",
      binary: "argent-execd",
      env: { ARGENT_EXECD_BIND: "127.0.0.1:18809" },
      rustShadow: true,
    },
  };
  const service = serviceMap[req.params.serviceId];
  const action = String(req.params.action || "").trim();
  if (!service) {
    return res.status(404).json({ error: "Unknown service" });
  }
  if (!["start", "stop", "restart"].includes(action)) {
    return res.status(400).json({ error: "Unsupported action" });
  }
  try {
    let launchctlDetail = null;
    const repoRoot = path.resolve(__dirname, "..");
    if (service.rustShadow && (action === "start" || action === "restart")) {
      ensureRustShadowLaunchAgent(service, repoRoot);
    }
    if (action === "start") {
      try {
        execFileSync("/bin/launchctl", ["bootstrap", domain, service.plistPath], {
          stdio: "pipe",
          timeout: 10000,
        });
      } catch (err) {
        launchctlDetail = err instanceof Error ? err.message : String(err);
        if (!isLaunchctlIgnorableError(launchctlDetail, "start")) {
          throw err;
        }
      }
      try {
        execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/${service.label}`], {
          stdio: "pipe",
          timeout: 10000,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        launchctlDetail = launchctlDetail ? `${launchctlDetail}\n${detail}` : detail;
      }
    } else if (action === "stop") {
      try {
        execFileSync("/bin/launchctl", ["bootout", `${domain}/${service.label}`], {
          stdio: "pipe",
          timeout: 10000,
        });
      } catch (err) {
        launchctlDetail = err instanceof Error ? err.message : String(err);
        if (!isLaunchctlIgnorableError(launchctlDetail, "stop")) {
          throw err;
        }
      }
    } else {
      execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/${service.label}`], {
        stdio: "pipe",
        timeout: 10000,
      });
    }

    let verified = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      verified = readLaunchAgentServiceState({
        domain,
        launchdLabel: service.label,
        port: service.port,
      });
      if (action === "stop") {
        if (!verified.loaded && verified.status === "stopped") break;
      } else if (verified.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (
      verified &&
      ((action === "stop" && (verified.loaded || verified.status !== "stopped")) ||
        (action !== "stop" && verified.status !== "running"))
    ) {
      return res.status(500).json({
        error: "Service action did not reach the expected state",
        details: launchctlDetail,
        service: req.params.serviceId,
        action,
        verified,
      });
    }

    return res.json({
      ok: true,
      service: req.params.serviceId,
      action,
      verified,
      details: launchctlDetail,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Service action failed",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================
// Database endpoints
// ============================================
app.get("/api/settings/database", async (req, res) => {
  try {
    const storageTargets = loadStorageTargets();
    const storage = readStorageConfigSummary();
    const [postgresReachable, redisReachable] = await Promise.all([
      checkTcpReachable(storageTargets.postgres.host, storageTargets.postgres.port),
      checkTcpReachable(storageTargets.redis.host, storageTargets.redis.port),
    ]);
    const postgresService = getPostgresServiceState(storageTargets.postgres.port);
    const redisService = (() => {
      try {
        const uid = process.getuid?.() ?? Number.parseInt(execSync("id -u").toString().trim(), 10);
        const domain = `gui/${uid}`;
        const printOut = execSync(
          `/bin/launchctl print ${domain}/ai.argent.redis 2>/dev/null || true`,
          { timeout: 3000 },
        )
          .toString()
          .trim();
        let pid = null;
        try {
          const result = execSync(
            `/usr/sbin/lsof -nP -iTCP:${storageTargets.redis.port} -sTCP:LISTEN -t 2>/dev/null || true`,
            { timeout: 3000 },
          )
            .toString()
            .trim();
          if (result) pid = Number.parseInt(result.split("\n")[0] || "", 10) || null;
        } catch {}
        return {
          service: "ai.argent.redis",
          status: redisReachable
            ? "running"
            : /state = running|state = waiting|pid =/i.test(printOut)
              ? "loaded"
              : "stopped",
          pid,
          reachable: redisReachable,
        };
      } catch {
        return {
          service: "ai.argent.redis",
          status: redisReachable ? "running" : "unknown",
          pid: null,
          reachable: redisReachable,
        };
      }
    })();

    const backups = listDatabaseBackups().slice(0, 8);
    const backupPlistPath = getDatabaseBackupPlistPath();
    const backupScheduleInstalled = fs.existsSync(backupPlistPath);

    res.json({
      storage,
      postgres: {
        host: storageTargets.postgres.host,
        port: storageTargets.postgres.port,
        ...postgresService,
      },
      redis: {
        host: storageTargets.redis.host,
        port: storageTargets.redis.port,
        ...redisService,
      },
      backups,
      backupSchedule: {
        installed: backupScheduleInstalled,
        schedule: backupScheduleInstalled ? "Daily at 2:00 AM" : null,
        retention: backupScheduleInstalled ? "Last 7 backups" : null,
        plistPath: backupScheduleInstalled ? backupPlistPath : null,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to load database settings",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/settings/database/service/:serviceId/:action", (req, res) => {
  const serviceId = String(req.params.serviceId || "").trim();
  const action = String(req.params.action || "").trim();
  if (!["postgres", "redis"].includes(serviceId)) {
    return res.status(404).json({ error: "Unknown database service" });
  }
  if (!["start", "stop", "restart"].includes(action)) {
    return res.status(400).json({ error: "Unsupported action" });
  }

  try {
    if (serviceId === "postgres") {
      const brew = resolveBrewCommand();
      execFileSync(brew, ["services", action, "postgresql@17"], {
        stdio: "pipe",
        timeout: 30000,
      });
    } else {
      const uid = process.getuid?.() ?? Number.parseInt(execSync("id -u").toString().trim(), 10);
      const domain = `gui/${uid}`;
      const label = "ai.argent.redis";
      const plistPath = path.join(
        process.env.HOME,
        "Library",
        "LaunchAgents",
        "ai.argent.redis.plist",
      );
      if (action === "start") {
        execSync(`/bin/launchctl bootstrap ${domain} "${plistPath}" 2>/dev/null || true`, {
          timeout: 10000,
        });
        execSync(`/bin/launchctl kickstart -k ${domain}/${label} 2>/dev/null || true`, {
          timeout: 10000,
        });
      } else if (action === "stop") {
        execSync(`/bin/launchctl bootout ${domain}/${label} 2>/dev/null || true`, {
          timeout: 10000,
        });
      } else {
        execSync(`/bin/launchctl kickstart -k ${domain}/${label} 2>/dev/null || true`, {
          timeout: 10000,
        });
      }
    }
    return res.json({ ok: true, service: serviceId, action });
  } catch (err) {
    return res.status(500).json({
      error: "Database service action failed",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/settings/database/backup", (req, res) => {
  try {
    const storage = readStorageConfigSummary();
    const connectionString = storage.postgresConnectionString;
    if (!connectionString) {
      return res.status(400).json({ error: "No PostgreSQL connection string configured" });
    }
    const backupDir = getDatabaseBackupDir();
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupPath = path.join(backupDir, `argentos-db-backup-${timestamp}.dump`);
    const pgDump = resolvePgDumpCommand();
    execFileSync(pgDump, ["--format=custom", "--file", backupPath, connectionString], {
      stdio: "pipe",
      timeout: 120000,
    });
    const stats = fs.statSync(backupPath);
    res.json({
      ok: true,
      filename: path.basename(backupPath),
      path: backupPath,
      sizeMb: (stats.size / 1024 / 1024).toFixed(1),
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to create database backup",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/api/settings/database/backups", (req, res) => {
  try {
    res.json({ backups: listDatabaseBackups() });
  } catch (err) {
    res.status(500).json({
      error: "Failed to list database backups",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/settings/database/backup/cron", (req, res) => {
  try {
    const storage = readStorageConfigSummary();
    const connectionString = storage.postgresConnectionString;
    if (!connectionString) {
      return res.status(400).json({ error: "No PostgreSQL connection string configured" });
    }
    const backupDir = getDatabaseBackupDir();
    const logPath = getDatabaseBackupLogPath();
    const plistPath = getDatabaseBackupPlistPath();
    fs.mkdirSync(backupDir, { recursive: true });
    const scriptPath = path.join(backupDir, "run-db-backup.sh");
    const pgDump = resolvePgDumpCommand();
    const scriptContent = `#!/bin/bash
BACKUP_DIR="${backupDir}"
CONNECTION_STRING='${connectionString.replace(/'/g, "'\\''")}'
PG_DUMP="${pgDump}"
TIMESTAMP=$(date +%Y-%m-%dT%H-%M-%S)
FILENAME="argentos-db-backup-\${TIMESTAMP}.dump"
mkdir -p "$BACKUP_DIR"
"$PG_DUMP" --format=custom --file "$BACKUP_DIR/$FILENAME" "$CONNECTION_STRING"
ls -t "$BACKUP_DIR"/argentos-db-backup-*.dump 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null
echo "[$(date)] Backup complete: $FILENAME" >> "${logPath}"
`;
    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.argent.database-backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${scriptPath}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>2</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
    try {
      execSync(`/bin/launchctl bootout gui/$(id -u) "${plistPath}" 2>/dev/null || true`, {
        timeout: 5000,
      });
    } catch {}
    fs.writeFileSync(plistPath, plistContent);
    execSync(`/bin/launchctl bootstrap gui/$(id -u) "${plistPath}"`, { timeout: 10000 });
    res.json({
      ok: true,
      schedule: "Daily at 2:00 AM",
      retention: "Last 7 backups",
      plistPath,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to install database backup schedule",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================
// TTS / VOICE SETTINGS API
// ============================================

app.get("/api/settings/tts", (req, res) => {
  try {
    const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw);
    const tts = cfg.messages?.tts || {};
    res.json({
      auto: tts.auto || "off",
      provider: tts.provider || "edge",
      fallbackOrder: tts.fallbackOrder || null,
      elevenlabs: {
        voiceId: tts.elevenlabs?.voiceId || "cgSgspJ2msm6clMCkdW9",
        modelId: tts.elevenlabs?.modelId || "eleven_multilingual_v2",
        voiceSettings: {
          stability: tts.elevenlabs?.voiceSettings?.stability ?? 0.5,
          similarityBoost: tts.elevenlabs?.voiceSettings?.similarityBoost ?? 0.75,
          style: tts.elevenlabs?.voiceSettings?.style ?? 0.0,
          useSpeakerBoost: tts.elevenlabs?.voiceSettings?.useSpeakerBoost ?? true,
          speed: tts.elevenlabs?.voiceSettings?.speed ?? 1.0,
        },
      },
      openai: {
        model: tts.openai?.model || "gpt-4o-mini-tts",
        voice: tts.openai?.voice || "alloy",
      },
    });
  } catch (err) {
    console.error("[TTS] Error reading settings:", err);
    res.status(500).json({ error: "Failed to read TTS settings" });
  }
});

app.post("/api/settings/tts", (req, res) => {
  try {
    const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw);
    if (!cfg.messages) cfg.messages = {};
    if (!cfg.messages.tts) cfg.messages.tts = {};

    const { auto, provider, fallbackOrder, elevenlabs, openai } = req.body;

    if (auto !== undefined) cfg.messages.tts.auto = auto;
    if (provider !== undefined) cfg.messages.tts.provider = provider;
    if (fallbackOrder !== undefined) cfg.messages.tts.fallbackOrder = fallbackOrder;

    if (elevenlabs) {
      if (!cfg.messages.tts.elevenlabs) cfg.messages.tts.elevenlabs = {};
      if (elevenlabs.voiceId !== undefined)
        cfg.messages.tts.elevenlabs.voiceId = elevenlabs.voiceId;
      if (elevenlabs.modelId !== undefined)
        cfg.messages.tts.elevenlabs.modelId = elevenlabs.modelId;
      if (elevenlabs.voiceSettings) {
        if (!cfg.messages.tts.elevenlabs.voiceSettings)
          cfg.messages.tts.elevenlabs.voiceSettings = {};
        const vs = cfg.messages.tts.elevenlabs.voiceSettings;
        const patch = elevenlabs.voiceSettings;
        if (patch.stability !== undefined) vs.stability = patch.stability;
        if (patch.similarityBoost !== undefined) vs.similarityBoost = patch.similarityBoost;
        if (patch.style !== undefined) vs.style = patch.style;
        if (patch.useSpeakerBoost !== undefined) vs.useSpeakerBoost = patch.useSpeakerBoost;
        if (patch.speed !== undefined) vs.speed = patch.speed;
      }
    }

    if (openai) {
      if (!cfg.messages.tts.openai) cfg.messages.tts.openai = {};
      if (openai.model !== undefined) cfg.messages.tts.openai.model = openai.model;
      if (openai.voice !== undefined) cfg.messages.tts.openai.voice = openai.voice;
    }

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    res.json({ ok: true, tts: cfg.messages.tts });
  } catch (err) {
    console.error("[TTS] Error saving settings:", err);
    res.status(500).json({ error: "Failed to save TTS settings" });
  }
});

// ============================================
// LICENSE API - License management
// ============================================

// GET /api/license/key - Get the license key (for marketplace API calls)
app.get("/api/license/key", (req, res) => {
  const argentosDir = path.join(process.env.HOME, ".argentos");

  // Check argent.json first
  try {
    const config = JSON.parse(fs.readFileSync(path.join(argentosDir, "argent.json"), "utf-8"));
    if (config.license?.key) {
      return res.json({ key: config.license.key });
    }
  } catch {
    /* not in argent.json */
  }

  // Fallback to license.json
  try {
    const licenseFile = JSON.parse(
      fs.readFileSync(path.join(argentosDir, "license.json"), "utf-8"),
    );
    if (licenseFile.key) {
      return res.json({ key: licenseFile.key });
    }
  } catch {
    /* no license.json */
  }

  res.json({ key: null });
});

// GET /api/license/status - Get current license status
app.get("/api/license/status", (req, res) => {
  console.log("License status endpoint hit");
  const argentosDir = path.join(process.env.HOME, ".argentos");
  const configPath = path.join(argentosDir, "argent.json");
  const licensePath = path.join(argentosDir, "license.json");

  try {
    // Check argent.json license block first (LicenseManager writes here)
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const license = config.license;
      if (license) {
        return res.json({
          hasLicense: true,
          status: license.cachedStatus || "unknown",
          tier: license.cachedTier || "unknown",
          expiresAt: license.cachedExpiresAt,
          lastValidated: license.lastValidated,
          machineId: license.machineId,
        });
      }
    } catch {
      /* argent.json may not exist or have no license block */
    }

    // Fallback: check standalone license.json (written by infra/license.ts)
    try {
      const licenseFile = JSON.parse(fs.readFileSync(licensePath, "utf-8"));
      if (licenseFile.key && licenseFile.status === "active") {
        return res.json({
          hasLicense: true,
          status: "active",
          tier: licenseFile.tier || "pro",
          lastValidated: licenseFile.validatedAt,
          orgName: licenseFile.companyName,
        });
      }
    } catch {
      /* license.json may not exist */
    }

    res.json({
      hasLicense: false,
      status: "none",
      tier: "free",
    });
  } catch (err) {
    console.error("Error reading license status:", err);
    res.status(500).json({ error: "Failed to read license status" });
  }
});

// POST /api/license/activate - Activate a license key
app.post("/api/license/activate", async (req, res) => {
  console.log("License activation endpoint hit");
  const { key } = req.body;

  if (!key) {
    return res.status(400).json({ error: "License key required" });
  }

  try {
    // Try LicenseManager first (if compiled module exists)
    try {
      const { LicenseManager } = await import("../dist/licensing/manager.js");
      const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      const manager = new LicenseManager({ config });
      const result = await manager.activate(key);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error || "Activation failed",
        });
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      const response = {
        success: true,
        license: {
          status: result.license?.status,
          tier: result.license?.tier,
          expiresAt: result.license?.expiresAt,
        },
      };

      if (result.license?.metadata?.organizationId) {
        response.org = {
          orgId: result.license.metadata.organizationId,
          orgName: result.license.metadata.organizationName || null,
        };
      }

      return res.json(response);
    } catch (importErr) {
      console.log("[License] LicenseManager not available, using direct validation");
    }

    // Fallback: validate directly against marketplace API
    const checkUrl = `https://marketplace.argentos.ai/api/v1/license/check/${encodeURIComponent(key)}`;
    const checkRes = await fetch(checkUrl);
    const checkData = await checkRes.json();

    if (!checkRes.ok || !checkData.valid) {
      return res.status(400).json({
        success: false,
        error: checkData.error || "Invalid license key",
      });
    }

    // Write to license.json
    const licensePath = path.join(process.env.HOME, ".argentos", "license.json");
    const licenseData = {
      key,
      companyName: checkData.orgName || null,
      validatedAt: new Date().toISOString(),
      status: checkData.status || "active",
      tier: checkData.type || "pro",
    };
    fs.writeFileSync(licensePath, JSON.stringify(licenseData, null, 2));

    res.json({
      success: true,
      license: {
        status: licenseData.status,
        tier: licenseData.tier,
      },
      org: checkData.orgName ? { orgName: checkData.orgName } : undefined,
    });
  } catch (err) {
    console.error("Error activating license:", err);
    res.status(500).json({
      success: false,
      error: "Failed to activate license",
      details: err.message,
    });
  }
});

// POST /api/license/validate - Validate current license with server
app.post("/api/license/validate", async (req, res) => {
  console.log("License validation endpoint hit");

  try {
    // Try LicenseManager first
    try {
      const { LicenseManager } = await import("../dist/licensing/manager.js");
      const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      const manager = new LicenseManager({ config });
      const result = await manager.validate();

      if (!result.valid) {
        return res.json({ valid: false, error: result.error || "Validation failed" });
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return res.json({
        valid: true,
        license: {
          status: result.license?.status,
          tier: result.license?.tier,
          expiresAt: result.license?.expiresAt,
        },
      });
    } catch (importErr) {
      console.log("[License] LicenseManager not available, using direct validation");
    }

    // Fallback: validate from license.json against marketplace
    const licensePath = path.join(process.env.HOME, ".argentos", "license.json");
    const licenseFile = JSON.parse(fs.readFileSync(licensePath, "utf-8"));

    if (!licenseFile.key) {
      return res.json({ valid: false, error: "No license key found" });
    }

    const checkUrl = `https://marketplace.argentos.ai/api/v1/license/check/${encodeURIComponent(licenseFile.key)}`;
    const checkRes = await fetch(checkUrl);
    const checkData = await checkRes.json();

    if (!checkRes.ok || !checkData.valid) {
      return res.json({ valid: false, error: checkData.error || "License validation failed" });
    }

    // Update license.json with fresh timestamp
    licenseFile.validatedAt = new Date().toISOString();
    licenseFile.status = checkData.status || "active";
    fs.writeFileSync(licensePath, JSON.stringify(licenseFile, null, 2));

    res.json({
      valid: true,
      license: {
        status: checkData.status || "active",
        tier: checkData.type || "pro",
      },
    });
  } catch (err) {
    console.error("Error validating license:", err);
    res.status(500).json({
      valid: false,
      error: "Failed to validate license",
      details: err.message,
    });
  }
});

// POST /api/license/deactivate - Deactivate current license
app.post("/api/license/deactivate", async (req, res) => {
  console.log("License deactivation endpoint hit");

  try {
    // Try LicenseManager first
    try {
      const { LicenseManager } = await import("../dist/licensing/manager.js");
      const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      const manager = new LicenseManager({ config });
      const result = await manager.deactivate();

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: result.error || "Deactivation failed" });
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return res.json({ success: true });
    } catch (importErr) {
      console.log("[License] LicenseManager not available, using direct deactivation");
    }

    // Fallback: remove license.json
    const licensePath = path.join(process.env.HOME, ".argentos", "license.json");
    try {
      fs.unlinkSync(licensePath);
    } catch {
      /* may not exist */
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error deactivating license:", err);
    res.status(500).json({
      success: false,
      error: "Failed to deactivate license",
      details: err.message,
    });
  }
});

// GET /api/license/machine-id - Get machine ID for license activation
app.get("/api/license/machine-id", async (req, res) => {
  console.log("License machine-id endpoint hit");

  try {
    // Try compiled crypto module first
    try {
      const { getMachineId } = await import("../dist/licensing/crypto.js");
      const machineId = getMachineId();
      return res.json({ machineId });
    } catch {
      /* compiled module not available */
    }

    // Fallback: generate simple machine ID from os info
    const os = require("os");
    const machineId = require("crypto")
      .createHash("sha256")
      .update(`${os.hostname()}-${os.platform()}-${os.arch()}-${os.cpus()[0]?.model || "unknown"}`)
      .digest("hex")
      .slice(0, 32);

    res.json({ machineId });
  } catch (err) {
    console.error("Error getting machine ID:", err);
    res.status(500).json({ error: "Failed to get machine ID" });
  }
});

// ============================================
// ORG API - Organization secret sync
// ============================================

// GET /api/org/status - Get org binding status and sync info
app.get("/api/org/status", async (req, res) => {
  try {
    const { LicenseManager } = await import("../dist/licensing/manager.js");
    const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    const manager = new LicenseManager({ config });
    const license = manager.getCurrentLicense();

    const orgId = license?.metadata?.organizationId;
    const orgName = license?.metadata?.organizationName;

    if (!orgId) {
      return res.json({ bound: false, secretCount: 0 });
    }

    // Count org-synced keys
    const skData = readServiceKeys();
    const orgSyncedCount = (skData.keys || []).filter((k) => k.source === "org-sync").length;

    // Read last sync timestamp if stored
    const syncMetaPath = path.join(process.env.HOME, ".argentos", "org-sync-meta.json");
    let lastSyncAt = null;
    try {
      if (fs.existsSync(syncMetaPath)) {
        const meta = JSON.parse(fs.readFileSync(syncMetaPath, "utf-8"));
        lastSyncAt = meta.lastSyncAt || null;
      }
    } catch {
      // ignore
    }

    res.json({
      bound: true,
      orgId,
      orgName: orgName || null,
      lastSyncAt,
      secretCount: orgSyncedCount,
    });
  } catch (err) {
    console.error("[Org] Error reading org status:", err);
    res.status(500).json({ error: "Failed to read org status" });
  }
});

// POST /api/org/sync-secrets - Trigger org secret sync
app.post("/api/org/sync-secrets", async (req, res) => {
  try {
    const { LicenseManager } = await import("../dist/licensing/manager.js");
    const configPath = path.join(process.env.HOME, ".argentos", "argent.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    const manager = new LicenseManager({ config });
    const result = await manager.syncSecrets();

    // Persist sync timestamp on success
    if (result.synced > 0 || (result.errors.length === 0 && result.skipped >= 0)) {
      const syncMetaPath = path.join(process.env.HOME, ".argentos", "org-sync-meta.json");
      const dir = path.dirname(syncMetaPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        syncMetaPath,
        JSON.stringify({ lastSyncAt: new Date().toISOString() }, null, 2),
        "utf-8",
      );
    }

    res.json({
      success: result.errors.length === 0,
      synced: result.synced,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (err) {
    console.error("[Org] Error syncing secrets:", err);
    res.status(500).json({
      success: false,
      synced: 0,
      skipped: 0,
      errors: [err.message || "Failed to sync secrets"],
    });
  }
});

// ══════════════════════════════════════════════════════════════════
// WORKFLOW MAP APIs — Real family agents + active providers
// ══════════════════════════════════════════════════════════════════

/** GET /api/workflow-map/agents — Real family agents (PG first, filesystem fallback) */
app.get("/api/workflow-map/agents", async (req, res) => {
  try {
    const stateDir = resolveAlignmentStateDir();
    const agentsDir = path.join(stateDir, "agents");
    const SKIP = new Set(["main", "argent", "test", "beta", "dumbo"]);
    const SKIP_PREFIXES = ["test-", "agent-main-subagent-"];

    // Try PG agent family first (source of truth for active agents)
    let pgAgents = [];
    try {
      const familyModule = await getAgentFamilyModule();
      if (familyModule && typeof familyModule.getAgentFamily === "function") {
        const family = await familyModule.getAgentFamily();
        if (family && typeof family.listMembers === "function") {
          const members = await family.listMembers();
          if (Array.isArray(members)) {
            pgAgents = members
              .filter((row) => {
                const id = String(row?.id || "").trim();
                if (!id || SKIP.has(id)) return false;
                if (SKIP_PREFIXES.some((p) => id.startsWith(p))) return false;
                return true;
              })
              .map((row) => ({
                id: String(row.id).trim(),
                name: String(row.name || row.id).trim(),
                role: String(row.role || "Agent"),
                team: String(row.department || row.team || ""),
                color: String(row.color || ""),
                status: String(row.status || "idle"),
              }));
          }
        }
      }
    } catch (err) {
      console.warn("[WorkflowMap] PG agent family unavailable:", err?.message);
    }

    // If PG returned agents, enrich with IDENTITY.md data
    if (pgAgents.length > 0) {
      for (const agent of pgAgents) {
        const identityPath = path.join(agentsDir, agent.id, "agent", "IDENTITY.md");
        try {
          if (fs.existsSync(identityPath)) {
            const content = fs.readFileSync(identityPath, "utf-8");
            const roleMatch = content.match(/\*\*Role:\*\*\s*(.+)/i);
            const teamMatch = content.match(/\*\*Team:\*\*\s*(.+)/i);
            const colorMatch = content.match(/\*\*Color:\*\*\s*(#[0-9a-fA-F]{6})/i);
            if (roleMatch && !agent.role) agent.role = roleMatch[1].trim().replace(/_/g, " ");
            if (teamMatch && !agent.team) agent.team = teamMatch[1].trim();
            if (colorMatch && !agent.color) agent.color = colorMatch[1].trim();
          }
        } catch {}
      }
      return res.json({ agents: pgAgents, defaultId: "argent", source: "pg" });
    }

    // Fallback: filesystem scan
    if (!fs.existsSync(agentsDir)) return res.json({ agents: [], source: "empty" });
    const entries = fs.readdirSync(agentsDir).filter((name) => {
      if (!name || name.startsWith(".") || name.startsWith("agent-main-subagent-")) return false;
      if (SKIP.has(name)) return false;
      const agentDir = path.join(agentsDir, name, "agent");
      return fs.existsSync(agentDir) && fs.statSync(agentDir).isDirectory();
    });

    const agents = entries.map((id) => {
      const identityPath = path.join(agentsDir, id, "agent", "IDENTITY.md");
      let name = id;
      let role = "Agent";
      let team = "";
      let color = "";
      try {
        if (fs.existsSync(identityPath)) {
          const content = fs.readFileSync(identityPath, "utf-8");
          const nameMatch = content.match(/\*\*Name:\*\*\s*(.+)/i);
          const roleMatch = content.match(/\*\*Role:\*\*\s*(.+)/i);
          const teamMatch = content.match(/\*\*Team:\*\*\s*(.+)/i);
          const colorMatch = content.match(/\*\*Color:\*\*\s*(#[0-9a-fA-F]{6})/i);
          if (nameMatch) name = nameMatch[1].trim();
          if (roleMatch) role = roleMatch[1].trim().replace(/_/g, " ");
          if (teamMatch) team = teamMatch[1].trim();
          if (colorMatch) color = colorMatch[1].trim();
        }
      } catch {}
      return { id, name, role, team, color, status: "idle" };
    });

    res.json({ agents, defaultId: "argent", source: "filesystem" });
  } catch (err) {
    console.error("[WorkflowMap] Error reading agents:", err);
    res.status(500).json({ error: "Failed to read agents" });
  }
});

/** GET /api/workflow-map/providers — Active providers from auth-profiles */
app.get("/api/workflow-map/providers", (req, res) => {
  try {
    const data = readAuthProfiles();
    const allKeys = Object.keys(data.profiles || {});
    const lastGood = data.lastGood || {};

    const providerMap = {};
    for (const key of allKeys) {
      const profile = data.profiles[key];
      const provId = (profile.provider || key.split(":")[0]).toLowerCase();
      if (!provId) continue;
      const isLastGood = Object.values(lastGood).includes(key);
      if (!providerMap[provId] || (isLastGood && providerMap[provId].status !== "active")) {
        providerMap[provId] = {
          id: provId,
          name: provId.charAt(0).toUpperCase() + provId.slice(1),
          key: key,
          type: profile.type || "api_key",
          status: isLastGood ? "active" : "standby",
        };
      }
    }

    res.json({ providers: Object.values(providerMap) });
  } catch (err) {
    console.error("[WorkflowMap] Error reading providers:", err);
    res.status(500).json({ error: "Failed to read providers" });
  }
});

// Sentry Express error handler (must be after all routes)
if (Sentry) {
  Sentry.setupExpressErrorHandler(app);
}

// Export for testing — when required as a module, don't auto-listen
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);

    // ============================================
    // Task Scheduler - checks for due tasks every 30s
    // ============================================
    setInterval(async () => {
      try {
        await runSchedulerTick();
      } catch (err) {
        console.error("[Scheduler] Error checking due tasks:", err.message);
      }
    }, 30000);

    if (tasksDb) {
      console.log("[Scheduler] Task scheduler started (30s interval)");
    } else {
      console.log("[Scheduler] Legacy SQLite scheduler disabled (quarantined)");
    }
  });
} else {
  module.exports = {
    app,
    __test: {
      setPgSqlClientForTests,
      runSchedulerTick,
      getStorageInfo() {
        return {
          backend: STORAGE_BACKEND,
          legacySqliteQuarantined: LEGACY_SQLITE_QUARANTINED,
          appsDbPath: appsDb?.DB_PATH || null,
          widgetsDbPath: widgetsDb?.DB_PATH || null,
          hasTasksSchedulerMethods: Boolean(tasksDb?.getScheduledTasksDue),
        };
      },
    },
  };
}
