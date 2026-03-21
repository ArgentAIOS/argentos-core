# Local Runtime And Install Workflow

Date: 2026-03-21

## Purpose

Keep the active development workspace separate from:

- the clean validation workspace
- the installed macOS app in `/Applications`
- experimental kernel-memory services such as the Curiosity Queue Monitor

Also keep the current `/Users/sem/code/argentos` runtime separate from the older autonomy-only
kernel workspace at `/Users/sem/code/argentos-main-autonomy-fixes-20260319`.

This is the local operating model to use until the install/onboarding path is fully productized.

## Current Local Layout

### Active development workspace

- path: `/Users/sem/code/argentos`
- branch: `codex/*`
- allowed to be dirty

### Clean validation workspace

- path: `/Users/sem/code/argentos-main-clean-20260321`
- source: `origin/main`
- state: detached clean validation tree

This exists because the older "clean" worktrees were already dirty and could not be trusted for smoke checks.

## Rules

1. Do day-to-day edits only in `/Users/sem/code/argentos`.
2. Do not treat `/Users/sem/code/argentos-main-clean-20260321` as an editing workspace.
3. Run smoke/build validation from the clean validation workspace.
4. Package the app from the intended source workspace, but do not let packaging rewrite shared runtime dependencies.
5. Treat `http://127.0.0.1:19427/` as experimental tooling, not part of the normal operator chat/runtime surface.

## Clean Validation Workflow

### Create a fresh clean validation tree

```bash
cd /Users/sem/code/argentos
git fetch origin --prune
git worktree add --detach /Users/sem/code/argentos-main-clean-YYYYMMDD origin/main
```

### Verify it is clean

```bash
cd /Users/sem/code/argentos-main-clean-20260321
git status --short --branch
```

Expected result:

- `## HEAD (no branch)`
- no modified files

### Current smoke standard

```bash
cd /Users/sem/code/argentos-main-clean-20260321
pnpm install --no-frozen-lockfile
pnpm exec vitest run src/infra/runtime-guard.test.ts
pnpm exec vitest run src/commands/critical-observability.test.ts
pnpm exec vitest run src/infra/update-check.test.ts src/infra/update-runner.test.ts src/cli/update-cli.test.ts
pnpm --dir dashboard build
```

### Current result on 2026-03-21

The smoke pass succeeded from `/Users/sem/code/argentos-main-clean-20260321`.

One environment note:

- `pnpm install --frozen-lockfile` failed on `origin/main` with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`
- `pnpm install --no-frozen-lockfile` succeeded without dirtying the tree

So the current blocker is a frozen-install policy mismatch, not lockfile drift in `main`.

## Packaging The macOS App

Package from the source workspace you actually want to test:

```bash
cd /Users/sem/code/argentos
scripts/package-mac-app.sh
```

Important:

- packaging now uses the existing workspace `node_modules`
- it no longer force-runs `pnpm install`
- if dependencies are missing, packaging fails fast

Explicit opt-in if you really want packaging to install dependencies in the current workspace:

```bash
cd /Users/sem/code/argentos
FORCE_PNPM_INSTALL=1 scripts/package-mac-app.sh
```

That opt-in should be treated as exceptional, because it can still reshape the active workspace.

## Replacing The Installed App

Current packaged bundle path:

- `/Users/sem/code/argentos/dist/Argent.app`

Current packaged bundle metadata after the last rebuild:

- `ArgentGitCommit = 32f9956af`
- `CFBundleShortVersionString = 2026.3.2`

Replace `/Applications/Argent.app` with the current local build:

```bash
osascript -e 'tell application "Argent" to quit' 2>/dev/null || true
pkill -f '/Applications/Argent.app/Contents/MacOS/Argent' 2>/dev/null || true
rm -rf "/Applications/Argent.app"
ditto "/Users/sem/code/argentos/dist/Argent.app" "/Applications/Argent.app"
open "/Applications/Argent.app"
```

## LaunchAgent Re-Homing

If dashboard API/UI services are still pointing at an old workspace, reinstall the control-surface services from the intended repo:

```bash
cd /Users/sem/code/argentos
node dist/index.js cs install
```

This should rewrite the dashboard LaunchAgents to the current repo paths.

## Experimental Curiosity Monitor

The Curiosity Queue Monitor is documented separately in:

- [EXPERIMENTAL_CURIOSITY_MONITOR.md](/Users/sem/code/argentos/docs/argent/EXPERIMENTAL_CURIOSITY_MONITOR.md)
- [KERNEL_MEMORY_PAUSE_HANDOFF_2026-03-21.md](/Users/sem/code/argentos/docs/argent/KERNEL_MEMORY_PAUSE_HANDOFF_2026-03-21.md)

Boundary:

- experimental kernel-memory service
- not part of the main operator chat
- not part of the public/installable product surface

Control path:

- `Settings`
- `Gateway`
- `Services`
- `Curiosity Queue Monitor`

## Update Rails

There are still two distinct update rails:

1. runtime/gateway update rail
2. native macOS app rail

References:

- [docs/install/updating.md](/Users/sem/code/argentos/docs/install/updating.md)
- [docs/install/update-distribution.md](/Users/sem/code/argentos/docs/install/update-distribution.md)

Do not collapse these conceptually. Updating the gateway/runtime does not replace `/Applications/Argent.app`, and Sparkle app updates do not replace the runtime checkout by themselves.
