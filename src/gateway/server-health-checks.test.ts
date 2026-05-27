import { describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { pingOllama, runHealthCheck } from "./server-health-checks.js";

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

  // Regression test for the 2026-05-24 ollama=down false-positive bug.
  // pingOllama was using `localhost`, which Node's `fetch` (undici) resolves
  // to IPv6 `::1` first on macOS. Ollama binds only to IPv4 (`127.0.0.1`), so
  // the probe ECONNREFUSED'd in ~3ms and the catch returned false. Fix: use
  // the IPv4 literal so DNS address-selection can't go wrong.
  it("pingOllama targets the IPv4 literal so it works with Ollama's default IPv4-only bind", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await pingOllama();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const requestedUrl = fetchSpy.mock.calls[0]?.[0];
      expect(requestedUrl).toBe("http://127.0.0.1:11434/api/tags");
      // Specifically NOT "localhost" — that's what caused the bug.
      expect(requestedUrl).not.toMatch(/localhost/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
