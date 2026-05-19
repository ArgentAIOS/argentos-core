/**
 * Tests for HTTPS_PROXY / memory.proxy wiring across the memory embedding
 * clients (SAFE-PORT #313, upstream MemU PR #310).
 *
 * Strategy: hoist a fake undici `ProxyAgent` + `fetch` so that any code that
 * imports `./proxy-fetch.js` (which imports `undici`) ends up routed through
 * our spies. We then drive each embedding factory and assert:
 *   - When proxy is configured, the client's `.fetch` is defined AND requests
 *     to the embedding URL go through the undici proxy fetch (not global).
 *   - When proxy is NOT configured, `.fetch` is undefined and global fetch is
 *     used (default behavior — no regression).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ProxyAgent, undiciFetch, proxyAgentSpy, getLastAgent } = vi.hoisted(() => {
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

vi.mock("../agents/model-auth.js", () => ({
  resolveApiKeyForProvider: vi.fn(async () => ({
    apiKey: "test-key",
    mode: "api-key",
    source: "test",
  })),
  requireApiKey: (auth: { apiKey?: string }) => auth.apiKey ?? "test-key",
}));

describe("embedding clients honor HTTPS_PROXY / memory.proxy", () => {
  const originals = {
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
  };

  beforeEach(() => {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    undiciFetch.mockReset();
    proxyAgentSpy.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.unstubAllGlobals();
  });

  describe("OpenAI", () => {
    it("attaches proxy fetch when HTTPS_PROXY env is set", async () => {
      process.env.HTTPS_PROXY = "http://proxy.test:8080";
      undiciFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
        text: async () => "",
      });

      const { createOpenAiEmbeddingProvider } = await import("./embeddings-openai.js");
      const { provider, client } = await createOpenAiEmbeddingProvider({
        config: {} as never,
        provider: "openai",
        remote: { apiKey: "k" },
        model: "text-embedding-3-small",
        fallback: "none",
      });

      expect(client.fetch).toBeDefined();
      expect(proxyAgentSpy).toHaveBeenCalledWith("http://proxy.test:8080");

      await provider.embedQuery("hello");
      expect(undiciFetch).toHaveBeenCalledTimes(1);
      const [url, init] = undiciFetch.mock.calls[0] ?? [];
      expect(String(url)).toContain("/embeddings");
      expect((init as { dispatcher?: unknown }).dispatcher).toBe(getLastAgent());
    });

    it("uses memory.proxy config in preference to env", async () => {
      process.env.HTTPS_PROXY = "http://env-proxy:8080";
      undiciFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1] }] }),
        text: async () => "",
      });

      const { createOpenAiEmbeddingProvider } = await import("./embeddings-openai.js");
      const { client } = await createOpenAiEmbeddingProvider({
        config: { memory: { proxy: "http://config-proxy:3128" } } as never,
        provider: "openai",
        remote: { apiKey: "k" },
        model: "text-embedding-3-small",
        fallback: "none",
      });

      expect(client.fetch).toBeDefined();
      expect(proxyAgentSpy).toHaveBeenCalledWith("http://config-proxy:3128");
    });

    it("leaves client.fetch undefined when no proxy is set (no behavior change)", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1] }] }),
        text: async () => "",
      }));
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const { createOpenAiEmbeddingProvider } = await import("./embeddings-openai.js");
      const { provider, client } = await createOpenAiEmbeddingProvider({
        config: {} as never,
        provider: "openai",
        remote: { apiKey: "k" },
        model: "text-embedding-3-small",
        fallback: "none",
      });

      expect(client.fetch).toBeUndefined();
      await provider.embedQuery("hi");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(undiciFetch).not.toHaveBeenCalled();
    });
  });

  describe("Gemini", () => {
    it("attaches proxy fetch when HTTPS_PROXY env is set", async () => {
      process.env.HTTPS_PROXY = "http://proxy.test:8080";
      undiciFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ embedding: { values: [0.1, 0.2] } }),
        text: async () => "",
      });

      const { createGeminiEmbeddingProvider } = await import("./embeddings-gemini.js");
      const { provider, client } = await createGeminiEmbeddingProvider({
        config: {} as never,
        provider: "gemini",
        remote: { apiKey: "gk" },
        model: "gemini-embedding-001",
        fallback: "none",
      });

      expect(client.fetch).toBeDefined();
      expect(proxyAgentSpy).toHaveBeenCalledWith("http://proxy.test:8080");

      await provider.embedQuery("hello");
      expect(undiciFetch).toHaveBeenCalledTimes(1);
      const [, init] = undiciFetch.mock.calls[0] ?? [];
      expect((init as { dispatcher?: unknown }).dispatcher).toBe(getLastAgent());
    });

    it("leaves client.fetch undefined when no proxy is set", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ embedding: { values: [0.1] } }),
        text: async () => "",
      }));
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const { createGeminiEmbeddingProvider } = await import("./embeddings-gemini.js");
      const { provider, client } = await createGeminiEmbeddingProvider({
        config: {} as never,
        provider: "gemini",
        remote: { apiKey: "gk" },
        model: "gemini-embedding-001",
        fallback: "none",
      });

      expect(client.fetch).toBeUndefined();
      await provider.embedQuery("hi");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(undiciFetch).not.toHaveBeenCalled();
    });
  });

  describe("Ollama", () => {
    it("attaches proxy fetch when HTTP_PROXY env is set", async () => {
      process.env.HTTP_PROXY = "http://proxy.test:3128";
      undiciFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
        text: async () => "",
      });

      const { createOllamaEmbeddingProvider } = await import("./embeddings-ollama.js");
      const { provider, client } = await createOllamaEmbeddingProvider({
        config: {} as never,
        provider: "ollama",
        model: "nomic-embed-text",
        fallback: "none",
      });

      expect(client.fetch).toBeDefined();
      expect(proxyAgentSpy).toHaveBeenCalledWith("http://proxy.test:3128");

      await provider.embedQuery("hello");
      expect(undiciFetch).toHaveBeenCalledTimes(1);
      const [, init] = undiciFetch.mock.calls[0] ?? [];
      expect((init as { dispatcher?: unknown }).dispatcher).toBe(getLastAgent());
    });

    it("leaves client.fetch undefined when no proxy is set", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1] }] }),
        text: async () => "",
      }));
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const { createOllamaEmbeddingProvider } = await import("./embeddings-ollama.js");
      const { provider, client } = await createOllamaEmbeddingProvider({
        config: {} as never,
        provider: "ollama",
        model: "nomic-embed-text",
        fallback: "none",
      });

      expect(client.fetch).toBeUndefined();
      await provider.embedQuery("hi");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(undiciFetch).not.toHaveBeenCalled();
    });
  });
});

describe("batch clients route through proxy fetch when set", () => {
  const originals = {
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
  };

  beforeEach(() => {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    undiciFetch.mockReset();
    proxyAgentSpy.mockReset();
    vi.resetModules();
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

  it("openai batch uses client.fetch when present", async () => {
    process.env.HTTPS_PROXY = "http://proxy.test:8080";
    // Three undici fetch invocations expected per group: upload, create, status (or
    // completion). The submitOpenAiBatch path itself does upload + create; we stop
    // there by returning `status: "completed"` with an output file.
    undiciFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "file-xyz" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "batch-abc", status: "completed", output_file_id: "out-1" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            custom_id: "row-1",
            response: { status_code: 200, body: { data: [{ embedding: [0.1, 0.2] }] } },
          }),
      });

    const { runOpenAiEmbeddingBatches } = await import("./batch-openai.js");
    const { createOpenAiEmbeddingProvider } = await import("./embeddings-openai.js");
    const { client } = await createOpenAiEmbeddingProvider({
      config: {} as never,
      provider: "openai",
      remote: { apiKey: "k" },
      model: "text-embedding-3-small",
      fallback: "none",
    });

    const result = await runOpenAiEmbeddingBatches({
      openAi: client,
      agentId: "test-agent",
      requests: [
        {
          custom_id: "row-1",
          method: "POST",
          url: "/v1/embeddings",
          body: { model: "text-embedding-3-small", input: "hello" },
        },
      ],
      wait: true,
      pollIntervalMs: 10,
      timeoutMs: 1000,
      concurrency: 1,
    });

    expect(result.get("row-1")).toEqual([0.1, 0.2]);
    expect(undiciFetch).toHaveBeenCalledTimes(3);
    for (const [, init] of undiciFetch.mock.calls) {
      expect((init as { dispatcher?: unknown }).dispatcher).toBe(getLastAgent());
    }
  });
});

describe("MemU LLM run config surfaces proxy URL", () => {
  const originals = {
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
  };

  beforeEach(() => {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    vi.resetModules();
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

  it("surfaces memory.proxy on every run attempt", async () => {
    const { buildMemuLlmRunAttempts } = await import("./llm-config.js");
    const cfg = {
      memory: { proxy: "http://config-proxy:3128", memu: { llm: { model: "" } } },
    } as never;
    const attempts = buildMemuLlmRunAttempts(cfg, { timeoutMs: 15_000 });
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    for (const attempt of attempts) {
      expect(attempt.proxyUrl).toBe("http://config-proxy:3128");
    }
  });

  it("surfaces HTTPS_PROXY env when config is unset", async () => {
    process.env.HTTPS_PROXY = "http://env-proxy:8080";
    const { buildMemuLlmRunAttempts } = await import("./llm-config.js");
    const attempts = buildMemuLlmRunAttempts({} as never, { timeoutMs: 15_000 });
    for (const attempt of attempts) {
      expect(attempt.proxyUrl).toBe("http://env-proxy:8080");
    }
  });

  it("leaves proxyUrl undefined when neither config nor env is set", async () => {
    const { buildMemuLlmRunAttempts } = await import("./llm-config.js");
    const attempts = buildMemuLlmRunAttempts({} as never, { timeoutMs: 15_000 });
    for (const attempt of attempts) {
      expect(attempt.proxyUrl).toBeUndefined();
    }
  });
});
