---
summary: "Updating ArgentOS safely on the git rail, plus rollback strategy"
read_when:
  - Updating ArgentOS
  - Something breaks after an update
title: "Updating"
---

# Updating

ArgentOS is moving fast (pre “1.0”). Treat updates like shipping infra: update → run checks → restart (or use `argent update`, which restarts) → verify.

Partner/operator handoff checklist: [Partner RC Runbook](/install/partner-release-rc)

## Recommended: `argent update` on the hosted git rail

The public website installer defaults to the **git rail**, so the normal update
path for those installs is:

```bash
argent update
```

Notes:

- On the hosted git rail, `stable` means the latest GitHub release tag.
- `beta` lands on the newest beta-or-stable release tag.
- `dev` tracks `main`.
- `argent update` keeps git installs on the git rail. It does not switch stable users to npm.
- Legacy note: `argent` remains available as a compatibility shim.

## Repair / reinstall in place

Re-run the website installer if you need to repair an install, recreate wrappers,
or bootstrap a fresh machine with the standard hosted rail:

```bash
curl -fsSL https://argentos.ai/install.sh | bash
```

Notes:

- Add `--no-onboard` if you don’t want the onboarding wizard to run again.
- The hosted installer defaults to `--install-method git --channel stable`.
- Existing git checkouts only `git pull --rebase` when the worktree is clean.

## Before you update

- Know how you installed: **hosted git rail** vs **from source** (git clone).
- Know how your Gateway is running: **foreground terminal** vs **supervised service** (launchd/systemd).
- Snapshot your tailoring:
  - Config: `~/.argentos/argent.json`
  - Credentials: `~/.argentos/credentials/`
  - Workspace: `~/.argentos/workspace`

## Update (`argent update`)

For **hosted/source installs** (git checkout), prefer:

```bash
argent update
```

It runs a safe-ish update flow:

- Requires a clean worktree.
- Switches to the selected channel:
  - `stable`/`beta`: latest matching GitHub release tag
  - `dev`: `main`
- Fetches + rebases against the configured upstream (dev channel).
- Installs deps, builds, builds the Control UI, and runs `argent doctor`.
- Restarts the gateway by default (use `--no-restart` to skip).

## Update (Control UI / RPC)

The Control UI has **Update & Restart** (RPC: `update.run`). It:

1. Runs the same source-update flow as `argent update` (git checkout only).
2. Writes a restart sentinel with a structured report (stdout/stderr tail).
3. Restarts the gateway and pings the last active session with the report.

If the update fails (for example, rebase fails), the gateway does **not** restart; it stays on the current running version and reports the failure.

For private-repo deployments and Sparkle app-release staging, see
[Update Distribution (Private Repo + Desktop App)](./update-distribution.md).

## Update (from source)

From the repo checkout:

Preferred:

```bash
argent update
```

Manual (equivalent-ish):

```bash
git pull
pnpm install
pnpm build
pnpm ui:build # auto-installs UI deps on first run
argent doctor
argent health
```

Notes:

- `pnpm build` matters when you run the packaged `argent` binary ([`argent.mjs`](https://github.com/ArgentAIOS/argentos/blob/main/argent.mjs)) or use Node to run `dist/`.
- If you run from a repo checkout without `argent` on PATH, use `pnpm argent ...` for CLI commands.
- If you run directly from TypeScript (`pnpm argent ...`), a rebuild is usually unnecessary, but **config migrations still apply** → run doctor.
- If you are repairing an older legacy package install, re-run the hosted installer to move back onto the supported git rail.

## Always Run: `argent doctor`

Doctor is the “safe update” command. It’s intentionally boring: repair + migrate + warn.

Note: if you’re on a **source install** (git checkout), `argent doctor` will offer to run `argent update` first.

Typical things it does:

- Migrate deprecated config keys / legacy config file locations.
- Audit DM policies and warn on risky “open” settings.
- Check Gateway health and can offer to restart.
- Detect and migrate older gateway services (launchd/systemd; legacy schtasks) to current ArgentOS services.
- On Linux, ensure systemd user lingering (so the Gateway survives logout).

Details: [Doctor](/gateway/doctor)

## Start / stop / restart the Gateway

CLI (works regardless of OS):

```bash
argent gateway status
argent gateway stop
argent gateway restart
argent gateway --port 18789
argent logs --follow
```

If you’re supervised:

- macOS launchd (app-bundled LaunchAgent): `launchctl kickstart -k gui/$UID/bot.molt.gateway` (use `bot.molt.<profile>`; legacy `com.argentos.*` still works)
- Linux systemd user service: `systemctl --user restart argent-gateway[-<profile>].service`
- Windows (WSL2): `systemctl --user restart argent-gateway[-<profile>].service`
  - `launchctl`/`systemctl` only work if the service is installed; otherwise run `argent gateway install`.

Runbook + exact service labels: [Gateway runbook](/gateway)

## Rollback / pinning (when something breaks)

### Pin (git rail) to a release tag or date

Preferred for the hosted/public rail: check out a known-good GitHub release tag:

```bash
git fetch --tags origin
git checkout --detach <release-tag>
```

Or pick a commit from a date (example: “state of main as of 2026-01-01”):

```bash
git fetch origin
git checkout "$(git rev-list -n 1 --before=\"2026-01-01\" origin/main)"
```

Then reinstall deps + restart:

```bash
pnpm install
pnpm build
argent gateway restart
```

If you want to go back to latest later:

```bash
git checkout main
git pull
```

## If you’re stuck

- Run `argent doctor` again and read the output carefully (it often tells you the fix).
- Check: [Troubleshooting](/gateway/troubleshooting)
- Ask in Discord: https://discord.gg/clawd
