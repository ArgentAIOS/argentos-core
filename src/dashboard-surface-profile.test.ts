import { describe, expect, it } from "vitest";
import {
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

  it("blocks admin config tabs in public-core", () => {
    expect(isConfigTabAllowed("gateway", "public-core")).toBe(false);
    expect(isConfigTabAllowed("systems", "public-core")).toBe(false);
    expect(isConfigTabAllowed("intent", "public-core")).toBe(true);
    expect(isConfigTabAllowed("appearance", "public-core")).toBe(true);
  });

  it("disables raw config editing and workforce surfaces in public-core", () => {
    expect(isRawConfigEditorAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("full")).toBe(true);
  });
});
