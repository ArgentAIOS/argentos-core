#!/usr/bin/env node
import { init, parse } from "es-module-lexer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeDir = process.argv[2];
if (!runtimeDir) {
  console.error("Usage: node scripts/verify-runtime-deps.mjs <runtime_dir>");
  process.exit(1);
}

const entrypoint = path.join(runtimeDir, "argent.mjs");
if (!fs.existsSync(entrypoint)) {
  console.error(`Missing runtime entrypoint: ${entrypoint}`);
  process.exit(1);
}

function resolveRelativeImport(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

await init;

const queue = [entrypoint];
const visited = new Set();
const bareSpecs = new Set();

while (queue.length > 0) {
  const file = queue.pop();
  if (!file || visited.has(file)) continue;
  visited.add(file);

  if (!file.endsWith(".js") && !file.endsWith(".mjs")) continue;
  if (!fs.existsSync(file)) {
    console.error(`Runtime dependency verification failed. Missing local module file: ${file}`);
    process.exit(1);
  }

  const source = fs.readFileSync(file, "utf8");
  let imports;
  try {
    [imports] = parse(source);
  } catch (err) {
    console.error(`Failed to parse imports in ${file}: ${String(err)}`);
    process.exit(1);
  }

  for (const im of imports) {
    if (im.n == null) continue;
    const spec = im.n;
    if (spec.startsWith("node:") || spec.startsWith("data:")) continue;
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const resolved = resolveRelativeImport(file, spec);
      if (resolved == null) {
        console.error(
          `Runtime dependency verification failed. Missing local import "${spec}" from ${file}`,
        );
        process.exit(1);
      }
      queue.push(resolved);
      continue;
    }
    // Skip bare dynamic imports. They are often optional and guarded by runtime conditions.
    if (im.d !== -1) continue;
    bareSpecs.add(spec);
  }
}

const runtimeRequire = createRequire(pathToFileURL(entrypoint));
function resolvesFromRuntimeContext(spec) {
  try {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `try { await import.meta.resolve(${JSON.stringify(spec)}); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }`,
      ],
      {
        cwd: runtimeDir,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    return true;
  } catch {
    return false;
  }
}
const missing = [];
for (const spec of [...bareSpecs].sort()) {
  const runtimeResolved = resolvesFromRuntimeContext(spec);
  let requireResolved = false;
  try {
    runtimeRequire.resolve(spec);
    requireResolved = true;
  } catch {
    requireResolved = false;
  }
  if (!runtimeResolved && !requireResolved) {
    missing.push(spec);
  }
}

if (missing.length > 0) {
  console.error("Runtime dependency verification failed. Missing packages:");
  for (const spec of missing) console.error(`- ${spec}`);
  process.exit(1);
}

function listExtensionDependencyChecks(rootDir) {
  const extensionsDir = path.join(rootDir, "extensions");
  if (!fs.existsSync(extensionsDir) || !fs.statSync(extensionsDir).isDirectory()) {
    return [];
  }

  const checks = [];
  for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const extDir = path.join(extensionsDir, entry.name);
    const packageJsonPath = path.join(extDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    } catch (err) {
      console.error(`Runtime dependency verification failed. Invalid JSON: ${packageJsonPath}`);
      console.error(String(err));
      process.exit(1);
    }

    const isCoreBundledExtension =
      manifest?.argent?.core === true || manifest?.argent?.runtime?.bundleDependencies === true;
    if (!isCoreBundledExtension) {
      continue;
    }

    const deps = [
      ...Object.keys(manifest?.dependencies ?? {}),
      ...Object.keys(manifest?.optionalDependencies ?? {}),
    ];
    for (const dep of deps) {
      if (dep.startsWith("node:")) continue;
      checks.push({ extensionId: entry.name, packageJsonPath, dep });
    }
  }

  return checks;
}

const extensionMissing = [];
const extensionChecks = listExtensionDependencyChecks(runtimeDir);
for (const check of extensionChecks) {
  try {
    const extensionRequire = createRequire(pathToFileURL(check.packageJsonPath));
    extensionRequire.resolve(check.dep);
  } catch {
    extensionMissing.push(`${check.dep} (required by extension ${check.extensionId})`);
  }
}

if (extensionMissing.length > 0) {
  console.error("Runtime dependency verification failed. Missing extension packages:");
  for (const spec of extensionMissing.sort()) console.error(`- ${spec}`);
  process.exit(1);
}

console.log(
  `Runtime dependency verification passed (${visited.size} modules traversed, ${bareSpecs.size} packages resolved, ${extensionChecks.length} extension deps checked).`,
);
