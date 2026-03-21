import { describe, expect, it } from "vitest";
import { getAgentCoreRuntimeDiagnostics } from "./diagnostics.js";

describe("agent-core diagnostics", () => {
  it("reports default runtime state", () => {
    const d = getAgentCoreRuntimeDiagnostics({});
    expect(d.mode).toBe("pi_only");
    expect(d.isArgentRuntime).toBe(false);
    expect(d.piFallbackAllowed).toBe(false);
    expect(d.source).toBe("default");
  });

  it("reports explicit mode source when ARGENT_RUNTIME_MODE is set", () => {
    const d = getAgentCoreRuntimeDiagnostics({
      ARGENT_RUNTIME_MODE: "argent_with_fallback",
      ARGENT_RUNTIME: "false",
    });
    expect(d.mode).toBe("argent_with_fallback");
    expect(d.isArgentRuntime).toBe(true);
    expect(d.piFallbackAllowed).toBe(true);
    expect(d.source).toBe("explicit_mode");
    expect(d.env.runtimeModeRaw).toBe("argent_with_fallback");
    expect(d.env.runtimeBoolRaw).toBe("false");
  });

  it("reports legacy bool source when only ARGENT_RUNTIME is set", () => {
    const d = getAgentCoreRuntimeDiagnostics({
      ARGENT_RUNTIME: "true",
    });
    expect(d.mode).toBe("argent_with_fallback");
    expect(d.isArgentRuntime).toBe(true);
    expect(d.piFallbackAllowed).toBe(true);
    expect(d.source).toBe("legacy_bool");
    expect(d.env.runtimeModeRaw).toBeUndefined();
    expect(d.env.runtimeBoolRaw).toBe("true");
  });

  it("reports strict mode correctly", () => {
    const d = getAgentCoreRuntimeDiagnostics({
      ARGENT_RUNTIME_MODE: "argent_strict",
    });
    expect(d.mode).toBe("argent_strict");
    expect(d.isArgentRuntime).toBe(true);
    expect(d.piFallbackAllowed).toBe(false);
    expect(d.source).toBe("explicit_mode");
  });
});
