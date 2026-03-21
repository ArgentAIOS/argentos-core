import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = path.join(os.tmpdir(), `argent-plugins-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function withStateDir<T>(stateDir: string, fn: () => Promise<T>) {
  const prev = process.env.ARGENT_STATE_DIR;
  const prevBundled = process.env.ARGENT_BUNDLED_PLUGINS_DIR;
  const prevOrgId = process.env.ARGENT_ORG_ID;
  process.env.ARGENT_STATE_DIR = stateDir;
  process.env.ARGENT_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
  vi.resetModules();
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env.ARGENT_STATE_DIR;
    } else {
      process.env.ARGENT_STATE_DIR = prev;
    }
    if (prevBundled === undefined) {
      delete process.env.ARGENT_BUNDLED_PLUGINS_DIR;
    } else {
      process.env.ARGENT_BUNDLED_PLUGINS_DIR = prevBundled;
    }
    if (prevOrgId === undefined) {
      delete process.env.ARGENT_ORG_ID;
    } else {
      process.env.ARGENT_ORG_ID = prevOrgId;
    }
    vi.resetModules();
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});

describe("discoverArgentPlugins", () => {
  it("discovers global and workspace extensions", async () => {
    const stateDir = makeTempDir();
    const workspaceDir = path.join(stateDir, "workspace");

    const globalExt = path.join(stateDir, "extensions");
    fs.mkdirSync(globalExt, { recursive: true });
    fs.writeFileSync(path.join(globalExt, "alpha.ts"), "export default function () {}", "utf-8");

    const workspaceExt = path.join(workspaceDir, ".argent", "extensions");
    fs.mkdirSync(workspaceExt, { recursive: true });
    fs.writeFileSync(path.join(workspaceExt, "beta.ts"), "export default function () {}", "utf-8");

    const { candidates } = await withStateDir(stateDir, async () => {
      const { discoverArgentPlugins } = await import("./discovery.js");
      return discoverArgentPlugins({ workspaceDir });
    });

    const ids = candidates.map((c) => c.idHint);
    expect(ids).toContain("alpha");
    expect(ids).toContain("beta");
  });

  it("loads package extension packs", async () => {
    const stateDir = makeTempDir();
    const globalExt = path.join(stateDir, "extensions", "pack");
    fs.mkdirSync(path.join(globalExt, "src"), { recursive: true });

    fs.writeFileSync(
      path.join(globalExt, "package.json"),
      JSON.stringify({
        name: "pack",
        argent: { extensions: ["./src/one.ts", "./src/two.ts"] },
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(globalExt, "src", "one.ts"),
      "export default function () {}",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(globalExt, "src", "two.ts"),
      "export default function () {}",
      "utf-8",
    );

    const { candidates } = await withStateDir(stateDir, async () => {
      const { discoverArgentPlugins } = await import("./discovery.js");
      return discoverArgentPlugins({});
    });

    const ids = candidates.map((c) => c.idHint);
    expect(ids).toContain("pack/one");
    expect(ids).toContain("pack/two");
  });

  it("derives unscoped ids for scoped packages", async () => {
    const stateDir = makeTempDir();
    const globalExt = path.join(stateDir, "extensions", "voice-call-pack");
    fs.mkdirSync(path.join(globalExt, "src"), { recursive: true });

    fs.writeFileSync(
      path.join(globalExt, "package.json"),
      JSON.stringify({
        name: "@argent/voice-call",
        argent: { extensions: ["./src/index.ts"] },
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(globalExt, "src", "index.ts"),
      "export default function () {}",
      "utf-8",
    );

    const { candidates } = await withStateDir(stateDir, async () => {
      const { discoverArgentPlugins } = await import("./discovery.js");
      return discoverArgentPlugins({});
    });

    const ids = candidates.map((c) => c.idHint);
    expect(ids).toContain("voice-call");
  });

  it("treats configured directory paths as plugin packages", async () => {
    const stateDir = makeTempDir();
    const packDir = path.join(stateDir, "packs", "demo-plugin-dir");
    fs.mkdirSync(packDir, { recursive: true });

    fs.writeFileSync(
      path.join(packDir, "package.json"),
      JSON.stringify({
        name: "@argent/demo-plugin-dir",
        argent: { extensions: ["./index.js"] },
      }),
      "utf-8",
    );
    fs.writeFileSync(path.join(packDir, "index.js"), "module.exports = {}", "utf-8");

    const { candidates } = await withStateDir(stateDir, async () => {
      const { discoverArgentPlugins } = await import("./discovery.js");
      return discoverArgentPlugins({ extraPaths: [packDir] });
    });

    const ids = candidates.map((c) => c.idHint);
    expect(ids).toContain("demo-plugin-dir");
  });

  it("discovers only the selected org plugin path", async () => {
    const stateDir = makeTempDir();
    const orgA = path.join(stateDir, "orgs", "org-a", "extensions");
    const orgB = path.join(stateDir, "orgs", "org-b", "extensions");
    fs.mkdirSync(orgA, { recursive: true });
    fs.mkdirSync(orgB, { recursive: true });
    fs.writeFileSync(path.join(orgA, "a.ts"), "export default function () {}", "utf-8");
    fs.writeFileSync(path.join(orgB, "b.ts"), "export default function () {}", "utf-8");

    const { candidates } = await withStateDir(stateDir, async () => {
      const { discoverArgentPlugins } = await import("./discovery.js");
      return discoverArgentPlugins({ organizationId: "org-a" });
    });

    const orgCandidates = candidates.filter((candidate) => candidate.origin === "org");
    expect(orgCandidates.map((candidate) => candidate.idHint)).toContain("a");
    expect(orgCandidates.map((candidate) => candidate.idHint)).not.toContain("b");
    expect(orgCandidates.every((candidate) => candidate.orgId === "org-a")).toBe(true);
  });
});
