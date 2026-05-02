import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { formatCliCommand } from "../cli/command-format.js";
import { note } from "../terminal/note.js";
import { getRustGatewayParityReportStatus } from "./status.rust-gateway-parity-report.js";

const execFileAsync = promisify(execFile);

export type RustGatewayParityReadinessCheck = {
  label: string;
  status: "ok" | "warn";
  detail: string;
};

export type RustGatewayParityReadiness = {
  checks: RustGatewayParityReadinessCheck[];
  command: string;
};

export type RustGatewayParityReadinessOptions = {
  cwd?: string;
  nowMs?: () => number;
  freshMs?: number;
  execFileImpl?: typeof execFileAsync;
  readFile?: typeof fs.readFile;
};

export async function collectRustGatewayParityReadiness(
  options: RustGatewayParityReadinessOptions = {},
): Promise<RustGatewayParityReadiness> {
  const cwd = options.cwd ?? process.cwd();
  const execImpl = options.execFileImpl ?? execFileAsync;
  const readFile = options.readFile ?? fs.readFile;
  const [cargo, packageScript, report] = await Promise.all([
    commandVersion("cargo", ["--version"], execImpl),
    hasPackageScript(cwd, readFile),
    getRustGatewayParityReportStatus({
      cwd,
      readFile,
      nowMs: options.nowMs,
      freshMs: options.freshMs,
    }),
  ]);

  const checks: RustGatewayParityReadinessCheck[] = [
    cargo.ok
      ? { label: "cargo", status: "ok", detail: cargo.detail }
      : { label: "cargo", status: "warn", detail: cargo.detail },
    packageScript
      ? {
          label: "report command",
          status: "ok",
          detail: formatCliCommand("pnpm rust-gateway:parity:report"),
        }
      : {
          label: "report command",
          status: "warn",
          detail: "missing package script rust-gateway:parity:report",
        },
    {
      label: "latest report",
      status: report.freshness === "fresh" ? "ok" : "warn",
      detail: formatReportDetail(report),
    },
  ];

  return {
    checks,
    command: formatCliCommand("pnpm rust-gateway:parity:report"),
  };
}

export async function noteRustGatewayParityReadiness(
  options: RustGatewayParityReadinessOptions = {},
): Promise<void> {
  const readiness = await collectRustGatewayParityReadiness(options);
  const lines = readiness.checks.map((check) => {
    const tag = check.status === "ok" ? "OK" : "WARN";
    return `- ${tag}: ${check.label} — ${check.detail}`;
  });
  lines.push(`- Run: ${readiness.command}`);
  note(lines.join("\n"), "Rust gateway parity");
}

async function commandVersion(
  command: string,
  args: string[],
  execImpl: typeof execFileAsync,
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  try {
    const { stdout } = await execImpl(command, args, { timeout: 2_000 });
    const detail = stdout.trim().split("\n")[0]?.trim();
    return { ok: true, detail: detail || `${command} available` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function hasPackageScript(cwd: string, readFile: typeof fs.readFile): Promise<boolean> {
  try {
    const raw = await readFile(path.join(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return typeof parsed.scripts?.["rust-gateway:parity:report"] === "string";
  } catch {
    return false;
  }
}

function formatReportDetail(
  report: Awaited<ReturnType<typeof getRustGatewayParityReportStatus>>,
): string {
  if (report.freshness === "missing") {
    return `missing at ${report.path}`;
  }
  if (report.freshness === "invalid") {
    return `invalid at ${report.path}${report.error ? ` (${report.error})` : ""}`;
  }
  const totals = report.totals
    ? `${report.totals.passed} passed, ${report.totals.failed} failed, ${report.totals.skipped} skipped`
    : "totals unavailable";
  const freshness =
    report.freshness === "fresh"
      ? "fresh"
      : `stale${report.ageMs != null ? ` ageMs=${report.ageMs}` : ""}`;
  const readiness =
    report.promotionReady === true
      ? "promotionReady=YES"
      : report.promotionReady === false
        ? "promotionReady=NO"
        : "promotionReady=unknown";
  return `${freshness}; ${totals}; ${readiness}; blockers=${report.blockers ?? "?"}; warnings=${report.warnings ?? "?"}`;
}
