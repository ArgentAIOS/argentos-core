import { describe, expect, it } from "vitest";
import {
  filterConfigNavSections,
  isConfigTabAllowed,
  isRawConfigEditorAllowed,
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

  it("fails closed to public-core when profile is missing or unreadable", () => {
    expect(parseDashboardSurfaceProfile(null)).toBe("public-core");
    expect(parseDashboardSurfaceProfile("")).toBe("public-core");
    expect(parseDashboardSurfaceProfile("{not-json")).toBe("public-core");
  });

  it("keeps Core settings tabs visible in public-core", () => {
    expect(isConfigTabAllowed("gateway", "public-core")).toBe(true);
    expect(isConfigTabAllowed("systems", "public-core")).toBe(true);
    expect(isConfigTabAllowed("logs", "public-core")).toBe(true);
    expect(isConfigTabAllowed("license", "public-core")).toBe(true);
    expect(isConfigTabAllowed("intent", "public-core")).toBe(true);
    expect(isConfigTabAllowed("appearance", "public-core")).toBe(true);
  });

  it("does not drop Core nav sections in public-core", () => {
    const sections = filterConfigNavSections(
      [
        {
          label: "System",
          items: [{ id: "systems" }, { id: "license" }],
        },
        {
          label: "Developer",
          items: [{ id: "logs" }],
        },
      ],
      "public-core",
    );
    expect(sections).toEqual([
      {
        label: "System",
        items: [{ id: "systems" }, { id: "license" }],
      },
      {
        label: "Developer",
        items: [{ id: "logs" }],
      },
    ]);
  });

  it("disables raw config editing and workforce surfaces in public-core", () => {
    expect(isRawConfigEditorAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("full")).toBe(true);
  });
});
