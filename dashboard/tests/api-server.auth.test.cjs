/**
 * Auth-gate coverage for the dashboard API server.
 *
 * Verifies the unified-token gate re-applied from commit eb93ca3b:
 * - DASHBOARD_API_TOKEN env var authenticates.
 * - gateway.auth.token from argent.json authenticates.
 * - A random third token is rejected.
 *
 * Run from the dashboard/ directory:
 *   node --test tests/api-server.auth.test.cjs
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DASHBOARD_TOKEN = "dashboard-env-token-aaaaaaaaaaaaaaaaaa";
const GATEWAY_TOKEN = "gateway-config-token-bbbbbbbbbbbbbbbbbb";
const RANDOM_TOKEN = "totally-unrelated-third-cccccccccccccccccc";

let baseUrl;
let server;
let tempHome;
let prevHome;
let prevDashboardToken;
let prevApiPort;

before(async () => {
  // Stage a sandbox HOME so api-server.cjs reads our argent.json instead of
  // the developer's real config. ARGENT_CONFIG_PATH is built from HOME at
  // module load time, so HOME must be set BEFORE require().
  prevHome = process.env.HOME;
  prevDashboardToken = process.env.DASHBOARD_API_TOKEN;
  prevApiPort = process.env.API_PORT;

  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "argent-api-server-auth-"));
  fs.mkdirSync(path.join(tempHome, ".argentos"), { recursive: true });
  fs.writeFileSync(
    path.join(tempHome, ".argentos", "argent.json"),
    JSON.stringify({ gateway: { auth: { token: GATEWAY_TOKEN } } }, null, 2),
    "utf-8",
  );

  process.env.HOME = tempHome;
  process.env.DASHBOARD_API_TOKEN = DASHBOARD_TOKEN;
  process.env.API_PORT = "0";

  // Drop the require cache so api-server.cjs re-evaluates with our env+config.
  // (Safe in this test process — no other code under test depends on a stale
  // copy of the module.)
  for (const cached of Object.keys(require.cache)) {
    if (cached.includes(`${path.sep}dashboard${path.sep}api-server.cjs`)) {
      delete require.cache[cached];
    }
  }
  const { app } = require("../api-server.cjs");
  server = app.listen(0);
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  if (server) {
    server.close();
  }
  if (prevHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = prevHome;
  }
  if (prevDashboardToken === undefined) {
    delete process.env.DASHBOARD_API_TOKEN;
  } else {
    process.env.DASHBOARD_API_TOKEN = prevDashboardToken;
  }
  if (prevApiPort === undefined) {
    delete process.env.API_PORT;
  } else {
    process.env.API_PORT = prevApiPort;
  }
  if (tempHome) {
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

async function get(token) {
  const headers = {};
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
  // /api/tasks is a normal protected route (not on the skip list).
  const res = await fetch(`${baseUrl}/api/tasks`, { headers });
  return res.status;
}

describe("Dashboard API auth gate (unified token)", () => {
  it("rejects requests with no token", async () => {
    const status = await get(null);
    assert.strictEqual(status, 401);
  });

  it("authenticates the DASHBOARD_API_TOKEN env-var token", async () => {
    const status = await get(DASHBOARD_TOKEN);
    assert.notStrictEqual(status, 401, "DASHBOARD_API_TOKEN must authenticate");
  });

  it("authenticates the gateway.auth.token from argent.json", async () => {
    const status = await get(GATEWAY_TOKEN);
    assert.notStrictEqual(
      status,
      401,
      "gateway.auth.token must authenticate (re-applied from commit eb93ca3b)",
    );
  });

  it("rejects an unrelated third token", async () => {
    const status = await get(RANDOM_TOKEN);
    assert.strictEqual(status, 401);
  });

  it("/api/health remains accessible without a token (health-check skip list)", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
  });
});
