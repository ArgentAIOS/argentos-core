#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const isPrePush = args.has("--pre-push");
const strictBranch = args.has("--strict-branch");

function fail(message) {
  console.error(`repo-lane check failed: ${message}`);
  process.exitCode = 1;
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function normalizeRepoId(value) {
  if (!value) return "";
  let text = String(value).trim();
  text = text.replace(/^git\+/, "");
  text = text.replace(/^ssh:\/\/git@github\.com\//, "");
  text = text.replace(/^git@github\.com:/, "");
  text = text.replace(/^https:\/\/github\.com\//, "");
  text = text.replace(/^http:\/\/github\.com\//, "");
  text = text.replace(/\.git$/, "");
  text = text.replace(/\/$/, "");
  return text;
}

function localRepoName(value) {
  const text = String(value || "").replace(/\/$/, "");
  return path.basename(text.replace(/\.git$/, ""));
}

function matchesRepo(value, repo) {
  const normalized = normalizeRepoId(value);
  if (normalized === repo) return true;
  const [owner, name] = repo.split("/");
  return normalized === name || normalized === `${owner}/${name}`;
}

const repoRoot = git(["rev-parse", "--show-toplevel"]);
const sentinelPath = path.join(repoRoot, ".argent-repo.json");
const sentinel = JSON.parse(fs.readFileSync(sentinelPath, "utf8"));
const expectedRepo = sentinel.repo;
const expectedBranch = sentinel.installChannel;
const forbiddenRemotes = Array.isArray(sentinel.forbiddenRemotes) ? sentinel.forbiddenRemotes : [];

if (path.resolve(process.cwd()) !== path.resolve(repoRoot)) {
  fail(`run from repo root ${repoRoot}; current directory is ${process.cwd()}`);
}

const githubRepository = process.env.GITHUB_REPOSITORY;
if (githubRepository && normalizeRepoId(githubRepository) !== expectedRepo) {
  fail(`GITHUB_REPOSITORY is ${githubRepository}, expected ${expectedRepo}`);
}

const originUrl = git(["remote", "get-url", "origin"]);
if (!matchesRepo(originUrl, expectedRepo)) {
  fail(`origin is ${originUrl}, expected ${expectedRepo}`);
}

const remoteLines = git(["remote", "-v"])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

for (const line of remoteLines) {
  const [, url = ""] = line.split(/\s+/);
  for (const forbidden of forbiddenRemotes) {
    const forbiddenName = forbidden.split("/").at(-1);
    if (matchesRepo(url, forbidden) || localRepoName(url) === forbiddenName) {
      fail(`remote ${url} points at forbidden repo ${forbidden}`);
    }
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const packageRepo = packageJson.repository?.url;
if (packageRepo && !matchesRepo(packageRepo, expectedRepo)) {
  fail(`package.json repository is ${packageRepo}, expected ${expectedRepo}`);
}

const targetBranch = process.env.GITHUB_BASE_REF || process.env.ARGENT_TARGET_BRANCH || "";
if (targetBranch && targetBranch !== expectedBranch) {
  fail(`target branch is ${targetBranch}, expected ${expectedBranch}`);
}

if (process.env.GITHUB_EVENT_NAME === "push") {
  const pushBranch = process.env.GITHUB_REF_NAME || "";
  if (pushBranch && pushBranch !== expectedBranch) {
    fail(`push branch is ${pushBranch}, expected ${expectedBranch}`);
  }
}

if (strictBranch) {
  const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (currentBranch !== expectedBranch) {
    fail(`current branch is ${currentBranch}, expected ${expectedBranch}`);
  }
}

if (isPrePush) {
  const input = fs.readFileSync(0, "utf8").trim();
  const remoteName = process.argv[3] || "";
  const remoteUrl = process.argv[4] || "";
  if (remoteUrl && !matchesRepo(remoteUrl, expectedRepo)) {
    fail(`pre-push remote ${remoteName || "(unknown)"} is ${remoteUrl}, expected ${expectedRepo}`);
  }

  for (const line of input.split("\n").filter(Boolean)) {
    const [, , remoteRef = ""] = line.split(/\s+/);
    if (remoteRef === "refs/heads/main") {
      fail(`push target is main; core lane PRs should target ${expectedBranch}`);
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`repo-lane check passed: ${expectedRepo} (${sentinel.lane}) -> ${expectedBranch}`);
