import { describe, expect, it } from "vitest";
import { isModernModelRef } from "./live-model-filter.js";

describe("isModernModelRef", () => {
  it("accepts newer GLM 5.x Z.AI models", () => {
    expect(isModernModelRef({ provider: "zai", id: "glm-5.1" })).toBe(true);
    expect(isModernModelRef({ provider: "zai", id: "glm-5" })).toBe(true);
  });
});
