import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";

describe("Ollama provider", () => {
  it("should not include ollama when no API key is configured", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "argent-test-"));
    vi.resetModules();
    const { resolveImplicitProviders } = await import("./models-config.providers.js");
    const providers = await resolveImplicitProviders({ agentDir });

    // Ollama requires explicit configuration via OLLAMA_API_KEY env var or profile
    expect(providers?.ollama).toBeUndefined();
  });

  it("includes inception when INCEPTION_API_KEY exists in service-keys", async () => {
    const previousHome = process.env.HOME;
    const homeDir = mkdtempSync(join(tmpdir(), "argent-home-"));
    const serviceKeysDir = join(homeDir, ".argentos");
    const agentDir = mkdtempSync(join(tmpdir(), "argent-test-"));

    mkdirSync(serviceKeysDir, { recursive: true });
    writeFileSync(
      join(serviceKeysDir, "service-keys.json"),
      JSON.stringify(
        {
          version: 1,
          keys: [
            {
              id: "sk-inception-test",
              name: "Inception API key",
              variable: "INCEPTION_API_KEY",
              value: "inception-test-key",
              enabled: true,
            },
          ],
        },
        null,
        2,
      ),
    );

    process.env.HOME = homeDir;
    try {
      vi.resetModules();
      const { resolveImplicitProviders } = await import("./models-config.providers.js");
      const providers = await resolveImplicitProviders({ agentDir });
      expect(providers?.inception?.apiKey).toBe("INCEPTION_API_KEY");
      expect(providers?.inception?.models.some((model) => model.id === "mercury-2")).toBe(true);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });

  it("skips noisy Ollama discovery when LM Studio is the selected local runtime", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "argent-test-"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("OLLAMA_API_KEY", "ollama-test-key");
    const config = {
      agents: {
        defaults: {
          kernel: {
            localModel: "lmstudio/qwen/qwen3.5-35b-a3b",
          },
          memorySearch: {
            provider: "lmstudio",
            fallback: "none",
            model: "text-embedding-nomic-embed-text-v1.5",
          },
        },
      },
    } satisfies Partial<ArgentConfig>;

    try {
      vi.resetModules();
      const { resolveImplicitProviders } = await import("./models-config.providers.js");
      const providers = await resolveImplicitProviders({
        agentDir,
        config: config as ArgentConfig,
      });
      expect(providers?.ollama).toBeDefined();
      expect(providers?.ollama?.models).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
  it("includes lmstudio when kernel localModel is configured without API auth", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "argent-test-"));
    const config = {
      agents: {
        defaults: {
          kernel: {
            localModel: "lmstudio/qwen/qwen3.5-35b-a3b",
          },
        },
      },
    } satisfies Partial<ArgentConfig>;

    vi.resetModules();
    const { resolveImplicitProviders } = await import("./models-config.providers.js");
    const providers = await resolveImplicitProviders({
      agentDir,
      config: config as ArgentConfig,
    });

    expect(providers?.lmstudio).toBeDefined();
    expect(providers?.lmstudio?.baseUrl).toBe("http://127.0.0.1:1234/v1");
    expect(providers?.lmstudio?.models).toEqual([]);
  });
});
