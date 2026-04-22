import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import "./test-helpers/fast-core-tools.js";
import { createArgentTools } from "./argent-tools.js";

describe("argent-tools surface recovery", () => {
  it("restores stranded first-class tools to the normal Argent surface", () => {
    const toolNames = new Set(createArgentTools().map((tool) => tool.name));

    expect(toolNames.has("think_tank")).toBe(true);
    expect(toolNames.has("group_chat")).toBe(true);
    expect(toolNames.has("projects_list")).toBe(true);
    expect(toolNames.has("project_detail")).toBe(true);
    expect(toolNames.has("project_create")).toBe(true);
  });

  it("keeps restored tools visible on the public-core surface", () => {
    const config = {
      distribution: {
        surfaceProfile: "public-core",
      },
    } satisfies ArgentConfig;

    const toolNames = new Set(createArgentTools({ config }).map((tool) => tool.name));

    expect(toolNames.has("think_tank")).toBe(true);
    expect(toolNames.has("group_chat")).toBe(true);
    expect(toolNames.has("projects_list")).toBe(true);
    expect(toolNames.has("project_detail")).toBe(true);
    expect(toolNames.has("project_create")).toBe(true);
  });
});
