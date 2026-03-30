import { describe, expect, it } from "vitest";
import { ArgentSchema } from "./zod-schema.js";

describe("public core surface config schema", () => {
  it("accepts distribution public-core settings", () => {
    const result = ArgentSchema.safeParse({
      distribution: {
        surfaceProfile: "public-core",
        dashboardMode: "personal",
        publicCore: {
          includePowerUserTools: true,
          alsoAllowTools: ["service_keys"],
          denyTools: ["github_issue"],
          allowPlugins: ["slack"],
          denyPlugins: ["marketplace-demo"],
        },
      },
    });

    expect(result.success).toBe(true);
  });
});
