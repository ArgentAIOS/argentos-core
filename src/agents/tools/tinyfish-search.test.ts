import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing, createTinyFishSearchTool } from "./tinyfish-search.js";

const { resolveSearchApiKey, resolveSearchBaseUrl, DEFAULT_TINYFISH_SEARCH_BASE_URL } = __testing;

describe("tinyfish_search resolver", () => {
  const originalEnv = process.env.TINYFISH_API_KEY;

  beforeEach(() => {
    delete process.env.TINYFISH_API_KEY;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = originalEnv;
  });

  it("returns undefined when no key is configured anywhere", () => {
    expect(resolveSearchApiKey({})).toBeUndefined();
  });

  it("falls back to env var when no service-key store entry and no inline key", () => {
    process.env.TINYFISH_API_KEY = "from-env";
    expect(resolveSearchApiKey({})).toBe("from-env");
  });

  it("returns the inline apiKey when neither service-key store nor env are set", () => {
    // resolveServiceKey (service-keys store + env) is checked first; when both
    // are empty, inline config.apiKey is the final non-undefined source. This
    // mirrors the precedence established by tinyfish_browser.
    expect(resolveSearchApiKey({ search: { apiKey: "from-inline" } })).toBe("from-inline");
  });

  it("uses default base URL when none configured", () => {
    expect(resolveSearchBaseUrl()).toBe(DEFAULT_TINYFISH_SEARCH_BASE_URL);
  });

  it("strips trailing slashes from the configured base URL", () => {
    expect(resolveSearchBaseUrl({ baseUrl: "https://example.test/search/" })).toBe(
      "https://example.test/search",
    );
  });
});

describe("tinyfish_search tool", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns a missing-key error payload when no API key resolves", async () => {
    const tool = createTinyFishSearchTool();
    const result = await tool.execute("call-1", { query: "hello world" });
    const text = result.content?.[0]?.text;
    expect(text).toBeTruthy();
    const parsed = JSON.parse(text as string);
    expect(parsed.error).toBe("missing_tinyfish_api_key");
  });

  it("invokes the TinyFish endpoint with the resolved key, query, location, language", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const calledUrl = typeof input === "string" ? input : input.toString();
      expect(calledUrl).toContain("api.search.tinyfish.ai");
      expect(calledUrl).toContain("query=hello+world");
      expect(calledUrl).toContain("location=United+States");
      expect(calledUrl).toContain("language=en");
      const headers = new Headers(init?.headers);
      expect(headers.get("X-API-Key")).toBe("test-key");
      return new Response(
        JSON.stringify({
          query: "hello world",
          results: [
            { position: 1, title: "Hit one", snippet: "snip", url: "https://example.test/a" },
            { position: 2, title: "Hit two", snippet: "snip2", url: "https://example.test/b" },
            { position: 3, title: "Hit three", snippet: "snip3", url: "https://example.test/c" },
          ],
          total_results: 12345,
          page: 1,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const tool = createTinyFishSearchTool();
    const result = await tool.execute("call-2", {
      query: "hello world",
      location: "United States",
      language: "en",
      limit: 2,
    });
    delete process.env.TINYFISH_API_KEY;

    const parsed = JSON.parse(result.content?.[0]?.text as string);
    expect(parsed.provider).toBe("tinyfish");
    // limit=2 caps the returned results even if the API ignored it
    expect(parsed.results).toHaveLength(2);
    expect(parsed.total_results).toBe(12345);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an error payload on non-2xx upstream", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 429 })) as typeof globalThis.fetch;

    const tool = createTinyFishSearchTool();
    const result = await tool.execute("call-3", { query: "boom" });
    delete process.env.TINYFISH_API_KEY;

    const parsed = JSON.parse(result.content?.[0]?.text as string);
    expect(parsed.error).toBe("tinyfish_search_failed");
    expect(parsed.message).toContain("429");
  });
});
