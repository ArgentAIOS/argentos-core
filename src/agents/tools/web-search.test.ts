import { afterEach, describe, expect, it, vi } from "vitest";
import * as serviceKeys from "../../infra/service-keys.js";
import { __testing } from "./web-search.js";

const {
  inferPerplexityBaseUrlFromApiKey,
  resolvePerplexityBaseUrl,
  normalizeFreshness,
  resolveSearchApiKey,
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
