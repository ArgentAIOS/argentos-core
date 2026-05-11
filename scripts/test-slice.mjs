#!/usr/bin/env node
// scripts/test-slice.mjs
//
// Run focused vitest only on tests related to files changed in this slice
// (i.e. files that differ between origin/dev and HEAD).
//
// Heuristic for mapping a changed source file to its test files:
//   * If the file already ends in .test.ts or .test.tsx, include it directly.
//   * Otherwise, for a .ts/.tsx file at <dir>/<name>.<ext>, look for a sibling
//     <dir>/<name>.test.ts and <dir>/<name>.test.tsx. Include any that exist.
//
// This applies uniformly across the repo (src/, dashboard/, ui/, etc.).
//
// If no test files are discovered, exit 0 with a "skipping (clean)" message.
// Otherwise exec `pnpm exec vitest run <files>` and propagate its exit code.
//
// Used by the "verified" definition (docs/conventions/verified.md).

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

function changedFiles() {
  const out = execFileSync("git", ["diff", "--name-only", "origin/dev...HEAD"], {
    encoding: "utf8",
    cwd: repoRoot,
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isTestFile(file) {
  return /\.test\.(ts|tsx)$/.test(file);
}

function isSourceFile(file) {
  return /\.(ts|tsx)$/.test(file) && !isTestFile(file);
}

function existsRel(rel) {
  return fs.existsSync(path.join(repoRoot, rel));
}

function discoverTestsForFile(file) {
  if (isTestFile(file)) {
    if (existsRel(file)) return [file];
    return [];
  }
  if (!isSourceFile(file)) return [];
  const ext = path.extname(file); // .ts or .tsx
  const base = file.slice(0, -ext.length);
  const candidates = [`${base}.test.ts`, `${base}.test.tsx`];
  return candidates.filter(existsRel);
}

function main() {
  const changed = changedFiles();
  const testSet = new Set();
  for (const file of changed) {
    for (const t of discoverTestsForFile(file)) {
      testSet.add(t);
    }
  }
  const tests = [...testSet].sort();

  if (tests.length === 0) {
    console.log("no test files for this slice; skipping (clean)");
    process.exit(0);
  }

  console.log(`test:slice -> running ${tests.length} test file(s):`);
  for (const t of tests) console.log(`  ${t}`);

  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpm, ["exec", "vitest", "run", ...tests], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`failed to launch vitest: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();
