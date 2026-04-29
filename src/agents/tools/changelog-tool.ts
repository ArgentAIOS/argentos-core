import { Type } from "@sinclair/typebox";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { resolveArgentPackageRoot } from "../../infra/argent-root.js";
import { VERSION } from "../../version.js";
import { jsonResult, readStringParam } from "./common.js";

const REPO_URL = "https://github.com/ArgentAIOS/argentos-core";
const MAIN_CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;

type ChangelogSection = {
  version: string;
  heading: string;
  body: string;
  lineStart: number;
  lineEnd: number;
};

type RemoteFetchResult =
  | {
      ok: true;
      url: string;
      latest: ChangelogSection | null;
      currentVersion: ChangelogSection | null;
    }
  | {
      ok: false;
      url: string;
      error: string;
    };

type ChangelogToolOptions = {
  packageRoot?: string;
  currentVersion?: string;
  branch?: string | null;
  commit?: string | null;
  fetchText?: (url: string) => Promise<string>;
};

function normalizeVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^v/, "");
  return trimmed || null;
}

function parseSortableVersion(value: string | null | undefined): number[] | null {
  const normalized = normalizeVersion(value);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+)|-(\d+))?/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1] ?? "0", 10);
  const month = Number.parseInt(match[2] ?? "0", 10);
  const day = Number.parseInt(match[3] ?? "0", 10);
  const devRevision = match[4] ? Number.parseInt(match[4], 10) : null;
  const releaseRevision = match[5] ? Number.parseInt(match[5], 10) : null;
  const channelRank = devRevision === null ? 1 : 0;
  const revision = devRevision ?? releaseRevision ?? 0;
  return [year, month, day, channelRank, revision];
}

function compareVersionStrings(a: string | null | undefined, b: string | null | undefined): number {
  const left = parseSortableVersion(a);
  const right = parseSortableVersion(b);
  if (!left && !right) {
    return (a ?? "").localeCompare(b ?? "");
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function parseChangelogSections(markdown: string): ChangelogSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ChangelogSection[] = [];
  let current: { heading: string; version: string; body: string[]; lineStart: number } | null =
    null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      if (current) {
        sections.push({
          version: current.version,
          heading: current.heading,
          body: current.body.join("\n").trim(),
          lineStart: current.lineStart,
          lineEnd: index,
        });
      }
      const heading = match[1]?.trim() ?? "";
      current = {
        heading,
        version: heading.split(/\s+/)[0]?.replace(/^v/, "") ?? heading,
        body: [],
        lineStart: index + 1,
      };
      continue;
    }
    if (current) {
      current.body.push(line);
    }
  }

  if (current) {
    sections.push({
      version: current.version,
      heading: current.heading,
      body: current.body.join("\n").trim(),
      lineStart: current.lineStart,
      lineEnd: lines.length,
    });
  }

  return sections;
}

function sortSectionsNewestFirst(sections: ChangelogSection[]): ChangelogSection[] {
  return sections.toSorted((a, b) => {
    const byVersion = compareVersionStrings(b.version, a.version);
    return byVersion === 0 ? a.lineStart - b.lineStart : byVersion;
  });
}

function clipSection(section: ChangelogSection | null, maxChars: number): ChangelogSection | null {
  if (!section) {
    return null;
  }
  if (section.body.length <= maxChars) {
    return section;
  }
  return {
    ...section,
    body: `${section.body.slice(0, maxChars).trimEnd()}\n\n[truncated]`,
  };
}

function findCurrentSection(sections: ChangelogSection[], version: string | null) {
  if (!version) {
    return null;
  }
  const normalized = normalizeVersion(version);
  return sections.find((section) => normalizeVersion(section.version) === normalized) ?? null;
}

function sectionsAfterVersion(sections: ChangelogSection[], version: string | null, limit: number) {
  if (!version) {
    return [];
  }
  return sortSectionsNewestFirst(sections)
    .filter((section) => compareVersionStrings(section.version, version) > 0)
    .slice(0, limit);
}

function safeGit(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

function githubChangelogUrl(ref: string) {
  return `${REPO_URL}/blob/${encodeURI(ref)}/CHANGELOG.md`;
}

function rawChangelogUrl(ref: string) {
  return `https://raw.githubusercontent.com/ArgentAIOS/argentos-core/refs/heads/${encodeURI(ref)}/CHANGELOG.md`;
}

async function defaultFetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRemoteChangelog(params: {
  ref: string;
  currentVersion: string | null;
  maxChars: number;
  fetchText: (url: string) => Promise<string>;
}): Promise<RemoteFetchResult> {
  const url = rawChangelogUrl(params.ref);
  try {
    const markdown = await params.fetchText(url);
    const sections = sortSectionsNewestFirst(parseChangelogSections(markdown));
    return {
      ok: true,
      url,
      latest: clipSection(sections[0] ?? null, params.maxChars),
      currentVersion: clipSection(
        findCurrentSection(sections, params.currentVersion),
        params.maxChars,
      ),
    };
  } catch (err) {
    return {
      ok: false,
      url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function resolvePackageRoot(options: ChangelogToolOptions) {
  if (options.packageRoot) {
    return options.packageRoot;
  }
  return (
    (await resolveArgentPackageRoot({
      cwd: process.cwd(),
      argv1: process.argv[1],
      moduleUrl: import.meta.url,
    })) ?? process.cwd()
  );
}

export function createChangelogTool(options: ChangelogToolOptions = {}): AnyAgentTool {
  return {
    label: "Changelog",
    name: "changelog",
    description:
      "Read ArgentOS release notes and update awareness. Shows current version, branch, local changelog notes, and GitHub changelog links for main/current branch.",
    parameters: Type.Object({
      action: Type.Optional(
        Type.Union([Type.Literal("summary"), Type.Literal("latest"), Type.Literal("current")]),
      ),
      includeRemote: Type.Optional(
        Type.Boolean({
          description:
            "Fetch live GitHub main/current-branch changelog snippets when possible. Defaults to true.",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 20,
          description:
            "Maximum number of changelog sections to include for available/skipped updates.",
        }),
      ),
      maxChars: Type.Optional(
        Type.Number({
          minimum: 500,
          maximum: 8000,
          description: "Maximum characters to return per changelog section.",
        }),
      ),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action") ?? "summary";
      const includeRemote = params.includeRemote !== false;
      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.max(1, Math.min(20, Math.floor(params.limit)))
          : 5;
      const maxChars =
        typeof params.maxChars === "number" && Number.isFinite(params.maxChars)
          ? Math.max(500, Math.min(8000, Math.floor(params.maxChars)))
          : 2200;

      const root = await resolvePackageRoot(options);
      const changelogPath = path.join(root, "CHANGELOG.md");
      const currentVersion = normalizeVersion(options.currentVersion ?? VERSION);
      const branch =
        options.branch !== undefined
          ? options.branch
          : safeGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const commit =
        options.commit !== undefined
          ? options.commit
          : safeGit(root, ["rev-parse", "--short", "HEAD"]);
      const isDevBuild = Boolean(currentVersion?.includes("-dev")) || branch === "dev";
      const currentBranchUrl = branch ? githubChangelogUrl(branch) : null;

      let localError: string | null = null;
      let sections: ChangelogSection[] = [];
      try {
        sections = parseChangelogSections(await fs.readFile(changelogPath, "utf8"));
      } catch (err) {
        localError = err instanceof Error ? err.message : String(err);
      }

      const sortedSections = sortSectionsNewestFirst(sections);
      const latestLocal = clipSection(sortedSections[0] ?? null, maxChars);
      const currentLocal = clipSection(findCurrentSection(sections, currentVersion), maxChars);
      const availableAfterRuntime = sectionsAfterVersion(sections, currentVersion, limit).map(
        (section) => clipSection(section, maxChars),
      );
      const remote =
        includeRemote && (action === "summary" || action === "latest")
          ? {
              main: await fetchRemoteChangelog({
                ref: "main",
                currentVersion,
                maxChars,
                fetchText: options.fetchText ?? defaultFetchText,
              }),
              currentBranch:
                branch && branch !== "main"
                  ? await fetchRemoteChangelog({
                      ref: branch,
                      currentVersion,
                      maxChars,
                      fetchText: options.fetchText ?? defaultFetchText,
                    })
                  : null,
            }
          : null;

      return jsonResult({
        ok: true,
        action,
        runtime: {
          version: currentVersion,
          branch,
          commit,
          isDevBuild,
          buildLabel: isDevBuild ? "dev" : "release",
        },
        links: {
          githubMainChangelog: MAIN_CHANGELOG_URL,
          githubCurrentBranchChangelog: currentBranchUrl,
        },
        local: {
          path: changelogPath,
          error: localError,
          latest: action === "current" ? null : latestLocal,
          currentVersion: action === "latest" ? null : currentLocal,
          currentVersionFound: Boolean(currentLocal),
          availableAfterRuntime,
          availableAfterRuntimeCount: sectionsAfterVersion(
            sections,
            currentVersion,
            Number.MAX_SAFE_INTEGER,
          ).length,
        },
        remote,
        guidance: [
          `You are on ArgentOS ${currentVersion ?? "unknown version"}${branch ? ` from branch ${branch}` : ""}.`,
          isDevBuild
            ? "This is a dev build/branch; prefer local installed notes for exact runtime behavior and use the current-branch GitHub changelog for live dev history."
            : "This appears to be a release build; use the main GitHub changelog for full historical context.",
          `Full historical changelog: ${MAIN_CHANGELOG_URL}`,
        ],
      });
    },
  };
}

export const __test = {
  parseChangelogSections,
  sortSectionsNewestFirst,
  compareVersionStrings,
  findCurrentSection,
  githubChangelogUrl,
  rawChangelogUrl,
};
