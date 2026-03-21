import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROTECTED_ALIGNMENT_DOCS,
  refreshAlignmentIntegrityManifest,
  runAlignmentIntegrityStartupCheck,
  verifyAlignmentIntegrityManifest,
} from "./alignment-integrity.js";

const cleanupDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-align-integrity-"));
  cleanupDirs.push(dir);
  for (const name of PROTECTED_ALIGNMENT_DOCS) {
    await fs.writeFile(path.join(dir, name), `# ${name}\nseed\n`, "utf-8");
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("alignment-integrity", () => {
  it("clean pass with manifest + unchanged files", async () => {
    const workspace = await createWorkspace();
    await refreshAlignmentIntegrityManifest(workspace);

    const result = await runAlignmentIntegrityStartupCheck({
      workspaceDir: workspace,
      mode: "enforce",
    });

    expect(result.ok).toBe(true);
    expect(result.tamperedFiles).toEqual([]);
    expect(result.integrityIssues).toEqual([]);
  });

  it("tampered file is detected with exact filename", async () => {
    const workspace = await createWorkspace();
    await refreshAlignmentIntegrityManifest(workspace);
    await fs.writeFile(path.join(workspace, "SOUL.md"), "tampered\n", "utf-8");

    const result = await runAlignmentIntegrityStartupCheck({
      workspaceDir: workspace,
      mode: "enforce",
    });

    expect(result.ok).toBe(false);
    expect(result.tamperedFiles).toEqual(["SOUL.md"]);
    expect(result.messages.some((msg) => msg.includes("SOUL.md"))).toBe(true);
  });

  it("missing manifest reports explicit issue", async () => {
    const workspace = await createWorkspace();

    const verification = await verifyAlignmentIntegrityManifest(workspace);

    expect(verification.issues).toHaveLength(1);
    expect(verification.issues[0]?.kind).toBe("missing-manifest");
  });

  it("manifest refresh path clears mismatch after intentional update", async () => {
    const workspace = await createWorkspace();
    await refreshAlignmentIntegrityManifest(workspace);
    await fs.writeFile(path.join(workspace, "IDENTITY.md"), "# IDENTITY.md\nnew\n", "utf-8");

    const before = await runAlignmentIntegrityStartupCheck({
      workspaceDir: workspace,
      mode: "enforce",
    });
    expect(before.ok).toBe(false);
    expect(before.tamperedFiles).toEqual(["IDENTITY.md"]);

    await refreshAlignmentIntegrityManifest(workspace);

    const after = await runAlignmentIntegrityStartupCheck({
      workspaceDir: workspace,
      mode: "enforce",
    });
    expect(after.ok).toBe(true);
    expect(after.tamperedFiles).toEqual([]);
  });

  it("warns on git-reported protected mutations", async () => {
    const workspace = await createWorkspace();
    await refreshAlignmentIntegrityManifest(workspace);

    const result = await runAlignmentIntegrityStartupCheck({
      workspaceDir: workspace,
      mode: "warn",
      commandRunner: async (argv) => {
        if (argv[1] === "rev-parse") {
          return {
            code: 0,
            killed: false,
            signal: null,
            stderr: "",
            stdout: "true\n",
          };
        }
        return {
          code: 0,
          killed: false,
          signal: null,
          stderr: "",
          stdout: " M AGENTS.md\n?? TOOLS.md\n",
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.gitMutations).toEqual(["AGENTS.md"]);
    expect(result.messages.some((msg) => msg.includes("AGENTS.md"))).toBe(true);
  });
});
