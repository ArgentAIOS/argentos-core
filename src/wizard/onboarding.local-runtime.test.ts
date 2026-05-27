import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import {
  applyLocalRuntimeConfig,
  rankDiscoveredLocalRuntimeModels,
} from "./onboarding.local-runtime.js";

describe("rankDiscoveredLocalRuntimeModels", () => {
  it("prefers Qwen text models and Nomic embeddings for Ollama", () => {
    const ranked = rankDiscoveredLocalRuntimeModels("ollama", {
      textModels: ["llama3.2:latest", "qwen3:14b", "deepseek-r1:8b"],
      embeddingModels: ["bge-m3", "nomic-embed-text", "e5-large-v2"],
    });

    // The injected default (qwen3.5:9b-mlx) is current-generation MLX-native and
    // outranks the discovered qwen3:14b on the Apple Silicon preference, so it
    // should sort first. qwen3:14b still places ahead of llama/deepseek.
    expect(ranked.textModels[0]).toBe("qwen3.5:9b-mlx");
    expect(ranked.textModels).toContain("qwen3:14b");
    expect(ranked.embeddingModels[0]).toBe("nomic-embed-text");
  });

  it("prefers newer MLX/MoE variants over older dense models when both are present", () => {
    // Regression test for the May 2026 scoring update: MLX-native and MoE-active
    // bonuses must put qwen3.6:35b-mlx above plain qwen3:14b on Apple Silicon.
    const ranked = rankDiscoveredLocalRuntimeModels("ollama", {
      textModels: ["qwen3:14b", "qwen3.6:35b-mlx", "qwen3.5:9b-mlx"],
      embeddingModels: ["nomic-embed-text"],
    });

    // qwen3.6:35b-mlx scores: qwen3.6 (+110) + 35b (+20) + mlx (+30) = 160
    // qwen3.5:9b-mlx scores:  qwen3.5 (+105) + 9b (+20) + mlx (+30)  = 155
    // qwen3:14b scores:       qwen3   (+100) + 14b (+20)             = 120
    expect(ranked.textModels[0]).toBe("qwen3.6:35b-mlx");
    expect(ranked.textModels[1]).toBe("qwen3.5:9b-mlx");
    expect(ranked.textModels[2]).toBe("qwen3:14b");
  });

  it("keeps defaults present even when discovery is empty", () => {
    const ranked = rankDiscoveredLocalRuntimeModels("lmstudio", {
      textModels: [],
      embeddingModels: [],
    });

    expect(ranked.textModels).toContain("qwen3.6-35b-a3b");
    expect(ranked.embeddingModels).toContain("nomic-embed-text");
  });
});

describe("applyLocalRuntimeConfig — Phase C kernel.localModel wiring", () => {
  const emptyConfig: ArgentConfig = {
    agents: { defaults: {}, list: [{ id: "main" }] },
  };

  it("sets agents.defaults.kernel.localModel to ollama/<model> for the ollama branch", () => {
    const cfg = applyLocalRuntimeConfig({
      choice: "ollama",
      config: emptyConfig,
      textModel: "qwen3.5:9b-mlx",
      embeddingModel: "nomic-embed-text",
    });
    expect(cfg.agents?.defaults?.kernel?.localModel).toBe("ollama/qwen3.5:9b-mlx");
  });

  it("sets agents.defaults.kernel.localModel to lmstudio/<model> for the lmstudio branch", () => {
    const cfg = applyLocalRuntimeConfig({
      choice: "lmstudio",
      config: emptyConfig,
      textModel: "qwen3.6-35b-a3b",
      embeddingModel: "nomic-embed-text",
    });
    expect(cfg.agents?.defaults?.kernel?.localModel).toBe("lmstudio/qwen3.6-35b-a3b");
  });

  it("preserves other kernel knobs the operator already set (tickMs, idleActivityGateMinutes, etc.)", () => {
    const existing: ArgentConfig = {
      agents: {
        defaults: {
          kernel: {
            enabled: true,
            tickMs: 60_000,
            idleActivityGateMinutes: 45,
            // @ts-expect-error - localModel isn't required to be in the type for this test
            localModel: "lmstudio/old-model",
          },
        },
        list: [{ id: "main" }],
      },
    };
    const cfg = applyLocalRuntimeConfig({
      choice: "ollama",
      config: existing,
      textModel: "qwen3.5:9b-mlx",
      embeddingModel: "nomic-embed-text",
    });
    expect(cfg.agents?.defaults?.kernel).toMatchObject({
      enabled: true,
      tickMs: 60_000,
      idleActivityGateMinutes: 45,
      localModel: "ollama/qwen3.5:9b-mlx", // overwritten to match new choice
    });
  });
});
