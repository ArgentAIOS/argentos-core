import { describe, expect, it } from "vitest";
import {
  getOperationsWorkspaceTabs,
  isConfigTabAllowed,
  isRawConfigEditorAllowed,
  isOperationsWorkspaceTabAllowed,
  isWorkforceSurfaceAllowed,
  parseDashboardSurfaceProfile,
} from "../dashboard/src/lib/configSurfaceProfile.js";

describe("dashboard surface profile", () => {
  it("parses public-core from raw config", () => {
    expect(
      parseDashboardSurfaceProfile(
        JSON.stringify({
          distribution: {
            surfaceProfile: "public-core",
          },
        }),
      ),
    ).toBe("public-core");
  });

  it("blocks admin config tabs in public-core", () => {
    expect(isConfigTabAllowed("gateway", "public-core")).toBe(false);
    expect(isConfigTabAllowed("systems", "public-core")).toBe(false);
    expect(isConfigTabAllowed("appearance", "public-core")).toBe(true);
  });

  it("disables raw config editing and workforce surfaces in public-core", () => {
    expect(isRawConfigEditorAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("full")).toBe(true);
  });

  it("removes workload lanes from public-core operations", () => {
    expect(isOperationsWorkspaceTabAllowed("jobs", "public-core")).toBe(false);
    expect(isOperationsWorkspaceTabAllowed("org", "public-core")).toBe(true);
    expect(getOperationsWorkspaceTabs("public-core").map((tab) => tab.id)).toEqual([
      "map",
      "workflows",
      "tasks",
      "org",
      "schedule",
    ]);
  });
});
