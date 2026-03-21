import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./config.js";

describe("intent validation mode", () => {
  it("blocks invalid hierarchy in enforce mode (default)", () => {
    const result = validateConfigObject({
      intent: {
        enabled: true,
        global: {
          allowedActions: ["reply"],
        },
        agents: {
          main: {
            allowedActions: ["reply", "refund_small"],
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((issue) => issue.path === "intent.agents.main.allowedActions"),
      ).toBe(true);
    }
  });

  it("allows invalid hierarchy when validationMode=warn", () => {
    const result = validateConfigObject({
      intent: {
        enabled: true,
        validationMode: "warn",
        global: {
          allowedActions: ["reply"],
        },
        agents: {
          main: {
            allowedActions: ["reply", "refund_small"],
          },
        },
      },
    });
    expect(result.ok).toBe(true);
  });
});
