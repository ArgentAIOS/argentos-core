/**
 * Rust Gateway Parity Report
 *
 * Opt-in isolated Node-vs-Rust gateway parity harness.
 *
 * This does not switch live gateway authority. It starts an isolated Node gateway
 * and an isolated `argentd` shadow gateway on loopback ports, replays safe
 * fixtures, and writes JSON/Markdown/drift reports.
 *
 * Usage:
 *   node --import tsx scripts/rust-gateway-parity-report.ts
 *   node --import tsx scripts/rust-gateway-parity-report.ts --output-dir .omx/state/rust-gateway-parity/manual
 *   node --import tsx scripts/rust-gateway-parity-report.ts --node-port 19100 --rust-port 19101 --strict
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { runRustGatewayParityReportJob } from "../src/infra/rust-gateway-parity-report-run.js";

type Args = {
  outputDir: string;
  nodePort?: number;
  rustPort?: number;
  token?: string;
  timeoutMs?: number;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  jsonSummary: boolean;
  strict: boolean;
  help: boolean;
};

const DEFAULT_OUTPUT_DIR = ".omx/state/rust-gateway-parity/latest";

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    outputDir: DEFAULT_OUTPUT_DIR,
    jsonSummary: false,
    strict: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--strict") {
      args.strict = true;
      continue;
    }
    if (arg === "--json-summary") {
      args.jsonSummary = true;
      continue;
    }
    if (arg === "--output-dir") {
      args.outputDir = readNext(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      args.outputDir = arg.slice("--output-dir=".length);
      continue;
    }
    if (arg === "--node-port") {
      args.nodePort = parsePort(readNext(argv, ++i, arg), arg);
      continue;
    }
    if (arg.startsWith("--node-port=")) {
      args.nodePort = parsePort(arg.slice("--node-port=".length), "--node-port");
      continue;
    }
    if (arg === "--rust-port") {
      args.rustPort = parsePort(readNext(argv, ++i, arg), arg);
      continue;
    }
    if (arg.startsWith("--rust-port=")) {
      args.rustPort = parsePort(arg.slice("--rust-port=".length), "--rust-port");
      continue;
    }
    if (arg === "--token") {
      args.token = readNext(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith("--token=")) {
      args.token = arg.slice("--token=".length);
      continue;
    }
    if (arg === "--timeout-ms") {
      args.timeoutMs = parsePositiveInt(readNext(argv, ++i, arg), arg);
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      args.timeoutMs = parsePositiveInt(arg.slice("--timeout-ms=".length), "--timeout-ms");
      continue;
    }
    if (arg === "--startup-timeout-ms") {
      args.startupTimeoutMs = parsePositiveInt(readNext(argv, ++i, arg), arg);
      continue;
    }
    if (arg.startsWith("--startup-timeout-ms=")) {
      args.startupTimeoutMs = parsePositiveInt(
        arg.slice("--startup-timeout-ms=".length),
        "--startup-timeout-ms",
      );
      continue;
    }
    if (arg === "--request-timeout-ms") {
      args.requestTimeoutMs = parsePositiveInt(readNext(argv, ++i, arg), arg);
      continue;
    }
    if (arg.startsWith("--request-timeout-ms=")) {
      args.requestTimeoutMs = parsePositiveInt(
        arg.slice("--request-timeout-ms=".length),
        "--request-timeout-ms",
      );
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!args.outputDir.trim()) {
    throw new Error("--output-dir cannot be empty");
  }
  return args;
}

function readNext(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePort(value: string, flag: string): number {
  const port = parsePositiveInt(value, flag);
  if (port > 65_535) {
    throw new Error(`${flag} must be <= 65535`);
  }
  return port;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== value || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`Rust Gateway Parity Report

Usage:
  node --import tsx scripts/rust-gateway-parity-report.ts [options]
  pnpm rust-gateway:parity:report -- [options]

Options:
  --output-dir <dir>   Report output directory (default: ${DEFAULT_OUTPUT_DIR})
  --node-port <port>   Explicit isolated Node gateway port
  --rust-port <port>   Explicit isolated argentd port
  --token <token>      Shared test token for both isolated gateways
  --timeout-ms <ms>    Startup and WebSocket timeout fallback
  --startup-timeout-ms <ms>
                       Service startup timeout (useful when dist rebuilds)
  --request-timeout-ms <ms>
                       Per-request WebSocket replay timeout
  --json-summary       Print machine-readable JSON summary to stdout
  --strict             Exit 2 when promotion readiness is not clean
  -h, --help           Show this help

Safety:
  Starts isolated loopback services only. Unsafe fixtures stay blocked by policy.
  Node remains the live gateway authority; this command never promotes Rust.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const outputDir = path.resolve(process.cwd(), args.outputDir);
  const result = await runRustGatewayParityReportJob({
    outputDir,
    repoRoot: process.cwd(),
    nodePort: args.nodePort,
    rustPort: args.rustPort,
    token: args.token,
    timeoutMs: args.timeoutMs,
    startupTimeoutMs: args.startupTimeoutMs,
    requestTimeoutMs: args.requestTimeoutMs,
  });

  if (args.jsonSummary) {
    console.log(
      JSON.stringify(
        {
          outputDir,
          files: result.files,
          totals: result.report.totals,
          promotionReady: result.readiness.ready,
          blockers: result.readiness.blockers.length,
          warnings: result.readiness.warnings.length,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("=== Rust Gateway Parity Report ===");
    console.log(`outputDir: ${outputDir}`);
    console.log(`json: ${result.files.json}`);
    console.log(`markdown: ${result.files.markdown}`);
    console.log(`readinessSummary: ${result.files.readinessSummary}`);
    console.log(`driftJsonl: ${result.files.driftJsonl}`);
    console.log(
      `summary: passed=${result.report.totals.passed} failed=${result.report.totals.failed} skipped=${result.report.totals.skipped}`,
    );
    console.log(`promotionReady: ${result.readiness.ready ? "YES" : "NO"}`);
    if (result.readiness.blockers.length > 0) {
      console.log(`blockers: ${result.readiness.blockers.length}`);
    }
    if (result.readiness.warnings.length > 0) {
      console.log(`warnings: ${result.readiness.warnings.length}`);
    }
  }

  if (args.strict && !result.readiness.ready) {
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
