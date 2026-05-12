/**
 * Coverage for the gateway-side proxy + token-inject helpers used by
 * `server-http.ts` (port 18789 `/api/*` proxy) and `control-ui.ts` (port
 * 18789 HTML token injection).
 *
 * Mirrors `dashboard/tests/static-server.token-inject.test.cjs` from R-1c's
 * PR #161 (port 8080 fix) but on the gateway path. See GH #162 for context.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindIsLoopback,
  dashboardApiTokenFromRequest,
  injectGatewayTokenIntoIndexHtml,
  proxyApiRequest,
  readGatewayConfigFromDisk,
  resolveProxyAuthToken,
} from "./gateway-proxy-token.js";

const GATEWAY_TOKEN = "gateway-token-server-http-test-aaaaaaaa";

let tempHome: string;
let argentJsonPath: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "argent-gateway-token-"));
  fs.mkdirSync(path.join(tempHome, ".argentos"), { recursive: true });
  argentJsonPath = path.join(tempHome, ".argentos", "argent.json");
});

afterEach(() => {
  if (tempHome) {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

function writeArgentConfig(payload: unknown) {
  fs.writeFileSync(argentJsonPath, JSON.stringify(payload, null, 2), "utf-8");
}

function clearArgentConfig() {
  if (fs.existsSync(argentJsonPath)) {
    fs.rmSync(argentJsonPath);
  }
}

describe("readGatewayConfigFromDisk", () => {
  it("returns token + bind when argent.json present", () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN }, bind: "loopback" } });
    expect(readGatewayConfigFromDisk(argentJsonPath)).toEqual({
      token: GATEWAY_TOKEN,
      bind: "loopback",
    });
  });

  it("defaults bind to loopback when unset (matches gateway-daemon default)", () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN } } });
    expect(readGatewayConfigFromDisk(argentJsonPath).bind).toBe("loopback");
  });

  it("returns nulls when file missing", () => {
    clearArgentConfig();
    expect(readGatewayConfigFromDisk(argentJsonPath)).toEqual({ token: null, bind: null });
  });

  it("returns nulls when JSON malformed", () => {
    fs.writeFileSync(argentJsonPath, "{not json", "utf-8");
    expect(readGatewayConfigFromDisk(argentJsonPath)).toEqual({ token: null, bind: null });
  });

  it("ignores non-string tokens", () => {
    writeArgentConfig({ gateway: { auth: { token: 12345 } } });
    expect(readGatewayConfigFromDisk(argentJsonPath).token).toBeNull();
  });

  it("trims whitespace from token", () => {
    writeArgentConfig({ gateway: { auth: { token: "  spaced-token  " } } });
    expect(readGatewayConfigFromDisk(argentJsonPath).token).toBe("spaced-token");
  });

  it("re-reads on each call (rotations propagate without restart)", () => {
    writeArgentConfig({ gateway: { auth: { token: "first-token" } } });
    expect(readGatewayConfigFromDisk(argentJsonPath).token).toBe("first-token");
    writeArgentConfig({ gateway: { auth: { token: "rotated-token" } } });
    expect(readGatewayConfigFromDisk(argentJsonPath).token).toBe("rotated-token");
  });
});

describe("bindIsLoopback", () => {
  it.each([
    ["loopback", true],
    ["lan", false],
    ["tailnet", false],
    ["auto", false],
    ["custom", false],
    [null, false],
    [undefined, false],
  ] as const)("bind=%s → %s", (bind, expected) => {
    expect(bindIsLoopback(bind)).toBe(expected);
  });
});

describe("injectGatewayTokenIntoIndexHtml", () => {
  const html = `<!doctype html><html><head><title>x</title></head><body></body></html>`;

  it("injects script before </head> when token + loopback", () => {
    const out = injectGatewayTokenIntoIndexHtml(html, {
      token: GATEWAY_TOKEN,
      bind: "loopback",
    });
    expect(out).toContain(`window.__ARGENT_GATEWAY_TOKEN__=${JSON.stringify(GATEWAY_TOKEN)}`);
    expect(out.indexOf("__ARGENT_GATEWAY_TOKEN__")).toBeLessThan(out.indexOf("</head>"));
  });

  it("returns unchanged when no token (fresh install)", () => {
    expect(injectGatewayTokenIntoIndexHtml(html, { token: null, bind: "loopback" })).toBe(html);
  });

  it("returns unchanged when bind=lan (security: no leak to remote browsers)", () => {
    const out = injectGatewayTokenIntoIndexHtml(html, { token: GATEWAY_TOKEN, bind: "lan" });
    expect(out).toBe(html);
    expect(out).not.toContain(GATEWAY_TOKEN);
  });

  it("returns unchanged when bind=tailnet (security: same as lan)", () => {
    const out = injectGatewayTokenIntoIndexHtml(html, { token: GATEWAY_TOKEN, bind: "tailnet" });
    expect(out).toBe(html);
    expect(out).not.toContain(GATEWAY_TOKEN);
  });

  it("returns unchanged when bind=auto (defensive — auto may resolve to lan)", () => {
    const out = injectGatewayTokenIntoIndexHtml(html, { token: GATEWAY_TOKEN, bind: "auto" });
    expect(out).toBe(html);
  });

  it("idempotent: skips re-injection when marker already present", () => {
    const pre = `<!doctype html><html><head><script>window.__ARGENT_GATEWAY_TOKEN__="prev";</script></head><body></body></html>`;
    const out = injectGatewayTokenIntoIndexHtml(pre, {
      token: "different-token",
      bind: "loopback",
    });
    expect(out).toBe(pre);
    expect(out).not.toContain("different-token");
  });

  it("falls back to prepend when no </head> tag exists", () => {
    const headless = `<html><body><div>x</div></body></html>`;
    const out = injectGatewayTokenIntoIndexHtml(headless, {
      token: GATEWAY_TOKEN,
      bind: "loopback",
    });
    expect(out.startsWith("<script>")).toBe(true);
    expect(out).toContain(GATEWAY_TOKEN);
  });

  it("JSON.stringify guards against tokens that contain </script>", () => {
    const evil = `tok-with-"quotes"-and-</script>-junk`;
    const out = injectGatewayTokenIntoIndexHtml(html, { token: evil, bind: "loopback" });
    const scriptStart = out.indexOf("<script>window.__ARGENT_GATEWAY_TOKEN__");
    const scriptEnd = out.indexOf("</script>", scriptStart);
    const injected = out.slice(scriptStart, scriptEnd);
    expect(injected.toLowerCase()).not.toContain("</script");
  });
});

describe("dashboardApiTokenFromRequest", () => {
  it("reads ?token= from request URL", () => {
    const req = { url: "/api/build-info?token=url-token", headers: {} } as IncomingMessage;
    expect(dashboardApiTokenFromRequest(req)).toBe("url-token");
  });

  it("reads ?api_token= from request URL (preferred over ?token=)", () => {
    const req = {
      url: "/api/build-info?api_token=preferred&token=fallback",
      headers: {},
    } as IncomingMessage;
    expect(dashboardApiTokenFromRequest(req)).toBe("preferred");
  });

  it("reads ?token= from Referer when request URL has none", () => {
    const req = {
      url: "/api/build-info",
      headers: { referer: "http://127.0.0.1:18789/?token=referer-token" },
    } as unknown as IncomingMessage;
    expect(dashboardApiTokenFromRequest(req)).toBe("referer-token");
  });

  it("returns null when neither URL nor Referer carries a token", () => {
    const req = {
      url: "/api/build-info",
      headers: { referer: "http://127.0.0.1:18789/" },
    } as unknown as IncomingMessage;
    expect(dashboardApiTokenFromRequest(req)).toBeNull();
  });
});

describe("resolveProxyAuthToken", () => {
  it("prefers URL token over disk token when both present", () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN } } });
    const req = { url: "/api/build-info?token=url-token", headers: {} } as IncomingMessage;
    expect(resolveProxyAuthToken(req, argentJsonPath)).toBe("url-token");
  });

  it("prefers Referer token over disk token when URL has none", () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN } } });
    const req = {
      url: "/api/build-info",
      headers: { referer: "http://127.0.0.1:18789/?token=referer-token" },
    } as unknown as IncomingMessage;
    expect(resolveProxyAuthToken(req, argentJsonPath)).toBe("referer-token");
  });

  it("falls back to disk gateway token when URL + Referer are bare", () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN } } });
    const req = {
      url: "/api/build-info",
      headers: { referer: "http://127.0.0.1:18789/" },
    } as unknown as IncomingMessage;
    expect(resolveProxyAuthToken(req, argentJsonPath)).toBe(GATEWAY_TOKEN);
  });

  it("returns null when nothing available (fresh install)", () => {
    clearArgentConfig();
    const req = { url: "/api/build-info", headers: {} } as IncomingMessage;
    expect(resolveProxyAuthToken(req, argentJsonPath)).toBeNull();
  });
});

/**
 * Mock a Node IncomingMessage that vitest can pipe through
 * `proxyApiRequest`. Bodies are passed as a single chunk for simplicity —
 * the implementation buffers via `for-await-of` so this is sufficient.
 */
function makeRequest(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer;
}): IncomingMessage {
  const { url, method = "GET", headers = {}, body } = opts;
  const chunks = body ? [body] : [];
  const req = {
    url,
    method,
    headers,
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  } as unknown as IncomingMessage;
  return req;
}

interface MockResponse {
  res: ServerResponse;
  statusCode: () => number;
  body: () => Buffer;
  header: (name: string) => string | undefined;
}

function makeResponse(): MockResponse {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: Buffer = Buffer.alloc(0);
  const res = {
    set statusCode(v: number) {
      statusCode = v;
    },
    get statusCode() {
      return statusCode;
    },
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    end: (chunk?: Buffer | string) => {
      if (chunk) {
        body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
    },
  } as unknown as ServerResponse;
  return {
    res,
    statusCode: () => statusCode,
    body: () => body,
    header: (name: string) => headers[name.toLowerCase()],
  };
}

describe("proxyApiRequest", () => {
  it("forwards the client's Authorization header to the api-server", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit | undefined) => {
      return new Response("ok", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const req = makeRequest({
      url: "/api/build-info",
      headers: { authorization: "Bearer browser-supplied" },
    });
    const { res, statusCode } = makeResponse();
    await proxyApiRequest(req, res, {
      configPathOverride: argentJsonPath,
      fetchImpl,
    });
    expect(statusCode()).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization || headers.Authorization).toBe("Bearer browser-supplied");
  });

  it("auto-injects gateway token from disk when no Authorization, on loopback", async () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN }, bind: "loopback" } });
    const fetchImpl = vi.fn(
      async () => new Response("ok", { status: 200 }),
    ) as unknown as typeof fetch;
    const req = makeRequest({ url: "/api/build-info" });
    const { res } = makeResponse();
    await proxyApiRequest(req, res, {
      configPathOverride: argentJsonPath,
      fetchImpl,
    });
    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization || headers.authorization).toBe(`Bearer ${GATEWAY_TOKEN}`);
  });

  it("does NOT auto-inject gateway token when bind=lan (security)", async () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN }, bind: "lan" } });
    const fetchImpl = vi.fn(
      async () => new Response("ok", { status: 200 }),
    ) as unknown as typeof fetch;
    const req = makeRequest({ url: "/api/build-info" });
    const { res } = makeResponse();
    await proxyApiRequest(req, res, {
      configPathOverride: argentJsonPath,
      fetchImpl,
    });
    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
  });

  it("returns the upstream 401 status faithfully (no fall-through to SPA)", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const req = makeRequest({ url: "/api/build-info" });
    const { res, statusCode, header, body } = makeResponse();
    await proxyApiRequest(req, res, {
      configPathOverride: argentJsonPath,
      fetchImpl,
    });
    expect(statusCode()).toBe(401);
    expect(header("content-type")).toContain("application/json");
    // Critical: NOT 200 HTML. The body must be the upstream JSON error.
    expect(body().toString("utf-8")).toContain("unauthorized");
    expect(body().toString("utf-8")).not.toContain("<html");
  });

  it("returns 502 when api-server is unreachable (NOT fall-through to SPA)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const req = makeRequest({ url: "/api/build-info" });
    const { res, statusCode, body } = makeResponse();
    await proxyApiRequest(req, res, {
      configPathOverride: argentJsonPath,
      fetchImpl,
    });
    expect(statusCode()).toBe(502);
    // Body must be a JSON error, not an HTML SPA fallback.
    expect(body().toString("utf-8")).toContain("Dashboard API unavailable");
    expect(body().toString("utf-8")).not.toContain("<html");
  });

  it("forwards request body for non-GET methods", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit | undefined) => {
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const req = makeRequest({
      url: "/api/echo",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ hello: "world" })),
    });
    const { res } = makeResponse();
    await proxyApiRequest(req, res, {
      configPathOverride: argentJsonPath,
      fetchImpl,
    });
    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.body as Buffer).toString("utf-8")).toContain("hello");
  });

  it("strips hop-by-hop headers (host, connection) from forwarded request", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("ok", { status: 200 }),
    ) as unknown as typeof fetch;
    const req = makeRequest({
      url: "/api/build-info",
      headers: {
        host: "127.0.0.1:18789",
        connection: "keep-alive",
        "x-custom": "passthrough",
      },
    });
    const { res } = makeResponse();
    await proxyApiRequest(req, res, {
      configPathOverride: argentJsonPath,
      fetchImpl,
    });
    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.host).toBeUndefined();
    expect(headers.connection).toBeUndefined();
    expect(headers["x-custom"]).toBe("passthrough");
  });

  it("URL-derived token wins over disk token when client did not send Authorization", async () => {
    writeArgentConfig({ gateway: { auth: { token: GATEWAY_TOKEN }, bind: "loopback" } });
    const fetchImpl = vi.fn(
      async () => new Response("ok", { status: 200 }),
    ) as unknown as typeof fetch;
    const req = makeRequest({ url: "/api/build-info?token=url-token" });
    const { res } = makeResponse();
    await proxyApiRequest(req, res, {
      configPathOverride: argentJsonPath,
      fetchImpl,
    });
    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer url-token");
  });
});
