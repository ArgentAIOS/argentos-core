import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  defaultPublicCoreManifestPath,
  resolvePublicCoreRepoRoot,
  resolveManifestEntryPath,
} from "../src/infra/public-core-export.js";

const execFile = promisify(execFileCallback);

type Manifest = {
  version: number;
  mode?: string;
  sourceRepoRoot: string;
  targetRepoRoot: string;
  include: string[];
  exclude?: string[];
  denylistFiles?: string[];
  preserveInTarget?: string[];
  deferredReview?: string[];
  notes?: string[];
};

type DenylistRule = {
  id: string;
  reason: string;
  paths: string[];
};

type Denylist = {
  version: number;
  date?: string;
  purpose?: string;
  notes?: string[];
  rules: DenylistRule[];
};

type Options = {
  manifestPath: string;
  sourceRepoRootOverride: string | null;
  targetRepoRootOverride: string | null;
  apply: boolean;
  verbose: boolean;
};

function parseArgs(argv: string[]): Options {
  let manifestPath = defaultPublicCoreManifestPath(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  let sourceRepoRootOverride: string | null = null;
  let targetRepoRootOverride: string | null = null;
  let apply = false;
  let verbose = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      manifestPath = argv[index + 1] ?? manifestPath;
      index += 1;
      continue;
    }
    if (arg === "--source-repo-root") {
      sourceRepoRootOverride = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--target-repo-root") {
      targetRepoRootOverride = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsageAndExit(0);
    }
  }
  return { manifestPath, sourceRepoRootOverride, targetRepoRootOverride, apply, verbose };
}

function printUsageAndExit(code: number): never {
  const lines = [
    "Usage: node --import tsx scripts/export-public-core.ts [--manifest <path>] [--source-repo-root <path>] [--target-repo-root <path>] [--apply] [--verbose]",
    "",
    "Default mode is dry-run.",
    "Use --apply to sync the selected files into the target repo.",
  ];
  console.error(lines.join(os.EOL));
  process.exit(code);
}

async function readManifest(manifestPath: string): Promise<Manifest> {
  const raw = await fs.readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as Manifest;
  if (!parsed?.sourceRepoRoot || !parsed?.targetRepoRoot) {
    throw new Error(`Invalid manifest: ${manifestPath}`);
  }
  if (!Array.isArray(parsed.include) || parsed.include.length === 0) {
    throw new Error(`Manifest must declare at least one include pattern: ${manifestPath}`);
  }
  return parsed;
}

async function readDenylist(denylistPath: string): Promise<Denylist> {
  const raw = await fs.readFile(denylistPath, "utf8");
  const parsed = JSON.parse(raw) as Denylist;
  if (!Array.isArray(parsed?.rules)) {
    throw new Error(`Invalid denylist: ${denylistPath}`);
  }
  return parsed;
}

function normalizeSlashes(input: string): string {
  return input.split(path.sep).join("/");
}

function matchesAny(relPath: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => path.matchesGlob(relPath, pattern));
}

function matchesSegmentDirectory(relPath: string, segment: string): boolean {
  return (
    relPath === segment || relPath.startsWith(`${segment}/`) || relPath.includes(`/${segment}/`)
  );
}

function isTargetLocalArtifact(relPath: string): boolean {
  const normalized = normalizeSlashes(relPath).replace(/\/+$/, "");
  return (
    matchesSegmentDirectory(normalized, "node_modules") ||
    matchesSegmentDirectory(normalized, "dist") ||
    matchesSegmentDirectory(normalized, ".build") ||
    matchesSegmentDirectory(normalized, ".pnpm-store") ||
    matchesSegmentDirectory(normalized, ".turbo") ||
    matchesSegmentDirectory(normalized, ".cache") ||
    matchesSegmentDirectory(normalized, "coverage")
  );
}

function resolveManifestPath(basePath: string, entry: string): string {
  return resolveManifestEntryPath(basePath, entry);
}

async function listSourceFiles(repoRoot: string): Promise<string[]> {
  const { stdout } = await execFile(
    "git",
    ["-C", repoRoot, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: repoRoot,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return stdout
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => normalizeSlashes(entry));
}

async function walkTargetFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
      const absolute = path.join(current, entry.name);
      const relative = normalizeSlashes(path.relative(root, absolute));
      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        out.push(relative);
      }
    }
  }
  await walk(root);
  return out;
}

async function ensureParent(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function copyFile(source: string, target: string): Promise<void> {
  await ensureParent(target);
  await fs.copyFile(source, target);
}

async function removeEmptyDirectories(root: string): Promise<void> {
  async function prune(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
      if (entry.isDirectory()) {
        await prune(path.join(current, entry.name));
      }
    }
    if (current === root) {
      return;
    }
    const remaining = await fs.readdir(current);
    if (remaining.length === 0) {
      await fs.rmdir(current);
    }
  }
  await prune(root);
}

function classifyFiles(files: string[], manifest: Manifest, denyPatterns: string[]) {
  const included: string[] = [];
  const excluded: string[] = [];
  for (const relPath of files) {
    const isIncluded = matchesAny(relPath, manifest.include);
    const isExcluded =
      matchesAny(relPath, manifest.exclude) ||
      matchesAny(relPath, denyPatterns) ||
      matchesAny(relPath, manifest.deferredReview);
    if (isIncluded && !isExcluded) {
      included.push(relPath);
    } else {
      excluded.push(relPath);
    }
  }
  return { included, excluded };
}

function flattenDenyPatterns(rules: DenylistRule[]): string[] {
  return rules.flatMap((rule) => rule.paths);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(options.manifestPath);
  const manifest = await readManifest(manifestPath);
  const denylistPaths = (manifest.denylistFiles ?? []).map((entry) =>
    resolveManifestPath(manifestPath, entry),
  );
  const denylists = await Promise.all(denylistPaths.map((entry) => readDenylist(entry)));
  const denyRules = denylists.flatMap((entry) => entry.rules);
  const denyPatterns = flattenDenyPatterns(denyRules);
  const sourceRepoRoot = resolvePublicCoreRepoRoot(
    manifestPath,
    manifest.sourceRepoRoot,
    options.sourceRepoRootOverride,
  );
  const targetRepoRoot = resolvePublicCoreRepoRoot(
    manifestPath,
    manifest.targetRepoRoot,
    options.targetRepoRootOverride,
  );
  const sourceFiles = await listSourceFiles(sourceRepoRoot);
  const { included, excluded } = classifyFiles(sourceFiles, manifest, denyPatterns);
  const preserve = new Set(
    (manifest.preserveInTarget ?? []).map((entry) => normalizeSlashes(entry.replace(/\/$/, ""))),
  );
  const denyMatches = denyRules.map((rule) => ({
    id: rule.id,
    matchedCount: sourceFiles.filter((relPath) => matchesAny(relPath, rule.paths)).length,
  }));

  console.log(
    JSON.stringify(
      {
        mode: manifest.mode ?? "unspecified",
        sourceRepoRoot,
        targetRepoRoot,
        includedCount: included.length,
        excludedCount: excluded.length,
        denylistFileCount: denylistPaths.length,
        denyRuleCount: denyRules.length,
        denyPatternCount: denyPatterns.length,
        deferredReviewExcludedCount: manifest.deferredReview?.length ?? 0,
        deferredReviewCount: manifest.deferredReview?.length ?? 0,
        apply: options.apply,
      },
      null,
      2,
    ),
  );

  if (options.verbose) {
    if (denyMatches.length > 0) {
      console.log("\nDenylist matches:");
      for (const match of denyMatches) {
        console.log(`  ! ${match.id}: ${match.matchedCount}`);
      }
    }
    console.log("\nIncluded sample:");
    for (const relPath of included.slice(0, 40)) {
      console.log(`  + ${relPath}`);
    }
    console.log("\nExcluded sample:");
    for (const relPath of excluded.slice(0, 40)) {
      console.log(`  - ${relPath}`);
    }
  }

  if (!options.apply) {
    console.log("\nDry-run only. Re-run with --apply to sync the target repo.");
    return;
  }

  await fs.mkdir(targetRepoRoot, { recursive: true });
  const targetFiles = await walkTargetFiles(targetRepoRoot);
  const includedSet = new Set(included);
  let copied = 0;
  let deleted = 0;
  let preserved = 0;

  for (const targetRelPath of targetFiles) {
    if (preserve.has(targetRelPath)) {
      preserved += 1;
      continue;
    }
    if (isTargetLocalArtifact(targetRelPath)) {
      preserved += 1;
      continue;
    }
    if (!includedSet.has(targetRelPath)) {
      await fs.rm(path.join(targetRepoRoot, targetRelPath), { force: true });
      deleted += 1;
    }
  }

  for (const relPath of included) {
    const sourcePath = path.join(sourceRepoRoot, relPath);
    const targetPath = path.join(targetRepoRoot, relPath);
    await copyFile(sourcePath, targetPath);
    copied += 1;
  }

  await removeEmptyDirectories(targetRepoRoot);

  console.log(
    `\nSync complete: copied=${copied} deleted=${deleted} preserved=${preserved} target=${targetRepoRoot}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
