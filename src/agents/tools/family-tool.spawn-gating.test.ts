import { describe, expect, it } from "vitest";
import { createFamilyTool } from "./family-tool.js";

describe("family spawn gating", () => {
  it('rejects direct family.spawn unless mode="family" is explicit', async () => {
    const tool = createFamilyTool();
    await tool.execute("reset", { action: "telemetry", reset: true });

    const result = await tool.execute("call1", {
      action: "spawn",
      id: "elon",
      task: "research tenant access",
    });

    expect(result.details).toMatchObject({
      ok: false,
    });
    expect((result.details as { error?: string }).error).toContain("family.dispatch");
    expect((result.details as { error?: string }).error).toContain('mode="family"');

    const telemetry = await tool.execute("stats", { action: "telemetry" });
    const counters = (
      telemetry.details as {
        telemetry?: { counters?: Record<string, number> };
      }
    ).telemetry?.counters;
    expect(counters?.spawnDirectBlocked).toBeGreaterThanOrEqual(1);
  });
});
