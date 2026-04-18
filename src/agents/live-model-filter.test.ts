import { describe, expect, it } from "vitest";
import { isModernModelRef } from "./live-model-filter.js";

describe("isModernModelRef", () => {
  it("treats MiniMax M2.7 as a modern model", () => {
    expect(isModernModelRef({ provider: "minimax", id: "MiniMax-M2.7" })).toBe(true);
  });

  it("treats OpenRouter MiniMax M2.7 as a modern model", () => {
    expect(isModernModelRef({ provider: "openrouter", id: "minimax/minimax-m2.7" })).toBe(true);
  });

  it("does not treat MiniMax M2 as a modern model", () => {
    expect(isModernModelRef({ provider: "minimax", id: "MiniMax-M2" })).toBe(false);
  });
});
