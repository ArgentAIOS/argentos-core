import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GEMINI_EMBEDDING_MODEL } from "./embeddings-gemini.js";
import { DEFAULT_LMSTUDIO_EMBEDDING_MODEL } from "./embeddings-openai.js";

vi.mock("../agents/model-auth.js", () => ({
  resolveApiKeyForProvider: vi.fn(),
  requireApiKey: (auth: { apiKey?: string; mode?: string }, provider: string) => {
    if (auth?.apiKey) {
      return auth.apiKey;
    }
    throw new Error(`No API key resolved for provider "${provider}" (auth mode: ${auth?.mode}).`);
  },
}));

const createFetchMock = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ embedding: [1, 2, 3] }] }),
  })) as unknown as typeof fetch;

describe("embedding provider remote overrides", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses remote baseUrl/apiKey and merges headers", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "provider-key",
      mode: "api-key",
      source: "test",
    });

    const cfg = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://provider.example/v1",
            headers: {
              "X-Provider": "p",
              "X-Shared": "provider",
            },
          },
        },
      },
    };

    const result = await createEmbeddingProvider({
      config: cfg as never,
      provider: "openai",
      remote: {
        baseUrl: "https://remote.example/v1",
        apiKey: "  remote-key  ",
        headers: {
          "X-Shared": "remote",
          "X-Remote": "r",
        },
      },
      model: "text-embedding-3-small",
      fallback: "openai",
    });

    await result.provider.embedQuery("hello");

    expect(authModule.resolveApiKeyForProvider).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://remote.example/v1/embeddings");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer remote-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Provider"]).toBe("p");
    expect(headers["X-Shared"]).toBe("remote");
    expect(headers["X-Remote"]).toBe("r");
  });

  it("falls back to resolved api key when remote apiKey is blank", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "provider-key",
      mode: "api-key",
      source: "test",
    });

    const cfg = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://provider.example/v1",
          },
        },
      },
    };

    const result = await createEmbeddingProvider({
      config: cfg as never,
      provider: "openai",
      remote: {
        baseUrl: "https://remote.example/v1",
        apiKey: "   ",
      },
      model: "text-embedding-3-small",
      fallback: "openai",
    });

    await result.provider.embedQuery("hello");

    expect(authModule.resolveApiKeyForProvider).toHaveBeenCalledTimes(1);
    const headers = (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>) ?? {};
    expect(headers.Authorization).toBe("Bearer provider-key");
  });

  it("injects dimensions=768 for OpenAI text-embedding-3 models when V3 is enabled", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");

    const result = await createEmbeddingProvider({
      config: {
        memory: {
          vault: {
            enabled: true,
          },
        },
      } as never,
      provider: "openai",
      remote: {
        baseUrl: "https://remote.example/v1",
        apiKey: "remote-key",
      },
      model: "text-embedding-3-small",
      fallback: "openai",
    });

    await result.provider.embedQuery("hello");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      dimensions?: number;
    };
    expect(body.dimensions).toBe(768);
  });

  it("builds Gemini embeddings requests with api key header", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: [1, 2, 3] } }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "provider-key",
      mode: "api-key",
      source: "test",
    });

    const cfg = {
      models: {
        providers: {
          google: {
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          },
        },
      },
    };

    const result = await createEmbeddingProvider({
      config: cfg as never,
      provider: "gemini",
      remote: {
        apiKey: "gemini-key",
      },
      model: "text-embedding-004",
      fallback: "openai",
    });

    await result.provider.embedQuery("hello");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent",
    );
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("gemini-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("builds Ollama embeddings requests from models.providers.ollama settings", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "profile-key",
      mode: "api-key",
      source: "test",
    });

    const cfg = {
      models: {
        providers: {
          ollama: {
            baseUrl: "http://127.0.0.1:11435/v1",
            headers: {
              "X-Ollama-Provider": "p",
            },
          },
        },
      },
    };

    const result = await createEmbeddingProvider({
      config: cfg as never,
      provider: "ollama",
      model: "ollama/nomic-embed-text",
      fallback: "none",
    });

    await result.provider.embedQuery("hello");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:11435/v1/embeddings");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer profile-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Ollama-Provider"]).toBe("p");
  });

  it("builds LM Studio embeddings requests from models.providers.lmstudio settings", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "should-not-be-used",
      mode: "api-key",
      source: "test",
    });

    const cfg = {
      models: {
        providers: {
          lmstudio: {
            baseUrl: "http://127.0.0.1:1234/v1",
            apiKey: "lmstudio",
            headers: {
              "X-LMStudio-Provider": "p",
            },
          },
        },
      },
    };

    const result = await createEmbeddingProvider({
      config: cfg as never,
      provider: "lmstudio",
      model: `lmstudio/${DEFAULT_LMSTUDIO_EMBEDDING_MODEL}`,
      fallback: "none",
    });

    await result.provider.embedQuery("hello");

    expect(result.provider.id).toBe("lmstudio");
    expect(authModule.resolveApiKeyForProvider).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:1234/v1/embeddings");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer lmstudio");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-LMStudio-Provider"]).toBe("p");
    const payload = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    expect(payload.model).toBe(DEFAULT_LMSTUDIO_EMBEDDING_MODEL);
  });
});

describe("embedding provider auto selection", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("prefers openai when a key resolves", async () => {
    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockImplementation(async ({ provider }) => {
      if (provider === "openai") {
        return { apiKey: "openai-key", source: "env: OPENAI_API_KEY", mode: "api-key" };
      }
      throw new Error(`No API key found for provider "${provider}".`);
    });

    const result = await createEmbeddingProvider({
      config: {} as never,
      provider: "auto",
      model: "",
      fallback: "none",
    });

    expect(result.requestedProvider).toBe("auto");
    expect(result.provider.id).toBe("openai");
  });

  it("uses Gemini default model when openai is missing but auto model is openai-specific", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: [1, 2, 3] } }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockImplementation(async ({ provider }) => {
      if (provider === "openai") {
        throw new Error('No API key found for provider "openai".');
      }
      if (provider === "google") {
        return { apiKey: "gemini-key", source: "env: GEMINI_API_KEY", mode: "api-key" };
      }
      throw new Error(`Unexpected provider ${provider}`);
    });

    const result = await createEmbeddingProvider({
      config: {} as never,
      provider: "auto",
      model: "text-embedding-3-small",
      fallback: "none",
    });

    expect(result.requestedProvider).toBe("auto");
    expect(result.provider.id).toBe("gemini");
    await result.provider.embedQuery("hello");
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_EMBEDDING_MODEL}:embedContent`,
    );
  });

  it("keeps explicit model when openai is selected", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [1, 2, 3] }] }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockImplementation(async ({ provider }) => {
      if (provider === "openai") {
        return { apiKey: "openai-key", source: "env: OPENAI_API_KEY", mode: "api-key" };
      }
      throw new Error(`Unexpected provider ${provider}`);
    });

    const result = await createEmbeddingProvider({
      config: {} as never,
      provider: "auto",
      model: "text-embedding-3-small",
      fallback: "none",
    });

    expect(result.requestedProvider).toBe("auto");
    expect(result.provider.id).toBe("openai");
    await result.provider.embedQuery("hello");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      model?: string;
      dimensions?: number;
    };
    expect(payload.model).toBe("text-embedding-3-small");
    expect(payload.dimensions).toBeUndefined();
  });
});

describe("embedding provider local fallback", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.doUnmock("./node-llama.js");
  });

  it("falls back to openai when node-llama-cpp is missing", async () => {
    vi.doMock("./node-llama.js", () => ({
      importNodeLlamaCpp: async () => {
        throw Object.assign(new Error("Cannot find package 'node-llama-cpp'"), {
          code: "ERR_MODULE_NOT_FOUND",
        });
      },
    }));

    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "provider-key",
      mode: "api-key",
      source: "test",
    });

    const result = await createEmbeddingProvider({
      config: {} as never,
      provider: "local",
      model: "text-embedding-3-small",
      fallback: "openai",
    });

    expect(result.provider.id).toBe("openai");
    expect(result.fallbackFrom).toBe("local");
    expect(result.fallbackReason).toContain("node-llama-cpp");
  });

  it("throws a helpful error when local is requested and fallback is none", async () => {
    vi.doMock("./node-llama.js", () => ({
      importNodeLlamaCpp: async () => {
        throw Object.assign(new Error("Cannot find package 'node-llama-cpp'"), {
          code: "ERR_MODULE_NOT_FOUND",
        });
      },
    }));

    const { createEmbeddingProvider } = await import("./embeddings.js");

    await expect(
      createEmbeddingProvider({
        config: {} as never,
        provider: "local",
        model: "text-embedding-3-small",
        fallback: "none",
      }),
    ).rejects.toThrow(/optional dependency node-llama-cpp/i);
  });

  it("falls back to ollama when local is unavailable", async () => {
    vi.doMock("./node-llama.js", () => ({
      importNodeLlamaCpp: async () => {
        throw Object.assign(new Error("Cannot find package 'node-llama-cpp'"), {
          code: "ERR_MODULE_NOT_FOUND",
        });
      },
    }));

    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "ollama-key",
      mode: "api-key",
      source: "test",
    });

    const result = await createEmbeddingProvider({
      config: {
        models: {
          providers: {
            ollama: {
              baseUrl: "http://127.0.0.1:11434/v1",
            },
          },
        },
      } as never,
      provider: "local",
      model: "nomic-embed-text",
      fallback: "ollama",
    });

    expect(result.provider.id).toBe("ollama");
    expect(result.fallbackFrom).toBe("local");
    expect(result.fallbackReason).toContain("node-llama-cpp");
    await result.provider.embedQuery("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("local embedding normalization", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.doUnmock("./node-llama.js");
  });

  it("normalizes local embeddings to magnitude ~1.0", async () => {
    const unnormalizedVector = [2.35, 3.45, 0.63, 4.3, 1.2, 5.1, 2.8, 3.9];

    vi.doMock("./node-llama.js", () => ({
      importNodeLlamaCpp: async () => ({
        getLlama: async () => ({
          loadModel: vi.fn().mockResolvedValue({
            createEmbeddingContext: vi.fn().mockResolvedValue({
              getEmbeddingFor: vi.fn().mockResolvedValue({
                vector: new Float32Array(unnormalizedVector),
              }),
            }),
          }),
        }),
        resolveModelFile: async () => "/fake/model.gguf",
        LlamaLogLevel: { error: 0 },
      }),
    }));

    const { createEmbeddingProvider } = await import("./embeddings.js");

    const result = await createEmbeddingProvider({
      config: {} as never,
      provider: "local",
      model: "",
      fallback: "none",
    });

    const embedding = await result.provider.embedQuery("test query");

    const magnitude = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));

    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  it("handles zero vector without division by zero", async () => {
    const zeroVector = [0, 0, 0, 0];

    vi.doMock("./node-llama.js", () => ({
      importNodeLlamaCpp: async () => ({
        getLlama: async () => ({
          loadModel: vi.fn().mockResolvedValue({
            createEmbeddingContext: vi.fn().mockResolvedValue({
              getEmbeddingFor: vi.fn().mockResolvedValue({
                vector: new Float32Array(zeroVector),
              }),
            }),
          }),
        }),
        resolveModelFile: async () => "/fake/model.gguf",
        LlamaLogLevel: { error: 0 },
      }),
    }));

    const { createEmbeddingProvider } = await import("./embeddings.js");

    const result = await createEmbeddingProvider({
      config: {} as never,
      provider: "local",
      model: "",
      fallback: "none",
    });

    const embedding = await result.provider.embedQuery("test");

    expect(embedding).toEqual([0, 0, 0, 0]);
    expect(embedding.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("sanitizes non-finite values before normalization", async () => {
    const nonFiniteVector = [1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    vi.doMock("./node-llama.js", () => ({
      importNodeLlamaCpp: async () => ({
        getLlama: async () => ({
          loadModel: vi.fn().mockResolvedValue({
            createEmbeddingContext: vi.fn().mockResolvedValue({
              getEmbeddingFor: vi.fn().mockResolvedValue({
                vector: new Float32Array(nonFiniteVector),
              }),
            }),
          }),
        }),
        resolveModelFile: async () => "/fake/model.gguf",
        LlamaLogLevel: { error: 0 },
      }),
    }));

    const { createEmbeddingProvider } = await import("./embeddings.js");

    const result = await createEmbeddingProvider({
      config: {} as never,
      provider: "local",
      model: "",
      fallback: "none",
    });

    const embedding = await result.provider.embedQuery("test");

    expect(embedding).toEqual([1, 0, 0, 0]);
    expect(embedding.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("normalizes batch embeddings to magnitude ~1.0", async () => {
    const unnormalizedVectors = [
      [2.35, 3.45, 0.63, 4.3],
      [10.0, 0.0, 0.0, 0.0],
      [1.0, 1.0, 1.0, 1.0],
    ];

    vi.doMock("./node-llama.js", () => ({
      importNodeLlamaCpp: async () => ({
        getLlama: async () => ({
          loadModel: vi.fn().mockResolvedValue({
            createEmbeddingContext: vi.fn().mockResolvedValue({
              getEmbeddingFor: vi
                .fn()
                .mockResolvedValueOnce({ vector: new Float32Array(unnormalizedVectors[0]) })
                .mockResolvedValueOnce({ vector: new Float32Array(unnormalizedVectors[1]) })
                .mockResolvedValueOnce({ vector: new Float32Array(unnormalizedVectors[2]) }),
            }),
          }),
        }),
        resolveModelFile: async () => "/fake/model.gguf",
        LlamaLogLevel: { error: 0 },
      }),
    }));

    const { createEmbeddingProvider } = await import("./embeddings.js");

    const result = await createEmbeddingProvider({
      config: {} as never,
      provider: "local",
      model: "",
      fallback: "none",
    });

    const embeddings = await result.provider.embedBatch(["text1", "text2", "text3"]);

    for (const embedding of embeddings) {
      const magnitude = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    }
  });
});

describe("V3 embedding contract", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("enables strict mode only when a V3 flag is turned on", async () => {
    const { shouldEnforceV3EmbeddingContract } = await import("./embedding-contract.js");

    expect(shouldEnforceV3EmbeddingContract({} as never)).toBe(false);
    expect(
      shouldEnforceV3EmbeddingContract({
        memory: { vault: { enabled: true } },
      } as never),
    ).toBe(true);
    expect(
      shouldEnforceV3EmbeddingContract({
        memory: { vault: { ingest: { enabled: true } } },
      } as never),
    ).toBe(true);
    expect(
      shouldEnforceV3EmbeddingContract({
        memory: { cognee: { enabled: true } },
      } as never),
    ).toBe(true);
    expect(
      shouldEnforceV3EmbeddingContract({
        agents: { defaults: { contemplation: { discoveryPhase: { enabled: true } } } },
      } as never),
    ).toBe(true);
  });

  it("skips preflight when V3 is disabled", async () => {
    const { runV3EmbeddingContractPreflight } = await import("./embedding-contract.js");
    const probe = vi.fn(async () => [1, 2, 3]);
    await runV3EmbeddingContractPreflight({
      config: {} as never,
      context: "test",
      probe,
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("fails preflight when V3 is enabled and dimensions do not match", async () => {
    const { runV3EmbeddingContractPreflight } = await import("./embedding-contract.js");
    await expect(
      runV3EmbeddingContractPreflight({
        config: { memory: { vault: { enabled: true } } } as never,
        context: "test",
        probe: async () => [1, 2, 3],
      }),
    ).rejects.toThrow(/Expected 768 dimensions/);
  });
});

describe("memu embedder V3 contract enforcement", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.doUnmock("./embeddings.js");
  });

  it("preserves existing behavior when V3 flags are off", async () => {
    vi.doMock("./embeddings.js", () => ({
      createEmbeddingProvider: vi.fn(async () => ({
        provider: {
          id: "mock",
          model: "mock-model",
          embedQuery: async () => [1, 2, 3],
          embedBatch: async () => [[1, 2, 3]],
        },
      })),
    }));

    const { getMemuEmbedder, resetMemuEmbedder } = await import("./memu-embed.js");
    resetMemuEmbedder();
    const embedder = await getMemuEmbedder({} as never);
    await expect(embedder.embed("hello")).resolves.toEqual([1, 2, 3]);
  });

  it("fails fast on dimension mismatch when V3 flags are enabled", async () => {
    vi.doMock("./embeddings.js", () => ({
      createEmbeddingProvider: vi.fn(async () => ({
        provider: {
          id: "mock",
          model: "mock-model",
          embedQuery: async () => [1, 2, 3],
          embedBatch: async () => [[1, 2, 3]],
        },
      })),
    }));

    const { getMemuEmbedder, resetMemuEmbedder } = await import("./memu-embed.js");
    resetMemuEmbedder();
    const embedder = await getMemuEmbedder({
      memory: {
        vault: {
          enabled: true,
        },
      },
    } as never);
    await expect(embedder.embed("hello")).rejects.toThrow(/Expected 768 dimensions/);
  });
});
