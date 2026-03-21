/**
 * Export memory recall telemetry into an offline eval bundle.
 *
 * Usage:
 *   node --import tsx scripts/export-memory-recall-evals.ts
 *   node --import tsx scripts/export-memory-recall-evals.ts --limit 500 --summary
 *   node --import tsx scripts/export-memory-recall-evals.ts --query-class identity_property --out /tmp/mrql.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  readMemoryRecallTelemetryEntries,
  resolveMemoryRecallTelemetryPath,
  summarizeMemoryRecallTelemetry,
} from "../src/agents/tools/memu-recall-telemetry.js";

type Args = {
  filePath?: string;
  outPath?: string;
  limit: number;
  sinceHours?: number;
  queryClass?: string;
  status?: "ok" | "error";
  agentId?: string;
  summaryOnly: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 200,
    summaryOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--summary") {
      args.summaryOnly = true;
      continue;
    }
    if (arg === "--limit" && argv[i + 1]) {
      args.limit = Number.parseInt(argv[++i] ?? "200", 10) || 200;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      args.limit = Number.parseInt(arg.slice("--limit=".length), 10) || 200;
      continue;
    }
    if (arg === "--since-hours" && argv[i + 1]) {
      args.sinceHours = Number.parseFloat(argv[++i] ?? "0") || undefined;
      continue;
    }
    if (arg.startsWith("--since-hours=")) {
      args.sinceHours = Number.parseFloat(arg.slice("--since-hours=".length)) || undefined;
      continue;
    }
    if (arg === "--query-class" && argv[i + 1]) {
      args.queryClass = argv[++i];
      continue;
    }
    if (arg.startsWith("--query-class=")) {
      args.queryClass = arg.slice("--query-class=".length);
      continue;
    }
    if (arg === "--status" && argv[i + 1]) {
      const value = argv[++i];
      if (value === "ok" || value === "error") {
        args.status = value;
      }
      continue;
    }
    if (arg.startsWith("--status=")) {
      const value = arg.slice("--status=".length);
      if (value === "ok" || value === "error") {
        args.status = value;
      }
      continue;
    }
    if (arg === "--agent" && argv[i + 1]) {
      args.agentId = argv[++i];
      continue;
    }
    if (arg.startsWith("--agent=")) {
      args.agentId = arg.slice("--agent=".length);
      continue;
    }
    if (arg === "--file" && argv[i + 1]) {
      args.filePath = argv[++i];
      continue;
    }
    if (arg.startsWith("--file=")) {
      args.filePath = arg.slice("--file=".length);
      continue;
    }
    if (arg === "--out" && argv[i + 1]) {
      args.outPath = argv[++i];
      continue;
    }
    if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(args.filePath ?? resolveMemoryRecallTelemetryPath(process.env));
  const sinceTs =
    typeof args.sinceHours === "number" && Number.isFinite(args.sinceHours)
      ? Date.now() - args.sinceHours * 60 * 60 * 1000
      : undefined;

  const entries = await readMemoryRecallTelemetryEntries({
    filePath,
    limit: args.limit,
    sinceTs,
    queryClass: args.queryClass,
    status: args.status,
    agentId: args.agentId,
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    filePath,
    filters: {
      limit: args.limit,
      sinceHours: args.sinceHours ?? null,
      queryClass: args.queryClass ?? null,
      status: args.status ?? null,
      agentId: args.agentId ?? null,
    },
    summary: summarizeMemoryRecallTelemetry(entries),
    entries: args.summaryOnly ? undefined : entries,
  };

  const body = `${JSON.stringify(payload, null, 2)}\n`;
  if (args.outPath) {
    const outPath = path.resolve(args.outPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, body, "utf-8");
    process.stdout.write(`${outPath}\n`);
    return;
  }

  process.stdout.write(body);
}

void main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
