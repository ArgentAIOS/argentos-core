---
name: argentos-installer-sync
description: Sync the ArgentOS hosted installer from the source repo to the website. Use when the installer script changes, when Codex merges installer PRs, when the live install.sh is stale or broken, when onboarding fails on a clean machine, or when anyone mentions "installer sync", "install.sh", "stale installer", or "onboard crash".
---

# ArgentOS Installer Sync

Ensures the live installer at `https://argentos.ai/install.sh` matches the source of truth.

## The Sync Chain

```
Source of truth:
  argentos/scripts/install-hosted.sh
    ↓ Codex merges to argentos main
Copy to website:
  argentos.ai/scripts/install.sh
  argentos.ai/public/install.sh
    ↓ Claude pushes to argentos.ai main
Live:
  https://argentos.ai/install.sh
    ↓ Railway deploys automatically
End users:
  curl -fsSL https://argentos.ai/install.sh | bash
```

## When to Sync

Sync immediately when:

- Codex sends a `HANDOFF TO CLAUDE` mentioning the installer
- A PR merging installer changes lands on argentos main
- The live URL serves outdated code (test with verification step below)
- `argent onboard` crashes on a clean machine

## Sync Procedure

### 1. Pull latest source

```bash
cd /Users/sem/code/argentos
git fetch origin main
git show origin/main:scripts/install-hosted.sh > /tmp/install-latest.sh
```

### 2. Copy to both website locations

```bash
cp /tmp/install-latest.sh /Users/sem/code/argentos.ai/scripts/install.sh
cp /tmp/install-latest.sh /Users/sem/code/argentos.ai/public/install.sh
```

### 3. Verify byte-for-byte match

```bash
diff /Users/sem/code/argentos.ai/scripts/install.sh \
     /Users/sem/code/argentos.ai/public/install.sh
# Must output nothing (identical)
```

### 4. Commit and push

```bash
cd /Users/sem/code/argentos.ai
git add scripts/install.sh public/install.sh
git commit -m "fix: Sync hosted installer from argentos main"
git push origin main
```

### 5. Verify live (after Railway deploys)

```bash
# Check it serves the new script, not HTML
curl -fsSL https://argentos.ai/install.sh | head -3
# Must show: #!/usr/bin/env bash

# Check specific fix is present (adapt grep to the change)
curl -fsSL https://argentos.ai/install.sh | grep "run_onboard"
```

## Common Drift Patterns

| Symptom                                     | Cause                        | Fix                                                |
| ------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `ONBOARD_NO_PROMPT[@]: unbound variable`    | Bash 3.2 array expansion     | Sync — source has `run_onboard()` guard            |
| `git clone` fails for end users             | Wrong repo URL in installer  | Check line ~704 for correct repo                   |
| Live URL returns HTML not bash              | Railway serving SPA fallback | Check server.js serves `/install.sh` from scripts/ |
| `install.sh` and `public/install.sh` differ | Partial sync                 | Always copy to both, verify with diff              |

## Do Not

- Edit `argentos.ai/scripts/install.sh` directly — always sync from source.
- Push installer changes without verifying both copies match.
- Assume Railway deployed — always verify the live URL after push.
