#!/usr/bin/env npx tsx
/**
 * Automated GitHub Issue Fixer
 *
 * Scans a repo for issues labeled "auto-fix", spins up a Claude Code CLI
 * session to investigate + fix each one, then opens a PR and closes the issue.
 *
 * Usage:
 *   npx tsx scripts/issue-fixer.ts --repo ArgentAIOS/argentos
 *   npx tsx scripts/issue-fixer.ts --repo ArgentAIOS/argentos --dry-run
 *   npx tsx scripts/issue-fixer.ts --repo ArgentAIOS/argentos --issue 11
 *   npx tsx scripts/issue-fixer.ts --install
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values: opts } = parseArgs({
  options: {
    repo: { type: "string" },
    label: { type: "string", default: "auto-fix" },
    model: { type: "string", default: "sonnet" },
    "max-budget": { type: "string", default: "1.00" },
    "dry-run": { type: "boolean", default: false },
    issue: { type: "string" },
    "max-issues": { type: "string", default: "3" },
    install: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
  strict: true,
});

const VERBOSE = opts.verbose ?? false;
const DRY_RUN = opts["dry-run"] ?? false;
const LABEL = opts.label ?? "auto-fix";
const MODEL = opts.model ?? "sonnet";
const MAX_BUDGET = opts["max-budget"] ?? "1.00";
const MAX_ISSUES = Number(opts["max-issues"] ?? "3");

const STATE_DIR = resolve(homedir(), ".argent");
const LOCK_FILE = resolve(STATE_DIR, "issue-fixer.lock");
const HISTORY_FILE = resolve(STATE_DIR, "issue-fixer-history.json");

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function debug(msg: string) {
  if (VERBOSE) log(`[debug] ${msg}`);
}

// ---------------------------------------------------------------------------
// Lock file — prevent concurrent runs
// ---------------------------------------------------------------------------

function acquireLock(): boolean {
  mkdirSync(STATE_DIR, { recursive: true });
  if (existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      const lockAge = Date.now() - lockData.timestamp;
      // Stale lock: if older than 15 minutes, break it (Claude CLI timeout is 5 min)
      if (lockAge > 15 * 60 * 1000) {
        log(`Breaking stale lock (age: ${Math.round(lockAge / 60000)}m, pid: ${lockData.pid})`);
        unlinkSync(LOCK_FILE);
      } else {
        return false;
      }
    } catch {
      // Corrupt lock file — remove it
      unlinkSync(LOCK_FILE);
    }
  }
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, timestamp: Date.now() }), "utf8");
  return true;
}

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------------------
// History — track processed issues to avoid re-processing
// ---------------------------------------------------------------------------

type HistoryEntry = {
  repo: string;
  issue: number;
  timestamp: string;
  status: "fixed" | "no-fix" | "error";
  prUrl?: string;
  summary?: string;
};

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  // Keep last 200 entries to prevent unbounded growth
  const trimmed = entries.slice(-200);
  writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), "utf8");
}

function recordHistory(entry: HistoryEntry) {
  const history = loadHistory();
  history.push(entry);
  saveHistory(history);
}

function wasRecentlyProcessed(repo: string, issueNum: number): HistoryEntry | undefined {
  const history = loadHistory();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h cooldown
  return history.find(
    (h) => h.repo === repo && h.issue === issueNum && new Date(h.timestamp).getTime() > cutoff,
  );
}

// ---------------------------------------------------------------------------
// Install LaunchAgent
// ---------------------------------------------------------------------------

if (opts.install) {
  installLaunchAgent();
  process.exit(0);
}

function installLaunchAgent() {
  const repo = opts.repo;
  if (!repo) {
    console.error("--repo is required with --install");
    process.exit(1);
  }

  const label = "ai.argent.issue-fixer";
  const plistPath = resolve(homedir(), "Library/LaunchAgents", `${label}.plist`);
  const logDir = resolve(homedir(), ".argent/logs");
  const scriptPath = resolve(dirname(new URL(import.meta.url).pathname), "issue-fixer.ts");
  const nodePath = process.execPath;
  const npxPath = resolve(dirname(nodePath), "npx");
  const tsxPath = "tsx"; // resolved via PATH

  mkdirSync(logDir, { recursive: true });

  // gh uses keyring auth, so we just need PATH to include gh + node + git
  const pathDirs = [
    dirname(nodePath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].join(":");

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>Comment</key>
    <string>Argent Issue Fixer — auto-fix GitHub issues</string>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>ProgramArguments</key>
    <array>
      <string>${npxPath}</string>
      <string>tsx</string>
      <string>${scriptPath}</string>
      <string>--repo</string>
      <string>${repo}</string>
    </array>
    <key>StandardOutPath</key>
    <string>${logDir}/issue-fixer.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/issue-fixer.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key>
      <string>${homedir()}</string>
      <key>PATH</key>
      <string>${pathDirs}</string>
    </dict>
  </dict>
</plist>`;

  writeFileSync(plistPath, plist, "utf8");
  log(`Wrote ${plistPath}`);

  const uid = execFileSync("id", ["-u"], { encoding: "utf8" }).trim();
  try {
    execFileSync("launchctl", ["bootout", `gui/${uid}`, plistPath], { stdio: "ignore" });
  } catch {
    // not loaded yet — fine
  }
  execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
  log(`LaunchAgent loaded: ${label} (every 30 min)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const REPO = opts.repo;
if (!REPO) {
  console.error("--repo <owner/name> is required");
  process.exit(1);
}

type GhIssue = {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
  comments: { body: string; author: { login: string } }[];
};

async function main() {
  log(`issue-fixer starting — repo=${REPO} label=${LABEL} model=${MODEL} dry-run=${DRY_RUN}`);

  // Acquire lock to prevent concurrent runs
  if (!DRY_RUN && !acquireLock()) {
    log("Another instance is running (lock file exists). Exiting.");
    return;
  }

  try {
    await mainInner();
  } finally {
    if (!DRY_RUN) releaseLock();
  }
}

async function mainInner() {
  // Resolve the local clone path for this repo
  const repoDir = resolveRepoDir(REPO!);
  log(`Working directory: ${repoDir}`);

  let issues: GhIssue[];

  if (opts.issue) {
    // Single-issue mode
    const raw = execFileSync(
      "gh",
      ["issue", "view", opts.issue, "--repo", REPO!, "--json", "number,title,body,labels,comments"],
      { encoding: "utf8" },
    );
    issues = [JSON.parse(raw)];
  } else {
    issues = scanIssues(REPO!, LABEL);
  }

  if (!issues.length) {
    log("No eligible issues found.");
    return;
  }

  log(`Found ${issues.length} issue(s)`);

  const batch = issues.slice(0, MAX_ISSUES);
  for (const issue of batch) {
    // Skip if already being processed (label guard)
    if (issue.labels.some((l) => l.name === "fixing")) {
      log(`#${issue.number} — skipping (has "fixing" label)`);
      continue;
    }

    // Skip if recently processed (history guard)
    const recent = wasRecentlyProcessed(REPO!, issue.number);
    if (recent && !opts.issue) {
      log(`#${issue.number} — skipping (processed ${recent.timestamp}, status: ${recent.status})`);
      continue;
    }

    try {
      await processIssue(REPO!, issue, repoDir);
    } catch (err) {
      log(`#${issue.number} — ERROR: ${err}`);
      recordHistory({
        repo: REPO!,
        issue: issue.number,
        timestamp: new Date().toISOString(),
        status: "error",
        summary: String(err).slice(0, 500),
      });
      // Remove "fixing" label on failure so it can be retried
      safeGh(["issue", "edit", String(issue.number), "--repo", REPO!, "--remove-label", "fixing"]);
    }
  }

  log("issue-fixer done");
}

// ---------------------------------------------------------------------------
// Scan for eligible issues
// ---------------------------------------------------------------------------

function scanIssues(repo: string, label: string): GhIssue[] {
  const raw = execFileSync(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--label",
      label,
      "--state",
      "open",
      "--json",
      "number,title,body,labels,comments",
      "--limit",
      "20",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Process a single issue
// ---------------------------------------------------------------------------

async function processIssue(repo: string, issue: GhIssue, repoDir: string) {
  const num = issue.number;
  const branch = `fix/issue-${num}`;
  log(`#${num} — "${issue.title}"`);

  if (DRY_RUN) {
    log(`#${num} — [dry-run] would claim, branch, fix, PR, close`);
    return;
  }

  // 1. Claim: add "fixing" label
  gh(["issue", "edit", String(num), "--repo", repo, "--add-label", "fixing"]);
  log(`#${num} — claimed (added "fixing" label)`);

  // 2. Ensure we're on main and up to date
  git(repoDir, ["checkout", "main"]);
  git(repoDir, ["pull", "--ff-only"]);

  // 3. Create branch
  try {
    git(repoDir, ["branch", "-D", branch]);
  } catch {
    // branch didn't exist — fine
  }
  git(repoDir, ["checkout", "-b", branch]);
  log(`#${num} — on branch ${branch}`);

  // 4. Run Claude Code CLI
  const claudeResult = runClaudeFix(repo, issue, repoDir);
  debug(`#${num} — claude output (${claudeResult.text.length} chars)`);

  // 5. Check for changes
  const diff = gitOutput(repoDir, ["diff", "--stat"]);
  const diffStaged = gitOutput(repoDir, ["diff", "--staged", "--stat"]);
  const hasChanges = diff.trim().length > 0 || diffStaged.trim().length > 0;

  if (!hasChanges) {
    log(`#${num} — no changes produced`);
    postNoFixComment(repo, num, claudeResult.text);
    recordHistory({
      repo,
      issue: num,
      timestamp: new Date().toISOString(),
      status: "no-fix",
      summary: claudeResult.text.slice(0, 500),
    });
    cleanup(repoDir, branch);
    return;
  }

  // 6. Stage all changes, commit
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-m", `fix: auto-fix issue #${num} — ${issue.title}`]);
  log(`#${num} — committed`);

  // 7. Push and open PR
  git(repoDir, ["push", "-u", "origin", branch, "--force-with-lease"]);
  const prUrl = createPR(repo, num, issue.title, branch, claudeResult.text);
  log(`#${num} — PR opened: ${prUrl}`);

  // 8. Comment and close issue
  gh([
    "issue",
    "comment",
    String(num),
    "--repo",
    repo,
    "--body",
    `Automated fix submitted: ${prUrl}\n\nClosing this issue. Re-open if the fix is insufficient.`,
  ]);
  gh(["issue", "close", String(num), "--repo", repo]);
  gh(["issue", "edit", String(num), "--repo", repo, "--remove-label", "fixing"]);
  log(`#${num} — issue closed`);

  recordHistory({
    repo,
    issue: num,
    timestamp: new Date().toISOString(),
    status: "fixed",
    prUrl,
  });

  // 9. Cleanup
  cleanup(repoDir, branch);
}

// ---------------------------------------------------------------------------
// Claude Code CLI invocation
// ---------------------------------------------------------------------------

function runClaudeFix(
  repo: string,
  issue: GhIssue,
  repoDir: string,
): { text: string; sessionId?: string } {
  const commentsText = issue.comments
    .map((c) => `### Comment by @${c.author.login}\n${c.body}`)
    .join("\n\n");

  const prompt = `You are fixing GitHub issue #${issue.number} in the ${repo} repository.

## Issue: ${issue.title}

${issue.body || "(no body)"}

${commentsText ? `## Comments\n\n${commentsText}` : ""}

## Instructions

1. Read the issue carefully — understand the bug or feature request
2. Search the codebase for the root cause
3. Implement a minimal fix — change only what's needed
4. Run the build to verify: pnpm build
5. If you cannot fix it, explain what you found and why

Rules:
- Minimal changes only — fix the issue, nothing else
- Do NOT refactor surrounding code
- Do NOT add comments, docs, or type annotations to unchanged code
- Do NOT create new files unless absolutely necessary
- Verify the build passes before finishing`;

  const appendSystem = `You are an automated GitHub issue fixer. You have full access to the codebase. Make minimal, targeted changes. Always verify the build passes with "pnpm build" before finishing.`;

  const args = [
    "-p",
    "--output-format",
    "json",
    "--dangerously-skip-permissions",
    "--model",
    MODEL,
    "--max-budget-usd",
    MAX_BUDGET,
    "--append-system-prompt",
    appendSystem,
    prompt,
  ];

  debug(`Running: claude ${args.slice(0, 4).join(" ")} ...`);

  try {
    const raw = execFileSync("claude", args, {
      encoding: "utf8",
      cwd: repoDir,
      timeout: 5 * 60 * 1000, // 5 min
      maxBuffer: 10 * 1024 * 1024,
    });

    try {
      const json = JSON.parse(raw);
      return {
        text: json.result ?? json.content ?? raw,
        sessionId: json.session_id,
      };
    } catch {
      return { text: raw };
    }
  } catch (err: any) {
    const output = err.stdout?.toString() ?? err.message ?? String(err);
    return { text: `Claude CLI error:\n${output}` };
  }
}

// ---------------------------------------------------------------------------
// PR / comment helpers
// ---------------------------------------------------------------------------

function createPR(
  repo: string,
  issueNum: number,
  issueTitle: string,
  branch: string,
  claudeSummary: string,
): string {
  // Truncate summary for PR body
  const summary =
    claudeSummary.length > 2000
      ? claudeSummary.slice(0, 2000) + "\n\n_(truncated)_"
      : claudeSummary;

  const body = `## Summary

Automated fix for #${issueNum}: ${issueTitle}

## Claude's Analysis

${summary}

---
_Generated by [issue-fixer](https://github.com/ArgentAIOS/argentos/blob/main/scripts/issue-fixer.ts)_`;

  const result = execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      repo,
      "--title",
      `fix: auto-fix #${issueNum} — ${issueTitle}`,
      "--body",
      body,
      "--head",
      branch,
      "--base",
      "main",
    ],
    { encoding: "utf8" },
  );

  return result.trim();
}

function postNoFixComment(repo: string, issueNum: number, claudeOutput: string) {
  const summary =
    claudeOutput.length > 1500 ? claudeOutput.slice(0, 1500) + "\n\n_(truncated)_" : claudeOutput;

  gh([
    "issue",
    "comment",
    String(issueNum),
    "--repo",
    repo,
    "--body",
    `## Auto-fix attempted — no changes produced

The automated fixer investigated this issue but was unable to produce a code change.

<details>
<summary>Claude's findings</summary>

${summary}

</details>

Labeling as \`needs-human\` for manual review.`,
  ]);
  gh(["issue", "edit", String(issueNum), "--repo", repo, "--add-label", "needs-human"]);
  gh(["issue", "edit", String(issueNum), "--repo", repo, "--remove-label", "fixing"]);
}

// ---------------------------------------------------------------------------
// Git / GH helpers
// ---------------------------------------------------------------------------

function git(cwd: string, args: string[]): string {
  debug(`git ${args.join(" ")}`);
  return execFileSync("git", args, { encoding: "utf8", cwd });
}

function gitOutput(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", cwd });
  } catch {
    return "";
  }
}

function gh(args: string[]): string {
  debug(`gh ${args.join(" ")}`);
  return execFileSync("gh", args, { encoding: "utf8" });
}

function safeGh(args: string[]) {
  try {
    gh(args);
  } catch {
    // non-fatal
  }
}

function cleanup(repoDir: string, branch: string) {
  try {
    git(repoDir, ["checkout", "main"]);
    git(repoDir, ["branch", "-D", branch]);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Resolve local clone directory for a repo
// ---------------------------------------------------------------------------

function resolveRepoDir(repo: string): string {
  const repoName = repo.split("/")[1];

  // Check common locations
  const candidates = [
    resolve(homedir(), "code", repoName),
    resolve(homedir(), "projects", repoName),
    resolve(homedir(), repoName),
    resolve("/Users/sem/code", repoName),
  ];

  // Special case: argentos is our current project
  if (repoName === "argentos") {
    candidates.unshift(resolve("/Users/sem/code/argentos"));
  }

  for (const dir of candidates) {
    if (existsSync(resolve(dir, ".git"))) {
      return dir;
    }
  }

  throw new Error(`Cannot find local clone for ${repo}. Checked: ${candidates.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
