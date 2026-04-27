#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledHarnesses = ["aos-cognee"];
const strict = process.argv.includes("--strict");
const requestedOnly = process.argv
  .filter((arg) => arg.startsWith("--only="))
  .map((arg) => arg.slice("--only=".length).trim())
  .filter(Boolean);
const selectedHarnesses = requestedOnly.length > 0 ? requestedOnly : bundledHarnesses;

function log(message) {
  process.stdout.write(`[aos-harness] ${message}\n`);
}

function warn(message) {
  process.stderr.write(`[aos-harness] ${message}\n`);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    timeout: options.timeoutMs ?? 300_000,
  });
}

function resolvePython(minVersion) {
  for (const candidate of ["python3", "python"]) {
    const result = run(candidate, [
      "-c",
      "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
    ]);
    if (result.status !== 0) {
      continue;
    }
    const [major, minor] = String(result.stdout || "")
      .trim()
      .split(".")
      .map((part) => Number(part));
    if (
      Number.isFinite(major) &&
      Number.isFinite(minor) &&
      (major > minVersion.major || (major === minVersion.major && minor >= minVersion.minor))
    ) {
      return candidate;
    }
  }
  return null;
}

function parseMinPython(pyprojectPath) {
  const raw = fs.readFileSync(pyprojectPath, "utf8");
  const match = raw.match(/requires-python\s*=\s*">=\s*(\d+)\.(\d+)/);
  return {
    major: Number(match?.[1] ?? 3),
    minor: Number(match?.[2] ?? 10),
  };
}

function installHarness(tool) {
  const harnessDir = path.join(root, "tools", "aos", tool, "agent-harness");
  const pyprojectPath = path.join(harnessDir, "pyproject.toml");
  if (!fs.existsSync(pyprojectPath)) {
    return { ok: false, message: `${tool}: missing ${pyprojectPath}` };
  }

  const minPython = parseMinPython(pyprojectPath);
  const python = resolvePython(minPython);
  if (!python) {
    return {
      ok: false,
      message: `${tool}: Python ${minPython.major}.${minPython.minor}+ not found on PATH`,
    };
  }

  const venvDir = path.join(harnessDir, ".venv");
  const venvPython =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python");
  const expectedBinary =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", `${tool}.exe`)
      : path.join(venvDir, "bin", tool);

  if (!fs.existsSync(venvPython)) {
    const create = run(python, ["-m", "venv", ".venv"], { cwd: harnessDir });
    if (create.status !== 0) {
      return {
        ok: false,
        message: `${tool}: failed to create venv: ${String(create.stderr || create.stdout).trim()}`,
      };
    }
  }

  const pipUpgrade = run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], {
    cwd: harnessDir,
    timeoutMs: 180_000,
  });
  if (pipUpgrade.status !== 0) {
    return {
      ok: false,
      message: `${tool}: failed to upgrade pip: ${String(pipUpgrade.stderr || pipUpgrade.stdout).trim()}`,
    };
  }

  const install = run(venvPython, ["-m", "pip", "install", "-e", "."], {
    cwd: harnessDir,
    timeoutMs: 600_000,
  });
  if (install.status !== 0) {
    return {
      ok: false,
      message: `${tool}: failed to install harness: ${String(install.stderr || install.stdout).trim()}`,
    };
  }

  if (!fs.existsSync(expectedBinary)) {
    return { ok: false, message: `${tool}: expected binary was not created at ${expectedBinary}` };
  }

  return { ok: true, message: `${tool}: installed at ${expectedBinary}` };
}

if (process.env.ARGENT_SKIP_BUNDLED_AOS_HARNESSES === "1") {
  log("skipped because ARGENT_SKIP_BUNDLED_AOS_HARNESSES=1");
  process.exit(0);
}

let failed = false;
for (const tool of selectedHarnesses) {
  log(`installing ${tool}`);
  const result = installHarness(tool);
  if (result.ok) {
    log(result.message);
  } else {
    failed = true;
    warn(result.message);
  }
}

if (failed && strict) {
  process.exit(1);
}
