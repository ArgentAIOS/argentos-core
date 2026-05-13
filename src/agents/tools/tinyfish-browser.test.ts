import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as serviceKeys from "../../infra/service-keys.js";
import {
  __testing,
  createTinyFishBrowserCloseTool,
  createTinyFishBrowserOpenTool,
} from "./tinyfish-browser.js";

const {
  resolveBrowserApiKey,
  resolveBrowserBaseUrl,
  resolveBrowserConfig,
  openTinyFishBrowserSession,
  DEFAULT_TINYFISH_BROWSER_BASE_URL,
} = __testing;

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
});

describe("tinyfish-browser config resolvers", () => {
  beforeEach(() => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue(undefined);
  });

  it("returns empty config when none provided", () => {
    expect(resolveBrowserConfig(undefined)).toEqual({});
  });

  it("reuses tools.web.fetch.tinyfish for config (no duplicate schema)", () => {
    const cfg = {
      tools: {
        web: {
          fetch: {
            tinyfish: { apiKey: "tf_cfg", baseUrl: "https://example.com/" },
          },
        },
      },
    } as unknown as Parameters<typeof resolveBrowserConfig>[0];
    expect(resolveBrowserConfig(cfg)).toEqual({
      apiKey: "tf_cfg",
      baseUrl: "https://example.com/",
    });
  });

  it("prefers dashboard service keys over env and config", () => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue("service-key");
    vi.stubEnv("TINYFISH_API_KEY", "env-key");
    expect(
      resolveBrowserApiKey({
        browser: { apiKey: "config-key" },
      }),
    ).toBe("service-key");
  });

  it("falls back to config apiKey when service keys empty", () => {
    vi.stubEnv("TINYFISH_API_KEY", "env-key");
    expect(resolveBrowserApiKey({ browser: { apiKey: "config-key" } })).toBe("config-key");
  });

  it("falls back to TINYFISH_API_KEY env when service+config empty", () => {
    vi.stubEnv("TINYFISH_API_KEY", "env-key");
    expect(resolveBrowserApiKey({ browser: {} })).toBe("env-key");
  });

  it("returns undefined when no key is configured anywhere", () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    expect(resolveBrowserApiKey({ browser: {} })).toBeUndefined();
  });

  it("defaults baseUrl to the public TinyFish Browser endpoint", () => {
    expect(resolveBrowserBaseUrl(undefined)).toBe(DEFAULT_TINYFISH_BROWSER_BASE_URL);
    expect(resolveBrowserBaseUrl({})).toBe(DEFAULT_TINYFISH_BROWSER_BASE_URL);
  });

  it("honors configured baseUrl and strips trailing slashes", () => {
    expect(resolveBrowserBaseUrl({ baseUrl: "https://browser.example.com/" })).toBe(
      "https://browser.example.com",
    );
  });
});

describe("openTinyFishBrowserSession", () => {
  it("posts to the base URL with X-API-Key and returns parsed session", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      expect(url).toBe("https://api.browser.tinyfish.ai/");
      const headers = (init?.headers as Record<string, string>) ?? {};
      expect(headers["X-API-Key"]).toBe("tf_test");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toEqual({ url: "https://example.com" });
      return new Response(
        JSON.stringify({
          session_id: "br-abc",
          cdp_url: "wss://example.tinyfish.io/cdp",
          base_url: "https://example.tinyfish.io",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await openTinyFishBrowserSession({
      apiKey: "tf_test",
      baseUrl: DEFAULT_TINYFISH_BROWSER_BASE_URL,
      url: "https://example.com",
      timeoutSeconds: 60,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session_id).toBe("br-abc");
      expect(result.cdp_url).toBe("wss://example.tinyfish.io/cdp");
      expect(result.base_url).toBe("https://example.tinyfish.io");
    }
  });

  it("omits the url field when not provided", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toEqual({});
      return new Response(
        JSON.stringify({
          session_id: "br-empty",
          cdp_url: "wss://example.tinyfish.io/cdp",
          base_url: "https://example.tinyfish.io",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await openTinyFishBrowserSession({
      apiKey: "tf_test",
      baseUrl: DEFAULT_TINYFISH_BROWSER_BASE_URL,
      timeoutSeconds: 60,
    });
    expect(result.ok).toBe(true);
  });

  it("returns paidWall=true on 402", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "payment_required" }), {
          status: 402,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const result = await openTinyFishBrowserSession({
      apiKey: "tf_test",
      baseUrl: DEFAULT_TINYFISH_BROWSER_BASE_URL,
      timeoutSeconds: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.paidWall).toBe(true);
    }
  });

  it("returns paidWall=true on 403", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("forbidden", { status: 403 }),
    ) as unknown as typeof fetch;

    const result = await openTinyFishBrowserSession({
      apiKey: "tf_test",
      baseUrl: DEFAULT_TINYFISH_BROWSER_BASE_URL,
      timeoutSeconds: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.paidWall).toBe(true);
    }
  });

  it("returns paidWall=false on 401 (auth) and other errors", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "INVALID_API_KEY" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const result = await openTinyFishBrowserSession({
      apiKey: "bad",
      baseUrl: DEFAULT_TINYFISH_BROWSER_BASE_URL,
      timeoutSeconds: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.paidWall).toBe(false);
    }
  });

  it("returns ok=false when response is missing session_id/cdp_url", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const result = await openTinyFishBrowserSession({
      apiKey: "tf_test",
      baseUrl: DEFAULT_TINYFISH_BROWSER_BASE_URL,
      timeoutSeconds: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toMatch(/incomplete session payload/);
    }
  });
});

describe("createTinyFishBrowserOpenTool", () => {
  beforeEach(() => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue(undefined);
  });

  it("registers as 'tinyfish_browser_open' with a schema", () => {
    const tool = createTinyFishBrowserOpenTool();
    expect(tool.name).toBe("tinyfish_browser_open");
    expect(tool.parameters).toBeDefined();
  });

  it("returns missing_tinyfish_api_key when no key resolvable", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    const tool = createTinyFishBrowserOpenTool();
    const result = (await tool.execute("call-1", {})) as {
      details?: { error?: string };
    };
    expect(result.details?.error).toBe("missing_tinyfish_api_key");
  });

  it("returns a session payload on success", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf_env");
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            session_id: "br-1",
            cdp_url: "wss://x.tinyfish.io/cdp",
            base_url: "https://x.tinyfish.io",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const tool = createTinyFishBrowserOpenTool();
    const result = (await tool.execute("call-1", { url: "https://example.com" })) as {
      details?: { session_id?: string; cdp_url?: string; provider?: string };
    };
    expect(result.details?.provider).toBe("tinyfish");
    expect(result.details?.session_id).toBe("br-1");
    expect(result.details?.cdp_url).toBe("wss://x.tinyfish.io/cdp");
  });

  it("surfaces a paid-tier wall message on 402", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf_env");
    globalThis.fetch = vi.fn(
      async () => new Response("payment required", { status: 402 }),
    ) as unknown as typeof fetch;

    const tool = createTinyFishBrowserOpenTool();
    const result = (await tool.execute("call-1", {})) as {
      details?: { error?: string; status?: number };
    };
    expect(result.details?.error).toBe("tinyfish_browser_paid_tier_required");
    expect(result.details?.status).toBe(402);
  });
});

describe("createTinyFishBrowserCloseTool", () => {
  it("registers as 'tinyfish_browser_close' with a schema", () => {
    const tool = createTinyFishBrowserCloseTool();
    expect(tool.name).toBe("tinyfish_browser_close");
    expect(tool.parameters).toBeDefined();
  });

  it("requires a session_id", async () => {
    const tool = createTinyFishBrowserCloseTool();
    await expect(tool.execute("call-1", {})).rejects.toThrow(/session_id/);
  });

  it("returns an auto-cleanup acknowledgement (no network call)", async () => {
    // No fetch mock — if the tool tried to make a network call we'd see it.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("close tool should not call fetch");
    }) as unknown as typeof fetch;

    const tool = createTinyFishBrowserCloseTool();
    const result = (await tool.execute("call-1", { session_id: "br-1" })) as {
      details?: { closed?: boolean; autoCleanup?: boolean; session_id?: string };
    };
    expect(result.details?.closed).toBe(false);
    expect(result.details?.autoCleanup).toBe(true);
    expect(result.details?.session_id).toBe("br-1");
  });
});
