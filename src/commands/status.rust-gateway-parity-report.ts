import fs from "node:fs/promises";
import path from "node:path";

export const RUST_GATEWAY_PARITY_REPORT_DEFAULT_PATH = path.join(
  ".omx",
  "state",
  "rust-gateway-parity",
  "latest",
  "rust-gateway-parity-report.json",
);
export const RUST_GATEWAY_PARITY_REPORT_FRESH_MS = 24 * 60 * 60 * 1000;

export type RustGatewayParityReportFreshness = "missing" | "fresh" | "stale" | "invalid";

export type RustGatewayParityReportStatus = {
  path: string;
  freshness: RustGatewayParityReportFreshness;
  generatedAtMs: number | null;
  ageMs: number | null;
  totals: {
    passed: number;
    failed: number;
    skipped: number;
  } | null;
  promotionReady: boolean | null;
  blockers: number | null;
  warnings: number | null;
  error: string | null;
};

export type RustGatewayParityReportStatusOptions = {
  reportPath?: string;
  cwd?: string;
  nowMs?: () => number;
  freshMs?: number;
  readFile?: typeof fs.readFile;
};

type StoredReadiness = {
  ready?: unknown;
  blockers?: unknown;
  warnings?: unknown;
};

type StoredReportResult = {
  safety?: unknown;
  expectedParity?: unknown;
  observedParity?: unknown;
  status?: unknown;
};

type StoredReport = {
  generatedAtMs?: unknown;
  totals?: unknown;
  results?: StoredReportResult[];
  readiness?: StoredReadiness;
};

export async function getRustGatewayParityReportStatus(
  options: RustGatewayParityReportStatusOptions = {},
): Promise<RustGatewayParityReportStatus> {
  const reportPath = resolveReportPath(options.reportPath, options.cwd);
  const readFile = options.readFile ?? fs.readFile;
  try {
    const raw = await readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw) as StoredReport;
    return parseReportStatus({
      reportPath,
      report: parsed,
      nowMs: (options.nowMs ?? Date.now)(),
      freshMs: options.freshMs ?? RUST_GATEWAY_PARITY_REPORT_FRESH_MS,
    });
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
    if (code === "ENOENT") {
      return emptyStatus(reportPath, "missing", null);
    }
    return emptyStatus(
      reportPath,
      "invalid",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function parseReportStatus(params: {
  reportPath: string;
  report: StoredReport;
  nowMs: number;
  freshMs: number;
}): RustGatewayParityReportStatus {
  const generatedAtMs =
    typeof params.report.generatedAtMs === "number" && Number.isFinite(params.report.generatedAtMs)
      ? params.report.generatedAtMs
      : null;
  const totals = parseTotals(params.report.totals);
  if (!generatedAtMs || !totals) {
    return emptyStatus(params.reportPath, "invalid", "report is missing generatedAtMs or totals");
  }
  const ageMs = Math.max(0, params.nowMs - generatedAtMs);
  const failed = totals.failed > 0;
  const warnings = countWarnings(params.report);
  const blockers = countBlockers(params.report);
  return {
    path: params.reportPath,
    freshness: ageMs > params.freshMs ? "stale" : "fresh",
    generatedAtMs,
    ageMs,
    totals,
    promotionReady: !failed && blockers === 0 && warnings === 0,
    blockers,
    warnings,
    error: null,
  };
}

function parseTotals(value: unknown): RustGatewayParityReportStatus["totals"] {
  if (!value || typeof value !== "object") {
    return null;
  }
  const totals = value as Record<string, unknown>;
  const passed = readFiniteNumber(totals.passed);
  const failed = readFiniteNumber(totals.failed);
  const skipped = readFiniteNumber(totals.skipped);
  if (passed === null || failed === null || skipped === null) {
    return null;
  }
  return { passed, failed, skipped };
}

function countWarnings(report: StoredReport): number {
  const stored = readArrayLength(report.readiness?.warnings);
  if (stored !== null) {
    return stored;
  }
  return (
    report.results?.filter(
      (result) =>
        result.observedParity === "mock-compatible" || result.expectedParity === "unsupported",
    ).length ?? 0
  );
}

function countBlockers(report: StoredReport): number {
  const stored = readArrayLength(report.readiness?.blockers);
  if (stored !== null) {
    return stored;
  }
  return (
    report.results?.filter(
      (result) =>
        result.status === "failed" || (result.status === "skipped" && result.safety !== "unsafe"),
    ).length ?? 0
  );
}

function readArrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyStatus(
  reportPath: string,
  freshness: RustGatewayParityReportFreshness,
  error: string | null,
): RustGatewayParityReportStatus {
  return {
    path: reportPath,
    freshness,
    generatedAtMs: null,
    ageMs: null,
    totals: null,
    promotionReady: null,
    blockers: null,
    warnings: null,
    error,
  };
}

function resolveReportPath(reportPath: string | undefined, cwd = process.cwd()): string {
  const raw = reportPath ?? RUST_GATEWAY_PARITY_REPORT_DEFAULT_PATH;
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}
