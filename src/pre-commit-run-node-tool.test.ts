// Tests for scripts/pre-commit/run-node-tool.sh — specifically the
// worktree-aware fallback added for GH #176. When a linked worktree has no
// node_modules of its own (the standard state for bump-version worktrees
// created by merge-custody workers), the resolver must find the requested
// binary in the main checkout's node_modules so the pre-commit hook still
// runs `oxfmt`/`oxlint` without manual symlinking.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runNodeTool = join(repoRoot, "scripts", "pre-commit", "run-node-tool.sh");

interface Fixture {
  baseDir: string;
  mainRoot: string;
  worktreeRoot: string;
  mainStubLog: string;
}

async function writeStub(path: string, marker: string, logPath: string) {
  const stub = `#!/usr/bin/env bash
set -euo pipefail
echo "${marker}"
echo "args:$*" >>"${logPath}"
`;
  await writeFile(path, stub, { mode: 0o755 });
}

async function setupGitWorkspace(): Promise<Fixture> {
  const baseDir = await mkdtemp(join(tmpdir(), "run-node-tool-test-"));
  const mainRoot = join(baseDir, "main");
  await mkdir(mainRoot, { recursive: true });

  // Initialize a git repo in `main`. `-b main` is portable across recent git.
  const gitInit = spawnSync("git", ["init", "-b", "main", "--quiet", mainRoot], {
    encoding: "utf8",
  });
  expect(gitInit.status, gitInit.stderr).toBe(0);

  // Configure a committer so `git commit` succeeds in CI environments where
  // user.name/user.email aren't set globally.
  for (const [key, value] of [
    ["user.email", "test@example.invalid"],
    ["user.name", "Test Runner"],
    ["commit.gpgsign", "false"],
  ]) {
    const r = spawnSync("git", ["-C", mainRoot, "config", key, value], {
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
  }

  // Stage the run-node-tool.sh script at the expected location and commit
  // it BEFORE creating the worktree, so the worktree's checkout includes the
  // script. The test always exercises the current on-disk implementation by
  // copying its contents verbatim into the temp repo.
  const scriptsDir = join(mainRoot, "scripts", "pre-commit");
  await mkdir(scriptsDir, { recursive: true });
  const scriptCopy = join(scriptsDir, "run-node-tool.sh");
  await writeFile(scriptCopy, await readScript());
  await chmodExec(scriptCopy);
  await writeFile(join(mainRoot, "README"), "test\n");

  const add = spawnSync("git", ["-C", mainRoot, "add", "-A"], {
    encoding: "utf8",
  });
  expect(add.status, add.stderr).toBe(0);
  const commit = spawnSync("git", ["-C", mainRoot, "commit", "--quiet", "-m", "init"], {
    encoding: "utf8",
  });
  expect(commit.status, commit.stderr).toBe(0);

  // Install a fake binary in the main checkout's node_modules/.bin only —
  // the worktree we create below will deliberately have NO node_modules.
  const mainBinDir = join(mainRoot, "node_modules", ".bin");
  await mkdir(mainBinDir, { recursive: true });
  const mainStubLog = join(baseDir, "main-stub.log");
  await writeFile(mainStubLog, "");
  await writeStub(join(mainBinDir, "fake-oxfmt"), "MAIN_STUB_INVOKED", mainStubLog);

  // Create the linked worktree on a new branch.
  const worktreeRoot = join(baseDir, "worktree-bump");
  const wt = spawnSync(
    "git",
    ["-C", mainRoot, "worktree", "add", "--quiet", "-b", "bump-test", worktreeRoot],
    { encoding: "utf8" },
  );
  expect(wt.status, wt.stderr).toBe(0);

  return { baseDir, mainRoot, worktreeRoot, mainStubLog };
}

async function readScript(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(runNodeTool, "utf8");
}

async function chmodExec(path: string): Promise<void> {
  const { chmod } = await import("node:fs/promises");
  await chmod(path, 0o755);
}

describe("scripts/pre-commit/run-node-tool.sh", () => {
  it("resolves a binary from the main worktree when the linked worktree has no node_modules (closes #176)", async () => {
    const bashCheck = spawnSync("bash", ["--version"], { encoding: "utf8" });
    if (bashCheck.status !== 0) {
      return; // Skip if bash isn't available.
    }

    const fx = await setupGitWorkspace();

    // Sanity: worktree must not have its own node_modules.
    const lsWorktreeBin = spawnSync("test", ["-e", join(fx.worktreeRoot, "node_modules")], {
      encoding: "utf8",
    });
    expect(lsWorktreeBin.status).not.toBe(0);

    // Sanity: main has the stub.
    const lsMainBin = spawnSync(
      "test",
      ["-x", join(fx.mainRoot, "node_modules", ".bin", "fake-oxfmt")],
      { encoding: "utf8" },
    );
    expect(lsMainBin.status).toBe(0);

    // Run the script using the COPY inside the worktree (which inherits the
    // checkout's tree because git worktree copies tracked files). The cwd
    // is the worktree.
    const scriptInWorktree = join(fx.worktreeRoot, "scripts", "pre-commit", "run-node-tool.sh");
    const result = spawnSync("bash", [scriptInWorktree, "fake-oxfmt", "--write", "src", "test"], {
      encoding: "utf8",
      cwd: fx.worktreeRoot,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("MAIN_STUB_INVOKED");

    // The fake stub records the args it received — confirm forwarding works.
    const { readFile } = await import("node:fs/promises");
    const log = await readFile(fx.mainStubLog, "utf8");
    expect(log).toContain("--write src test");
  });

  it("prefers local node_modules over the main worktree's", async () => {
    const bashCheck = spawnSync("bash", ["--version"], { encoding: "utf8" });
    if (bashCheck.status !== 0) {
      return;
    }

    const fx = await setupGitWorkspace();

    // Install a DIFFERENT stub in the linked worktree, then assert it wins.
    const worktreeBinDir = join(fx.worktreeRoot, "node_modules", ".bin");
    await mkdir(worktreeBinDir, { recursive: true });
    const worktreeStubLog = join(fx.baseDir, "worktree-stub.log");
    await writeFile(worktreeStubLog, "");
    await writeStub(join(worktreeBinDir, "fake-oxfmt"), "WORKTREE_STUB_INVOKED", worktreeStubLog);

    const scriptInWorktree = join(fx.worktreeRoot, "scripts", "pre-commit", "run-node-tool.sh");
    const result = spawnSync("bash", [scriptInWorktree, "fake-oxfmt"], {
      encoding: "utf8",
      cwd: fx.worktreeRoot,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("WORKTREE_STUB_INVOKED");
    expect(result.stdout).not.toContain("MAIN_STUB_INVOKED");
  });
});
