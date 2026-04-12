import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const executeMarketplaceTool = vi.fn();
const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn((code: number) => {
    throw new Error(`exit:${code}`);
  }),
};

vi.mock("../agents/tools/marketplace-tool.js", () => ({
  createMarketplaceTool: () => ({
    execute: executeMarketplaceTool,
  }),
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime: runtime,
}));

describe("marketplace cli", () => {
  afterEach(() => {
    executeMarketplaceTool.mockReset();
    runtime.log.mockReset();
    runtime.error.mockReset();
    runtime.exit.mockReset();
  });

  it("does not crash when the tool result has no content array", async () => {
    executeMarketplaceTool.mockResolvedValueOnce({
      details: {
        ok: false,
        action: "install",
        packageId: "aos-quickbooks",
        error: "Package format unsupported",
      },
    });

    const { registerMarketplaceCli } = await import("./marketplace-cli.js");
    const program = new Command();
    registerMarketplaceCli(program);

    await program.parseAsync(["marketplace", "install", "aos-quickbooks"], { from: "user" });

    expect(runtime.error).not.toHaveBeenCalled();
    expect(runtime.exit).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining('"packageId": "aos-quickbooks"'),
    );
  });
});
