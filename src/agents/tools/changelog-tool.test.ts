import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createChangelogTool, __test } from "./changelog-tool.js";

const tempDirs: string[] = [];

function makePackageRoot(changelog: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-changelog-tool-"));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "argent" }), "utf8");
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), changelog, "utf8");
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("changelog tool", () => {
  it("sorts dev changelog sections by version instead of file order", () => {
    const sections = __test.sortSectionsNewestFirst(
      __test.parseChangelogSections(`# Changelog

## 2026.4.29-dev.8

eight

## 2026.4.29-dev.10

ten

## 2026.4.29-dev.9

nine
`),
    );

    expect(sections.map((section) => section.version)).toEqual([
      "2026.4.29-dev.10",
      "2026.4.29-dev.9",
      "2026.4.29-dev.8",
    ]);
    expect(__test.compareVersionStrings("2026.4.29-dev.10", "2026.4.29-dev.9")).toBeGreaterThan(0);
  });

  it("reports current runtime version, branch, links, and skipped available sections", async () => {
    const packageRoot = makePackageRoot(`# Changelog

## 2026.4.29-dev.10

- ten

## 2026.4.29-dev.9

- nine

## 2026.4.29-dev.8

- eight

## 2026.4.29-dev.7

- seven
`);
    const tool = createChangelogTool({
      packageRoot,
      currentVersion: "2026.4.29-dev.7",
      branch: "dev",
      commit: "abc1234",
    });

    const result = await tool.execute("call-1", {
      includeRemote: false,
      limit: 3,
    });
    const details = result.details as {
      runtime: { version: string; branch: string; isDevBuild: boolean };
      links: { githubMainChangelog: string; githubCurrentBranchChangelog: string };
      local: {
        currentVersionFound: boolean;
        latest: { version: string };
        currentVersion: { version: string };
        availableAfterRuntime: Array<{ version: string }>;
        availableAfterRuntimeCount: number;
      };
    };

    expect(details.runtime).toMatchObject({
      version: "2026.4.29-dev.7",
      branch: "dev",
      isDevBuild: true,
    });
    expect(details.links.githubMainChangelog).toBe(
      "https://github.com/ArgentAIOS/argentos-core/blob/main/CHANGELOG.md",
    );
    expect(details.links.githubCurrentBranchChangelog).toBe(
      "https://github.com/ArgentAIOS/argentos-core/blob/dev/CHANGELOG.md",
    );
    expect(details.local.currentVersionFound).toBe(true);
    expect(details.local.latest.version).toBe("2026.4.29-dev.10");
    expect(details.local.currentVersion.version).toBe("2026.4.29-dev.7");
    expect(details.local.availableAfterRuntime.map((section) => section.version)).toEqual([
      "2026.4.29-dev.10",
      "2026.4.29-dev.9",
      "2026.4.29-dev.8",
    ]);
    expect(details.local.availableAfterRuntimeCount).toBe(3);
  });

  it("can fetch live main and current-branch changelogs when requested", async () => {
    const packageRoot = makePackageRoot(`# Changelog

## 2026.4.29-dev.7

- local
`);
    const requestedUrls: string[] = [];
    const tool = createChangelogTool({
      packageRoot,
      currentVersion: "2026.4.29-dev.7",
      branch: "codex/agent-changelog-tool",
      commit: "abc1234",
      fetchText: async (url) => {
        requestedUrls.push(url);
        return `# Changelog

## 2026.4.29-dev.10

- remote
`;
      },
    });

    const result = await tool.execute("call-1", { includeRemote: true });
    const details = result.details as {
      remote: {
        main: { ok: true; latest: { version: string } };
        currentBranch: { ok: true; latest: { version: string } };
      };
    };

    expect(requestedUrls).toEqual([
      "https://raw.githubusercontent.com/ArgentAIOS/argentos-core/refs/heads/main/CHANGELOG.md",
      "https://raw.githubusercontent.com/ArgentAIOS/argentos-core/refs/heads/codex/agent-changelog-tool/CHANGELOG.md",
    ]);
    expect(details.remote.main.latest.version).toBe("2026.4.29-dev.10");
    expect(details.remote.currentBranch.latest.version).toBe("2026.4.29-dev.10");
  });
});
