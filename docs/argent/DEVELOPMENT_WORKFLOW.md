# ArgentOS Development Workflow (Single Source of Truth)

## Purpose

Keep day-to-day development stable while preserving a clean `main` for testing, release checks, and partner handoff.

## Canonical Working Layout

- `/Users/sem/code/argentos`
  - Purpose: active development workspace
  - Branch: `codex/local-dev-wip-20260305` (or a current `codex/*` feature branch)
  - May be dirty/in-progress
- `/Users/sem/code/argentos-trunk-clean`
  - Purpose: clean validation workspace
  - Branch: `main` tracking `origin/main`
  - Must stay clean

## Ground Rules

1. Never do day-to-day edits directly on `main` in the active dev workspace.
2. All code changes happen on `codex/*` branches.
3. Merge via PR into `main`.
4. Validate release/smoke checks from `argentos-trunk-clean` (clean `main`), not from a dirty dev tree.
5. If local state is risky, create a salvage branch before cleanup:
   - Example: `codex/local-salvage-main-YYYYMMDD`

## Daily Start Checklist

From clean validation workspace:

```bash
cd /Users/sem/code/argentos-trunk-clean
git pull --ff-only
git status --short --branch
```

Expected: `main...origin/main` with no changed files.

From dev workspace:

```bash
cd /Users/sem/code/argentos
git branch --show-current
git status --short --branch
```

Expected: a `codex/*` branch (not `main`).

## Branch Hygiene

- Close superseded PRs once replacement PRs are merged.
- Remove stale integration/thread branches after merge.
- Remove stale worktrees that pin old branch refs.
- Keep long-lived strategy branches only if actively used.

## Recovery Pattern (If main gets dirty/diverged)

1. Snapshot current state:

```bash
git branch codex/local-salvage-main-YYYYMMDD
```

2. Move current dirty work onto a dev branch:

```bash
git switch -c codex/local-dev-wip-YYYYMMDD
```

3. Reset local `main` ref to remote (while on dev branch):

```bash
git fetch origin --prune
git branch -f main origin/main
```

4. Use `argentos-trunk-clean` for clean smoke/release checks.

## Smoke Pass Standard

Minimum smoke pass should run from `argentos-trunk-clean`:

```bash
pnpm install
pnpm exec vitest run src/infra/runtime-guard.test.ts
pnpm exec vitest run src/commands/critical-observability.test.ts
pnpm exec vitest run src/infra/update-check.test.ts src/infra/update-runner.test.ts src/cli/update-cli.test.ts
pnpm --dir dashboard build
```

If any known environment blocker appears (for example optional dependency not installed), record it explicitly in the smoke report as environment-bound, not silently ignored.
