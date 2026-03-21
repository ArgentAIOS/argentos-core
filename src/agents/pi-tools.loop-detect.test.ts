import { describe, expect, it, vi } from "vitest";
import { TOOL_LOOP_BUDGET_MARKER, wrapToolWithLoopDetection } from "./pi-tools.loop-detect.js";
import { ToolLoopDetector } from "./tool-loop-detector.js";

describe("wrapToolWithLoopDetection", () => {
  it("returns a loop-stop result instead of throwing when per-tool budget is exceeded", async () => {
    const execute = vi.fn(async () => "ok");
    const tool = {
      name: "exec",
      description: "test",
      parameters: { type: "object", properties: {} },
      execute,
    };
    const wrapped = wrapToolWithLoopDetection(tool, new ToolLoopDetector());

    for (let index = 0; index < 5; index += 1) {
      await expect(wrapped.execute?.(`call-${index}`, { command: `cmd-${index}` })).resolves.toBe(
        "ok",
      );
    }

    await expect(wrapped.execute?.("call-6", { command: "cmd-6" })).resolves.toContain(
      TOOL_LOOP_BUDGET_MARKER,
    );
    expect(execute).toHaveBeenCalledTimes(5);
  });
});
