---
summary: "Operator runbook for partner release-candidate install, update, rollback, and verification"
read_when:
  - Handing off an RC to non-dev operators
  - Verifying first install on a clean machine
  - Rolling back a failed RC update
title: "Partner RC Runbook"
---

# Partner RC Runbook

This runbook is for non-dev operators validating a partner release candidate on a clean machine.

## 1) Fresh install (clean machine)

```bash
curl -fsSL https://argentos.ai/install.sh | bash
argent --version
argent onboard --install-daemon
```

Expected:

- `argent --version` prints a semantic version.
- Onboarding completes without fatal errors.
- `argent update status --json` should normally report `installKind: "git"` for the standard hosted rail.

## 2) First-run verification

```bash
argent health --json
argent update status --json
argent gateway status --json
```

Expected:

- Health returns `"ok": true`.
- Update status returns `update.installKind` of `git` for the standard hosted rail (`package` only if you intentionally used the manual npm path).
- Update status returns `update.source.ready: true`.
- Gateway status reports running or installable with clear instructions.

## 3) Update verification

Recommended:

```bash
argent update --yes
```

Then verify again:

```bash
argent doctor --non-interactive
argent health --json
argent update status --json
```

Expected:

- `argent update` may return:
  - `ok` (updated), or
  - `skipped` with `reason=up-to-date` (already current; this is a pass).
- Doctor and health complete without fatal errors.

## 4) Rollback

If RC behavior regresses on the standard hosted rail, pin to the last known-good release tag:

```bash
git fetch --tags origin
git checkout --detach <known-good-release-tag>
argent doctor --non-interactive
argent gateway restart
argent health --json
```

If you intentionally used the manual npm path instead:

```bash
npm i -g argentos@<known-good-version>
argent doctor --non-interactive
argent gateway restart
argent health --json
```

If using pnpm:

```bash
pnpm add -g argentos@<known-good-version>
```

## 5) Handoff checklist

- Fresh install completed on clean machine.
- `argent update status --json` shows deterministic source detection and readiness.
- `argent update` does not fail when already up to date.
- Basic operator checks passed: `doctor`, `health`, `gateway status`.
- Rollback command validated and documented with a known-good version.
