import fs from "node:fs";
import path from "node:path";
import { countLegacyInstallSymlinks, sweepLegacyInstallSymlinks } from "../infra/symlink-sweep.js";
import { note } from "../terminal/note.js";

export function noteSourceInstallIssues(root: string | null) {
  if (!root) {
    return;
  }

  const workspaceMarker = path.join(root, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspaceMarker)) {
    return;
  }

  const warnings: string[] = [];
  const nodeModules = path.join(root, "node_modules");
  const pnpmStore = path.join(nodeModules, ".pnpm");
  const tsxBin = path.join(nodeModules, ".bin", "tsx");
  const srcEntry = path.join(root, "src", "entry.ts");

  if (fs.existsSync(nodeModules) && !fs.existsSync(pnpmStore)) {
    warnings.push(
      "- node_modules was not installed by pnpm (missing node_modules/.pnpm). Run: pnpm install",
    );
  }

  if (fs.existsSync(path.join(root, "package-lock.json"))) {
    warnings.push(
      "- package-lock.json present in a pnpm workspace. If you ran npm install, remove it and reinstall with pnpm.",
    );
  }

  if (fs.existsSync(srcEntry) && !fs.existsSync(tsxBin)) {
    warnings.push("- tsx binary is missing for source runs. Run: pnpm install");
  }

  if (warnings.length > 0) {
    note(warnings.join("\n"), "Argent install");
  }
}

/**
 * Detect pnpm symlinks under the install whose absolute target escapes the
 * install root (typically pointing at a legacy `/Users/.../argentos/` checkout
 * — see issue #168). When `repair` is true, rewrite them in place; otherwise
 * surface a note so the user knows to run `argent update` or `argent doctor
 * --repair` to self-heal.
 *
 * Safe to call when the install has no escaped symlinks (no-op).
 */
export async function maybeRepairLegacyInstallSymlinks(
  root: string | null,
  options: { repair: boolean } = { repair: false },
): Promise<void> {
  if (!root) {
    return;
  }
  try {
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      return;
    }
  } catch {
    return;
  }

  if (options.repair) {
    const swept = await sweepLegacyInstallSymlinks(root).catch(() => null);
    if (!swept) {
      return;
    }
    if (swept.rewritten === 0 && swept.unresolved === 0) {
      return;
    }
    const lines: string[] = [];
    if (swept.rewritten > 0) {
      lines.push(
        `- Rewrote ${swept.rewritten} symlink${swept.rewritten === 1 ? "" : "s"} that pointed outside the install root to their equivalent inside ${root}.`,
      );
    }
    if (swept.unresolved > 0) {
      lines.push(
        `- ${swept.unresolved} symlink${swept.unresolved === 1 ? "" : "s"} still point outside the install with no equivalent inside it; run \`argent update\` to reinstall dependencies.`,
      );
    }
    note(lines.join("\n"), "Argent repairs");
    return;
  }

  const count = await countLegacyInstallSymlinks(root).catch(() => 0);
  if (count > 0) {
    note(
      [
        `- ${count} pnpm symlink${count === 1 ? "" : "s"} under ${root} point at a directory outside this install (typically a legacy install location).`,
        "- Removing the legacy directory will break this install. Run `argent update` to refresh the install, or `argent doctor --repair` to sweep the symlinks in place.",
      ].join("\n"),
      "Argent install",
    );
  }
}
