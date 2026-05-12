import { describe, expect, it, vi } from "vitest";
import { createConnectorSetupTool } from "./connector-setup-tool.js";

function preflightPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: false,
    checks: [
      { name: "gws_binary", ok: true, details: { resolved_path: "/usr/local/bin/gws" } },
      { name: "gws_version", ok: true, details: { stdout: "gws 0.16.0" } },
      { name: "gcloud_cli", ok: true, details: {} },
      { name: "oauth_client_config", ok: true, details: { client_secret_present: true } },
      { name: "gws_auth", ok: false, details: {} },
      { name: "model_armor_config", ok: false, details: {} },
    ],
    next_steps: ["Run login: gws auth login -s drive,gmail,calendar,sheets,docs"],
    ...overrides,
  };
}

describe("connector_setup tool", () => {
  it("returns business-friendly Google Workspace setup status", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify(preflightPayload()),
      stderr: "",
    });
    const tool = createConnectorSetupTool({ runCommand });

    const result = await tool.execute("call-1", { action: "status", connector: "gmail" });
    const details = result.details as Record<string, unknown>;

    expect(details.connector).toBe("aos-google");
    expect(details.summary).toContain("needs setup");
    expect(JSON.stringify(details)).toContain("Google account connected");
    expect(JSON.stringify(details)).toContain("Sign in with Google");
    expect(JSON.stringify(details)).not.toContain("client_secret_present");
    expect(runCommand).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["--require-auth", "--json"]),
      expect.objectContaining({ cwd: expect.any(String) }),
    );
  });

  it("resolves the Google preflight from the package root when runtime cwd is not the repo", async () => {
    const originalCwd = process.cwd();
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify(preflightPayload()),
      stderr: "",
    });

    try {
      process.chdir("/");
      const tool = createConnectorSetupTool({ runCommand });
      await tool.execute("call-1", { action: "status", connector: "aos-google" });
    } finally {
      process.chdir(originalCwd);
    }

    const args = runCommand.mock.calls[0]?.[1] as string[];
    expect(args[0]).toMatch(/tools\/aos\/aos-google\/installer\/preflight_gws\.py$/);
    expect(args[0]).not.toBe("/tools/aos/aos-google/installer/preflight_gws.py");
  });

  it("returns a structured payload when the preflight helper is missing (GH #128)", async () => {
    // Simulate an install where the helper script is not on disk (e.g. a
    // broken package or stale dist). We assert we return a structured payload
    // *without* shelling out to python3 — which would otherwise crash with
    // `[Errno 2] No such file or directory` and surface a raw trace to the
    // operator. See GH #128.
    const runCommand = vi.fn();
    const tool = createConnectorSetupTool({
      runCommand,
      preflightPath: "/var/empty/argent/preflight_gws.py",
    });

    const result = await tool.execute("call-1", {
      action: "status",
      connector: "aos-google",
    });
    const details = result.details as Record<string, unknown>;

    expect(runCommand).not.toHaveBeenCalled();
    expect(details.ok).toBe(false);
    expect(details.connector).toBe("aos-google");
    const checks = details.checks as Array<Record<string, unknown>>;
    expect(checks.some((c) => c.name === "gws_binary" && c.ok === false)).toBe(true);
    expect(JSON.stringify(details)).toContain("Install the local Google Workspace helper");
  });

  it("requires explicit confirmation before opening Google login", async () => {
    const runCommand = vi.fn();
    const tool = createConnectorSetupTool({ runCommand });

    const result = await tool.execute("call-1", {
      action: "start_google_login",
      connector: "aos-google",
    });
    const details = result.details as Record<string, unknown>;

    expect(details.needsConfirmation).toBe(true);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("does not launch Google login until the OAuth client is configured", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify(
        preflightPayload({
          checks: [
            { name: "gws_binary", ok: true, details: {} },
            { name: "gws_version", ok: true, details: {} },
            { name: "oauth_client_config", ok: false, details: {} },
            { name: "gws_auth", ok: false, details: {} },
          ],
        }),
      ),
      stderr: "",
    });
    const tool = createConnectorSetupTool({ runCommand });

    const result = await tool.execute("call-1", {
      action: "start_google_login",
      connector: "aos-google",
      confirm: true,
    });
    const details = result.details as Record<string, unknown>;

    expect(details.summary).toContain("cannot start");
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["--require-auth", "--json"]),
      expect.objectContaining({ cwd: expect.any(String) }),
    );
  });

  it("opens the macOS Google login flow when confirmed and configured", async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify(preflightPayload()),
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    const tool = createConnectorSetupTool({ runCommand, platform: "darwin" });

    const result = await tool.execute("call-1", {
      action: "start_google_login",
      connector: "google-workspace",
      confirm: true,
    });
    const details = result.details as Record<string, unknown>;

    expect(details.ok).toBe(true);
    expect(details.operatorActionRequired).toBe(true);
    expect(runCommand).toHaveBeenLastCalledWith("osascript", expect.arrayContaining(["-e"]));
  });
});
