import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

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
});
