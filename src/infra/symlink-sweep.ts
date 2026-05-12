import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Sweeps pnpm-style symlinks that escaped a previous install location.
 *
 * Background: when `argent update`'s `syncRuntimeSnapshot` step copies a git
 * checkout into the canonical install root via `fs.cp({ dereference: false })`,
 * Node resolves every relative symlink target to an absolute path relative to
 * the *source* directory before recreating it in the destination. The result is
 * a destination tree whose `node_modules/<pkg>` symlinks all point back at the
 * source's `.pnpm` content store — if the source is later removed, the install
 * snaps. (See issue #168.) This module finds those escaped symlinks and rewrites
 * them to point at the equivalent path inside the canonical install.
 */

export type SymlinkSweepResult = {
  /** Number of legacy symlinks rewritten to point inside `installRoot`. */
  rewritten: number;
  /**
   * Number of legacy symlinks detected but NOT rewritten because no equivalent
   * path was found inside `installRoot`. Callers should surface this as a
   * warning — the install is still missing modules.
   */
  unresolved: number;
  /** First few unresolved symlink paths, for diagnostic display. */
  unresolvedSamples: string[];
};

export type SymlinkSweepOptions = {
  /**
   * Optional explicit source root (e.g. the git checkout that was just copied
   * into `installRoot`). When a symlink target starts with this prefix the
   * sweep swaps the prefix for `installRoot`. When omitted the sweep falls
   * back to a generic `/node_modules/` suffix-matching heuristic so existing
   * affected installs can still self-heal without knowing the original source.
   */
  sourceRoot?: string;
  /** Hard ceiling on rewrites for test/safety. Defaults to no limit. */
  maxRewrites?: number;
  /** Invoked once per successful rewrite. */
  onRewrite?: (info: { from: string; oldTarget: string; newTarget: string }) => void;
  /**
   * When true, scan only — do not modify any symlink. Used by doctor checks.
   * Defaults to false.
   */
  dryRun?: boolean;
};

const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`;

/**
 * Walk every symlink under `installRoot` and rewrite ones whose target escapes
 * the install. Idempotent: a second run over a clean install is a no-op because
 * every rewritten link resolves *inside* `installRoot` and is skipped.
 *
 * Safe to invoke on installs that have no escaped symlinks (no-op).
 * Safe to invoke when `installRoot` does not exist (returns zeroed result).
 */
export async function sweepLegacyInstallSymlinks(
  installRoot: string,
  options: SymlinkSweepOptions = {},
): Promise<SymlinkSweepResult> {
  const root = path.resolve(installRoot);
  const result: SymlinkSweepResult = { rewritten: 0, unresolved: 0, unresolvedSamples: [] };

  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      return result;
    }
  } catch {
    return result;
  }

  const sourceRoot = options.sourceRoot ? path.resolve(options.sourceRoot) : null;
  const dryRun = options.dryRun === true;
  const limit = options.maxRewrites;

  const walkStack: string[] = [root];
  while (walkStack.length > 0) {
    const dir = walkStack.pop();
    if (!dir) {
      break;
    }
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (limit !== undefined && result.rewritten >= limit) {
          continue;
        }
        await considerSymlink({
          linkPath: full,
          installRoot: root,
          sourceRoot,
          dryRun,
          result,
          onRewrite: options.onRewrite,
        });
      } else if (entry.isDirectory()) {
        walkStack.push(full);
      }
    }
  }

  return result;
}

/**
 * Read-only variant: returns the count of symlinks that would be rewritten.
 * Equivalent to `sweepLegacyInstallSymlinks(..., { dryRun: true }).rewritten`
 * — included as a convenience for doctor checks that only need the headcount.
 */
export async function countLegacyInstallSymlinks(
  installRoot: string,
  options: Omit<SymlinkSweepOptions, "dryRun" | "onRewrite"> = {},
): Promise<number> {
  const result = await sweepLegacyInstallSymlinks(installRoot, { ...options, dryRun: true });
  return result.rewritten;
}

type ConsiderParams = {
  linkPath: string;
  installRoot: string;
  sourceRoot: string | null;
  dryRun: boolean;
  result: SymlinkSweepResult;
  onRewrite?: SymlinkSweepOptions["onRewrite"];
};

async function considerSymlink(params: ConsiderParams): Promise<void> {
  const { linkPath, installRoot, sourceRoot, dryRun, result, onRewrite } = params;

  let rawTarget: string;
  try {
    rawTarget = await fs.readlink(linkPath);
  } catch {
    return;
  }

  const linkDir = path.dirname(linkPath);
  const absoluteTarget = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(linkDir, rawTarget);

  // Already pointing inside the install root — nothing to do.
  if (isPathInside(absoluteTarget, installRoot)) {
    return;
  }

  const equivalent = computeEquivalentTarget({
    absoluteTarget,
    installRoot,
    sourceRoot,
  });

  if (!equivalent) {
    recordUnresolved(result, linkPath);
    return;
  }

  // Defense against self-referential rewrites: if the heuristic resolved the
  // equivalent to the symlink itself (e.g. the symlink is `node_modules/zod`
  // and the target's last `/node_modules/zod` segment maps back to itself),
  // skip — we have no safe equivalent to point at.
  if (path.resolve(equivalent) === path.resolve(linkPath)) {
    recordUnresolved(result, linkPath);
    return;
  }

  try {
    await fs.lstat(equivalent);
  } catch {
    recordUnresolved(result, linkPath);
    return;
  }

  const newTarget = path.relative(linkDir, equivalent) || ".";

  if (dryRun) {
    // Count what *would* be rewritten without touching the filesystem.
    result.rewritten += 1;
    return;
  }

  try {
    await fs.unlink(linkPath);
    await fs.symlink(newTarget, linkPath);
  } catch {
    recordUnresolved(result, linkPath);
    return;
  }

  result.rewritten += 1;
  onRewrite?.({ from: linkPath, oldTarget: rawTarget, newTarget });
}

function recordUnresolved(result: SymlinkSweepResult, linkPath: string): void {
  result.unresolved += 1;
  if (result.unresolvedSamples.length < 5) {
    result.unresolvedSamples.push(linkPath);
  }
}

function isPathInside(target: string, root: string): boolean {
  const normalizedTarget = path.resolve(target);
  const normalizedRoot = path.resolve(root);
  if (normalizedTarget === normalizedRoot) {
    return true;
  }
  const rel = path.relative(normalizedRoot, normalizedTarget);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function computeEquivalentTarget(params: {
  absoluteTarget: string;
  installRoot: string;
  sourceRoot: string | null;
}): string | null {
  const { absoluteTarget, installRoot, sourceRoot } = params;

  // Strategy 1: explicit prefix swap when we know the source root.
  if (sourceRoot) {
    const withSep = sourceRoot.endsWith(path.sep) ? sourceRoot : sourceRoot + path.sep;
    if (absoluteTarget === sourceRoot || absoluteTarget.startsWith(withSep)) {
      const rel = path.relative(sourceRoot, absoluteTarget);
      return path.join(installRoot, rel);
    }
  }

  // Strategy 2: take the substring after the FIRST `/node_modules/` segment in
  // the target and re-anchor it under `<installRoot>/node_modules/`. Handles
  // the typical pnpm layout where the symlink is e.g.
  //   /OLD/install/node_modules/.pnpm/zod@4/node_modules/zod
  // and the rewrite target is
  //   <installRoot>/node_modules/.pnpm/zod@4/node_modules/zod
  //
  // We use the FIRST occurrence (not the last) because the last segment ends
  // with the package name itself, and re-anchoring on the last would produce
  // `<installRoot>/node_modules/<pkg>` — which is often the symlink path we
  // are rewriting, creating a self-referential loop.
  const idx = absoluteTarget.indexOf(NODE_MODULES_SEGMENT);
  if (idx >= 0) {
    const suffix = absoluteTarget.slice(idx + NODE_MODULES_SEGMENT.length);
    if (suffix.length > 0) {
      return path.join(installRoot, "node_modules", suffix);
    }
  }

  return null;
}
