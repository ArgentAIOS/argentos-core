import { describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createArgentTools } from "./argent-tools.js";
import { ToolSearchRegistry } from "./tool-search-registry.js";

function namesFor(query: string) {
  const registry = new ToolSearchRegistry();
  registry.registerAll(createArgentTools());
  return registry.search(query, 10).map((entry) => entry.tool.name);
}

describe("tool-search-registry natural language discovery", () => {
  it("finds think_tank for roundtable family phrasing", () => {
    expect(namesFor("roundtable debate with the family")).toContain("think_tank");
    expect(namesFor("ask the panelists for a multi perspective debate")).toContain("think_tank");
  });

  it("finds group_chat for team broadcast phrasing", () => {
    expect(namesFor("message the team and collect all responses")).toContain("group_chat");
    expect(namesFor("ask the family and get everyone to respond")).toContain("group_chat");
  });

  it("finds project tools from board and roadmap language", () => {
    expect(namesFor("create a new project with tasks")).toContain("project_create");
    expect(namesFor("show me the project board")).toContain("projects_list");
    expect(namesFor("give me the project detail and child tasks")).toContain("project_detail");
  });

  it("finds doc panel tools from panel/canvas phrasing", () => {
    const results = namesFor("open this in the doc panel");
    expect(
      results.some((name) =>
        ["doc_panel_update", "doc_panel_get", "doc_panel_list", "doc_panel_search"].includes(name),
      ),
    ).toBe(true);
  });
});
