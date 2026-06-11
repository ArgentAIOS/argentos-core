import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type CommandOptions, runCommandWithTimeout } from "../process/exec.js";
import { trimLogTail } from "./restart-sentinel.js";
import { sweepLegacyInstallSymlinks } from "./symlink-sweep.js";
import {
  channelToNpmTag,
  DEFAULT_PACKAGE_CHANNEL,
  DEV_BRANCH,
  isBetaTag,
  isStableTag,
  type UpdateChannel,
} from "./update-channels.js";
import { compareSemverStrings } from "./update-check.js";
import {
  cleanupGlobalRenameDirs,
  detectGlobalInstallManagerForRoot,
  globalInstallArgs,
} from "./update-global.js";

export type UpdateStepResult = {
  name: string;
  command: string;
  cwd: string;
  durationMs: number;
  exitCode: number | null;
  stdoutTail?: string | null;
  stderrTail?: string | null;
};

export type UpdateVersionInfo = {
  sha?: string | null;
  version?: string | null;
  tag?: string | null;
};

export type UpdateRunResult = {
  status: "ok" | "error" | "skipped";
  mode: "git" | "pnpm" | "bun" | "npm" | "unknown";
  root?: string;
  reason?: string;
  before?: UpdateVersionInfo;
  after?: UpdateVersionInfo;
  steps: UpdateStepResult[];
  durationMs: number;
  /**
   * Populated when `status: "skipped"` and `reason: "dirty"`. Lists the paths
   * (one per line, as `git status --porcelain` emits them) that caused the
   * skip — surfaced to the operator so they know what's blocking the update
   * instead of having to manually `cd` and run `git status` themselves.
   */
  dirtyPaths?: string[];
};

type CommandRunner = (
  argv: string[],
  options: CommandOptions,
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

export type UpdateStepInfo = {
  name: string;
  command: string;
  index: number;
  total: number;
};

export type UpdateStepCompletion = UpdateStepInfo & {
  durationMs: number;
  exitCode: number | null;
  stderrTail?: string | null;
};

export type UpdateStepProgress = {
  onStepStart?: (step: UpdateStepInfo) => void;
  onStepComplete?: (step: UpdateStepCompletion) => void;
};

type UpdateRunnerOptions = {
  cwd?: string;
  argv1?: string;
  tag?: string;
  channel?: UpdateChannel;
  timeoutMs?: number;
  runCommand?: CommandRunner;
  progress?: UpdateStepProgress;
  /**
   * [#416] Override how the gateway service's launch command is read
   * (LaunchAgent plist / systemd unit). Tests inject this; production uses
   * resolveGatewayService().readCommand.
   */
  readServiceCommand?: () => Promise<{ programArguments: string[] } | null>;
};

const DEFAULT_TIMEOUT_MS = 20 * 60_000;
const MAX_LOG_CHARS = 8000;
const PREFLIGHT_MAX_COMMITS = 10;
const DEFAULT_PACKAGE_NAME = "argentos";
const CORE_PACKAGE_NAMES = new Set([DEFAULT_PACKAGE_NAME, "argent"]);

function normalizeDir(value?: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return path.resolve(trimmed);
}

function resolveNodeModulesBinPackageRoot(argv1: string): string | null {
  const normalized = path.resolve(argv1);
  const parts = normalized.split(path.sep);
  const binIndex = parts.lastIndexOf(".bin");
  if (binIndex <= 0) {
    return null;
  }
  if (parts[binIndex - 1] !== "node_modules") {
    return null;
  }
  const binName = path.basename(normalized);
  const nodeModulesDir = parts.slice(0, binIndex).join(path.sep);
  return path.join(nodeModulesDir, binName);
}

function buildStartDirs(opts: UpdateRunnerOptions): string[] {
  const dirs: string[] = [];
  const cwd = normalizeDir(opts.cwd);
  if (cwd) {
    dirs.push(cwd);
  }
  const argv1 = normalizeDir(opts.argv1);
  if (argv1) {
    dirs.push(path.dirname(argv1));
    const packageRoot = resolveNodeModulesBinPackageRoot(argv1);
    if (packageRoot) {
      dirs.push(packageRoot);
    }
  }
  const proc = normalizeDir(process.cwd());
  if (proc) {
    dirs.push(proc);
  }
  return Array.from(new Set(dirs));
}

async function readPackageVersion(root: string) {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return typeof parsed?.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

async function readPackageName(root: string) {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { name?: string };
    const name = parsed?.name?.trim();
    return name ? name : null;
  } catch {
    return null;
  }
}

async function readBranchName(
  runCommand: CommandRunner,
  root: string,
  timeoutMs: number,
): Promise<string | null> {
  const res = await runCommand(["git", "-C", root, "rev-parse", "--abbrev-ref", "HEAD"], {
    timeoutMs,
  }).catch(() => null);
  if (!res || res.code !== 0) {
    return null;
  }
  const branch = res.stdout.trim();
  return branch || null;
}

async function listGitTags(
  runCommand: CommandRunner,
  root: string,
  timeoutMs: number,
  pattern = "v*",
): Promise<string[]> {
  const res = await runCommand(["git", "-C", root, "tag", "--list", pattern, "--sort=-v:refname"], {
    timeoutMs,
  }).catch(() => null);
  if (!res || res.code !== 0) {
    return [];
  }
  return res.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function resolveChannelTag(
  runCommand: CommandRunner,
  root: string,
  timeoutMs: number,
  channel: Exclude<UpdateChannel, "dev">,
): Promise<string | null> {
  const tags = await listGitTags(runCommand, root, timeoutMs);
  if (channel === "beta") {
    const betaTag = tags.find((tag) => isBetaTag(tag)) ?? null;
    const stableTag = tags.find((tag) => isStableTag(tag)) ?? null;
    if (!betaTag) {
      return stableTag;
    }
    if (!stableTag) {
      return betaTag;
    }
    const cmp = compareSemverStrings(betaTag, stableTag);
    if (cmp != null && cmp < 0) {
      return stableTag;
    }
    return betaTag;
  }
  return tags.find((tag) => isStableTag(tag)) ?? null;
}

async function resolveGitRoot(
  runCommand: CommandRunner,
  candidates: string[],
  timeoutMs: number,
): Promise<string | null> {
  for (const dir of candidates) {
    const res = await runCommand(["git", "-C", dir, "rev-parse", "--show-toplevel"], {
      timeoutMs,
    });
    if (res.code === 0) {
      const root = res.stdout.trim();
      if (root) {
        return root;
      }
    }
  }
  return null;
}

async function findPackageRoot(candidates: string[]) {
  for (const dir of candidates) {
    let current = dir;
    for (let i = 0; i < 12; i += 1) {
      const pkgPath = path.join(current, "package.json");
      try {
        const raw = await fs.readFile(pkgPath, "utf-8");
        const parsed = JSON.parse(raw) as { name?: string };
        const name = parsed?.name?.trim();
        if (name && CORE_PACKAGE_NAMES.has(name)) {
          return current;
        }
      } catch {
        // ignore
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  return null;
}

async function pathExists(value: string) {
  try {
    await fs.stat(value);
    return true;
  } catch {
    return false;
  }
}

async function resolveRuntimeSnapshotPackageRoot(opts: UpdateRunnerOptions) {
  const override = normalizeDir(process.env.ARGENT_INSTALL_PACKAGE_DIR);
  if (override && (await pathExists(path.join(override, "package.json")))) {
    return override;
  }

  const argv1 = normalizeDir(opts.argv1);
  if (!argv1) {
    return null;
  }

  const packageRoot = resolveNodeModulesBinPackageRoot(argv1);
  if (packageRoot && (await pathExists(path.join(packageRoot, "package.json")))) {
    return packageRoot;
  }

  return findPackageRoot([path.dirname(argv1)]);
}

async function copyDirectoryWithoutGit(sourceRoot: string, targetRoot: string) {
  const source = path.resolve(sourceRoot);
  await fs.cp(source, targetRoot, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const rel = path.relative(source, src);
      if (!rel) {
        return true;
      }
      return rel.split(path.sep)[0] !== ".git";
    },
  });
}

async function syncRuntimeSnapshot(sourceRoot: string, snapshotRoot: string) {
  const source = path.resolve(sourceRoot);
  const target = path.resolve(snapshotRoot);
  if (source === target) {
    return;
  }

  const parent = path.dirname(target);
  const tmp = path.join(parent, `${path.basename(target)}.new.${process.pid}.${Date.now()}`);
  const backup = path.join(parent, `${path.basename(target)}.old.${process.pid}.${Date.now()}`);
  await fs.mkdir(parent, { recursive: true });
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.rm(backup, { recursive: true, force: true });

  try {
    await fs.mkdir(tmp, { recursive: true });
    await copyDirectoryWithoutGit(source, tmp);
    if (await pathExists(target)) {
      await fs.rename(target, backup);
    }
    await fs.rename(tmp, target);
    await fs.rm(backup, { recursive: true, force: true });
    // node:fs.cp resolves relative symlinks to *absolute* paths anchored at
    // `source`, so the freshly copied node_modules tree is full of pnpm
    // symlinks pointing back at the source checkout. Sweep them now so the
    // canonical install is self-contained (closes #168).
    await sweepLegacyInstallSymlinks(target, { sourceRoot: source }).catch(() => {
      // Sweep failures must not abort the update — the install is no worse
      // off than the legacy behavior, and `argent doctor` will flag any
      // remaining escaped links on the next run.
    });
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    if ((await pathExists(backup)) && !(await pathExists(target))) {
      await fs.rename(backup, target).catch(() => {});
    }
    throw err;
  }
}

async function detectPackageManager(root: string) {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { packageManager?: string };
    const pm = parsed?.packageManager?.split("@")[0]?.trim();
    if (pm === "pnpm" || pm === "bun" || pm === "npm") {
      return pm;
    }
  } catch {
    // ignore
  }

  const files = await fs.readdir(root).catch((): string[] => []);
  if (files.includes("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (files.includes("bun.lockb")) {
    return "bun";
  }
  if (files.includes("package-lock.json")) {
    return "npm";
  }
  return "npm";
}

type RunStepOptions = {
  runCommand: CommandRunner;
  name: string;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  progress?: UpdateStepProgress;
  stepIndex: number;
  totalSteps: number;
};

async function runStep(opts: RunStepOptions): Promise<UpdateStepResult> {
  const { runCommand, name, argv, cwd, timeoutMs, env, progress, stepIndex, totalSteps } = opts;
  const command = argv.join(" ");

  const stepInfo: UpdateStepInfo = {
    name,
    command,
    index: stepIndex,
    total: totalSteps,
  };

  progress?.onStepStart?.(stepInfo);

  const started = Date.now();
  const result = await runCommand(argv, { cwd, timeoutMs, env });
  const durationMs = Date.now() - started;

  const stderrTail = trimLogTail(result.stderr, MAX_LOG_CHARS);

  progress?.onStepComplete?.({
    ...stepInfo,
    durationMs,
    exitCode: result.code,
    stderrTail,
  });

  return {
    name,
    command,
    cwd,
    durationMs,
    exitCode: result.code,
    stdoutTail: trimLogTail(result.stdout, MAX_LOG_CHARS),
    stderrTail: trimLogTail(result.stderr, MAX_LOG_CHARS),
  };
}

async function runRuntimeSnapshotStep(params: {
  sourceRoot: string;
  snapshotRoot: string;
  progress?: UpdateStepProgress;
  stepIndex: number;
  totalSteps: number;
}): Promise<UpdateStepResult> {
  const { sourceRoot, snapshotRoot, progress, stepIndex, totalSteps } = params;
  const stepInfo: UpdateStepInfo = {
    name: "runtime snapshot sync",
    command: `sync ${sourceRoot} -> ${snapshotRoot}`,
    index: stepIndex,
    total: totalSteps,
  };
  progress?.onStepStart?.(stepInfo);

  const started = Date.now();
  try {
    await syncRuntimeSnapshot(sourceRoot, snapshotRoot);
    const durationMs = Date.now() - started;
    progress?.onStepComplete?.({ ...stepInfo, durationMs, exitCode: 0 });
    return {
      name: stepInfo.name,
      command: stepInfo.command,
      cwd: sourceRoot,
      durationMs,
      exitCode: 0,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const stderrTail = trimLogTail(err instanceof Error ? err.message : String(err), MAX_LOG_CHARS);
    progress?.onStepComplete?.({ ...stepInfo, durationMs, exitCode: 1, stderrTail });
    return {
      name: stepInfo.name,
      command: stepInfo.command,
      cwd: sourceRoot,
      durationMs,
      exitCode: 1,
      stderrTail,
    };
  }
}

function managerScriptArgs(manager: "pnpm" | "bun" | "npm", script: string, args: string[] = []) {
  if (manager === "pnpm") {
    return ["pnpm", script, ...args];
  }
  if (manager === "bun") {
    return ["bun", "run", script, ...args];
  }
  if (args.length > 0) {
    return ["npm", "run", script, "--", ...args];
  }
  return ["npm", "run", script];
}

function managerInstallArgs(manager: "pnpm" | "bun" | "npm", frozen = false) {
  if (manager === "pnpm") {
    return frozen
      ? ["pnpm", "install", "--ignore-workspace", "--frozen-lockfile"]
      : ["pnpm", "install", "--ignore-workspace"];
  }
  if (manager === "bun") {
    return frozen ? ["bun", "install", "--frozen-lockfile"] : ["bun", "install"];
  }
  return frozen ? ["npm", "ci"] : ["npm", "install"];
}

function managerRelinkArgs(manager: "pnpm" | "bun" | "npm") {
  if (manager === "pnpm") {
    return ["pnpm", "install", "--force", "--frozen-lockfile"];
  }
  return null;
}

/**
 * [EMPIRICAL 2026-05-24, issue #386] After `deps install`, recompile (or
 * re-fetch the correct prebuilt for) all native modules so their ABI matches
 * the active Node.js version. pnpm's content-addressable store hashes by
 * package version, NOT by Node ABI — so a binary cached under a different
 * Node version (e.g. someone ran an install with `nvm use 24` active)
 * persists and breaks the next gateway boot.
 *
 * `pnpm rebuild` (no args) rebuilds every package with an install script,
 * which is what we want — covers better-sqlite3, koffi, and any future
 * native modules without us having to enumerate them.
 */
function managerRebuildArgs(manager: "pnpm" | "bun" | "npm") {
  if (manager === "pnpm") {
    return ["pnpm", "rebuild"];
  }
  if (manager === "bun") {
    return null; // bun handles native rebuild during `bun install`; no equivalent.
  }
  return ["npm", "rebuild"];
}

/**
 * [#416] Native-module install scripts (prebuild-install) fetch binaries keyed
 * to the ABI of the Node RUNNING the package manager — not the Node the
 * gateway service loads them with. When the shell, Homebrew, and the gateway
 * plist carry different Node majors, `argent update` lands a better-sqlite3
 * binary the gateway physically cannot load (aos-lcm NODE_MODULE_VERSION
 * mismatch on next boot). Resolve the gateway service's pinned Node
 * (LaunchAgent plist / systemd unit argv[0]) so install/rebuild subprocesses
 * run under it and post-update verification loads the module with the
 * runtime that matters. Falls back to the updater's own runtime.
 */
async function resolveGatewayNodeRuntime(
  readServiceCommand?: UpdateRunnerOptions["readServiceCommand"],
): Promise<{ nodePath: string; binDir: string; source: "service" | "process" }> {
  const read =
    readServiceCommand ??
    (async () => {
      const { resolveGatewayService } = await import("../daemon/service.js");
      return resolveGatewayService().readCommand(process.env as Record<string, string | undefined>);
    });
  try {
    const command = await read();
    const argv0 = command?.programArguments?.[0]?.trim();
    if (argv0 && /(^|[\\/])node(\.exe)?$/i.test(argv0)) {
      const stat = await fs.stat(argv0).catch(() => null);
      if (stat?.isFile()) {
        return { nodePath: argv0, binDir: path.dirname(argv0), source: "service" };
      }
    }
  } catch {
    // Service definition unreadable — fall through to the current runtime.
  }
  return {
    nodePath: process.execPath,
    binDir: path.dirname(process.execPath),
    source: "process",
  };
}

/** PATH override that resolves `node`/`npm`/`npx` to the gateway's runtime first. */
function nodeFirstPathEnv(binDir: string): NodeJS.ProcessEnv {
  return { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };
}

/** The native module every install ships and the gateway must be able to load. */
const NATIVE_ABI_PROBE_MODULE = "better-sqlite3";

function nativeAbiVerifyArgv(nodePath: string): string[] {
  return [
    nodePath,
    "-e",
    `require(${JSON.stringify(NATIVE_ABI_PROBE_MODULE)}); process.stdout.write("native-abi-ok")`,
  ];
}

function managerForcedRebuildArgs(manager: "pnpm" | "bun" | "npm"): string[] | null {
  if (manager === "bun") {
    return null; // bun has no targeted rebuild; verification still reports the mismatch.
  }
  if (manager === "pnpm") {
    return ["pnpm", "rebuild", NATIVE_ABI_PROBE_MODULE];
  }
  return ["npm", "rebuild", NATIVE_ABI_PROBE_MODULE, "--build-from-source"];
}

/**
 * [#416 acceptance] Post-update failsafe: load the native probe module under
 * the gateway's Node. On ABI mismatch, force a from-source rebuild with the
 * gateway's Node first on PATH (prebuild-install is skipped via
 * npm_config_build_from_source) and verify again. Steps carry explicit names
 * so the CLI shows exactly which stage failed.
 */
async function verifyNativeAbiSteps(params: {
  makeStep: (name: string, argv: string[], env?: NodeJS.ProcessEnv) => RunStepOptions;
  manager: "pnpm" | "bun" | "npm";
  runtime: { nodePath: string; binDir: string; source: string };
}): Promise<UpdateStepResult[]> {
  const out: UpdateStepResult[] = [];
  const verifyArgv = nativeAbiVerifyArgv(params.runtime.nodePath);
  const verify = await runStep(params.makeStep("verify native ABI (gateway node)", verifyArgv));
  out.push(verify);
  if (verify.exitCode === 0) {
    return out;
  }
  const rebuildArgv = managerForcedRebuildArgs(params.manager);
  if (!rebuildArgv) {
    return out;
  }
  const heal = await runStep(
    params.makeStep("rebuild native modules from source (gateway node)", rebuildArgv, {
      ...nodeFirstPathEnv(params.runtime.binDir),
      npm_config_build_from_source: "true",
    }),
  );
  out.push(heal);
  // "<name> retry" so isRecoveredStepFailure forgives the original verify
  // when this one passes (existing recovered-failure convention).
  const reverify = await runStep(
    params.makeStep("verify native ABI (gateway node) retry", verifyArgv),
  );
  out.push(reverify);
  return out;
}

function shouldRepairPnpmInstall(manager: "pnpm" | "bun" | "npm", failedStep: UpdateStepResult) {
  if (manager !== "pnpm" || failedStep.exitCode === 0) {
    return false;
  }
  const output = `${failedStep.stderrTail ?? ""}\n${failedStep.stdoutTail ?? ""}`;
  return output.includes("MODULE_NOT_FOUND") || output.includes("Cannot find module");
}

async function runStepWithPnpmRelinkRetry(params: {
  name: string;
  argv: string[];
  cwd: string;
  manager: "pnpm" | "bun" | "npm";
  steps: UpdateStepResult[];
  runCommand: CommandRunner;
  timeoutMs: number;
  progress?: UpdateStepProgress;
  stepIndex: number;
  totalSteps: number;
  env?: NodeJS.ProcessEnv;
}) {
  let result = await runStep({
    runCommand: params.runCommand,
    name: params.name,
    argv: params.argv,
    cwd: params.cwd,
    timeoutMs: params.timeoutMs,
    env: params.env,
    progress: params.progress,
    stepIndex: params.stepIndex,
    totalSteps: params.totalSteps,
  });
  params.steps.push(result);

  if (!shouldRepairPnpmInstall(params.manager, result)) {
    return result;
  }

  const relinkArgs = managerRelinkArgs(params.manager);
  if (!relinkArgs) {
    return result;
  }

  const relinkStep = await runStep({
    runCommand: params.runCommand,
    name: "deps relink",
    argv: relinkArgs,
    cwd: params.cwd,
    timeoutMs: params.timeoutMs,
    progress: params.progress,
    stepIndex: params.stepIndex,
    totalSteps: params.totalSteps,
  });
  params.steps.push(relinkStep);

  if (relinkStep.exitCode !== 0) {
    return result;
  }

  result = await runStep({
    runCommand: params.runCommand,
    name: `${params.name} retry`,
    argv: params.argv,
    cwd: params.cwd,
    timeoutMs: params.timeoutMs,
    env: params.env,
    progress: params.progress,
    stepIndex: params.stepIndex,
    totalSteps: params.totalSteps,
  });
  params.steps.push(result);
  return result;
}

function isRecoveredStepFailure(step: UpdateStepResult, allSteps: UpdateStepResult[]) {
  if (step.exitCode === 0) {
    return false;
  }
  return allSteps.some(
    (candidate) => candidate.name === `${step.name} retry` && candidate.exitCode === 0,
  );
}

function dashboardViteBuildArgs(manager: "pnpm" | "bun" | "npm") {
  if (manager === "pnpm") {
    return ["pnpm", "exec", "vite", "build"];
  }
  if (manager === "bun") {
    return ["bunx", "vite", "build"];
  }
  return ["npx", "--yes", "vite", "build"];
}

function normalizeTag(tag?: string) {
  const trimmed = tag?.trim();
  if (!trimmed) {
    return "latest";
  }
  if (trimmed.startsWith("argent@")) {
    return trimmed.slice("argent@".length);
  }
  if (trimmed.startsWith(`${DEFAULT_PACKAGE_NAME}@`)) {
    return trimmed.slice(`${DEFAULT_PACKAGE_NAME}@`.length);
  }
  return trimmed;
}

export async function runGatewayUpdate(opts: UpdateRunnerOptions = {}): Promise<UpdateRunResult> {
  const startedAt = Date.now();
  const runCommand =
    opts.runCommand ??
    (async (argv, options) => {
      const res = await runCommandWithTimeout(argv, options);
      return { stdout: res.stdout, stderr: res.stderr, code: res.code };
    });
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const progress = opts.progress;
  const steps: UpdateStepResult[] = [];
  const candidates = buildStartDirs(opts);

  let stepIndex = 0;
  let gitTotalSteps = 0;

  const step = (
    name: string,
    argv: string[],
    cwd: string,
    env?: NodeJS.ProcessEnv,
  ): RunStepOptions => {
    const currentIndex = stepIndex;
    stepIndex += 1;
    return {
      runCommand,
      name,
      argv,
      cwd,
      timeoutMs,
      env,
      progress,
      stepIndex: currentIndex,
      totalSteps: gitTotalSteps,
    };
  };

  const pkgRoot = await findPackageRoot(candidates);

  // [#416] All native install/rebuild work runs under the gateway's pinned
  // Node so prebuild-install fetches the ABI the gateway can actually load.
  const gatewayRuntime = await resolveGatewayNodeRuntime(opts.readServiceCommand);
  const gatewayPathEnv = nodeFirstPathEnv(gatewayRuntime.binDir);

  let gitRoot = await resolveGitRoot(runCommand, candidates, timeoutMs);
  if (gitRoot && pkgRoot && path.resolve(gitRoot) !== path.resolve(pkgRoot)) {
    gitRoot = null;
  }

  if (gitRoot && !pkgRoot) {
    // Running from within an unrelated git checkout should not hard-fail updates.
    // Fall through to package/global install detection instead.
    gitRoot = null;
  }

  if (gitRoot && pkgRoot && path.resolve(gitRoot) === path.resolve(pkgRoot)) {
    // Get current SHA (not a visible step, no progress)
    const beforeShaResult = await runCommand(["git", "-C", gitRoot, "rev-parse", "HEAD"], {
      cwd: gitRoot,
      timeoutMs,
    });
    const beforeSha = beforeShaResult.stdout.trim() || null;
    const beforeVersion = await readPackageVersion(gitRoot);
    const channel: UpdateChannel = opts.channel ?? "dev";
    const branch = channel === "dev" ? await readBranchName(runCommand, gitRoot, timeoutMs) : null;
    const needsCheckoutMain = channel === "dev" && branch !== DEV_BRANCH;
    const runtimeSnapshotRoot = await resolveRuntimeSnapshotPackageRoot(opts);
    const shouldSyncRuntimeSnapshot =
      runtimeSnapshotRoot != null && path.resolve(runtimeSnapshotRoot) !== path.resolve(gitRoot);
    gitTotalSteps =
      (channel === "dev" ? (needsCheckoutMain ? 13 : 12) : 11) +
      (shouldSyncRuntimeSnapshot ? 1 : 0);

    // #413: dirty-check pathspec excludes regenerated-but-tracked artifacts.
    // These files are committed to the repo (so fresh installs have them as
    // fallbacks) BUT are rewritten by the build step during a normal install,
    // so any install that ever successfully built is otherwise permanently
    // "dirty" and refuses to update. The `:!dist/control-ui/` exclusion was
    // the original precedent; this list extends it to the other known
    // regenerated tracked paths.
    const statusCheck = await runStep(
      step(
        "git status",
        [
          "git",
          "-C",
          gitRoot,
          "status",
          "--porcelain",
          "--",
          ":!dist/control-ui/",
          ":!dashboard/provider-catalog/index.cjs",
          ":!dashboard/src/lib/_generated/",
        ],
        gitRoot,
      ),
    );
    steps.push(statusCheck);
    const statusOut = statusCheck.stdoutTail?.trim() ?? "";
    const hasUncommittedChanges = statusOut.length > 0;
    if (hasUncommittedChanges) {
      // Surface the offending paths so the CLI can render them under the
      // skipped-reason message instead of the operator having to manually
      // cd into the install root and run `git status`.
      const dirtyPaths = statusOut
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return {
        status: "skipped",
        mode: "git",
        root: gitRoot,
        reason: "dirty",
        before: { sha: beforeSha, version: beforeVersion },
        steps,
        dirtyPaths,
        durationMs: Date.now() - startedAt,
      };
    }

    // Track resolved release tag for stable/beta channels (used in final result)
    let resolvedTag: string | null = null;
    // Resolve the tag the current HEAD points to (if any)
    let beforeTag: string | null = null;
    if (channel !== "dev" && beforeSha) {
      const describeResult = await runCommand(
        ["git", "-C", gitRoot, "describe", "--tags", "--exact-match", "HEAD"],
        { cwd: gitRoot, timeoutMs },
      );
      if (describeResult.code === 0 && describeResult.stdout.trim()) {
        beforeTag = describeResult.stdout.trim();
      }
    }

    if (channel === "dev") {
      if (needsCheckoutMain) {
        const checkoutStep = await runStep(
          step(
            `git checkout ${DEV_BRANCH}`,
            ["git", "-C", gitRoot, "checkout", DEV_BRANCH],
            gitRoot,
          ),
        );
        steps.push(checkoutStep);
        if (checkoutStep.exitCode !== 0) {
          return {
            status: "error",
            mode: "git",
            root: gitRoot,
            reason: "checkout-failed",
            before: { sha: beforeSha, version: beforeVersion },
            steps,
            durationMs: Date.now() - startedAt,
          };
        }
      }

      const upstreamStep = await runStep(
        step(
          "upstream check",
          [
            "git",
            "-C",
            gitRoot,
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
          ],
          gitRoot,
        ),
      );
      steps.push(upstreamStep);
      if (upstreamStep.exitCode !== 0) {
        return {
          status: "skipped",
          mode: "git",
          root: gitRoot,
          reason: "no-upstream",
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }

      const fetchStep = await runStep(
        step("git fetch", ["git", "-C", gitRoot, "fetch", "--all", "--prune", "--tags"], gitRoot),
      );
      steps.push(fetchStep);

      const upstreamShaStep = await runStep(
        step(
          "git rev-parse @{upstream}",
          ["git", "-C", gitRoot, "rev-parse", "@{upstream}"],
          gitRoot,
        ),
      );
      steps.push(upstreamShaStep);
      const upstreamSha = upstreamShaStep.stdoutTail?.trim();
      if (!upstreamShaStep.stdoutTail || !upstreamSha) {
        return {
          status: "error",
          mode: "git",
          root: gitRoot,
          reason: "no-upstream-sha",
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }

      if (beforeSha && upstreamSha === beforeSha) {
        if (shouldSyncRuntimeSnapshot && runtimeSnapshotRoot) {
          const snapshotStep = await runRuntimeSnapshotStep({
            sourceRoot: gitRoot,
            snapshotRoot: runtimeSnapshotRoot,
            progress,
            stepIndex,
            totalSteps: gitTotalSteps,
          });
          stepIndex += 1;
          steps.push(snapshotStep);
          if (snapshotStep.exitCode !== 0) {
            return {
              status: "error",
              mode: "git",
              root: gitRoot,
              reason: snapshotStep.name,
              before: { sha: beforeSha, version: beforeVersion },
              after: { sha: upstreamSha, version: beforeVersion },
              steps,
              durationMs: Date.now() - startedAt,
            };
          }
        }
        return {
          status: shouldSyncRuntimeSnapshot ? "ok" : "skipped",
          mode: "git",
          root: gitRoot,
          reason: shouldSyncRuntimeSnapshot ? undefined : "up-to-date",
          before: { sha: beforeSha, version: beforeVersion },
          after: { sha: upstreamSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }

      const revListStep = await runStep(
        step(
          "git rev-list",
          ["git", "-C", gitRoot, "rev-list", `--max-count=${PREFLIGHT_MAX_COMMITS}`, upstreamSha],
          gitRoot,
        ),
      );
      steps.push(revListStep);
      if (revListStep.exitCode !== 0) {
        return {
          status: "error",
          mode: "git",
          root: gitRoot,
          reason: "preflight-revlist-failed",
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }

      const candidateShas = (revListStep.stdoutTail ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (candidateShas.length === 0) {
        return {
          status: "error",
          mode: "git",
          root: gitRoot,
          reason: "preflight-no-candidates",
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }

      const manager = await detectPackageManager(gitRoot);
      const preflightRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argent-update-preflight-"));
      const worktreeDir = path.join(preflightRoot, "worktree");
      const worktreeStep = await runStep(
        step(
          "preflight worktree",
          ["git", "-C", gitRoot, "worktree", "add", "--detach", worktreeDir, upstreamSha],
          gitRoot,
        ),
      );
      steps.push(worktreeStep);
      if (worktreeStep.exitCode !== 0) {
        await fs.rm(preflightRoot, { recursive: true, force: true }).catch(() => {});
        return {
          status: "error",
          mode: "git",
          root: gitRoot,
          reason: "preflight-worktree-failed",
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }

      let selectedSha: string | null = null;
      try {
        for (const sha of candidateShas) {
          const shortSha = sha.slice(0, 8);
          const checkoutStep = await runStep(
            step(
              `preflight checkout (${shortSha})`,
              ["git", "-C", worktreeDir, "checkout", "--detach", sha],
              worktreeDir,
            ),
          );
          steps.push(checkoutStep);
          if (checkoutStep.exitCode !== 0) {
            continue;
          }

          const depsStep = await runStep(
            step(`preflight deps install (${shortSha})`, managerInstallArgs(manager), worktreeDir),
          );
          steps.push(depsStep);
          if (depsStep.exitCode !== 0) {
            continue;
          }

          const lintStep = await runStep(
            step(
              `preflight lint advisory (${shortSha})`,
              managerScriptArgs(manager, "lint"),
              worktreeDir,
            ),
          );
          steps.push(lintStep);

          const buildStep = await runStep(
            step(`preflight build (${shortSha})`, managerScriptArgs(manager, "build"), worktreeDir),
          );
          steps.push(buildStep);
          if (buildStep.exitCode !== 0) {
            continue;
          }

          selectedSha = sha;
          break;
        }
      } finally {
        const removeStep = await runStep(
          step(
            "preflight cleanup",
            ["git", "-C", gitRoot, "worktree", "remove", "--force", worktreeDir],
            gitRoot,
          ),
        );
        steps.push(removeStep);
        await runCommand(["git", "-C", gitRoot, "worktree", "prune"], {
          cwd: gitRoot,
          timeoutMs,
        }).catch(() => null);
        await fs.rm(preflightRoot, { recursive: true, force: true }).catch(() => {});
      }

      if (!selectedSha) {
        return {
          status: "error",
          mode: "git",
          root: gitRoot,
          reason: "preflight-no-good-commit",
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }

      const rebaseStep = await runStep(
        step("git rebase", ["git", "-C", gitRoot, "rebase", selectedSha], gitRoot),
      );
      steps.push(rebaseStep);
      if (rebaseStep.exitCode !== 0) {
        const abortResult = await runCommand(["git", "-C", gitRoot, "rebase", "--abort"], {
          cwd: gitRoot,
          timeoutMs,
        });
        steps.push({
          name: "git rebase --abort",
          command: "git rebase --abort",
          cwd: gitRoot,
          durationMs: 0,
          exitCode: abortResult.code,
          stdoutTail: trimLogTail(abortResult.stdout, MAX_LOG_CHARS),
          stderrTail: trimLogTail(abortResult.stderr, MAX_LOG_CHARS),
        });
        return {
          status: "error",
          mode: "git",
          root: gitRoot,
          reason: "rebase-failed",
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }
    } else {
      const fetchStep = await runStep(
        step("git fetch", ["git", "-C", gitRoot, "fetch", "--all", "--prune", "--tags"], gitRoot),
      );
      steps.push(fetchStep);
      if (fetchStep.exitCode !== 0) {
        return {
          status: "error",
          mode: "git",
          root: gitRoot,
          reason: "fetch-failed",
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }

      const tag = await resolveChannelTag(runCommand, gitRoot, timeoutMs, channel);
      resolvedTag = tag;
      if (!tag) {
        return {
          status: "error",
          mode: "git",
          root: gitRoot,
          reason: "no-release-tag",
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }

      // Resolve the tag's SHA so we can check if we're already on it
      const tagShaResult = await runCommand(
        ["git", "-C", gitRoot, "rev-parse", `${tag}^{commit}`],
        { cwd: gitRoot, timeoutMs },
      );
      const tagSha = tagShaResult.stdout.trim() || null;

      if (beforeSha && tagSha && beforeSha === tagSha) {
        return {
          status: "skipped",
          mode: "git",
          root: gitRoot,
          reason: "up-to-date",
          before: { sha: beforeSha, version: beforeVersion, tag },
          after: { sha: tagSha, version: beforeVersion, tag },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }

      const checkoutStep = await runStep(
        step(`git checkout ${tag}`, ["git", "-C", gitRoot, "checkout", "--detach", tag], gitRoot),
      );
      steps.push(checkoutStep);
      if (checkoutStep.exitCode !== 0) {
        return {
          status: "error",
          mode: "git",
          root: gitRoot,
          reason: "checkout-failed",
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }
    }

    const installStepStart = steps.length;
    const manager = await detectPackageManager(gitRoot);

    const depsStep = await runStep(
      // [#416] gateway-node-first PATH so install scripts fetch the right ABI.
      step("deps install", managerInstallArgs(manager, true), gitRoot, gatewayPathEnv),
    );
    steps.push(depsStep);

    // If frozen-lockfile failed and pnpm fell back to a mutable install, or if
    // the lockfile was legitimately regenerated, restore it so the checkout stays clean.
    await runCommand(["git", "-C", gitRoot, "checkout", "--", "pnpm-lock.yaml"], {
      cwd: gitRoot,
      timeoutMs,
    }).catch(() => null);

    // [EMPIRICAL 2026-05-24, issue #386] Rebuild native modules so their ABI
    // matches the active Node version. Without this, a cached better-sqlite3
    // binary compiled under a different Node version persists in the pnpm
    // store and breaks plugin load on next gateway boot (aos-lcm
    // NODE_MODULE_VERSION mismatch). Non-fatal: if rebuild fails for one
    // module, the rest of the update can still proceed; the gateway will
    // surface the specific load error if it actually matters.
    const rebuildArgs = managerRebuildArgs(manager);
    if (rebuildArgs) {
      const rebuildStep = await runStep(
        // [#416] gateway-node-first PATH: prebuild-install keys the download
        // to the Node ABI of the process running it.
        step("rebuild native modules", rebuildArgs, gitRoot, gatewayPathEnv),
      );
      steps.push(rebuildStep);
    }

    // [#416] Failsafe: prove the gateway's Node can load the native module;
    // force a from-source rebuild and re-verify if it can't.
    steps.push(
      ...(await verifyNativeAbiSteps({
        makeStep: (name, argv, env) => step(name, argv, gitRoot, env),
        manager,
        runtime: gatewayRuntime,
      })),
    );

    const buildStep = await runStep(step("build", managerScriptArgs(manager, "build"), gitRoot));
    steps.push(buildStep);

    const uiBuildStep = await runStep(
      step("ui:build", managerScriptArgs(manager, "ui:build"), gitRoot),
    );
    steps.push(uiBuildStep);

    const dashboardRoot = path.join(gitRoot, "dashboard");
    if (await pathExists(path.join(dashboardRoot, "package.json"))) {
      const dashboardBuildStep = await runStep(
        step("dashboard vite build", dashboardViteBuildArgs(manager), dashboardRoot),
      );
      steps.push(dashboardBuildStep);
    }

    const bundledHarnessInstaller = path.join(
      gitRoot,
      "scripts",
      "install-bundled-aos-harnesses.mjs",
    );
    if (await pathExists(bundledHarnessInstaller)) {
      const bundledHarnessStep = await runStep(
        step("bundled AOS harness install", ["node", bundledHarnessInstaller], gitRoot),
      );
      steps.push(bundledHarnessStep);
    }

    // Restore committed Control UI assets when they exist. Some public Core
    // checkouts generate dist/control-ui/ as an ignored artifact instead.
    const controlUiTracked = await runCommand(
      ["git", "-C", gitRoot, "ls-files", "--error-unmatch", "dist/control-ui/"],
      {
        cwd: gitRoot,
        timeoutMs,
      },
    ).catch(() => null);
    if (controlUiTracked?.code === 0) {
      const restoreUiStep = await runStep(
        step(
          "restore control-ui",
          ["git", "-C", gitRoot, "checkout", "--", "dist/control-ui/"],
          gitRoot,
        ),
      );
      steps.push(restoreUiStep);
    }

    if (shouldSyncRuntimeSnapshot && runtimeSnapshotRoot) {
      const snapshotStep = await runRuntimeSnapshotStep({
        sourceRoot: gitRoot,
        snapshotRoot: runtimeSnapshotRoot,
        progress,
        stepIndex,
        totalSteps: gitTotalSteps,
      });
      stepIndex += 1;
      steps.push(snapshotStep);
    }

    await runStepWithPnpmRelinkRetry({
      ...step("workspace setup", managerScriptArgs(manager, "argent", ["setup"]), gitRoot),
      manager,
      steps,
    });

    await runStepWithPnpmRelinkRetry({
      ...step(
        "argent doctor",
        managerScriptArgs(manager, "argent", ["doctor", "--non-interactive", "--repair"]),
        gitRoot,
        { ARGENT_UPDATE_IN_PROGRESS: "1" },
      ),
      manager,
      steps,
    });

    const failedStep = steps
      .slice(installStepStart)
      .find((s) => s.exitCode !== 0 && !isRecoveredStepFailure(s, steps));
    const afterShaStep = await runStep(
      step("git rev-parse HEAD (after)", ["git", "-C", gitRoot, "rev-parse", "HEAD"], gitRoot),
    );
    steps.push(afterShaStep);
    const afterVersion = await readPackageVersion(gitRoot);

    return {
      status: failedStep ? "error" : "ok",
      mode: "git",
      root: gitRoot,
      reason: failedStep ? failedStep.name : undefined,
      before: { sha: beforeSha, version: beforeVersion, tag: beforeTag },
      after: {
        sha: afterShaStep.stdoutTail?.trim() ?? null,
        version: afterVersion,
        tag: resolvedTag,
      },
      steps,
      durationMs: Date.now() - startedAt,
    };
  }

  if (!pkgRoot) {
    return {
      status: "skipped",
      mode: "unknown",
      reason: "not-git-install",
      steps: [],
      durationMs: Date.now() - startedAt,
    };
  }

  const beforeVersion = await readPackageVersion(pkgRoot);
  const globalManager = await detectGlobalInstallManagerForRoot(runCommand, pkgRoot, timeoutMs);
  if (globalManager) {
    const packageName = (await readPackageName(pkgRoot)) ?? DEFAULT_PACKAGE_NAME;
    await cleanupGlobalRenameDirs({
      globalRoot: path.dirname(pkgRoot),
      packageName,
    });
    const channel = opts.channel ?? DEFAULT_PACKAGE_CHANNEL;
    const tag = normalizeTag(opts.tag ?? channelToNpmTag(channel));
    const spec = `${packageName}@${tag}`;
    const globalTotalSteps = 2;
    const updateStep = await runStep({
      runCommand,
      name: "global update",
      argv: globalInstallArgs(globalManager, spec),
      cwd: pkgRoot,
      timeoutMs,
      // [#416] gateway-node-first PATH: the global manager runs every
      // dependency's install script (prebuild-install) under whichever Node
      // it resolves — make that the gateway's pinned Node, not Homebrew's.
      env: gatewayPathEnv,
      progress,
      stepIndex: 0,
      totalSteps: globalTotalSteps,
    });
    const packageSteps = [updateStep];
    // [#416] Failsafe: prove the gateway's Node can load the native module;
    // force a from-source rebuild and re-verify if it can't.
    let globalStepIndex = 1;
    packageSteps.push(
      ...(await verifyNativeAbiSteps({
        makeStep: (name, argv, env) => ({
          runCommand,
          name,
          argv,
          cwd: pkgRoot,
          timeoutMs,
          env,
          progress,
          stepIndex: globalStepIndex++,
          totalSteps: globalTotalSteps,
        }),
        manager: globalManager,
        runtime: gatewayRuntime,
      })),
    );
    const failedStep = packageSteps.find(
      (item) => item.exitCode !== 0 && !isRecoveredStepFailure(item, packageSteps),
    );
    const afterVersion = await readPackageVersion(pkgRoot);
    return {
      status: failedStep ? "error" : "ok",
      mode: globalManager,
      root: pkgRoot,
      reason: failedStep?.name,
      before: { version: beforeVersion },
      after: { version: afterVersion },
      steps: packageSteps,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    status: "skipped",
    mode: "unknown",
    root: pkgRoot,
    reason: "not-git-install",
    before: { version: beforeVersion },
    steps: [],
    durationMs: Date.now() - startedAt,
  };
}
