/**
 * GH #220 — vitest coverage for the LM Studio dropdown partitioning helpers.
 *
 * The dashboard test suite uses vitest with no jsdom — these are pure,
 * deterministic helper tests that pin down the loaded/not-loaded distinction
 * the dropdown render branches on. See `local-model-probe.test.cjs` for the
 * server-side probe coverage.
 */

import { describe, expect, it } from "vitest";
import {
  formatRuntimeSummary,
  isSelectedModelNotLoaded,
  partitionRuntimeByLoadState,
  type LocalRuntime,
} from "./lmStudioDropdown.helpers";

function mkRuntime(partial: Partial<LocalRuntime> = {}): LocalRuntime {
  return {
    provider: "lmstudio",
    label: "LM Studio (Local)",
    running: true,
    source: "v0",
    models: [],
    ...partial,
  };
}

describe("partitionRuntimeByLoadState", () => {
  it("splits mixed loaded / not-loaded / unknown models", () => {
    const runtime = mkRuntime({
      models: [
        { id: "a", ref: "lmstudio/a", label: "lmstudio/a", loaded: true },
        { id: "b", ref: "lmstudio/b", label: "lmstudio/b", loaded: false },
        { id: "c", ref: "lmstudio/c", label: "lmstudio/c", loaded: true },
        { id: "d", ref: "lmstudio/d", label: "lmstudio/d", loaded: null },
        { id: "e", ref: "lmstudio/e", label: "lmstudio/e" /* no flag */ },
      ],
    });
    const result = partitionRuntimeByLoadState(runtime);
    expect(result.loaded.map((m) => m.id)).toEqual(["a", "c"]);
    expect(result.unloaded.map((m) => m.id)).toEqual(["b"]);
    expect(result.unknown.map((m) => m.id)).toEqual(["d", "e"]);
    expect(result.hasLoadStateSignal).toBe(true);
  });

  it("returns hasLoadStateSignal=false for legacy v1 catalog (no per-model state)", () => {
    // Server fell back to /v1/models — all entries surface as loaded: null,
    // so the UI must NOT render badges as if it knew the load state.
    const runtime = mkRuntime({
      source: "v1",
      models: [
        {
          id: "qwen/qwen3.6-27b",
          ref: "lmstudio/qwen/qwen3.6-27b",
          label: "lmstudio/qwen/qwen3.6-27b",
          loaded: null,
        },
        {
          id: "google/gemma-4-31b",
          ref: "lmstudio/google/gemma-4-31b",
          label: "lmstudio/google/gemma-4-31b",
          loaded: null,
        },
      ],
    });
    const result = partitionRuntimeByLoadState(runtime);
    expect(result.hasLoadStateSignal).toBe(false);
    // All entries land in `unknown` so the legacy flat-list branch renders them.
    expect(result.unknown.length).toBe(2);
    expect(result.loaded.length).toBe(0);
    expect(result.unloaded.length).toBe(0);
  });

  it("returns hasLoadStateSignal=false when source is missing (Ollama, undetected runtimes)", () => {
    const runtime = mkRuntime({
      provider: "ollama",
      label: "Ollama (Local)",
      source: undefined,
      models: [{ id: "qwen3:30b", ref: "ollama/qwen3:30b", label: "ollama/qwen3:30b" }],
    });
    const result = partitionRuntimeByLoadState(runtime);
    expect(result.hasLoadStateSignal).toBe(false);
  });

  it("handles a runtime where every model is not-loaded (worst case for the bug)", () => {
    // The exact case from GH #220: LM Studio reports 8 registered models,
    // 0 loaded. UI must still render all 8 with the 'loads on demand' badge,
    // never as 'available now'.
    const runtime = mkRuntime({
      models: Array.from({ length: 8 }, (_, i) => ({
        id: `m${i}`,
        ref: `lmstudio/m${i}`,
        label: `lmstudio/m${i}`,
        loaded: false as const,
      })),
    });
    const result = partitionRuntimeByLoadState(runtime);
    expect(result.loaded).toHaveLength(0);
    expect(result.unloaded).toHaveLength(8);
    // Even with zero loaded, the signal is present because we have unloaded entries.
    expect(result.hasLoadStateSignal).toBe(true);
  });
});

describe("isSelectedModelNotLoaded", () => {
  const runtimes: LocalRuntime[] = [
    mkRuntime({
      models: [
        { id: "live", ref: "lmstudio/live", label: "lmstudio/live", loaded: true },
        { id: "cold", ref: "lmstudio/cold", label: "lmstudio/cold", loaded: false },
        { id: "unknown", ref: "lmstudio/unknown", label: "lmstudio/unknown", loaded: null },
      ],
    }),
    mkRuntime({
      provider: "ollama",
      label: "Ollama (Local)",
      source: undefined,
      models: [{ id: "q3", ref: "ollama/q3", label: "ollama/q3" }],
    }),
  ];

  it("returns true ONLY for v0-reported not-loaded models", () => {
    expect(isSelectedModelNotLoaded(runtimes, "lmstudio/cold")).toBe(true);
  });

  it("returns false for currently-loaded models", () => {
    expect(isSelectedModelNotLoaded(runtimes, "lmstudio/live")).toBe(false);
  });

  it("returns false for unknown-state models (don't bother the user with a warning we can't justify)", () => {
    expect(isSelectedModelNotLoaded(runtimes, "lmstudio/unknown")).toBe(false);
  });

  it("returns false for Ollama (no load-state signal)", () => {
    expect(isSelectedModelNotLoaded(runtimes, "ollama/q3")).toBe(false);
  });

  it("returns false for empty / unmatched refs", () => {
    expect(isSelectedModelNotLoaded(runtimes, "")).toBe(false);
    expect(isSelectedModelNotLoaded(runtimes, "lmstudio/does-not-exist")).toBe(false);
  });
});

describe("formatRuntimeSummary", () => {
  it("annotates with loaded/registered counts when v0 data is present", () => {
    const runtime = mkRuntime({
      models: [
        { id: "a", ref: "lmstudio/a", label: "lmstudio/a", loaded: true },
        { id: "b", ref: "lmstudio/b", label: "lmstudio/b", loaded: false },
        { id: "c", ref: "lmstudio/c", label: "lmstudio/c", loaded: false },
      ],
    });
    expect(formatRuntimeSummary(runtime)).toBe("LM Studio (Local) (1 loaded / 3 registered)");
  });

  it("falls back to plain registered count for legacy v1 / Ollama", () => {
    const runtime = mkRuntime({
      source: "v1",
      models: [
        { id: "a", ref: "lmstudio/a", label: "lmstudio/a", loaded: null },
        { id: "b", ref: "lmstudio/b", label: "lmstudio/b", loaded: null },
      ],
    });
    expect(formatRuntimeSummary(runtime)).toBe("LM Studio (Local) (2)");
  });
});
