import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runCommandWithTimeout, type CommandOptions, type SpawnResult } from "../process/exec.js";

export const PROTECTED_ALIGNMENT_DOCS = [
  "SOUL.md",
  "IDENTITY.md",
  "AGENTS.md",
  "USER.md",
  "HEARTBEAT.md",
  "CONTEMPLATION.md",
  "TOOLS.md",
  "MEMORY.md",
] as const;

export type ProtectedAlignmentDocName = (typeof PROTECTED_ALIGNMENT_DOCS)[number];

export const ALIGNMENT_MANIFEST_FILENAME = ".argent-alignment-integrity.json";

export type AlignmentIntegrityMode = "warn" | "enforce";

export type AlignmentManifest = {
  version: 1;
  generatedAt: string;
  files: Record<ProtectedAlignmentDocName, { sha256: string | null }>;
};

export type AlignmentManifestIssue =
  | { kind: "missing-manifest"; manifestPath: string }
  | { kind: "invalid-manifest"; manifestPath: string; detail: string }
  | {
      kind: "hash-mismatch";
      name: ProtectedAlignmentDocName;
      expected: string | null;
      actual: string | null;
    };

export type AlignmentIntegrityVerification = {
  manifestPath: string;
  issues: AlignmentManifestIssue[];
  checkedFiles: Array<{ name: ProtectedAlignmentDocName; path: string }>;
};

export type AlignmentStartupCheckResult = {
  ok: boolean;
  mode: AlignmentIntegrityMode;
  manifestPath: string;
  integrityIssues: AlignmentManifestIssue[];
  tamperedFiles: ProtectedAlignmentDocName[];
  gitMutations: ProtectedAlignmentDocName[];
  messages: string[];
};

type CommandRunner = (argv: string[], options: number | CommandOptions) => Promise<SpawnResult>;

function normalizeMode(value: string | undefined): AlignmentIntegrityMode {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "enforce") {
    return "enforce";
  }
  return "warn";
}

export function resolveAlignmentIntegrityMode(
  env: NodeJS.ProcessEnv = process.env,
): AlignmentIntegrityMode {
  return normalizeMode(env.ARGENT_ALIGNMENT_INTEGRITY_MODE);
}

export function isProtectedAlignmentDocName(name: string): name is ProtectedAlignmentDocName {
  return PROTECTED_ALIGNMENT_DOCS.includes(name as ProtectedAlignmentDocName);
}

function manifestPathForWorkspace(workspaceDir: string): string {
  return path.join(workspaceDir, ALIGNMENT_MANIFEST_FILENAME);
}

async function readSha256OrNull(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function computeCurrentHashes(
  workspaceDir: string,
): Promise<Record<ProtectedAlignmentDocName, string | null>> {
  const entries = await Promise.all(
    PROTECTED_ALIGNMENT_DOCS.map(async (name) => {
      const filePath = path.join(workspaceDir, name);
      const hash = await readSha256OrNull(filePath);
      return [name, hash] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<ProtectedAlignmentDocName, string | null>;
}

export async function refreshAlignmentIntegrityManifest(workspaceDir: string): Promise<{
  manifestPath: string;
  manifest: AlignmentManifest;
}> {
  const hashes = await computeCurrentHashes(workspaceDir);
  const files = Object.fromEntries(
    PROTECTED_ALIGNMENT_DOCS.map((name) => [name, { sha256: hashes[name] }]),
  ) as AlignmentManifest["files"];
  const manifest: AlignmentManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files,
  };
  const manifestPath = manifestPathForWorkspace(workspaceDir);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return { manifestPath, manifest };
}

export async function verifyAlignmentIntegrityManifest(
  workspaceDir: string,
): Promise<AlignmentIntegrityVerification> {
  const manifestPath = manifestPathForWorkspace(workspaceDir);
  const checkedFiles = PROTECTED_ALIGNMENT_DOCS.map((name) => ({
    name,
    path: path.join(workspaceDir, name),
  }));

  let rawManifest: string;
  try {
    rawManifest = await fs.readFile(manifestPath, "utf-8");
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") {
      return {
        manifestPath,
        checkedFiles,
        issues: [{ kind: "missing-manifest", manifestPath }],
      };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest) as unknown;
  } catch (err) {
    return {
      manifestPath,
      checkedFiles,
      issues: [
        {
          kind: "invalid-manifest",
          manifestPath,
          detail: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { files?: unknown }).files !== "object"
  ) {
    return {
      manifestPath,
      checkedFiles,
      issues: [
        {
          kind: "invalid-manifest",
          manifestPath,
          detail: "manifest must be a JSON object with a files map",
        },
      ],
    };
  }

  const manifestFiles = (parsed as { files: Record<string, { sha256?: unknown }> }).files;
  const currentHashes = await computeCurrentHashes(workspaceDir);
  const issues: AlignmentManifestIssue[] = [];

  for (const name of PROTECTED_ALIGNMENT_DOCS) {
    const expectedRaw = manifestFiles[name]?.sha256;
    const expected =
      typeof expectedRaw === "string"
        ? expectedRaw
        : expectedRaw == null
          ? null
          : String(expectedRaw);
    const actual = currentHashes[name];
    if (expected !== actual) {
      issues.push({ kind: "hash-mismatch", name, expected, actual });
    }
  }

  return {
    manifestPath,
    checkedFiles,
    issues,
  };
}

function parseGitStatusLine(line: string): { code: string; path: string } | null {
  if (line.length < 4) {
    return null;
  }
  const code = line.slice(0, 2);
  const filePath = line.slice(3).trim();
  if (!filePath) {
    return null;
  }
  return { code, path: filePath };
}

export async function listAlignmentGitMutations(
  workspaceDir: string,
  commandRunner: CommandRunner = runCommandWithTimeout,
): Promise<ProtectedAlignmentDocName[]> {
  const files = [...PROTECTED_ALIGNMENT_DOCS];

  let insideRepo = false;
  try {
    const probe = await commandRunner(["git", "rev-parse", "--is-inside-work-tree"], {
      cwd: workspaceDir,
      timeoutMs: 2_000,
    });
    insideRepo = probe.code === 0 && probe.stdout.trim() === "true";
  } catch {
    insideRepo = false;
  }
  if (!insideRepo) {
    return [];
  }

  let status: SpawnResult;
  try {
    status = await commandRunner(["git", "status", "--porcelain", "--", ...files], {
      cwd: workspaceDir,
      timeoutMs: 4_000,
    });
  } catch {
    return [];
  }
  if (status.code !== 0 || !status.stdout.trim()) {
    return [];
  }

  const mutated = new Set<ProtectedAlignmentDocName>();
  for (const rawLine of status.stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }
    const parsed = parseGitStatusLine(line);
    if (!parsed) {
      continue;
    }
    // "??" (untracked) is expected in fresh workspaces; we only warn on tracked mutations.
    if (parsed.code === "??") {
      continue;
    }
    const candidate = path.basename(parsed.path);
    if (isProtectedAlignmentDocName(candidate)) {
      mutated.add(candidate);
    }
  }
  return [...mutated];
}

export function formatAlignmentIntegrityStatus(result: AlignmentStartupCheckResult): string {
  if (result.ok) {
    return `[alignment-integrity] PASS: ${result.tamperedFiles.length === 0 ? "no manifest mismatches" : "warnings present"}`;
  }

  const tampered = result.tamperedFiles.length > 0 ? result.tamperedFiles.join(", ") : "none";
  return [
    "[alignment-integrity] BLOCKED: protected alignment docs failed integrity checks",
    `mode=${result.mode}`,
    `tampered=${tampered}`,
    `manifest=${result.manifestPath}`,
    "remediation: review and restore expected file contents, then refresh the manifest",
  ].join("\n");
}

export async function runAlignmentIntegrityStartupCheck(params: {
  workspaceDir: string;
  mode: AlignmentIntegrityMode;
  commandRunner?: CommandRunner;
}): Promise<AlignmentStartupCheckResult> {
  const verification = await verifyAlignmentIntegrityManifest(params.workspaceDir);
  const gitMutations = await listAlignmentGitMutations(params.workspaceDir, params.commandRunner);

  const tamperedFiles = verification.issues
    .filter(
      (issue): issue is Extract<AlignmentManifestIssue, { kind: "hash-mismatch" }> =>
        issue.kind === "hash-mismatch",
    )
    .map((issue) => issue.name);

  const messages: string[] = [];
  for (const issue of verification.issues) {
    if (issue.kind === "missing-manifest") {
      messages.push(
        `[alignment-integrity] manifest missing at ${issue.manifestPath}. Generate one before enforcing startup checks.`,
      );
      continue;
    }
    if (issue.kind === "invalid-manifest") {
      messages.push(
        `[alignment-integrity] manifest invalid at ${issue.manifestPath}: ${issue.detail}.`,
      );
      continue;
    }
    messages.push(
      `[alignment-integrity] hash mismatch: ${issue.name} expected=${issue.expected ?? "<missing>"} actual=${issue.actual ?? "<missing>"}`,
    );
  }

  if (gitMutations.length > 0) {
    messages.push(
      `[alignment-integrity] git reports modified protected files: ${gitMutations.join(", ")}. Verify these mutations are intentional.`,
    );
  }

  const hasBlockingIssue = verification.issues.length > 0 && params.mode === "enforce";

  return {
    ok: !hasBlockingIssue,
    mode: params.mode,
    manifestPath: verification.manifestPath,
    integrityIssues: verification.issues,
    tamperedFiles,
    gitMutations,
    messages,
  };
}
