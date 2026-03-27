import { describe, expect, it } from "vitest";
import { rankDiscoveredLocalRuntimeModels } from "./onboarding.local-runtime.js";

describe("rankDiscoveredLocalRuntimeModels", () => {
  it("prefers Qwen text models and Nomic embeddings for Ollama", () => {
    const ranked = rankDiscoveredLocalRuntimeModels("ollama", {
      textModels: ["llama3.2:latest", "qwen3:14b", "deepseek-r1:8b"],
      embeddingModels: ["bge-m3", "nomic-embed-text", "e5-large-v2"],
    });

    expect(ranked.textModels[0]).toBe("qwen3:14b");
    expect(ranked.embeddingModels[0]).toBe("nomic-embed-text");
  });

  it("keeps defaults present even when discovery is empty", () => {
    const ranked = rankDiscoveredLocalRuntimeModels("lmstudio", {
      textModels: [],
      embeddingModels: [],
    });

    expect(ranked.textModels).toContain("qwen3-32b");
    expect(ranked.embeddingModels).toContain("nomic-embed-text");
  });
});
