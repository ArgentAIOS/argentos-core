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

// ============================================================================
// Mid-rotation correctness — the core regression this PR fixes.
// ============================================================================
//
// Before this PR: api-server read `gateway.auth.token` ONCE at module load via
// an IIFE and held the value in `ACCEPTED_TOKENS` forever. When any code path
// rewrote `gateway.auth.token` in `~/.argentos/argent.json` (e.g. `argent
// update`, the wizard, or `src/browser/control-auth.ts`'s auto-gen), the
// gateway WS path picked up the new token (per-connect re-read shipped in
// PR #130 / `f2ae17a0`) but this api-server kept rejecting requests carrying
// the new token until the daemon was restarted. Today's confirmed cure was:
//
//     launchctl kickstart -k gui/$UID/ai.argent.dashboard-api
//
// The drift class is now extinct because `resolveAcceptedTokens()` reads
// argent.json fresh on every request. These tests pin that behavior.
//
// Use synthetic test tokens — never any real secret. The fixture writes
// directly to the sandbox argent.json (created in the `before` block above),
// not the developer's real config.
const ROTATED_TOKEN = "rotated-gateway-token-ddddddddddddddddd";

describe("Dashboard API auth gate — mid-rotation correctness", () => {
  // Each test in this block mutates the sandbox argent.json. We restore the
  // ORIGINAL gateway token (GATEWAY_TOKEN) after each one so the regression
  // sweep above keeps passing if these run interleaved or after a re-order.
  // (node:test runs `before`/`after` per `describe`, but the shared `server`
  // is started once in the file-level `before`, so we manage the file state
  // by hand here.)
  function writeArgentJson(tokenValue) {
    fs.writeFileSync(
      path.join(tempHome, ".argentos", "argent.json"),
      JSON.stringify(
        {
          distribution: { surfaceProfile: "full" },
          gateway: { auth: { token: tokenValue } },
        },
        null,
        2,
      ),
      "utf-8",
    );
  }

  it("accepts a freshly-rotated token without restarting api-server", async () => {
    // Sanity: the original token authenticates before rotation.
    const beforeRotation = await get(GATEWAY_TOKEN);
    assert.notStrictEqual(beforeRotation, 401, "GATEWAY_TOKEN should authenticate pre-rotation");

    // Simulate `argent update` (or any rewrite) writing a new gateway token.
    writeArgentJson(ROTATED_TOKEN);

    // The rotated token must be accepted on the very next request — no
    // process restart, no kickstart, no reload signal.
    const afterRotation = await get(ROTATED_TOKEN);
    assert.notStrictEqual(
      afterRotation,
      401,
      "Rotated gateway.auth.token must authenticate without restarting api-server",
    );

    // Restore for downstream tests.
    writeArgentJson(GATEWAY_TOKEN);
  });

  it("rejects the stale pre-rotation token after rotation", async () => {
    writeArgentJson(ROTATED_TOKEN);
    try {
      // The OLD gateway token (GATEWAY_TOKEN) must NOT authenticate after
      // rotation — the per-request resolver picks up the new value, and a
      // request still carrying the old value should 401.
      const status = await get(GATEWAY_TOKEN);
      assert.strictEqual(
        status,
        401,
        "Stale pre-rotation gateway token must be rejected after argent.json is rewritten",
      );

      // DASHBOARD_API_TOKEN remains valid — only the gateway slot rotated.
      const dashStatus = await get(DASHBOARD_TOKEN);
      assert.notStrictEqual(
        dashStatus,
        401,
        "DASHBOARD_API_TOKEN must keep authenticating across gateway-token rotations",
      );
    } finally {
      writeArgentJson(GATEWAY_TOKEN);
    }
  });

  it("recovers gracefully if argent.json is briefly unparseable", async () => {
    // Mid-rewrite, a config file may briefly contain partial/corrupt JSON.
    // The resolver returns null for the gateway slot rather than throwing,
    // so DASHBOARD_API_TOKEN should still authenticate (and a request with
    // the gateway-only token should 401, not crash the process).
    fs.writeFileSync(
      path.join(tempHome, ".argentos", "argent.json"),
      "{ this is not valid json",
      "utf-8",
    );
    try {
      const dashStatus = await get(DASHBOARD_TOKEN);
      assert.notStrictEqual(
        dashStatus,
        401,
        "DASHBOARD_API_TOKEN must keep authenticating even when argent.json is mid-rewrite",
      );
      const gwStatus = await get(GATEWAY_TOKEN);
      assert.strictEqual(
        gwStatus,
        401,
        "Old gateway token must be rejected when argent.json is unparseable (resolver returns null safely)",
      );
    } finally {
      writeArgentJson(GATEWAY_TOKEN);
    }
  });

  it("survives 100 sequential authed requests in reasonable time (smoke)", async () => {
    // Per-request disk reads are cheap on loopback (one stat + one tiny
    // JSON.parse). This is a smoke check that we haven't introduced a
    // pathological cost — not a strict performance bound.
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      const status = await get(GATEWAY_TOKEN, "/api/health");
      // /api/health is in the no-auth allowlist; we hit it for the per-
      // request middleware overhead measurement. Status will be 200.
      assert.strictEqual(status, 200);
    }
    const elapsed = Date.now() - start;
    // A very generous bound — 5s for 100 in-process requests would already
    // indicate a serious regression. Real numbers are typically <500ms.
    assert.ok(
      elapsed < 5000,
      `100 requests took ${elapsed}ms — per-request resolver may have a perf regression`,
    );
  });
});
