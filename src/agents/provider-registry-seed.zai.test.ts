import { describe, expect, it } from "vitest";
import { buildSeedRegistry } from "./provider-registry-seed.js";

describe("provider-registry seed — zai entry (issue #269)", () => {
  it("includes a zai provider in the seed", () => {
    const seed = buildSeedRegistry();
    expect(seed.providers.zai).toBeDefined();
  });

  it("zai entry is wired for openai-completions over api.z.ai", () => {
    const seed = buildSeedRegistry();
    const zai = seed.providers.zai;
    expect(zai).toBeDefined();
    if (!zai) {
      return;
    }
    expect(zai.baseUrl).toBe("https://api.z.ai/api/paas/v4");
    expect(zai.api).toBe("openai-completions");
    expect(zai.authType).toBe("api_key");
    expect(zai.envKeyVar).toBe("ZAI_API_KEY");
  });

  it("seeds the 8 GLM models that exist in models-db", () => {
    const seed = buildSeedRegistry();
    const zai = seed.providers.zai;
    expect(zai).toBeDefined();
    if (!zai) {
      return;
    }
    const ids = zai.models.map((m) => m.id).sort();
    expect(ids).toEqual(
      [
        "glm-4.5",
        "glm-4.5-air",
        "glm-4.5-flash",
        "glm-4.6",
        "glm-4.7",
        "glm-4.7-flash",
        "glm-5",
        "glm-5-turbo",
      ].sort(),
    );
  });
});
