import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ProxyAgent, undiciFetch, getLastAgent, proxyAgentSpy } = vi.hoisted(() => {
  const undiciFetch = vi.fn();
  const proxyAgentSpy = vi.fn();
  class ProxyAgent {
    static lastCreated: ProxyAgent | undefined;
    proxyUrl: string;
    constructor(proxyUrl: string) {
      this.proxyUrl = proxyUrl;
      ProxyAgent.lastCreated = this;
      proxyAgentSpy(proxyUrl);
    }
  }
  return {
    ProxyAgent,
    undiciFetch,
    proxyAgentSpy,
    getLastAgent: () => ProxyAgent.lastCreated,
  };
});

vi.mock("undici", () => ({
  ProxyAgent,
  fetch: undiciFetch,
}));

import { createProxyFetch, resolveMemoryProxyFetch, resolveMemoryProxyUrl } from "./proxy-fetch.js";

describe("resolveMemoryProxyUrl", () => {
  const originals = {
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
    https_proxy: process.env.https_proxy,
    http_proxy: process.env.http_proxy,
  };

  beforeEach(() => {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    delete process.env.https_proxy;
    delete process.env.http_proxy;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("returns undefined when no proxy is configured", () => {
    expect(resolveMemoryProxyUrl({} as never)).toBeUndefined();
    expect(resolveMemoryProxyUrl(undefined)).toBeUndefined();
  });

  it("prefers memory.proxy config over env vars", () => {
    process.env.HTTPS_PROXY = "http://env-proxy:8080";
    const cfg = { memory: { proxy: "http://config-proxy:3128" } } as never;
    expect(resolveMemoryProxyUrl(cfg)).toBe("http://config-proxy:3128");
  });

  it("falls back to HTTPS_PROXY env when config is unset", () => {
    process.env.HTTPS_PROXY = "http://https-proxy:8080";
    process.env.HTTP_PROXY = "http://http-proxy:8080";
    expect(resolveMemoryProxyUrl({} as never)).toBe("http://https-proxy:8080");
  });

  it("falls back to HTTP_PROXY env when HTTPS_PROXY is unset", () => {
    process.env.HTTP_PROXY = "http://http-proxy:8080";
    expect(resolveMemoryProxyUrl({} as never)).toBe("http://http-proxy:8080");
  });

  it("accepts lowercase https_proxy / http_proxy variants", () => {
    process.env.https_proxy = "http://lower-https:8080";
    expect(resolveMemoryProxyUrl({} as never)).toBe("http://lower-https:8080");
    delete process.env.https_proxy;
    process.env.http_proxy = "http://lower-http:8080";
    expect(resolveMemoryProxyUrl({} as never)).toBe("http://lower-http:8080");
  });

  it("treats empty/whitespace memory.proxy as unset (falls through to env)", () => {
    process.env.HTTPS_PROXY = "http://env-proxy:8080";
    const cfg = { memory: { proxy: "   " } } as never;
    expect(resolveMemoryProxyUrl(cfg)).toBe("http://env-proxy:8080");
  });
});

describe("createProxyFetch + resolveMemoryProxyFetch", () => {
  const originals = {
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
  };

  beforeEach(() => {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    undiciFetch.mockReset();
    proxyAgentSpy.mockReset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("createProxyFetch wires undici fetch + ProxyAgent dispatcher", async () => {
    undiciFetch.mockResolvedValue({ ok: true });
    const proxyFetch = createProxyFetch("http://proxy.test:8080");
    await proxyFetch("https://example.com");

    expect(proxyAgentSpy).toHaveBeenCalledWith("http://proxy.test:8080");
    expect(undiciFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ dispatcher: getLastAgent() }),
    );
  });

  it("resolveMemoryProxyFetch returns undefined when no proxy is configured", () => {
    expect(resolveMemoryProxyFetch({} as never)).toBeUndefined();
  });

  it("resolveMemoryProxyFetch returns a proxy-aware fetch when env is set", async () => {
    process.env.HTTPS_PROXY = "http://env-proxy:8080";
    undiciFetch.mockResolvedValue({ ok: true });
    const fetchImpl = resolveMemoryProxyFetch({} as never);
    expect(fetchImpl).toBeDefined();
    await fetchImpl!("https://example.com");
    expect(proxyAgentSpy).toHaveBeenCalledWith("http://env-proxy:8080");
  });
});
