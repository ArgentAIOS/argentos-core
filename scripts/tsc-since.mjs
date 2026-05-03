#!/usr/bin/env node
// scripts/tsc-since.mjs
//
// Compare current `pnpm exec tsc --noEmit` errors against the baseline snapshot
// in ops/known-failing.json. The intent: surface NET-NEW TS errors only, so
// agents and humans can verify a slice without being drowned by the known-red
// repo-wide baseline.
//
// Behaviour:
//   * Runs `pnpm exec tsc --noEmit` (combining stdout + stderr).
//   * Parses lines matching `<file>(<line>,<col>): error TS<code>: <message>`.
//   * Compares against ops/known-failing.json (baseline). Any error already
//     present in the baseline is ignored. Any error not in the baseline is
//     "NEW".
//   * Exits 0 with `no NET-NEW TS errors (still N baseline)` if no new ones.
//   * Exits 1 listing only the NEW errors otherwise.
//
// Identity: an error is identified by (file, line, code, message). Column is
// excluded so trivial reformatting doesn't flag pre-existing errors as new.

import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const snapshotPath = path.join(repoRoot, "ops", "known-failing.json");

const ERROR_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

function parseErrors(text) {
  const errors = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const m = line.match(ERROR_RE);
    if (!m) continue;
    errors.push({
      file: m[1],
      line: Number.parseInt(m[2], 10),
      code: m[4],
      message: m[5],
    });
  }
  return errors;
}

function errorKey(err) {
  // Identity excludes column so harmless reformatting doesn't reclassify
  // a baseline error as new.
  return `${err.file}|${err.line}|${err.code}|${err.message}`;
}

function loadBaseline() {
  if (!fs.existsSync(snapshotPath)) {
    console.error(
      `tsc-since: baseline snapshot not found at ${path.relative(repoRoot, snapshotPath)}`,
    );
    console.error(
      "tsc-since: run scripts/tsc-since.mjs --snapshot to generate one (or commit one)",
    );
    process.exit(2);
  }
  const raw = fs.readFileSync(snapshotPath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.errors)) {
    console.error(`tsc-since: baseline at ${snapshotPath} missing "errors" array`);
    process.exit(2);
  }
  return data;
}

function runTsc() {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpm, ["exec", "tsc", "--noEmit"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    console.error(`tsc-since: failed to launch tsc: ${result.error.message}`);
    process.exit(2);
  }
  // tsc writes diagnostics to stdout; grab both for safety.
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function writeSnapshot(errors) {
  const payload = {
    snapshotAt: new Date().toISOString(),
    totalErrors: errors.length,
    errors,
  };
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `tsc-since: wrote snapshot to ${path.relative(repoRoot, snapshotPath)} (${errors.length} errors)`,
  );
}

function main() {
  const args = new Set(process.argv.slice(2));
  const output = runTsc();
  const current = parseErrors(output);

  if (args.has("--snapshot")) {
    writeSnapshot(current);
    process.exit(0);
  }

  const baseline = loadBaseline();
  const baselineKeys = new Set(baseline.errors.map(errorKey));

  const newErrors = current.filter((err) => !baselineKeys.has(errorKey(err)));

  if (newErrors.length === 0) {
    console.log(`tsc-since: no NET-NEW TS errors (still ${baseline.totalErrors} baseline)`);
    process.exit(0);
  }

  console.error(`tsc-since: ${newErrors.length} NET-NEW TS error(s):`);
  for (const err of newErrors) {
    console.error(`  ${err.file}:${err.line} ${err.code}: ${err.message}`);
  }
  console.error(`tsc-since: (baseline has ${baseline.totalErrors} known errors; not shown)`);
  process.exit(1);
}

main();
