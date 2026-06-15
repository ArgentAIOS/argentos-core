import { describe, expect, it, vi } from "vitest";
import { type ProposedAction, wrapToolForSimulate } from "./simulate-tool-stub.js";

describe("wrapToolForSimulate (SIMULATE-mode write stubbing)", () => {
  it("write-capable tool → wrapped: records the action, does NOT call original execute", async () => {
    const original = vi.fn(async () => ({ content: [], details: { sent: true } }));
    const tool = { name: "message", label: "Message", execute: original };
    const collector: ProposedAction[] = [];

    const wrapped = wrapToolForSimulate(tool, collector);
    expect(wrapped.name).toBe("message");
    expect(wrapped.execute).not.toBe(original);

    const result = await wrapped.execute("call-1", { to: "user", text: "hi" });

    expect(original).not.toHaveBeenCalled();
    expect(collector).toEqual([{ tool: "message", args: { to: "user", text: "hi" } }]);
    expect(result).toMatchObject({ details: { ok: true, simulated: true } });
    expect((result.details as { summary: string }).summary).toContain("message");
  });

  it("non-write tool → passthrough: calling execute runs the original, nothing recorded", async () => {
    const original = vi.fn(async () => ({ content: [], details: { read: true } }));
    const tool = { name: "tasks", label: "Tasks", execute: original };
    const collector: ProposedAction[] = [];

    const wrapped = wrapToolForSimulate(tool, collector);
    expect(wrapped).toBe(tool);
    expect(wrapped.execute).toBe(original);

    await wrapped.execute("call-1", { action: "list" });
    expect(original).toHaveBeenCalledTimes(1);
    expect(collector).toHaveLength(0);
  });

  it("a write-capable tool with no execute is returned unchanged (passthrough)", () => {
    const tool = { name: "message", label: "Message" } as { name: string; label: string };
    const collector: ProposedAction[] = [];
    expect(wrapToolForSimulate(tool, collector)).toBe(tool);
    expect(collector).toHaveLength(0);
  });

  it("multiple calls accumulate in the collector in order", async () => {
    const tool = {
      name: "web_fetch",
      label: "Web Fetch",
      execute: vi.fn(async () => ({ content: [], details: {} })),
    };
    const collector: ProposedAction[] = [];
    const wrapped = wrapToolForSimulate(tool, collector);

    await wrapped.execute("c1", { url: "https://a.example" });
    await wrapped.execute("c2", { url: "https://b.example" });
    await wrapped.execute("c3", { url: "https://c.example" });

    expect(collector).toEqual([
      { tool: "web_fetch", args: { url: "https://a.example" } },
      { tool: "web_fetch", args: { url: "https://b.example" } },
      { tool: "web_fetch", args: { url: "https://c.example" } },
    ]);
  });
});
