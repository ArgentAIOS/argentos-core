import { describe, expect, it, vi } from "vitest";
import { applyNonInteractiveAuthChoice } from "./auth-choice.js";

describe("applyNonInteractiveAuthChoice local runtimes", () => {
  const runtime = {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };

  it("applies LM Studio defaults in non-interactive onboarding", async () => {
    const result = await applyNonInteractiveAuthChoice({
      nextConfig: {},
      authChoice: "lmstudio",
      opts: {},
      runtime,
      baseConfig: {},
    });

    expect(result?.agents?.defaults?.model?.primary).toBe("lmstudio/qwen/qwen3.5-35b-a3b");
    expect(result?.agents?.defaults?.memorySearch).toMatchObject({
      provider: "lmstudio",
      model: "text-embedding-nomic-embed-text-v1.5",
      fallback: "none",
    });
  });

  it("applies Ollama defaults in non-interactive onboarding", async () => {
    const result = await applyNonInteractiveAuthChoice({
      nextConfig: {},
      authChoice: "ollama",
      opts: {},
      runtime,
      baseConfig: {},
    });

    expect(result?.agents?.defaults?.model?.primary).toBe(
      "ollama/qwen3:30b-a3b-instruct-2507-q4_K_M",
    );
    expect(result?.agents?.defaults?.memorySearch).toMatchObject({
      provider: "ollama",
      model: "nomic-embed-text",
      fallback: "none",
    });
  });
});
