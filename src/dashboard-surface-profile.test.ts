import { describe, expect, it } from "vitest";
import {
  isConfigTabAllowed,
  isOperationsSurfaceAllowed,
  isRawConfigEditorAllowed,
  isWorkforceSurfaceAllowed,
  parseDashboardMode,
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
    expect(isConfigTabAllowed("capabilities", "public-core")).toBe(true);
    expect(isConfigTabAllowed("appearance", "public-core")).toBe(true);
  });

  it("keeps operations available while raw config and workforce stay disabled in public-core", () => {
    expect(isRawConfigEditorAllowed("public-core")).toBe(false);
    expect(isOperationsSurfaceAllowed("public-core")).toBe(true);
    expect(isWorkforceSurfaceAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("full")).toBe(true);
  });

  it("keeps Home/personal as the default mode in public-core", () => {
    expect(parseDashboardMode(null, "public-core")).toBe("personal");
    expect(parseDashboardMode(JSON.stringify({ distribution: {} }), "public-core")).toBe(
      "personal",
    );
    expect(
      parseDashboardMode(
        JSON.stringify({ distribution: { dashboardMode: "operations" } }),
        "public-core",
      ),
    ).toBe("operations");
  });
});
