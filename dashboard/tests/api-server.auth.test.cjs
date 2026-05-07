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
    // surfaceProfile: "full" mirrors a real Full install. Without it, the
    // public-core route-blocking gate runs BEFORE the auth gate and 403s
    // a handful of routes (e.g. /api/settings/intent), which would mask
    // auth-gate behaviour in the regression sweep below.
    JSON.stringify(
      {
        distribution: { surfaceProfile: "full" },
        gateway: { auth: { token: GATEWAY_TOKEN } },
      },
      null,
      2,
    ),
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

async function get(token, path = "/api/tasks") {
  const headers = {};
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl}${path}`, { headers });
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

// Cross-endpoint regression coverage — the bug surfaced after PR #148 was that
// "every /api/* REST call returns 401". This sweep proves the auth gate
// passes the gateway-auth-token chain across a wide swath of the affected
// endpoint list (build-info, score, stats, widgets, upcoming, tasks, apps,
// jobs, raw-config, documents, load-profile, nudges, USER.md, projects,
// settings/agent, settings/auth-profiles, settings/service-keys,
// settings/available-models, settings/intent, settings/knowledge/collections,
// settings/alignment, settings/gateway, calendar/accounts) AND the new
// PR #148 Composio endpoints. If the gateway-token chain ever regresses
// across any of these, this test will catch it.
const REGRESSION_ENDPOINTS = [
  "/api/build-info",
  "/api/score",
  "/api/stats",
  "/api/widgets",
  "/api/upcoming",
  "/api/tasks",
  "/api/apps",
  "/api/jobs",
  "/api/raw-config",
  "/api/documents",
  "/api/load-profile",
  "/api/nudges",
  "/api/USER.md",
  "/api/projects",
  "/api/settings/agent",
  "/api/settings/auth-profiles",
  "/api/settings/service-keys",
  "/api/settings/available-models",
  "/api/settings/intent",
  "/api/settings/knowledge/collections",
  "/api/settings/alignment",
  "/api/settings/gateway",
  "/api/calendar/accounts",
  // PR #148 Composio surface — must remain auth-gated, not bypass.
  "/api/connectors/composio/status",
];

describe("Dashboard API auth gate — cross-endpoint regression sweep", () => {
  for (const endpoint of REGRESSION_ENDPOINTS) {
    it(`${endpoint}: rejects request with no token`, async () => {
      const status = await get(null, endpoint);
      assert.strictEqual(status, 401, `${endpoint} must reject no-token requests`);
    });

    it(`${endpoint}: accepts gateway.auth.token`, async () => {
      const status = await get(GATEWAY_TOKEN, endpoint);
      assert.notStrictEqual(
        status,
        401,
        `${endpoint} must accept the gateway-auth-token chain (PR #148 regression sentinel)`,
      );
    });

    it(`${endpoint}: accepts DASHBOARD_API_TOKEN`, async () => {
      const status = await get(DASHBOARD_TOKEN, endpoint);
      assert.notStrictEqual(status, 401, `${endpoint} must accept DASHBOARD_API_TOKEN`);
    });
  }
});
