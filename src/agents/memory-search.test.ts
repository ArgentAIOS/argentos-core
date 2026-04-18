import { describe, expect, it } from "vitest";
import { resolveMemorySearchConfig } from "./memory-search.js";

describe("memory search config", () => {
  it("returns null when disabled", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: { enabled: true },
        },
        list: [
          {
            id: "main",
            default: true,
            memorySearch: { enabled: false },
          },
        ],
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved).toBeNull();
  });

  it("defaults provider to ollama when unspecified", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            enabled: true,
          },
        },
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.provider).toBe("ollama");
    expect(resolved?.fallback).toBe("none");
    expect(resolved?.model).toBe("nomic-embed-text");
    expect(resolved?.sync.watch).toBe(false);
    expect(resolved?.query.hybrid.mmr).toEqual({ enabled: false, lambda: 0.7 });
    expect(resolved?.query.hybrid.temporalDecay).toEqual({
      enabled: false,
      halfLifeDays: 30,
    });
  });

  it("accepts hybrid phase C overrides", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            query: {
              hybrid: {
                mmr: { enabled: true, lambda: 0.6 },
                temporalDecay: { enabled: true, halfLifeDays: 14 },
              },
            },
          },
        },
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.query.hybrid.mmr).toEqual({ enabled: true, lambda: 0.6 });
    expect(resolved?.query.hybrid.temporalDecay).toEqual({
      enabled: true,
      halfLifeDays: 14,
    });
  });

  it("merges defaults and overrides", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "openai",
            model: "text-embedding-3-small",
            store: {
              vector: {
                enabled: false,
                extensionPath: "/opt/sqlite-vec.dylib",
              },
            },
            chunking: { tokens: 500, overlap: 100 },
            query: { maxResults: 4, minScore: 0.2 },
          },
        },
        list: [
          {
            id: "main",
            default: true,
            memorySearch: {
              chunking: { tokens: 320 },
              query: { maxResults: 8 },
              store: {
                vector: {
                  enabled: true,
                },
              },
            },
          },
        ],
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.provider).toBe("openai");
    expect(resolved?.model).toBe("text-embedding-3-small");
    expect(resolved?.chunking.tokens).toBe(320);
    expect(resolved?.chunking.overlap).toBe(100);
    expect(resolved?.query.maxResults).toBe(8);
    expect(resolved?.query.minScore).toBe(0.2);
    expect(resolved?.store.vector.enabled).toBe(true);
    expect(resolved?.store.vector.extensionPath).toBe("/opt/sqlite-vec.dylib");
  });

  it("merges extra memory paths from defaults and overrides", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            extraPaths: ["/shared/notes", " docs "],
          },
        },
        list: [
          {
            id: "main",
            default: true,
            memorySearch: {
              extraPaths: ["/shared/notes", "../team-notes"],
            },
          },
        ],
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.extraPaths).toEqual(["/shared/notes", "docs", "../team-notes"]);
  });

  it("includes batch defaults for openai without remote overrides", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "openai",
          },
        },
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.remote?.batch).toEqual({
      enabled: true,
      wait: true,
      concurrency: 2,
      pollIntervalMs: 2000,
      timeoutMinutes: 60,
    });
  });

  it("keeps remote unset for local provider without overrides", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "local",
          },
        },
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.remote).toBeUndefined();
  });

  it("includes remote defaults for gemini without overrides", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "gemini",
          },
        },
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.remote?.batch).toEqual({
      enabled: true,
      wait: true,
      concurrency: 2,
      pollIntervalMs: 2000,
      timeoutMinutes: 60,
    });
  });

  it("includes remote defaults for lmstudio without overrides", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "lmstudio",
          },
        },
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.provider).toBe("lmstudio");
    expect(resolved?.model).toBe("text-embedding-nomic-embed-text-v1.5");
    expect(resolved?.remote?.batch).toEqual({
      enabled: true,
      wait: true,
      concurrency: 2,
      pollIntervalMs: 2000,
      timeoutMinutes: 60,
    });
  });

  it("normalizes legacy OpenAI-compatible LM Studio configs", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "openai",
            remote: {
              baseUrl: "http://127.0.0.1:1234/v1",
            },
          },
        },
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.provider).toBe("lmstudio");
    expect(resolved?.model).toBe("text-embedding-nomic-embed-text-v1.5");
  });

  it("normalizes legacy OpenAI-compatible Ollama configs", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "openai",
            remote: {
              baseUrl: "http://127.0.0.1:11434/v1",
            },
          },
        },
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.provider).toBe("ollama");
    expect(resolved?.model).toBe("nomic-embed-text");
  });

  it("defaults session delta thresholds", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "openai",
          },
        },
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.sync.sessions).toEqual({
      deltaBytes: 100000,
      deltaMessages: 50,
    });
  });

  it("merges remote defaults with agent overrides", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "openai",
            remote: {
              baseUrl: "https://default.example/v1",
              apiKey: "default-key",
              headers: { "X-Default": "on" },
            },
          },
        },
        list: [
          {
            id: "main",
            default: true,
            memorySearch: {
              remote: {
                baseUrl: "https://agent.example/v1",
              },
            },
          },
        ],
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.remote).toEqual({
      baseUrl: "https://agent.example/v1",
      apiKey: "default-key",
      headers: { "X-Default": "on" },
      batch: {
        enabled: true,
        wait: true,
        concurrency: 2,
        pollIntervalMs: 2000,
        timeoutMinutes: 60,
      },
    });
  });

  it("gates session sources behind experimental flag", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "openai",
            sources: ["memory", "sessions"],
          },
        },
        list: [
          {
            id: "main",
            default: true,
            memorySearch: {
              experimental: { sessionMemory: false },
            },
          },
        ],
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.sources).toEqual(["memory"]);
  });

  it("allows session sources when experimental flag is enabled", () => {
    const cfg = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "openai",
            sources: ["memory", "sessions"],
            experimental: { sessionMemory: true },
          },
        },
      },
    };
    const resolved = resolveMemorySearchConfig(cfg, "main");
    expect(resolved?.sources).toContain("sessions");
  });
});
