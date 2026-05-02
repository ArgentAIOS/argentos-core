import fs from "node:fs/promises";
import path from "node:path";
import type { RustGatewayParityReplayReport } from "./rust-gateway-parity-runner.js";
import { runIsolatedRustGatewayParity } from "./rust-gateway-parity-isolated.js";
import {
  renderRustGatewayParityReplayMarkdown,
  type RustGatewayPromotionReadiness,
  evaluateRustGatewayPromotionReadiness,
  buildRustGatewayPromotionReadinessSummary,
} from "./rust-gateway-parity-report.js";
import { createRustGatewayParityServiceStarters } from "./rust-gateway-parity-services.js";
import { collectRustGatewayShadowDriftEvents } from "./rust-gateway-shadow-drift-log.js";

export type RustGatewayParityReportJobResult = {
  report: RustGatewayParityReplayReport;
  readiness: RustGatewayPromotionReadiness;
  files: {
    json: string;
    markdown: string;
    driftJsonl: string;
    readinessSummary: string;
  };
};

export type RustGatewayParityReportJobOptions = {
  outputDir: string;
  repoRoot?: string;
  nodePort?: number;
  rustPort?: number;
  token?: string;
  timeoutMs?: number;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  createStarters?: typeof createRustGatewayParityServiceStarters;
  runParity?: typeof runIsolatedRustGatewayParity;
  mkdir?: typeof fs.mkdir;
  writeFile?: typeof fs.writeFile;
};

export async function runRustGatewayParityReportJob(
  options: RustGatewayParityReportJobOptions,
): Promise<RustGatewayParityReportJobResult> {
  const mkdir = options.mkdir ?? fs.mkdir;
  const writeFile = options.writeFile ?? fs.writeFile;
  const createStarters = options.createStarters ?? createRustGatewayParityServiceStarters;
  const runParity = options.runParity ?? runIsolatedRustGatewayParity;
  await mkdir(options.outputDir, { recursive: true });

  const starters = await createStarters({
    repoRoot: options.repoRoot,
    nodePort: options.nodePort,
    rustPort: options.rustPort,
    token: options.token,
    timeoutMs: options.startupTimeoutMs ?? options.timeoutMs,
  });
  const report = await runParity({
    startNodeGateway: starters.startNodeGateway,
    startRustGateway: starters.startRustGateway,
    token: starters.token,
    timeoutMs: options.requestTimeoutMs ?? options.timeoutMs,
  });
  const readiness = evaluateRustGatewayPromotionReadiness(report);
  const files = resolveReportFiles(options.outputDir);
  const markdown = renderRustGatewayParityReplayMarkdown(report);
  const readinessSummary = buildRustGatewayPromotionReadinessSummary(report);
  const driftJsonl = collectRustGatewayShadowDriftEvents(report)
    .map((event) => JSON.stringify(event))
    .join("\n");

  await writeFile(files.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(files.markdown, markdown, "utf8");
  await writeFile(files.readinessSummary, `${JSON.stringify(readinessSummary, null, 2)}\n`, "utf8");
  await writeFile(files.driftJsonl, driftJsonl ? `${driftJsonl}\n` : "", "utf8");

  return { report, readiness, files };
}

function resolveReportFiles(outputDir: string): RustGatewayParityReportJobResult["files"] {
  return {
    json: path.join(outputDir, "rust-gateway-parity-report.json"),
    markdown: path.join(outputDir, "rust-gateway-parity-report.md"),
    driftJsonl: path.join(outputDir, "rust-gateway-shadow-drift.jsonl"),
    readinessSummary: path.join(outputDir, "rust-gateway-readiness-summary.json"),
  };
}
