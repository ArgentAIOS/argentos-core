import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countLegacyInstallSymlinks, sweepLegacyInstallSymlinks } from "./symlink-sweep.js";

describe("symlink-sweep", () => {
  let tmpRoot: string;
  let installRoot: string;
  let sourceRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argent-symlink-sweep-"));
    installRoot = path.join(tmpRoot, "install");
    sourceRoot = path.join(tmpRoot, "legacy-source");
    await fs.mkdir(
      path.join(installRoot, "node_modules", ".pnpm", "zod@1", "node_modules", "zod"),
      {
        recursive: true,
      },
    );
    await fs.writeFile(
      path.join(installRoot, "node_modules", ".pnpm", "zod@1", "node_modules", "zod", "index.js"),
      "module.exports = { tag: 'install' };\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("rewrites a symlink whose absolute target lives in a legacy source root", async () => {
    // Simulate what fs.cp does: the link target was relative in the source
    // (`.pnpm/zod@1/node_modules/zod`) and was absolutized against the source.
    const linkPath = path.join(installRoot, "node_modules", "zod");
    const escapedTarget = path.join(
      sourceRoot,
      "node_modules",
      ".pnpm",
      "zod@1",
      "node_modules",
      "zod",
    );
    await fs.symlink(escapedTarget, linkPath);

    const sweep = await sweepLegacyInstallSymlinks(installRoot, { sourceRoot });

    expect(sweep.rewritten).toBe(1);
    expect(sweep.unresolved).toBe(0);

    const newTarget = await fs.readlink(linkPath);
    expect(path.isAbsolute(newTarget)).toBe(false);
    const resolved = path.resolve(path.dirname(linkPath), newTarget);
    expect(resolved).toBe(
      path.join(installRoot, "node_modules", ".pnpm", "zod@1", "node_modules", "zod"),
    );
    // The symlink should be live — readable through the install root.
    const contents = await fs.readFile(path.join(linkPath, "index.js"), "utf-8");
    expect(contents).toContain("install");
  });

  it("falls back to the /node_modules/ heuristic when sourceRoot is unknown", async () => {
    const linkPath = path.join(installRoot, "node_modules", "zod");
    const escapedTarget = path.join(
      "/Users",
      "ghost",
      "argentos",
      "node_modules",
      ".pnpm",
      "zod@1",
      "node_modules",
      "zod",
    );
    await fs.symlink(escapedTarget, linkPath);

    const sweep = await sweepLegacyInstallSymlinks(installRoot);

    expect(sweep.rewritten).toBe(1);
    const resolved = await fs.realpath(linkPath);
    const installRootResolved = await fs.realpath(installRoot);
    expect(resolved.startsWith(installRootResolved)).toBe(true);
  });

  it("is idempotent — a second sweep on a clean install is a no-op", async () => {
    const linkPath = path.join(installRoot, "node_modules", "zod");
    const escapedTarget = path.join(
      sourceRoot,
      "node_modules",
      ".pnpm",
      "zod@1",
      "node_modules",
      "zod",
    );
    await fs.symlink(escapedTarget, linkPath);

    const first = await sweepLegacyInstallSymlinks(installRoot, { sourceRoot });
    expect(first.rewritten).toBe(1);

    const second = await sweepLegacyInstallSymlinks(installRoot, { sourceRoot });
    expect(second.rewritten).toBe(0);
    expect(second.unresolved).toBe(0);
  });

  it("does not touch symlinks that already point inside the install root", async () => {
    const insidePath = path.join(installRoot, "node_modules", "zod");
    const insideTarget = path.join(
      installRoot,
      "node_modules",
      ".pnpm",
      "zod@1",
      "node_modules",
      "zod",
    );
    await fs.symlink(insideTarget, insidePath);
    const originalRaw = await fs.readlink(insidePath);

    const sweep = await sweepLegacyInstallSymlinks(installRoot, { sourceRoot });
    expect(sweep.rewritten).toBe(0);
    expect(sweep.unresolved).toBe(0);
    expect(await fs.readlink(insidePath)).toBe(originalRaw);
  });

  it("counts but does not rewrite symlinks whose equivalent does not exist", async () => {
    const linkPath = path.join(installRoot, "node_modules", "missing-pkg");
    const escapedTarget = path.join(
      sourceRoot,
      "node_modules",
      ".pnpm",
      "missing-pkg@1",
      "node_modules",
      "missing-pkg",
    );
    await fs.symlink(escapedTarget, linkPath);

    const sweep = await sweepLegacyInstallSymlinks(installRoot, { sourceRoot });
    expect(sweep.rewritten).toBe(0);
    expect(sweep.unresolved).toBe(1);
    expect(sweep.unresolvedSamples[0]).toBe(linkPath);
    // Symlink untouched
    expect(await fs.readlink(linkPath)).toBe(escapedTarget);
  });

  it("is a no-op when the install root does not exist", async () => {
    const sweep = await sweepLegacyInstallSymlinks(path.join(tmpRoot, "nonexistent"), {
      sourceRoot,
    });
    expect(sweep.rewritten).toBe(0);
    expect(sweep.unresolved).toBe(0);
  });

  it("countLegacyInstallSymlinks returns rewrite headcount without modifying the tree", async () => {
    const linkPath = path.join(installRoot, "node_modules", "zod");
    const escapedTarget = path.join(
      sourceRoot,
      "node_modules",
      ".pnpm",
      "zod@1",
      "node_modules",
      "zod",
    );
    await fs.symlink(escapedTarget, linkPath);

    const count = await countLegacyInstallSymlinks(installRoot, { sourceRoot });
    expect(count).toBe(1);

    // Verify dry-run didn't actually rewrite.
    expect(await fs.readlink(linkPath)).toBe(escapedTarget);
  });

  it("respects maxRewrites and reports remaining as un-touched", async () => {
    for (const pkg of ["a", "b", "c"]) {
      await fs.mkdir(
        path.join(installRoot, "node_modules", ".pnpm", `${pkg}@1`, "node_modules", pkg),
        { recursive: true },
      );
      await fs.symlink(
        path.join(sourceRoot, "node_modules", ".pnpm", `${pkg}@1`, "node_modules", pkg),
        path.join(installRoot, "node_modules", pkg),
      );
    }

    const sweep = await sweepLegacyInstallSymlinks(installRoot, {
      sourceRoot,
      maxRewrites: 2,
    });
    expect(sweep.rewritten).toBe(2);
  });
});
