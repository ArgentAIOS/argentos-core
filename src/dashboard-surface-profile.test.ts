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

  it("defaults public-core to operations mode", () => {
    expect(parseDashboardMode(null, "public-core")).toBe("operations");
    expect(parseDashboardMode(JSON.stringify({ distribution: {} }), "public-core")).toBe(
      "operations",
    );
    expect(
      parseDashboardMode(
        JSON.stringify({ distribution: { dashboardMode: "operations" } }),
        "public-core",
      ),
    ).toBe("operations");
  });
});
