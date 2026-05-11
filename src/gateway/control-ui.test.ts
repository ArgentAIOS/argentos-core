import type { IncomingMessage, ServerResponse } from "node:http";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleControlUiHttpRequest } from "./control-ui.js";

const makeResponse = (): {
  res: ServerResponse;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} => {
  const setHeader = vi.fn();
  const end = vi.fn();
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader,
    end,
  } as unknown as ServerResponse;
  return { res, setHeader, end };
};

describe("handleControlUiHttpRequest", () => {
  it("sets anti-clickjacking headers for Control UI responses", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "argent-ui-"));
    try {
      await fs.writeFile(path.join(tmp, "index.html"), "<html></html>\n");
      const { res, setHeader } = makeResponse();
      const handled = handleControlUiHttpRequest(
        { url: "/", method: "GET" } as IncomingMessage,
        res,
        {
          root: { kind: "resolved", path: tmp },
        },
      );
      expect(handled).toBe(true);
      expect(setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
      expect(setHeader).toHaveBeenCalledWith("Content-Security-Policy", "frame-ancestors 'none'");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("does not claim well-known discovery routes when mounted at root", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "argent-ui-"));
    try {
      await fs.writeFile(path.join(tmp, "index.html"), "<html></html>\n");
      const { res, setHeader, end } = makeResponse();
      const handled = handleControlUiHttpRequest(
        { url: "/.well-known/oauth-authorization-server/mcp", method: "GET" } as IncomingMessage,
        res,
        {
          root: { kind: "resolved", path: tmp },
        },
      );

      expect(handled).toBe(false);
      expect(setHeader).not.toHaveBeenCalled();
      expect(end).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * Coverage for the gateway-port-token-fix (GH #162): the gateway's HTML
 * serving path at port 18789 must inject `window.__ARGENT_GATEWAY_TOKEN__`
 * on loopback so the dashboard bundle can seed localStorage on bare-URL
 * boots — Swift app, browser bookmark, etc.
 *
 * `readGatewayConfigFromDisk` reads `~/.argentos/argent.json` by default;
 * tests redirect HOME to a sandboxed temp dir to keep the real config
 * untouched. The `process.env.HOME` swap is captured at module load time in
 * `gateway-proxy-token.ts`, but since the constant resolves on each call
 * via `pathOverride || DEFAULT`, the simplest path is to set HOME before
 * the test. We re-import the module fresh per suite to pick up the new HOME.
 */
describe("handleControlUiHttpRequest — gateway token HTML injection", () => {
  let savedHome: string | undefined;
  let tmpHome: string;

  beforeEach(async () => {
    savedHome = process.env.HOME;
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "argent-ui-home-"));
    fsSync.mkdirSync(path.join(tmpHome, ".argentos"), { recursive: true });
    process.env.HOME = tmpHome;
    // Force re-import so DEFAULT_ARGENT_CONFIG_PATH picks up the new HOME.
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("injects window.__ARGENT_GATEWAY_TOKEN__ into HTML on loopback bind", async () => {
    fsSync.writeFileSync(
      path.join(tmpHome, ".argentos", "argent.json"),
      JSON.stringify({ gateway: { auth: { token: "html-inject-token" }, bind: "loopback" } }),
    );
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "argent-ui-"));
    try {
      await fs.writeFile(
        path.join(tmp, "index.html"),
        "<!doctype html><html><head><title>x</title></head><body></body></html>",
      );
      // Re-import so the module re-resolves DEFAULT_ARGENT_CONFIG_PATH against
      // the new HOME.
      const { handleControlUiHttpRequest: handler } = await import("./control-ui.js");
      const { res, end } = makeResponse();
      const handled = handler({ url: "/", method: "GET", headers: {} } as IncomingMessage, res, {
        root: { kind: "resolved", path: tmp },
      });
      expect(handled).toBe(true);
      const body = (end.mock.calls[0]?.[0] ?? "") as string;
      expect(body).toContain("window.__ARGENT_GATEWAY_TOKEN__");
      expect(body).toContain("html-inject-token");
      // Token script must land before </head> so it executes before
      // module-script imports.
      expect(body.indexOf("__ARGENT_GATEWAY_TOKEN__")).toBeLessThan(body.indexOf("</head>"));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("does NOT inject window.__ARGENT_GATEWAY_TOKEN__ when bind=lan (security)", async () => {
    fsSync.writeFileSync(
      path.join(tmpHome, ".argentos", "argent.json"),
      JSON.stringify({ gateway: { auth: { token: "lan-token-secret" }, bind: "lan" } }),
    );
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "argent-ui-"));
    try {
      await fs.writeFile(
        path.join(tmp, "index.html"),
        "<!doctype html><html><head><title>x</title></head><body></body></html>",
      );
      const { handleControlUiHttpRequest: handler } = await import("./control-ui.js");
      const { res, end } = makeResponse();
      handler({ url: "/", method: "GET", headers: {} } as IncomingMessage, res, {
        root: { kind: "resolved", path: tmp },
      });
      const body = (end.mock.calls[0]?.[0] ?? "") as string;
      expect(body).not.toContain("__ARGENT_GATEWAY_TOKEN__");
      expect(body).not.toContain("lan-token-secret");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
