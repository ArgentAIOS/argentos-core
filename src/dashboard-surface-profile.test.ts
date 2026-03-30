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
    expect(isConfigTabAllowed("gateway", "public-core")).toBe(true);
    expect(isConfigTabAllowed("database", "public-core")).toBe(true);
    expect(isConfigTabAllowed("systems", "public-core")).toBe(false);
    expect(isConfigTabAllowed("appearance", "public-core")).toBe(true);
  });

  it("disables raw config editing and workforce surfaces in public-core", () => {
    expect(isRawConfigEditorAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("full")).toBe(true);
  });

  it("keeps workload lanes in public-core operations", () => {
    expect(isOperationsWorkspaceTabAllowed("jobs", "public-core")).toBe(true);
    expect(isOperationsWorkspaceTabAllowed("org", "public-core")).toBe(true);
    expect(isWorkforceSurfaceAllowed("public-core")).toBe(false);
    expect(getOperationsWorkspaceTabs("public-core").map((tab) => tab.id)).toEqual([
      "map",
      "workflows",
      "jobs",
      "tasks",
      "org",
      "schedule",
    ]);
  });

  it("treats workloads and workforce as distinct public-core surfaces", () => {
    const publicCoreTabs = getOperationsWorkspaceTabs("public-core").map((tab) => tab.id);
    expect(publicCoreTabs).toContain("jobs");
    expect(isWorkforceSurfaceAllowed("public-core")).toBe(false);
  });
});
