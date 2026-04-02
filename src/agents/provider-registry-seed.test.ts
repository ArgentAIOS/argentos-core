import { describe, expect, it } from "vitest";
import { buildSeedRegistry } from "./provider-registry-seed.js";

describe("buildSeedRegistry", () => {
  it("seeds Z.AI with GLM 5 / 5.1 inventory", () => {
    const registry = buildSeedRegistry();
    const zai = registry.providers.zai;

    expect(zai?.models?.map((model) => model.id)).toEqual(
      expect.arrayContaining(["glm-5.1", "glm-5", "glm-4.7"]),
    );
  });
});
