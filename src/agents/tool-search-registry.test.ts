import { describe, expect, it } from "vitest";
import type { AnyAgentTool } from "./tools/common.js";
import { CORE_TOOL_NAMES, ToolSearchRegistry } from "./tool-search-registry.js";

function tool(name: string): AnyAgentTool {
  return {
    name,
    label: name,
    description: `${name} tool`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [] }),
  };
}

describe("tool-search-registry", () => {
  it("keeps marketplace visible as a core tool", () => {
    const registry = new ToolSearchRegistry();
    registry.registerAll([tool("tool_search"), tool("marketplace"), tool("plugin_builder")]);

    expect(CORE_TOOL_NAMES.has("marketplace")).toBe(true);
    expect(registry.getCoreTools().map((entry) => entry.name)).toContain("marketplace");
    expect(registry.getDeferredTools().map((entry) => entry.name)).not.toContain("marketplace");
  });

  it("keeps specforge visible as a core project-intake tool", () => {
    const registry = new ToolSearchRegistry();
    registry.registerAll([
      tool("tool_search"),
      {
        ...tool("specforge"),
        label: "SpecForge",
        description: "Run strict development project intake before implementation.",
      },
    ]);

    expect(CORE_TOOL_NAMES.has("specforge")).toBe(true);
    expect(registry.getCoreTools().map((entry) => entry.name)).toContain("specforge");
    expect(registry.getDeferredTools().map((entry) => entry.name)).not.toContain("specforge");
  });

  it("finds changelog by release/version keywords as a deferred tool", () => {
    const registry = new ToolSearchRegistry();
    registry.registerAll([
      tool("tool_search"),
      {
        ...tool("changelog"),
        label: "Changelog",
        description: "Read ArgentOS release notes and update history.",
      },
    ]);

    expect(CORE_TOOL_NAMES.has("changelog")).toBe(false);
    expect(registry.search("release notes version").map((entry) => entry.tool.name)).toContain(
      "changelog",
    );
  });
});
