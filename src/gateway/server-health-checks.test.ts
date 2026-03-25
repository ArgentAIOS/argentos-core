import { describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { runHealthCheck } from "./server-health-checks.js";

describe("server health checks", () => {
  it("skips Ollama probing when LM Studio is the selected local runtime", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

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
      const result = await runHealthCheck(undefined, config as ArgentConfig);
      expect(result.localRuntimeProvider).toBe("lmstudio");
      expect(result.ollamaProbed).toBe(false);
      expect(result.ollamaReachable).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
