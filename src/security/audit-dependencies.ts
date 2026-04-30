import fs from "node:fs/promises";
import path from "node:path";
import { runCommandWithTimeout } from "../process/exec.js";

export type SecurityAuditFinding = {
  checkId: string;
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  remediation?: string;
};

export type DependencyPackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";

export type DependencyPackageManagerDetection = {
  manager: DependencyPackageManager;
  rootDir: string;
  evidence: string[];
  packageManagerSpec?: string;
};

export type DependencyAuditExecOptions = {
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
};

export type DependencyAuditExecResult = {
  stdout: string;
  stderr?: string;
  code?: number | null;
};

export type DependencyAuditExec = (
  command: string,
  args: string[],
  opts: DependencyAuditExecOptions,
) => Promise<DependencyAuditExecResult>;

export type DependencyAuditOptions = {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
  exec?: DependencyAuditExec;
  live?: boolean;
  timeoutMs?: number;
};

type AuditSeverity = "info" | "low" | "moderate" | "medium" | "high" | "critical";

type VulnerabilityCounts = {
  info: number;
  low: number;
  moderate: number;
  high: number;
  critical: number;
  total: number;
};

const ZERO_COUNTS: VulnerabilityCounts = {
  info: 0,
  low: 0,
  moderate: 0,
  high: 0,
  critical: 0,
  total: 0,
};

const DEFAULT_AUDIT_TIMEOUT_MS = 15_000;

export async function detectDependencyPackageManager(
  opts: { rootDir?: string } = {},
): Promise<DependencyPackageManagerDetection> {
  const rootDir = path.resolve(opts.rootDir ?? process.cwd());
  const packageJson = await readPackageJson(rootDir);
  const packageManagerSpec = readPackageManagerSpec(packageJson);
  const evidence: string[] = [];

  if (await fileExists(path.join(rootDir, "pnpm-lock.yaml"))) {
    evidence.push("pnpm-lock.yaml");
    if (packageManagerSpec) {
      evidence.push(`package.json packageManager=${packageManagerSpec}`);
    }
    return { manager: "pnpm", rootDir, evidence, packageManagerSpec };
  }

  const managerFromPackageJson = parsePackageManagerName(packageManagerSpec);
  if (managerFromPackageJson) {
    evidence.push(`package.json packageManager=${packageManagerSpec}`);
    return { manager: managerFromPackageJson, rootDir, evidence, packageManagerSpec };
  }

  if (
    (await fileExists(path.join(rootDir, "package-lock.json"))) ||
    (await fileExists(path.join(rootDir, "npm-shrinkwrap.json")))
  ) {
    evidence.push(
      (await fileExists(path.join(rootDir, "package-lock.json")))
        ? "package-lock.json"
        : "npm-shrinkwrap.json",
    );
    return { manager: "npm", rootDir, evidence };
  }
  if (await fileExists(path.join(rootDir, "yarn.lock"))) {
    evidence.push("yarn.lock");
    return { manager: "yarn", rootDir, evidence };
  }
  if (
    (await fileExists(path.join(rootDir, "bun.lock"))) ||
    (await fileExists(path.join(rootDir, "bun.lockb")))
  ) {
    evidence.push((await fileExists(path.join(rootDir, "bun.lock"))) ? "bun.lock" : "bun.lockb");
    return { manager: "bun", rootDir, evidence };
  }
  if (packageJson) {
    evidence.push("package.json");
  }
  return { manager: "unknown", rootDir, evidence, packageManagerSpec };
}

export async function collectDependencyAuditFindings(
  opts: DependencyAuditOptions = {},
): Promise<SecurityAuditFinding[]> {
  const rootDir = path.resolve(opts.rootDir ?? process.cwd());
  const detection = await detectDependencyPackageManager({ rootDir });
  const findings: SecurityAuditFinding[] = [formatPackageManagerFinding(detection)];

  if (detection.manager === "unknown") {
    findings.push({
      checkId: "dependencies.package_manager_unknown",
      severity: "warn",
      title: "Package manager could not be identified",
      detail:
        "No supported lockfile or packageManager field was found for dependency audit selection.",
      remediation:
        "Add and commit the expected package manager lockfile before relying on dependency audit results.",
    });
    return findings;
  }

  if (opts.live === false) {
    findings.push({
      checkId: "dependencies.audit_disabled",
      severity: "info",
      title: "Dependency audit command skipped",
      detail: `Live dependency audit execution was disabled; detected package manager is ${detection.manager}.`,
      remediation: `Run ${formatAuditCommand(detection)} in a connected environment before release.`,
    });
    return findings;
  }

  const command = buildAuditCommand(detection);
  if (!command) {
    findings.push({
      checkId: "dependencies.audit_unavailable",
      severity: "warn",
      title: "Dependency audit command unavailable",
      detail: `No JSON audit command is configured for package manager ${detection.manager}.`,
      remediation:
        "Run a package-manager-native dependency audit and review high or critical advisories before release.",
    });
    return findings;
  }

  const exec = opts.exec ?? defaultDependencyAuditExec;
  const result = await runAuditCommand(exec, command, {
    cwd: rootDir,
    timeoutMs: opts.timeoutMs ?? DEFAULT_AUDIT_TIMEOUT_MS,
    env: opts.env,
  });
  if (!result.ok) {
    findings.push({
      checkId: "dependencies.audit_unavailable",
      severity: "warn",
      title: "Dependency audit could not complete",
      detail: `${detection.manager} audit did not produce parseable JSON (${result.reason}).`,
      remediation: `Run ${formatAuditCommand(detection)} in a connected environment and resolve high or critical advisories before release.`,
    });
    return findings;
  }

  findings.push(formatVulnerabilityFinding(detection.manager, result.counts));
  return findings;
}

async function defaultDependencyAuditExec(
  command: string,
  args: string[],
  opts: DependencyAuditExecOptions,
): Promise<DependencyAuditExecResult> {
  return await runCommandWithTimeout([command, ...args], {
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs,
  });
}

async function runAuditCommand(
  exec: DependencyAuditExec,
  command: { command: string; args: string[] },
  opts: DependencyAuditExecOptions,
): Promise<{ ok: true; counts: VulnerabilityCounts } | { ok: false; reason: string }> {
  try {
    const result = await exec(command.command, command.args, opts);
    const counts = parseAuditOutput(result.stdout);
    if (!counts) {
      return {
        ok: false,
        reason: result.code == null ? "missing audit output" : `exit code ${result.code}`,
      };
    }
    return { ok: true, counts };
  } catch (err) {
    return { ok: false, reason: normalizeErrorReason(err) };
  }
}

function buildAuditCommand(
  detection: DependencyPackageManagerDetection,
): { command: string; args: string[] } | null {
  switch (detection.manager) {
    case "pnpm":
      return { command: "pnpm", args: ["audit", "--json"] };
    case "npm":
      return { command: "npm", args: ["audit", "--json"] };
    case "bun":
      return { command: "bun", args: ["audit", "--json"] };
    case "yarn":
      return isModernYarn(detection.packageManagerSpec)
        ? { command: "yarn", args: ["npm", "audit", "--json"] }
        : { command: "yarn", args: ["audit", "--json"] };
    case "unknown":
      return null;
  }
}

function formatAuditCommand(detection: DependencyPackageManagerDetection): string {
  const command = buildAuditCommand(detection);
  if (!command) {
    return "a package-manager-native audit command";
  }
  return `${command.command} ${command.args.join(" ")}`;
}

function formatPackageManagerFinding(
  detection: DependencyPackageManagerDetection,
): SecurityAuditFinding {
  const evidence =
    detection.evidence.length > 0 ? detection.evidence.join(", ") : "no lockfile evidence";
  return {
    checkId: "dependencies.package_manager",
    severity: "info",
    title: `Dependency package manager: ${detection.manager}`,
    detail: `Detected ${detection.manager} for ${detection.rootDir} from ${evidence}.`,
  };
}

function formatVulnerabilityFinding(
  manager: DependencyPackageManager,
  counts: VulnerabilityCounts,
): SecurityAuditFinding {
  if (counts.total === 0) {
    return {
      checkId: "dependencies.audit_clean",
      severity: "info",
      title: "Dependency audit found no known vulnerabilities",
      detail: `${manager} audit reported no known dependency vulnerabilities.`,
    };
  }

  const highestRisk = counts.critical > 0 || counts.high > 0;
  return {
    checkId: "dependencies.vulnerabilities",
    severity: highestRisk ? "critical" : "warn",
    title: "Dependency audit reported vulnerable packages",
    detail: `${manager} audit reported ${counts.total} known ${pluralize("vulnerability", counts.total)} (${formatCounts(counts)}).`,
    remediation: `Run ${manager} audit locally, update direct dependencies, and add package-manager overrides for vulnerable transitive dependencies when upstream fixes are unavailable.`,
  };
}

function parseAuditOutput(output: string): VulnerabilityCounts | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  const direct = parseJsonObject(trimmed);
  if (direct) {
    return summarizeAuditObject(direct);
  }

  const counts = { ...ZERO_COUNTS };
  let sawJsonLine = false;
  for (const line of trimmed.split(/\r?\n/)) {
    const parsed = parseJsonObject(line.trim());
    if (!parsed) {
      continue;
    }
    sawJsonLine = true;
    mergeCounts(counts, summarizeAuditObject(parsed));
  }
  return sawJsonLine ? counts : null;
}

function summarizeAuditObject(value: unknown): VulnerabilityCounts {
  const record = asRecord(value);
  if (!record) {
    return { ...ZERO_COUNTS };
  }

  const metadataCounts = countsFromMetadata(record);
  if (metadataCounts) {
    return metadataCounts;
  }

  const vulnerabilities = asRecord(record.vulnerabilities);
  if (vulnerabilities) {
    return countsFromVulnerabilityMap(vulnerabilities);
  }

  const advisories = asRecord(record.advisories);
  if (advisories) {
    return countsFromVulnerabilityMap(advisories);
  }

  if (record.type === "auditSummary") {
    return countsFromAuditSummary(record.data);
  }
  if (record.type === "auditAdvisory") {
    return countsFromAuditSummary(record.data);
  }
  return { ...ZERO_COUNTS };
}

function countsFromMetadata(record: Record<string, unknown>): VulnerabilityCounts | null {
  const metadata = asRecord(record.metadata);
  const vulnerabilities = asRecord(metadata?.vulnerabilities);
  if (!vulnerabilities) {
    return null;
  }
  return countsFromSeverityRecord(vulnerabilities);
}

function countsFromVulnerabilityMap(vulnerabilities: Record<string, unknown>): VulnerabilityCounts {
  const counts = { ...ZERO_COUNTS };
  for (const value of Object.values(vulnerabilities)) {
    const entry = asRecord(value);
    if (!entry) {
      continue;
    }
    incrementSeverity(counts, normalizeAuditSeverity(entry.severity));
  }
  return counts;
}

function countsFromAuditSummary(value: unknown): VulnerabilityCounts {
  const data = asRecord(value);
  if (!data) {
    return { ...ZERO_COUNTS };
  }
  const vulnerabilities = asRecord(data.vulnerabilities) ?? asRecord(data.advisory);
  if (vulnerabilities) {
    return countsFromSeverityRecord(vulnerabilities);
  }
  return countsFromSeverityRecord(data);
}

function countsFromSeverityRecord(record: Record<string, unknown>): VulnerabilityCounts {
  const counts = { ...ZERO_COUNTS };
  counts.info = readCount(record.info);
  counts.low = readCount(record.low);
  counts.moderate = readCount(record.moderate) + readCount(record.medium);
  counts.high = readCount(record.high);
  counts.critical = readCount(record.critical);
  counts.total =
    readCount(record.total) ||
    counts.info + counts.low + counts.moderate + counts.high + counts.critical;
  return counts;
}

function mergeCounts(target: VulnerabilityCounts, source: VulnerabilityCounts): void {
  target.info += source.info;
  target.low += source.low;
  target.moderate += source.moderate;
  target.high += source.high;
  target.critical += source.critical;
  target.total += source.total;
}

function incrementSeverity(counts: VulnerabilityCounts, severity: AuditSeverity | null): void {
  switch (severity) {
    case "critical":
      counts.critical += 1;
      break;
    case "high":
      counts.high += 1;
      break;
    case "moderate":
    case "medium":
      counts.moderate += 1;
      break;
    case "low":
      counts.low += 1;
      break;
    case "info":
      counts.info += 1;
      break;
    case null:
      return;
  }
  counts.total += 1;
}

async function readPackageJson(rootDir: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf-8"));
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function readPackageManagerSpec(packageJson: unknown): string | undefined {
  const record = asRecord(packageJson);
  return typeof record?.packageManager === "string" ? record.packageManager : undefined;
}

function parsePackageManagerName(spec: string | undefined): DependencyPackageManager | null {
  if (!spec) {
    return null;
  }
  const name = spec.split("@")[0]?.trim().toLowerCase();
  if (name === "pnpm" || name === "npm" || name === "yarn" || name === "bun") {
    return name;
  }
  return null;
}

function isModernYarn(spec: string | undefined): boolean {
  const version = spec?.match(/^yarn@(\d+)/)?.[1];
  return version ? Number(version) >= 2 : false;
}

function parseJsonObject(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeAuditSeverity(value: unknown): AuditSeverity | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.toLowerCase();
  if (
    normalized === "info" ||
    normalized === "low" ||
    normalized === "moderate" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "critical"
  ) {
    return normalized;
  }
  return null;
}

function formatCounts(counts: VulnerabilityCounts): string {
  const entries: Array<[string, number]> = [
    ["critical", counts.critical],
    ["high", counts.high],
    ["moderate", counts.moderate],
    ["low", counts.low],
    ["info", counts.info],
  ];
  return entries
    .filter((entry) => entry[1] > 0)
    .map((entry) => `${entry[1]} ${entry[0]}`)
    .join(", ");
}

function pluralize(word: string, count: number): string {
  if (count === 1) {
    return word;
  }
  if (word.endsWith("y")) {
    return `${word.slice(0, -1)}ies`;
  }
  return `${word}s`;
}

function normalizeErrorReason(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }
  return "command failed";
}
