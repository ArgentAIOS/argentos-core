import { describe, expect, it } from "vitest";
import {
  assertPiFallbackAllowed,
  allowsPiFallback,
  isArgentRuntimeMode,
  resolveAgentCoreRuntimeMode,
} from "./runtime-policy.js";

describe("agent-core runtime policy", () => {
  it("defaults to pi_only when no env vars are set", () => {
    expect(resolveAgentCoreRuntimeMode({})).toBe("pi_only");
  });

  it("honors explicit ARGENT_RUNTIME_MODE values", () => {
    expect(resolveAgentCoreRuntimeMode({ ARGENT_RUNTIME_MODE: "pi_only" })).toBe("pi_only");
    expect(resolveAgentCoreRuntimeMode({ ARGENT_RUNTIME_MODE: "argent_with_fallback" })).toBe(
      "argent_with_fallback",
    );
    expect(resolveAgentCoreRuntimeMode({ ARGENT_RUNTIME_MODE: "argent_strict" })).toBe(
      "argent_strict",
    );
    expect(resolveAgentCoreRuntimeMode({ ARGENT_RUNTIME_MODE: "strict" })).toBe("argent_strict");
  });

  it("falls back to legacy ARGENT_RUNTIME=true when mode is unset", () => {
    expect(resolveAgentCoreRuntimeMode({ ARGENT_RUNTIME: "true" })).toBe("argent_with_fallback");
    expect(resolveAgentCoreRuntimeMode({ ARGENT_RUNTIME: "1" })).toBe("argent_with_fallback");
    expect(resolveAgentCoreRuntimeMode({ ARGENT_RUNTIME: "false" })).toBe("pi_only");
  });

  it("prefers explicit mode over legacy boolean", () => {
    expect(
      resolveAgentCoreRuntimeMode({
        ARGENT_RUNTIME_MODE: "pi_only",
        ARGENT_RUNTIME: "true",
      }),
    ).toBe("pi_only");
  });

  it("computes helper predicates correctly", () => {
    expect(isArgentRuntimeMode("pi_only")).toBe(false);
    expect(isArgentRuntimeMode("argent_with_fallback")).toBe(true);
    expect(isArgentRuntimeMode("argent_strict")).toBe(true);

    expect(allowsPiFallback("pi_only")).toBe(false);
    expect(allowsPiFallback("argent_with_fallback")).toBe(true);
    expect(allowsPiFallback("argent_strict")).toBe(false);
  });

  it("assertPiFallbackAllowed allows only fallback mode", () => {
    expect(() => assertPiFallbackAllowed("argent_with_fallback", "test-op")).not.toThrow();
    expect(() => assertPiFallbackAllowed("pi_only", "test-op")).toThrow(
      "Pi fallback unavailable in pi_only mode",
    );
    expect(() => assertPiFallbackAllowed("argent_strict", "test-op")).toThrow(
      "Pi fallback blocked in argent_strict mode",
    );
  });
});
