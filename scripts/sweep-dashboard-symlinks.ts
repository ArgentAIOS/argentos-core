/**
 * Postinstall hook (closes #264): repairs cross-worktree symlinks in
 * `dashboard/node_modules/` that pnpm sometimes leaves pointing at a sibling
 * worktree.
 *
 * Background — in our pnpm workspace, `dashboard/node_modules/<pkg>` should
 * symlink to `<workspaceRoot>/node_modules/.pnpm/<pkg>@.../node_modules/<pkg>`.
 * When workers spin up sibling worktrees and the originating worktree later
 * gets removed, any `dashboard/node_modules/<pkg>` link that was copied or
 * generated to point at the deleted worktree's pnpm store dangles. The most
 * visible symptom is `dashboard/node_modules/react` resolving to a missing
 * path, which breaks every React test in a fresh worktree (see #264).
 *
 * We reuse the proven sweep utility from #168 / PR #270
 * (`src/infra/symlink-sweep.ts`) to do the actual rewrite. To keep the
 * postinstall cheap on healthy installs we first do a scoped scan of
 * `dashboard/node_modules/` for any cross-worktree symlinks; if there are
 * none the full sweep is skipped entirely. Idempotent: a healthy install
 * exits without touching anything.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sweepLegacyInstallSymlinks } from "../src/infra/symlink-sweep.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const dashboardNodeModules = path.join(workspaceRoot, "dashboard", "node_modules");

function isPathInside(target: string, root: string): boolean {
  const t = path.resolve(target);
  const r = path.resolve(root);
  if (t === r) return true;
  const rel = path.relative(r, t);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Cheap scoped probe — walks only `dashboard/node_modules/` (one level, plus
 * one level into `@scope/` directories so scoped package symlinks like
 * `@types/react` are visible). Returns true on the first symlink whose target
 * resolves outside the current workspace.
 */
async function dashboardHasCrossWorktreeSymlink(): Promise<boolean> {
  const probe = async (dir: string, recurse: boolean): Promise<boolean> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let raw: string;
        try {
          raw = await fs.readlink(full);
        } catch {
          continue;
        }
        const abs = path.isAbsolute(raw) ? raw : path.resolve(dir, raw);
        if (!isPathInside(abs, workspaceRoot)) {
          return true;
        }
      } else if (recurse && entry.isDirectory() && entry.name.startsWith("@")) {
        if (await probe(full, false)) return true;
      }
    }
    return false;
  };
  return probe(dashboardNodeModules, true);
}

async function main(): Promise<void> {
  if (!(await dashboardHasCrossWorktreeSymlink())) {
    return;
  }

  const result = await sweepLegacyInstallSymlinks(workspaceRoot);

  if (result.rewritten > 0) {
    console.log(
      `[sweep-dashboard-symlinks] rewrote ${result.rewritten} cross-worktree symlink(s) ` +
        `inside ${path.relative(workspaceRoot, dashboardNodeModules)} (issue #264)`,
    );
  }
  if (result.unresolved > 0) {
    console.warn(
      `[sweep-dashboard-symlinks] ${result.unresolved} symlink(s) still unresolved after sweep; ` +
        `samples:`,
      result.unresolvedSamples,
    );
  }
}

main().catch((err) => {
  // Never fail the install — a sweep error is no worse than the pre-#264 state.
  console.warn(`[sweep-dashboard-symlinks] sweep failed (non-fatal):`, err);
});
