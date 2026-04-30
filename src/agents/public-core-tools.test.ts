import { describe, expect, it } from "vitest";
import { resolveBuiltinToolAllowlist } from "./public-core-tools.js";

describe("public core builtin tools", () => {
  it("allows the Core SpecForge strict guide tool", () => {
    const allowlist = resolveBuiltinToolAllowlist({
      config: {
        distribution: { surfaceProfile: "public-core" },
      },
    });

    expect(allowlist?.has("specforge")).toBe(true);
  });
});
