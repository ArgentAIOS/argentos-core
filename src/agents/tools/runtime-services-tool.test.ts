import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeServicesTool } from "./runtime-services-tool.js";

const loadConfigMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
  resolveGatewayPort: (cfg: { gateway?: { port?: number } }) => cfg.gateway?.port ?? 18789,
}));

describe("runtime_services tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ARGENT_DASHBOARD_API;
    loadConfigMock.mockReturnValue({
      gateway: { port: 18789 },
    });
  });

  it("lists canonical runtime services", async () => {
    const tool = createRuntimeServicesTool();
    const result = await tool.execute("call-1", {}, undefined, undefined);
    const text = result.content.find((block) => block.type === "text")?.text ?? "";

    expect(text).toContain("Runtime Service Map");
    expect(text).toContain("gateway");
    expect(text).toContain("dashboard-api");
    expect(text).toContain("port: 18789");
    expect(text).toContain("port: 9242");
  });

  it("resolves a specific service by alias", async () => {
    const tool = createRuntimeServicesTool();
    const result = await tool.execute("call-2", { service: "dashboard-api" }, undefined, undefined);

    expect(result.details).toEqual(
      expect.objectContaining({
        ok: true,
        service: expect.objectContaining({
          name: "dashboard-api",
          port: 9242,
          healthCheck: expect.stringContaining("/api/health"),
        }),
      }),
    );
  });
});
