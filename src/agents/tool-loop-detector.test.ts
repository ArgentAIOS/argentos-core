import { describe, expect, it } from "vitest";
import { ToolLoopDetector } from "./tool-loop-detector.js";

describe("ToolLoopDetector", () => {
  it("aborts second music_generate call even when args differ", () => {
    const detector = new ToolLoopDetector();
    expect(detector.check("music_generate", { prompt: "one" })).toEqual({ action: "allow" });
    expect(detector.check("music_generate", { prompt: "two" })).toEqual({
      action: "abort",
      count: 2,
      toolName: "music_generate",
    });
  });

  it("keeps default consecutive behavior for non single-attempt tools", () => {
    const detector = new ToolLoopDetector();
    expect(detector.check("exec", { cmd: "ls" })).toEqual({ action: "allow" });
    expect(detector.check("exec", { cmd: "ls" })).toEqual({ action: "allow" });
    const third = detector.check("exec", { cmd: "ls" });
    expect(third.action).toBe("delay");
  });

  it("allows disabling single-attempt behavior by config", () => {
    const detector = new ToolLoopDetector({ singleAttemptTools: [] });
    expect(detector.check("music_generate", { prompt: "one" })).toEqual({ action: "allow" });
    expect(detector.check("music_generate", { prompt: "two" })).toEqual({ action: "allow" });
  });
});
