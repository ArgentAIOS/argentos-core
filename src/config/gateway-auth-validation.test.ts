import { describe, expect, it } from "vitest";
import { validateGatewayAuthConfig } from "./gateway-auth-validation.js";

describe("validateGatewayAuthConfig", () => {
  it("rejects token mode with empty token", () => {
    const issues = validateGatewayAuthConfig({
      gateway: { auth: { mode: "token", token: "   " } },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("token-mode-missing-token");
  });

  it("rejects password mode with empty password", () => {
    const issues = validateGatewayAuthConfig({
      gateway: { auth: { mode: "password", password: "" } },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("password-mode-missing-password");
  });

  it("accepts token mode with non-empty token", () => {
    const issues = validateGatewayAuthConfig({
      gateway: { auth: { mode: "token", token: "abc123" } },
    });
    expect(issues).toHaveLength(0);
  });
});
