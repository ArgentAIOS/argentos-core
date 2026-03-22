---
summary: "Clean-machine validation checklist for ArgentOS Core on a second Mac"
read_when:
  - Validating a public-core install before release
  - Testing install/onboarding on a clean Mac
title: "Second Mac Validation"
---

# Second Mac Validation

Use this runbook to validate **ArgentOS Core** on a clean secondary Mac before public release.

The goal is simple:

- prove the repo-local install path works from a fresh checkout
- prove onboarding completes cleanly
- prove the gateway and dashboard come online
- capture any install or runtime regressions with exact evidence

This runbook validates the **source checkout path**. It is not the primary end-user install story. End users should prefer the hosted installer or the macOS app distribution.

## Preconditions

- Clean Mac or a clean macOS user account
- Node **22.12+** for `pnpm install` / `pnpm build`
- `git` available
- No reliance on your existing `~/.argentos` state from the primary machine

## Validation target

Test the public-core repo, not the private source repo:

```bash
git clone https://github.com/ArgentAIOS/argentos-core.git
cd argentos-core
```

Confirm you are in the right repo:

```bash
git remote -v
```

Expected remote:

- `https://github.com/ArgentAIOS/argentos-core.git`

## Path A: repo-local install from source checkout

This is the current primary validation path.

```bash
pnpm install
pnpm build
bash install.sh
```

After install:

```bash
argent onboard --install-daemon
argent doctor
argent gateway status
argent dashboard
```

## What to verify

### 1) Build and install

Expected:

- `pnpm install` completes without lockfile drift
- `pnpm build` completes
- `bash install.sh` finishes without manual file surgery
- `bash install.sh` bootstraps a supported private Node runtime when the active shell Node is unsupported for the installed CLI/runtime

Record failures with:

```bash
node -v
pnpm -v
tail -n 100 ~/.argentos/logs/gateway.log 2>/dev/null || true
```

### 2) Onboarding

Expected:

- `argent onboard --install-daemon` completes
- local runtime selection is clear
- Ollama / LM Studio / cloud branching behaves as expected
- daemon install does not fail silently

Capture:

- which runtime path you selected
- which text model you selected
- which embedding model you selected
- any prompt copy that still feels inherited or off-brand

### 3) Gateway and dashboard

Expected:

- `argent doctor` returns clean or clearly actionable output
- `argent gateway status` reports the daemon accurately
- `argent dashboard` opens without a blank screen

If the gateway fails, capture:

```bash
argent gateway status
argent health
tail -n 120 ~/.argentos/logs/gateway.log
tail -n 120 ~/.argentos/logs/dashboard-api.log 2>/dev/null || true
```

### 4) Core boundary sanity

Expected:

- no workforce-only or business-only surfaces are required to complete install
- normal Core chat/session/dashboard flows are reachable
- no private marketplace/business dependencies are required just to boot Core

## Optional Path B: hosted installer spot check

Use this only after the repo-local path passes cleanly.

```bash
curl -fsSL https://argentos.ai/install.sh | bash
argent onboard --install-daemon
argent doctor
argent gateway status
```

This is a release-rail check, not the primary public-core source validation.

## Pass criteria

Treat the run as a pass only if all of these are true:

- install succeeds from `argentos-core`
- onboarding completes without hidden manual fixes
- gateway starts
- dashboard opens
- uninstall path is still available:

```bash
argent uninstall --all --yes --non-interactive
```

## Report format

When logging the result in Linear, include:

- machine model + macOS version
- Node version
- install path used
- runtime selected during onboarding
- exact failing command, if any
- exact log snippet or screenshot path

Recommended issue:

- `WEB-12 Validate argentos-core install and onboarding on a clean Mac`
