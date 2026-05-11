/**
 * Validate that every `ai.argent.*.plist` in `~/Library/LaunchAgents/` points
 * at the canonical argent install directory (e.g.
 * `~/.argentos/lib/node_modules/argentos/...`) and not a legacy source tree
 * like `~/argentos/`.
 *
 * Background: a stale plist that still references a decommissioned install
 * silently launches the *wrong* code at every boot. The classic example is the
 * "rogue Telegram poller" reported in issue #172, where a legacy install at
 * `/Users/sem/argentos/` kept running long after the canonical install moved
 * to `/Users/sem/.argentos/lib/node_modules/argentos/`.
 *
 * This validator runs from `argent doctor` and surfaces such drift before it
 * causes confusing duplicate-process bugs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { readLaunchAgentProgramArgumentsFromFile } from "./launchd-plist.js";

/** A plist that has at least one ProgramArguments entry pointing outside the canonical install dir. */
export type LaunchAgentInstallIssue = {
  plistPath: string;
  label: string;
  badArgs: string[];
  suggestedFix: string;
};

/**
 * Resolve the canonical install package directory the same way the runtime
 * does in `src/daemon/program-args.ts` and `src/daemon/service-env.ts`:
 *   1. `$ARGENT_INSTALL_PACKAGE_DIR` if set
 *   2. `$HOME/.argentos/lib/node_modules/argentos`
 */
export function resolveCanonicalInstallPackageDir(
  env: Record<string, string | undefined>,
): string | null {
  const override = env.ARGENT_INSTALL_PACKAGE_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) {
    return null;
  }
  return path.join(home, ".argentos", "lib", "node_modules", "argentos");
}

/**
 * Resolve the npm prefix root that contains the install package. We accept
 * arguments anywhere under this root, not just under `lib/node_modules/argentos`,
 * because argent legitimately ships sibling artifacts (`redis/redis.conf`,
 * `backups/database/run-db-backup.sh`) at the prefix root. Catching those as
 * "drift" would be a false positive.
 *
 * For the default install (`$HOME/.argentos/lib/node_modules/argentos`) the
 * prefix is `$HOME/.argentos`. The "rogue Telegram poller" path
 * `/Users/sem/argentos/...` (no leading dot) is *outside* this scope, so it
 * still gets flagged — which is what we want.
 */
export function resolveCanonicalInstallScope(installPackageDir: string): string {
  // installPackageDir ends with `lib/node_modules/argentos`. Walk three
  // segments up to get the npm prefix. If the path is shorter than that
  // (e.g. a custom $ARGENT_INSTALL_PACKAGE_DIR like `/opt/argentos`), fall
  // back to the install dir itself so we don't accidentally accept the
  // entire filesystem root.
  const parts = installPackageDir.split(path.sep);
  if (parts.length < 4) {
    return path.resolve(installPackageDir);
  }
  return path.resolve(path.dirname(path.dirname(path.dirname(installPackageDir))));
}

/**
 * Path-prefix check that is tolerant of a missing trailing separator.
 * Returns `true` when `child` is `prefix` itself or a descendant of it.
 */
function isUnderDir(child: string, prefix: string): boolean {
  const normalizedChild = path.resolve(child);
  const normalizedPrefix = path.resolve(prefix);
  if (normalizedChild === normalizedPrefix) {
    return true;
  }
  const withSep = normalizedPrefix.endsWith(path.sep)
    ? normalizedPrefix
    : normalizedPrefix + path.sep;
  return normalizedChild.startsWith(withSep);
}

/**
 * Heuristic: does this ProgramArguments entry *look like* an argent install
 * path that we should be validating?
 *
 * We deliberately match anything mentioning `argentos` or `.argent/` so that
 * legacy clones (`/Users/sem/argentos/...`) are caught. We skip plain
 * interpreters (`/opt/homebrew/bin/node`, `/bin/bash`) and non-path flags so
 * the validator stays focused on the actual install location.
 */
function looksLikeArgentInstallArg(arg: string): boolean {
  if (!arg || !arg.startsWith("/")) {
    return false;
  }
  // Match both `.argentos` (canonical install prefix) and `argentos` (source clones,
  // both legacy `~/argentos/` and the package dir under `.argentos/...node_modules/argentos/`).
  return /(^|\/)\.?argentos(\/|$)/.test(arg) || /(^|\/)\.argent(\/|$)/.test(arg);
}

/**
 * Inspect a single plist's ProgramArguments and flag any argent-looking path
 * that doesn't live under the canonical install scope (npm prefix). Either
 * `canonicalInstallScope` or `canonicalInstallPackageDir` must be provided;
 * the package dir is converted to its enclosing scope via
 * `resolveCanonicalInstallScope`.
 */
export function findBadProgramArguments(args: {
  programArguments: string[];
  canonicalInstallScope?: string;
  canonicalInstallPackageDir?: string;
}): string[] {
  const scope =
    args.canonicalInstallScope ??
    (args.canonicalInstallPackageDir
      ? resolveCanonicalInstallScope(args.canonicalInstallPackageDir)
      : undefined);
  if (!scope) {
    return [];
  }
  const bad: string[] = [];
  for (const entry of args.programArguments) {
    if (!looksLikeArgentInstallArg(entry)) {
      continue;
    }
    if (!isUnderDir(entry, scope)) {
      bad.push(entry);
    }
  }
  return bad;
}

function deriveLabelFromPlistPath(plistPath: string): string {
  return path.basename(plistPath).replace(/\.plist$/i, "");
}

function buildSuggestedFix(label: string): string {
  // Bootout + delete + reinstall via `argent doctor --fix` is the documented
  // remediation path. Show the launchctl bootout so the operator can do it
  // by hand even without re-running doctor.
  const guiDomain = "gui/$(id -u)";
  return [
    `launchctl bootout ${guiDomain} ~/Library/LaunchAgents/${label}.plist`,
    `rm ~/Library/LaunchAgents/${label}.plist`,
    "argent doctor --fix   # reinstall the canonical LaunchAgent",
  ].join(" && ");
}

export type ListLaunchAgentPlistsFn = (launchAgentsDir: string) => Promise<string[]>;
export type ReadProgramArgumentsFn = typeof readLaunchAgentProgramArgumentsFromFile;

async function defaultListLaunchAgentPlists(launchAgentsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(launchAgentsDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^ai\.argent\..+\.plist$/i.test(name))
    .map((name) => path.join(launchAgentsDir, name))
    .toSorted();
}

/**
 * Validate every `ai.argent.*.plist` in `~/Library/LaunchAgents/` against the
 * canonical install package directory. Returns one issue per plist (with all
 * offending paths) so a single note can summarize multiple drifts at once.
 */
export async function validateLaunchAgentInstallPaths(opts: {
  env: Record<string, string | undefined>;
  /** Override for tests; defaults to `$HOME/Library/LaunchAgents`. */
  launchAgentsDir?: string;
  /** Override for tests; defaults to reading the directory from disk. */
  listPlists?: ListLaunchAgentPlistsFn;
  /** Override for tests; defaults to parsing the plist XML. */
  readProgramArguments?: ReadProgramArgumentsFn;
  /** Override for tests; defaults to `resolveCanonicalInstallPackageDir(env)`. */
  canonicalInstallPackageDir?: string | null;
}): Promise<LaunchAgentInstallIssue[]> {
  const home = opts.env.HOME?.trim() || opts.env.USERPROFILE?.trim();
  if (!home) {
    return [];
  }
  const canonical = opts.canonicalInstallPackageDir ?? resolveCanonicalInstallPackageDir(opts.env);
  if (!canonical) {
    return [];
  }
  const scope = resolveCanonicalInstallScope(canonical);
  const launchAgentsDir = opts.launchAgentsDir ?? path.join(home, "Library", "LaunchAgents");
  const list = opts.listPlists ?? defaultListLaunchAgentPlists;
  const readArgs = opts.readProgramArguments ?? readLaunchAgentProgramArgumentsFromFile;

  const plists = await list(launchAgentsDir);
  const issues: LaunchAgentInstallIssue[] = [];

  for (const plistPath of plists) {
    const parsed = await readArgs(plistPath);
    if (!parsed || parsed.programArguments.length === 0) {
      // No ProgramArguments == nothing to validate (e.g. a malformed plist).
      // We don't synthesise an issue for that; doctor's other checks cover
      // gateway-specific plist health.
      continue;
    }
    const badArgs = findBadProgramArguments({
      programArguments: parsed.programArguments,
      canonicalInstallScope: scope,
    });
    if (badArgs.length === 0) {
      continue;
    }
    const label = deriveLabelFromPlistPath(plistPath);
    issues.push({
      plistPath,
      label,
      badArgs,
      suggestedFix: buildSuggestedFix(label),
    });
  }

  return issues;
}

/**
 * Format a doctor-friendly multi-line message for a set of issues. Returns
 * `null` if there are no issues (callers can use that to decide whether to
 * emit a note at all).
 */
export function formatLaunchAgentInstallIssues(
  issues: LaunchAgentInstallIssue[],
  opts: { canonicalInstallPackageDir: string; canonicalInstallScope?: string },
): string | null {
  if (issues.length === 0) {
    return null;
  }
  const scope =
    opts.canonicalInstallScope ?? resolveCanonicalInstallScope(opts.canonicalInstallPackageDir);
  const lines: string[] = [
    "- One or more LaunchAgents point at a non-canonical argent install.",
    `- Canonical install package: ${opts.canonicalInstallPackageDir}`,
    `- Accepted install scope:    ${scope}`,
  ];
  for (const issue of issues) {
    lines.push(`- ${issue.label}.plist references:`);
    for (const arg of issue.badArgs) {
      lines.push(`    ${arg}`);
    }
    lines.push(`  Fix: ${issue.suggestedFix}`);
  }
  return lines.join("\n");
}
