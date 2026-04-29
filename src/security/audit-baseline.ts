import fs from "node:fs/promises";
import type {
  SecurityAuditDomain,
  SecurityAuditFinding,
  SecurityAuditReport,
  SecurityAuditSeverity,
  SecurityAuditSummary,
} from "./audit.js";

export type SecurityAuditBaselineSuppression = {
  checkId: string;
  reason: string;
  domain?: SecurityAuditDomain;
  severity?: SecurityAuditSeverity;
};

export type SecurityAuditBaseline = {
  suppressions: SecurityAuditBaselineSuppression[];
};

export type SecurityAuditReportWithBaseline = SecurityAuditReport & {
  baseline: {
    source: string;
    suppressed: Array<{
      checkId: string;
      domain?: SecurityAuditDomain;
      severity: SecurityAuditSeverity;
      title: string;
      reason: string;
    }>;
  };
};

export class SecurityAuditBaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityAuditBaselineError";
  }
}

const VALID_DOMAINS = new Set<string>([
  "summary",
  "config",
  "filesystem",
  "gateway",
  "browser",
  "logging",
  "tools",
  "hooks",
  "secrets",
  "models",
  "plugins",
  "channels",
  "runtime",
  "workflows",
  "dependencies",
  "agents",
]);

const VALID_SEVERITIES = new Set<string>(["info", "warn", "critical"]);

export async function readSecurityAuditBaseline(filePath: string): Promise<SecurityAuditBaseline> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    throw new SecurityAuditBaselineError(
      `Unable to read security audit baseline at ${filePath}: ${formatError(err)}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new SecurityAuditBaselineError(
      `Invalid security audit baseline JSON at ${filePath}: ${formatError(err)}`,
    );
  }

  return parseSecurityAuditBaseline(raw);
}

export function parseSecurityAuditBaseline(raw: unknown): SecurityAuditBaseline {
  const record = asRecord(raw, "Security audit baseline must be a JSON object.");
  const suppressions = record.suppressions;
  if (!Array.isArray(suppressions)) {
    throw new SecurityAuditBaselineError(
      "Security audit baseline must include a suppressions array.",
    );
  }

  return {
    suppressions: suppressions.map((item, index) => parseSuppression(item, index)),
  };
}

export function applySecurityAuditBaseline(
  report: SecurityAuditReport,
  baseline: SecurityAuditBaseline,
  source: string,
): SecurityAuditReportWithBaseline {
  const findings: SecurityAuditFinding[] = [];
  const suppressed: SecurityAuditReportWithBaseline["baseline"]["suppressed"] = [];

  for (const finding of report.findings) {
    const suppression = baseline.suppressions.find((candidate) =>
      matchesSuppression(finding, candidate),
    );
    if (!suppression) {
      findings.push(finding);
      continue;
    }
    suppressed.push({
      checkId: finding.checkId,
      domain: finding.domain,
      severity: finding.severity,
      title: finding.title,
      reason: suppression.reason,
    });
  }

  return {
    ...report,
    summary: countBySeverity(findings),
    findings,
    baseline: { source, suppressed },
  };
}

function parseSuppression(raw: unknown, index: number): SecurityAuditBaselineSuppression {
  const label = `suppression #${index + 1}`;
  const record = asRecord(raw, `Security audit baseline ${label} must be a JSON object.`);
  const checkId = parseRequiredString(record.checkId, `Security audit baseline ${label}.checkId`);
  const reason = parseRequiredString(record.reason, `Security audit baseline ${label}.reason`);

  const suppression: SecurityAuditBaselineSuppression = { checkId, reason };
  if (record.domain !== undefined) {
    suppression.domain = parseOptionalDomain(record.domain, label);
  }
  if (record.severity !== undefined) {
    suppression.severity = parseOptionalSeverity(record.severity, label);
  }
  return suppression;
}

function parseOptionalDomain(raw: unknown, label: string): SecurityAuditDomain {
  const value = parseRequiredString(raw, `Security audit baseline ${label}.domain`);
  if (!VALID_DOMAINS.has(value)) {
    throw new SecurityAuditBaselineError(
      `Security audit baseline ${label}.domain must be a known audit domain.`,
    );
  }
  return value as SecurityAuditDomain;
}

function parseOptionalSeverity(raw: unknown, label: string): SecurityAuditSeverity {
  const value = parseRequiredString(raw, `Security audit baseline ${label}.severity`);
  if (!VALID_SEVERITIES.has(value)) {
    throw new SecurityAuditBaselineError(
      `Security audit baseline ${label}.severity must be info, warn, or critical.`,
    );
  }
  return value as SecurityAuditSeverity;
}

function parseRequiredString(raw: unknown, label: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new SecurityAuditBaselineError(`${label} must be a non-empty string.`);
  }
  return raw.trim();
}

function asRecord(raw: unknown, message: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SecurityAuditBaselineError(message);
  }
  return raw as Record<string, unknown>;
}

function matchesSuppression(
  finding: SecurityAuditFinding,
  suppression: SecurityAuditBaselineSuppression,
): boolean {
  if (finding.checkId !== suppression.checkId) {
    return false;
  }
  if (suppression.domain && finding.domain !== suppression.domain) {
    return false;
  }
  if (suppression.severity && finding.severity !== suppression.severity) {
    return false;
  }
  return true;
}

function countBySeverity(findings: SecurityAuditFinding[]): SecurityAuditSummary {
  let critical = 0;
  let warn = 0;
  let info = 0;
  for (const finding of findings) {
    if (finding.severity === "critical") {
      critical += 1;
    } else if (finding.severity === "warn") {
      warn += 1;
    } else {
      info += 1;
    }
  }
  return { critical, warn, info };
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
