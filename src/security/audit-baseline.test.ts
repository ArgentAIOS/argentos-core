import { describe, expect, it } from "vitest";
import type { SecurityAuditReport } from "./audit.js";
import {
  SecurityAuditBaselineError,
  applySecurityAuditBaseline,
  parseSecurityAuditBaseline,
} from "./audit-baseline.js";

function baseReport(): SecurityAuditReport {
  return {
    schemaVersion: 1,
    ts: 123,
    domains: ["gateway", "logging"],
    summary: { critical: 1, warn: 1, info: 1 },
    findings: [
      {
        checkId: "gateway.bind_no_auth",
        domain: "gateway",
        severity: "critical",
        title: "Gateway bind lacks auth",
        detail: "Gateway listens without auth.",
      },
      {
        checkId: "logging.redact_off",
        domain: "logging",
        severity: "warn",
        title: "Redaction disabled",
        detail: "Sensitive data may be logged.",
      },
      {
        checkId: "summary.attack_surface",
        domain: "summary",
        severity: "info",
        title: "Attack surface summary",
        detail: "Summary.",
      },
    ],
  };
}

describe("security audit baseline", () => {
  it("omits suppressed findings from JSON reports and records reason metadata", () => {
    const report = applySecurityAuditBaseline(
      baseReport(),
      {
        suppressions: [
          {
            checkId: "gateway.bind_no_auth",
            domain: "gateway",
            severity: "critical",
            reason: "Local dev gateway is isolated by the test network.",
          },
        ],
      },
      "security-baseline.json",
    );

    expect(report.findings.map((finding) => finding.checkId)).toEqual([
      "logging.redact_off",
      "summary.attack_surface",
    ]);
    expect(report.summary).toEqual({ critical: 0, warn: 1, info: 1 });
    expect(report.baseline).toEqual({
      source: "security-baseline.json",
      suppressed: [
        {
          checkId: "gateway.bind_no_auth",
          domain: "gateway",
          severity: "critical",
          title: "Gateway bind lacks auth",
          reason: "Local dev gateway is isolated by the test network.",
        },
      ],
    });
  });

  it("matches checkId with optional domain and severity constraints", () => {
    const report = applySecurityAuditBaseline(
      baseReport(),
      {
        suppressions: [
          {
            checkId: "gateway.bind_no_auth",
            domain: "logging",
            reason: "Wrong domain should not match.",
          },
          {
            checkId: "logging.redact_off",
            severity: "critical",
            reason: "Wrong severity should not match.",
          },
          {
            checkId: "summary.attack_surface",
            reason: "Accepted informational finding.",
          },
        ],
      },
      "baseline.json",
    );

    expect(report.findings.map((finding) => finding.checkId)).toEqual([
      "gateway.bind_no_auth",
      "logging.redact_off",
    ]);
    expect(report.summary).toEqual({ critical: 1, warn: 1, info: 0 });
    expect(report.baseline?.suppressed).toEqual([
      expect.objectContaining({ checkId: "summary.attack_surface" }),
    ]);
  });

  it("rejects broad suppressions without explicit reason metadata", () => {
    expect(() =>
      parseSecurityAuditBaseline({
        suppressions: [{ checkId: "gateway.bind_no_auth" }],
      }),
    ).toThrow(SecurityAuditBaselineError);
  });

  it("rejects malformed baseline files with clear validation errors", () => {
    expect(() => parseSecurityAuditBaseline({})).toThrow(
      "Security audit baseline must include a suppressions array.",
    );
    expect(() =>
      parseSecurityAuditBaseline({
        suppressions: [{ checkId: "gateway.bind_no_auth", reason: "Accepted.", severity: "bad" }],
      }),
    ).toThrow("severity must be info, warn, or critical");
  });
});
