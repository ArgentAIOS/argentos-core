import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecurityAuditReport } from "../security/audit.js";

const { defaultRuntime, fixSecurityFootguns, loadConfig, runSecurityAudit } = vi.hoisted(() => ({
  defaultRuntime: {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  },
  fixSecurityFootguns: vi.fn(),
  loadConfig: vi.fn(() => ({})),
  runSecurityAudit: vi.fn(),
}));

vi.mock("../config/config.js", () => ({ loadConfig }));
vi.mock("../runtime.js", () => ({ defaultRuntime }));
vi.mock("../security/audit.js", () => ({ runSecurityAudit }));
vi.mock("../security/fix.js", () => ({ fixSecurityFootguns }));

const { registerSecurityCli } = await import("./security-cli.js");

function reportWithCriticalFinding(): SecurityAuditReport {
  return {
    schemaVersion: 1,
    ts: 123,
    domains: ["gateway"],
    summary: { critical: 1, warn: 0, info: 0 },
    findings: [
      {
        checkId: "gateway.bind_no_auth",
        domain: "gateway",
        severity: "critical",
        title: "Gateway bind lacks auth",
        detail: "Gateway listens without auth.",
      },
    ],
  };
}

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSecurityCli(program);
  return program;
}

describe("security-cli baseline", () => {
  let tmp: string;
  let originalExitCode: string | number | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "argent-security-cli-baseline-"));
    loadConfig.mockReturnValue({});
    runSecurityAudit.mockResolvedValue(reportWithCriticalFinding());
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("applies baseline suppressions before JSON output and fail-on evaluation", async () => {
    const baselinePath = path.join(tmp, "baseline.json");
    await fs.writeFile(
      baselinePath,
      JSON.stringify({
        suppressions: [
          {
            checkId: "gateway.bind_no_auth",
            domain: "gateway",
            severity: "critical",
            reason: "Local test gateway is isolated.",
          },
        ],
      }),
      "utf-8",
    );

    await buildProgram().parseAsync(
      ["security", "audit", "--json", "--fail-on", "critical", "--baseline", baselinePath],
      { from: "user" },
    );

    expect(process.exitCode).toBeUndefined();
    const payload = JSON.parse(String(defaultRuntime.log.mock.calls.at(-1)?.[0]));
    expect(payload.summary).toEqual({ critical: 0, warn: 0, info: 0 });
    expect(payload.findings).toEqual([]);
    expect(payload.baseline.suppressed).toEqual([
      expect.objectContaining({
        checkId: "gateway.bind_no_auth",
        reason: "Local test gateway is isolated.",
      }),
    ]);
  });

  it("reports invalid baseline files clearly without running the audit", async () => {
    const baselinePath = path.join(tmp, "baseline.json");
    await fs.writeFile(baselinePath, "{", "utf-8");

    await buildProgram().parseAsync(["security", "audit", "--baseline", baselinePath], {
      from: "user",
    });

    expect(process.exitCode).toBe(1);
    expect(defaultRuntime.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid security audit baseline JSON"),
    );
    expect(runSecurityAudit).not.toHaveBeenCalled();
    expect(fixSecurityFootguns).not.toHaveBeenCalled();
  });
});
