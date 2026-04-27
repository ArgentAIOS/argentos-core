import { describe, expect, it, vi } from "vitest";
import { callBrowserRequest, formatBrowserRequestDiagnostic } from "./browser-cli-shared.js";

vi.mock("./gateway-rpc.js", () => ({
  callGatewayFromCli: vi.fn(async () => {
    throw new Error("gateway closed (1006 abnormal closure): no close reason");
  }),
}));

describe("browser cli shared diagnostics", () => {
  it("formats request diagnostics for browser status failures", () => {
    expect(
      formatBrowserRequestDiagnostic(
        {
          method: "GET",
          path: "/",
          query: { profile: "chrome" },
        },
        1500,
      ),
    ).toContain("Browser request: GET /");
    expect(
      formatBrowserRequestDiagnostic(
        {
          method: "GET",
          path: "/",
          query: { profile: "chrome" },
        },
        1500,
      ),
    ).toContain("Profile: chrome");
  });

  it("appends browser request context to gateway close failures", async () => {
    await expect(
      callBrowserRequest(
        { timeout: "1500" },
        {
          method: "GET",
          path: "/",
          query: { profile: "chrome" },
        },
        { timeoutMs: 1500 },
      ),
    ).rejects.toThrow(/gateway closed \(1006 abnormal closure\)[\s\S]*Browser request: GET \//u);
  });
});
