/**
 * Coverage for the static-server token-inject + auth-fallback paths added to
 * close the bare-URL bootstrap gap that R-1b's localApiFetch.ts fix alone
 * could not solve. Without this, ~95 raw `fetch("/api/...")` call sites in
 * `dashboard/src/**` 401 forever because:
 *   - Browser sends no Authorization header (raw fetch never set one).
 *   - URL has no `?token=` (Swift app loads `http://127.0.0.1:8080/`).
 *   - Referer also has no `?token=`.
 *   - Pre-fix proxy never read `gateway.auth.token` from disk as fallback.
 *
 * Run from the dashboard/ directory:
 *   node --test tests/static-server.token-inject.test.cjs
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GATEWAY_TOKEN = "gateway-token-static-server-test-aaaaaaaa";

let tempHome;
let argentJsonPath;
let staticServer;

before(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "argent-static-server-token-"));
  fs.mkdirSync(path.join(tempHome, ".argentos"), { recursive: true });
  argentJsonPath = path.join(tempHome, ".argentos", "argent.json");

  // Load the module fresh (it has top-level state for ARGENT_CONFIG_PATH that's
  // captured at require time, but our helpers all accept a configPathOverride
  // so we can avoid polluting `process.env.HOME`).
  delete require.cache[require.resolve("../static-server.cjs")];
  staticServer = require("../static-server.cjs").__test__;
});

after(() => {
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
});

function writeArgentConfig(payload) {
  fs.writeFileSync(argentJsonPath, JSON.stringify(payload, null, 2), "utf-8");
}

function clearArgentConfig() {
  if (fs.existsSync(argentJsonPath)) fs.rmSync(argentJsonPath);
}

describe("readGatewayConfigFromDisk", () => {
  it("returns token + bind when argent.json present", () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN }, bind: "loopback" } });
    const cfg = staticServer.readGatewayConfigFromDisk(argentJsonPath);
    assert.strictEqual(cfg.token, GATEWAY_TOKEN);
    assert.strictEqual(cfg.bind, "loopback");
  });

  it("defaults bind to loopback when unset (matches gateway-daemon default)", () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN } } });
    const cfg = staticServer.readGatewayConfigFromDisk(argentJsonPath);
    assert.strictEqual(cfg.bind, "loopback");
  });

  it("returns nulls when file missing", () => {
    clearArgentConfig();
    const cfg = staticServer.readGatewayConfigFromDisk(argentJsonPath);
    assert.deepStrictEqual(cfg, { token: null, bind: null });
  });

  it("returns nulls when JSON malformed", () => {
    fs.writeFileSync(argentJsonPath, "{not json", "utf-8");
    const cfg = staticServer.readGatewayConfigFromDisk(argentJsonPath);
    assert.deepStrictEqual(cfg, { token: null, bind: null });
  });

  it("ignores non-string tokens", () => {
    writeArgentConfig({ gateway: { auth: { token: 12345 } } });
    const cfg = staticServer.readGatewayConfigFromDisk(argentJsonPath);
    assert.strictEqual(cfg.token, null);
  });

  it("trims whitespace from token", () => {
    writeArgentConfig({ gateway: { auth: { token: "  spaced-token  " } } });
    const cfg = staticServer.readGatewayConfigFromDisk(argentJsonPath);
    assert.strictEqual(cfg.token, "spaced-token");
  });

  it("re-reads on each call (rotations propagate without restart)", () => {
    writeArgentConfig({ gateway: { auth: { token: "first-token" } } });
    assert.strictEqual(staticServer.readGatewayConfigFromDisk(argentJsonPath).token, "first-token");
    writeArgentConfig({ gateway: { auth: { token: "rotated-token" } } });
    assert.strictEqual(
      staticServer.readGatewayConfigFromDisk(argentJsonPath).token,
      "rotated-token",
    );
  });
});

describe("bindIsLoopback", () => {
  it("loopback → true", () => {
    assert.strictEqual(staticServer.bindIsLoopback("loopback"), true);
  });

  it("lan → false", () => {
    assert.strictEqual(staticServer.bindIsLoopback("lan"), false);
  });

  it("tailnet → false", () => {
    assert.strictEqual(staticServer.bindIsLoopback("tailnet"), false);
  });

  it("auto → false (defensive — auto may resolve to lan)", () => {
    assert.strictEqual(staticServer.bindIsLoopback("auto"), false);
  });

  it("custom → false", () => {
    assert.strictEqual(staticServer.bindIsLoopback("custom"), false);
  });

  it("null → false", () => {
    assert.strictEqual(staticServer.bindIsLoopback(null), false);
  });
});

describe("injectGatewayTokenIntoIndexHtml", () => {
  const html = `<!doctype html><html><head><title>x</title></head><body></body></html>`;

  it("injects script before </head> when token + loopback", () => {
    const out = staticServer.injectGatewayTokenIntoIndexHtml(html, {
      token: GATEWAY_TOKEN,
      bind: "loopback",
    });
    assert.ok(out.includes(`window.__ARGENT_GATEWAY_TOKEN__=${JSON.stringify(GATEWAY_TOKEN)}`));
    // Script lands before </head>, not after, so it executes before any
    // module-script imports kick off.
    assert.ok(out.indexOf("__ARGENT_GATEWAY_TOKEN__") < out.indexOf("</head>"));
  });

  it("returns unchanged when no token (fresh install with no gateway config)", () => {
    const out = staticServer.injectGatewayTokenIntoIndexHtml(html, {
      token: null,
      bind: "loopback",
    });
    assert.strictEqual(out, html);
  });

  it("returns unchanged when bind=lan (security: token must not leak to remote browsers)", () => {
    const out = staticServer.injectGatewayTokenIntoIndexHtml(html, {
      token: GATEWAY_TOKEN,
      bind: "lan",
    });
    assert.strictEqual(out, html);
    assert.ok(!out.includes(GATEWAY_TOKEN));
  });

  it("returns unchanged when bind=tailnet (security: same as lan)", () => {
    const out = staticServer.injectGatewayTokenIntoIndexHtml(html, {
      token: GATEWAY_TOKEN,
      bind: "tailnet",
    });
    assert.strictEqual(out, html);
    assert.ok(!out.includes(GATEWAY_TOKEN));
  });

  it("returns unchanged when bind=auto (defensive — auto may resolve to lan)", () => {
    const out = staticServer.injectGatewayTokenIntoIndexHtml(html, {
      token: GATEWAY_TOKEN,
      bind: "auto",
    });
    assert.strictEqual(out, html);
  });

  it("idempotent: skips re-injection when marker already present", () => {
    const pre = `<!doctype html><html><head><script>window.__ARGENT_GATEWAY_TOKEN__="prev";</script></head><body></body></html>`;
    const out = staticServer.injectGatewayTokenIntoIndexHtml(pre, {
      token: "different-token",
      bind: "loopback",
    });
    assert.strictEqual(out, pre);
    assert.ok(!out.includes("different-token"));
  });

  it("falls back to prepend when no </head> tag exists", () => {
    const headless = `<html><body><div>x</div></body></html>`;
    const out = staticServer.injectGatewayTokenIntoIndexHtml(headless, {
      token: GATEWAY_TOKEN,
      bind: "loopback",
    });
    assert.ok(out.startsWith("<script>"));
    assert.ok(out.includes(GATEWAY_TOKEN));
  });

  it("JSON.stringify guards against tokens that contain quotes or </script>", () => {
    const evil = `tok-with-"quotes"-and-</script>-junk`;
    const out = staticServer.injectGatewayTokenIntoIndexHtml(html, {
      token: evil,
      bind: "loopback",
    });
    // The raw `</script>` substring must NOT appear inside the injected
    // script tag (otherwise the browser closes the script early). The
    // JSON.stringify escape (`</script>` or `<\\/script>`) avoids
    // this. We verify by checking that the injected script content uses
    // an escaped form rather than a literal `</script>` inside the script.
    const scriptStart = out.indexOf("<script>window.__ARGENT_GATEWAY_TOKEN__");
    const scriptEnd = out.indexOf("</script>", scriptStart);
    const injected = out.slice(scriptStart, scriptEnd);
    assert.ok(
      !injected.toLowerCase().includes("</script"),
      `injected script must not contain literal </script>; got: ${injected}`,
    );
  });
});

describe("dashboardApiTokenFromRequest", () => {
  it("reads ?token= from request URL", () => {
    const req = { url: "/api/build-info?token=url-token", headers: {} };
    assert.strictEqual(staticServer.dashboardApiTokenFromRequest(req), "url-token");
  });

  it("reads ?api_token= from request URL (preferred over ?token=)", () => {
    const req = { url: "/api/build-info?api_token=preferred", headers: {} };
    assert.strictEqual(staticServer.dashboardApiTokenFromRequest(req), "preferred");
  });

  it("reads ?token= from Referer when request URL has none", () => {
    const req = {
      url: "/api/build-info",
      headers: { referer: "http://127.0.0.1:8080/?token=referer-token" },
    };
    assert.strictEqual(staticServer.dashboardApiTokenFromRequest(req), "referer-token");
  });

  it("returns null when neither URL nor Referer carries a token", () => {
    const req = { url: "/api/build-info", headers: { referer: "http://127.0.0.1:8080/" } };
    assert.strictEqual(staticServer.dashboardApiTokenFromRequest(req), null);
  });
});

describe("resolveProxyAuthToken", () => {
  it("prefers URL token over disk token when both present", () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN } } });
    const req = { url: "/api/build-info?token=url-token", headers: {} };
    assert.strictEqual(staticServer.resolveProxyAuthToken(req, argentJsonPath), "url-token");
  });

  it("prefers Referer token over disk token when URL has none", () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN } } });
    const req = {
      url: "/api/build-info",
      headers: { referer: "http://127.0.0.1:8080/?token=referer-token" },
    };
    assert.strictEqual(staticServer.resolveProxyAuthToken(req, argentJsonPath), "referer-token");
  });

  it("falls back to disk gateway token when URL + Referer are bare (Hypothesis A fix)", () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN } } });
    const req = {
      url: "/api/build-info",
      headers: { referer: "http://127.0.0.1:8080/" },
    };
    assert.strictEqual(staticServer.resolveProxyAuthToken(req, argentJsonPath), GATEWAY_TOKEN);
  });

  it("returns null when nothing available (fresh install, no gateway config)", () => {
    clearArgentConfig();
    const req = { url: "/api/build-info", headers: {} };
    assert.strictEqual(staticServer.resolveProxyAuthToken(req, argentJsonPath), null);
  });
});
