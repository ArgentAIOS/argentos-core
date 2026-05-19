import { createRequire } from "node:module";
import process from "node:process";
import type { StorageConfig } from "../data/storage-config.js";
import { resolveStorageConfig, shouldReadFrom, shouldWriteTo } from "../data/storage-config.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";

export type RuntimeKind = "node" | "unknown";

type Semver = {
  major: number;
  minor: number;
  patch: number;
};

const MIN_NODE: Semver = { major: 22, minor: 0, patch: 0 };

export type RuntimeDetails = {
  kind: RuntimeKind;
  version: string | null;
  abi: string | null;
  execPath: string | null;
  pathEnv: string;
};

const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

export function parseSemver(version: string | null): Semver | null {
  if (!version) {
    return null;
  }
  const match = version.match(SEMVER_RE);
  if (!match) {
    return null;
  }
  const [, major, minor, patch] = match;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}

export function isAtLeast(version: Semver | null, minimum: Semver): boolean {
  if (!version) {
    return false;
  }
  if (version.major !== minimum.major) {
    return version.major > minimum.major;
  }
  if (version.minor !== minimum.minor) {
    return version.minor > minimum.minor;
  }
  return version.patch >= minimum.patch;
}

export function detectRuntime(): RuntimeDetails {
  const kind: RuntimeKind = process.versions?.node ? "node" : "unknown";
  const version = process.versions?.node ?? null;

  return {
    kind,
    version,
    abi: process.versions?.modules ?? null,
    execPath: process.execPath ?? null,
    pathEnv: process.env.PATH ?? "(not set)",
  };
}

export function runtimeSatisfies(details: RuntimeDetails): boolean {
  const parsed = parseSemver(details.version);
  if (details.kind === "node") {
    return isAtLeast(parsed, MIN_NODE);
  }
  return false;
}

export function isSupportedNodeVersion(version: string | null): boolean {
  return isAtLeast(parseSemver(version), MIN_NODE);
}

export function assertSupportedRuntime(
  runtime: RuntimeEnv = defaultRuntime,
  details: RuntimeDetails = detectRuntime(),
): void {
  if (runtimeSatisfies(details)) {
    return;
  }

  const versionLabel = details.version ?? "unknown";
  const runtimeLabel =
    details.kind === "unknown" ? "unknown runtime" : `${details.kind} ${versionLabel}`;
  const execLabel = details.execPath ?? "unknown";

  runtime.error(
    [
      "argent requires Node >=22.0.0.",
      `Detected: ${runtimeLabel} (exec: ${execLabel}).`,
      `PATH searched: ${details.pathEnv}`,
      "Install Node: https://nodejs.org/en/download",
      "Upgrade Node and re-run argent.",
    ].join("\n"),
  );
  runtime.exit(1);
}

export type NativeSqliteProbe = () => void;

function defaultNativeSqliteProbe(): void {
  const require = createRequire(import.meta.url);
  const BetterSqlite3 = require("better-sqlite3") as {
    new (filename: string): { prepare: (sql: string) => { get: () => unknown }; close: () => void };
  };
  const db = new BetterSqlite3(":memory:");
  try {
    db.prepare("SELECT 1").get();
  } finally {
    db.close();
  }
}

function formatProbeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isAbiMismatchError(message: string): boolean {
  return (
    message.includes("NODE_MODULE_VERSION") ||
    message.includes("better_sqlite3.node") ||
    message.includes("was compiled against a different Node.js version")
  );
}

/**
 * Ensure better-sqlite3 can load under the current runtime.
 * Exits with actionable remediation when ABI mismatch is detected.
 */
export function assertNativeSqliteRuntime(
  runtime: RuntimeEnv = defaultRuntime,
  details: RuntimeDetails = detectRuntime(),
  probe: NativeSqliteProbe = defaultNativeSqliteProbe,
): void {
  try {
    probe();
  } catch (error) {
    const message = formatProbeError(error);
    const label = details.version ?? "unknown";
    const execLabel = details.execPath ?? "unknown";
    const abiLabel = details.abi ?? "unknown";
    const reason = isAbiMismatchError(message)
      ? "Detected better-sqlite3 ABI mismatch."
      : "Failed to load better-sqlite3 native module.";

    runtime.error(
      [
        `${reason}`,
        `Node: ${label} (abi: ${abiLabel}, exec: ${execLabel})`,
        "Fix:",
        "1) Use the same Node runtime that Argent services use (recommended: nvm Node 22).",
        "2) Rebuild native module: pnpm rebuild better-sqlite3",
        "3) Reinstall daemon with current node: argent daemon install --force --runtime node",
        "4) Restart services: argent cs restart",
        `Native error: ${message}`,
      ].join("\n"),
    );
    runtime.exit(1);
  }
}

/**
 * Determine whether runtime should probe native sqlite bindings.
 * In strict PG-only mode (read/write postgres, no sqlite path), probing is skipped.
 *
 * Overrides:
 *  - ARGENT_FORCE_SQLITE_PROBE=1 => always probe
 *  - ARGENT_SKIP_SQLITE_PROBE=1 => never probe
 */
export function shouldProbeNativeSqlite(
  rawStorageConfig?: Partial<StorageConfig> | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.ARGENT_FORCE_SQLITE_PROBE === "1") return true;
  if (env.ARGENT_SKIP_SQLITE_PROBE === "1") return false;

  const storage = resolveStorageConfig(rawStorageConfig ?? undefined);
  const readsSqlite = shouldReadFrom(storage, "sqlite");
  const writesSqlite = shouldWriteTo(storage, "sqlite");
  return readsSqlite || writesSqlite;
}
