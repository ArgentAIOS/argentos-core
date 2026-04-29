import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectDependencyAuditFindings,
  detectDependencyPackageManager,
  type DependencyAuditExec,
} from "./audit-dependencies.js";

describe("dependency security audit collector", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "argent-dependency-audit-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("prioritizes pnpm lockfile detection for this repository style", async () => {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ packageManager: "npm@10.0.0" }),
    );
    await fs.writeFile(path.join(tmp, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await fs.writeFile(path.join(tmp, "package-lock.json"), "{}\n");

    const detection = await detectDependencyPackageManager({ rootDir: tmp });

    expect(detection.manager).toBe("pnpm");
    expect(detection.evidence).toEqual(
      expect.arrayContaining(["pnpm-lock.yaml", "package.json packageManager=npm@10.0.0"]),
    );
  });

  it("skips live execution when disabled", async () => {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ packageManager: "pnpm@10.23.0" }),
    );
    await fs.writeFile(path.join(tmp, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const calls: string[] = [];
    const exec: DependencyAuditExec = async (command, args) => {
      calls.push([command, ...args].join(" "));
      return { stdout: "{}" };
    };

    const findings = await collectDependencyAuditFindings({ rootDir: tmp, exec, live: false });

    expect(calls).toEqual([]);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkId: "dependencies.package_manager", severity: "info" }),
        expect.objectContaining({ checkId: "dependencies.audit_disabled", severity: "info" }),
      ]),
    );
  });

  it("summarizes pnpm audit severity counts without raw advisory details", async () => {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ packageManager: "pnpm@10.23.0" }),
    );
    await fs.writeFile(path.join(tmp, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const exec: DependencyAuditExec = async (command, args, opts) => {
      calls.push({ command, args, cwd: opts.cwd });
      return {
        code: 1,
        stdout: JSON.stringify({
          advisories: {
            "100": {
              module_name: "left-pad",
              severity: "critical",
              cves: ["CVE-2099-0001"],
              title: "do not leak this title",
            },
            "101": { module_name: "debug", severity: "high" },
            "102": { module_name: "qs", severity: "moderate" },
          },
        }),
      };
    };

    const findings = await collectDependencyAuditFindings({ rootDir: tmp, exec });

    expect(calls).toEqual([{ command: "pnpm", args: ["audit", "--json"], cwd: tmp }]);
    const vuln = findings.find((finding) => finding.checkId === "dependencies.vulnerabilities");
    expect(vuln).toMatchObject({
      severity: "critical",
      detail: "pnpm audit reported 3 known vulnerabilities (1 critical, 1 high, 1 moderate).",
    });
    expect(JSON.stringify(vuln)).not.toContain("CVE-2099-0001");
    expect(JSON.stringify(vuln)).not.toContain("left-pad");
    expect(JSON.stringify(vuln)).not.toContain("do not leak this title");
  });

  it("summarizes npm audit metadata as a warning when there are no high-risk advisories", async () => {
    await fs.writeFile(path.join(tmp, "package.json"), "{}\n");
    await fs.writeFile(path.join(tmp, "package-lock.json"), "{}\n");
    const exec: DependencyAuditExec = async () => ({
      code: 1,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        metadata: {
          vulnerabilities: { info: 0, low: 1, moderate: 2, high: 0, critical: 0, total: 3 },
        },
      }),
    });

    const findings = await collectDependencyAuditFindings({ rootDir: tmp, exec });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "dependencies.vulnerabilities",
          severity: "warn",
          detail: "npm audit reported 3 known vulnerabilities (2 moderate, 1 low).",
        }),
      ]),
    );
  });

  it("reports clean audits", async () => {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ packageManager: "pnpm@10.23.0" }),
    );
    await fs.writeFile(path.join(tmp, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const exec: DependencyAuditExec = async () => ({
      stdout: JSON.stringify({
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
        },
      }),
    });

    const findings = await collectDependencyAuditFindings({ rootDir: tmp, exec });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkId: "dependencies.audit_clean", severity: "info" }),
      ]),
    );
  });

  it("gracefully reports unavailable audit commands", async () => {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ packageManager: "pnpm@10.23.0" }),
    );
    await fs.writeFile(path.join(tmp, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const exec: DependencyAuditExec = async () => {
      throw new Error("spawn pnpm ENOENT");
    };

    const findings = await collectDependencyAuditFindings({ rootDir: tmp, exec });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "dependencies.audit_unavailable",
          severity: "warn",
          detail: "pnpm audit did not produce parseable JSON (spawn pnpm ENOENT).",
        }),
      ]),
    );
  });
});
