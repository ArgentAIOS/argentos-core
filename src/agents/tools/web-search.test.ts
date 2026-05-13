import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as serviceKeys from "../../infra/service-keys.js";
import { __testing } from "./web-search.js";

const {
  inferPerplexityBaseUrlFromApiKey,
  resolvePerplexityBaseUrl,
  normalizeFreshness,
  resolveSearchApiKey,
  resolveSearchProvider,
  resolveTinyFishApiKey,
  resolveTinyFishBaseUrl,
  resolveTinyFishConfig,
  runTinyFishSearch,
  DEFAULT_TINYFISH_SEARCH_BASE_URL,
} = __testing;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("web_search perplexity baseUrl defaults", () => {
  it("detects a Perplexity key prefix", () => {
    expect(inferPerplexityBaseUrlFromApiKey("pplx-123")).toBe("direct");
  });

  it("detects an OpenRouter key prefix", () => {
    expect(inferPerplexityBaseUrlFromApiKey("sk-or-v1-123")).toBe("openrouter");
  });

  it("returns undefined for unknown key formats", () => {
    expect(inferPerplexityBaseUrlFromApiKey("unknown-key")).toBeUndefined();
  });

  it("prefers explicit baseUrl over key-based defaults", () => {
    expect(resolvePerplexityBaseUrl({ baseUrl: "https://example.com" }, "config", "pplx-123")).toBe(
      "https://example.com",
    );
  });

  it("defaults to direct when using PERPLEXITY_API_KEY", () => {
    expect(resolvePerplexityBaseUrl(undefined, "perplexity_env")).toBe("https://api.perplexity.ai");
  });

  it("defaults to OpenRouter when using OPENROUTER_API_KEY", () => {
    expect(resolvePerplexityBaseUrl(undefined, "openrouter_env")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("defaults to direct when config key looks like Perplexity", () => {
    expect(resolvePerplexityBaseUrl(undefined, "config", "pplx-123")).toBe(
      "https://api.perplexity.ai",
    );
  });

  it("defaults to OpenRouter when config key looks like OpenRouter", () => {
    expect(resolvePerplexityBaseUrl(undefined, "config", "sk-or-v1-123")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("defaults to OpenRouter for unknown config key formats", () => {
    expect(resolvePerplexityBaseUrl(undefined, "config", "weird-key")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });
});

describe("web_search freshness normalization", () => {
  it("accepts Brave shortcut values", () => {
    expect(normalizeFreshness("pd")).toBe("pd");
    expect(normalizeFreshness("PW")).toBe("pw");
  });

  it("accepts valid date ranges", () => {
    expect(normalizeFreshness("2024-01-01to2024-01-31")).toBe("2024-01-01to2024-01-31");
  });

  it("rejects invalid date ranges", () => {
    expect(normalizeFreshness("2024-13-01to2024-01-31")).toBeUndefined();
    expect(normalizeFreshness("2024-02-30to2024-03-01")).toBeUndefined();
    expect(normalizeFreshness("2024-03-10to2024-03-01")).toBeUndefined();
  });
});

describe("web_search tinyfish resolvers", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects tinyfish provider when configured", () => {
    expect(resolveSearchProvider({ provider: "tinyfish" })).toBe("tinyfish");
  });

  it("falls back to brave for unknown provider strings", () => {
    expect(resolveSearchProvider({ provider: "unknown" as never })).toBe("brave");
  });

  it("returns empty TinyFish config when none provided", () => {
    expect(resolveTinyFishConfig(undefined)).toEqual({});
    expect(resolveTinyFishConfig({})).toEqual({});
  });

  it("prefers config apiKey over TINYFISH_API_KEY env", () => {
    vi.stubEnv("TINYFISH_API_KEY", "env-key");
    expect(resolveTinyFishApiKey({ apiKey: "config-key" })).toBe("config-key");
  });

  it("falls back to TINYFISH_API_KEY env when no config key", () => {
    vi.stubEnv("TINYFISH_API_KEY", "env-key");
    expect(resolveTinyFishApiKey({})).toBe("env-key");
  });

  it("returns undefined when no key is configured anywhere", () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    expect(resolveTinyFishApiKey({})).toBeUndefined();
  });

  it("defaults baseUrl to the public TinyFish Search endpoint", () => {
    expect(resolveTinyFishBaseUrl(undefined)).toBe(DEFAULT_TINYFISH_SEARCH_BASE_URL);
    expect(resolveTinyFishBaseUrl({})).toBe(DEFAULT_TINYFISH_SEARCH_BASE_URL);
  });

  it("honors configured baseUrl and strips trailing slashes", () => {
    expect(resolveTinyFishBaseUrl({ baseUrl: "https://tf.example.com/" })).toBe(
      "https://tf.example.com",
    );
  });
});

describe("runTinyFishSearch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns parsed TinyFish results on success", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      expect(url).toContain("https://api.search.tinyfish.ai/?query=hello+world");
      expect(url).toContain("location=US");
      expect(url).toContain("language=en");
      return new Response(
        JSON.stringify({
          query: "hello world",
          total_results: 1,
          page: 0,
          results: [
            {
              position: 1,
              site_name: "example.com",
              title: "Hello World",
              snippet: "An example snippet.",
              url: "https://example.com/hw",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await runTinyFishSearch({
      query: "hello world",
      apiKey: "tf_test",
      baseUrl: DEFAULT_TINYFISH_SEARCH_BASE_URL,
      location: "US",
      language: "en",
      timeoutSeconds: 5,
    });

    expect(data.total_results).toBe(1);
    expect(data.results?.[0]?.url).toBe("https://example.com/hw");
    // X-API-Key header must be set.
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("tf_test");
  });

  it("throws a descriptive error on 401 auth failure", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "INVALID_API_KEY", message: "The provided API key is invalid" },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await expect(
      runTinyFishSearch({
        query: "anything",
        apiKey: "bad",
        baseUrl: DEFAULT_TINYFISH_SEARCH_BASE_URL,
        timeoutSeconds: 5,
      }),
    ).rejects.toThrow(/TinyFish Search API error \(401\)/);
  });
});

describe("web_search key resolution", () => {
  it("prefers dashboard service-keys over config and env", () => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue("service-key");
    vi.stubEnv("BRAVE_API_KEY", "env-key");

    const resolved = resolveSearchApiKey({ search: { apiKey: "config-key" } });
    expect(resolved).toBe("service-key");
  });

  it("falls back to config key when service-keys has no value", () => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue(undefined);
    vi.stubEnv("BRAVE_API_KEY", "env-key");

    const resolved = resolveSearchApiKey({ search: { apiKey: "config-key" } });
    expect(resolved).toBe("config-key");
  });

  it("falls back to env key when service-keys and config are empty", () => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue(undefined);
    vi.stubEnv("BRAVE_API_KEY", "env-key");

    const resolved = resolveSearchApiKey({ search: {} });
    expect(resolved).toBe("env-key");
  });
});
