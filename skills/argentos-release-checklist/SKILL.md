---
name: argentos-release-checklist
description: End-to-end release checklist for ArgentOS across all repos and services. Use when deploying a release, pushing to production, launching a feature across repos, doing a coordinated deploy, or when anyone mentions "release", "deploy", "launch", "go live", "push to prod", or "ship it".
---

# ArgentOS Release Checklist

Coordinated release across 5 repos, 3 Railway services, and supporting infrastructure.

## Pre-Release

### 1. Linear Check

- [ ] All issues for this release are Done or explicitly deferred
- [ ] No In Progress items that should block the release
- [ ] Release issue exists with acceptance criteria

### 2. Build All Repos

```bash
# argentos (Codex handles)
cd /Users/sem/code/argentos && pnpm build && pnpm test

# argentos-core (Codex handles)
cd /Users/sem/code/argentos-core && pnpm build && pnpm test

# argentos.ai
cd /Users/sem/code/argentos.ai && pnpm build

# argent-marketplace
cd /Users/sem/code/argent-marketplace && pnpm -r build

# argent-docs
cd /Users/sem/code/argent-docs && pnpm build
```

### 3. CodeRabbit Review

```bash
# Run on any repo with changes
pnpm review:coderabbit
```

Fix all findings before proceeding.

### 4. Installer Sync

If installer changed, follow the argentos-installer-sync skill procedure.

## Deploy

### 5. Push All Repos

```bash
# Push in dependency order
# 1. argentos-core (if changed, via PR — branch protection)
# 2. argentos.ai (triggers Railway deploy)
# 3. argent-marketplace (triggers Railway deploy)
# 4. argent-docs (triggers Railway deploy)
```

### 6. Verify Railway Deploys

Wait for each to complete. Check:

```bash
# Website
curl -s https://argentos.ai | head -1

# Marketplace
curl -s https://marketplace.argentos.ai/api/v1/catalog?limit=1 | head -1

# Docs
curl -s https://docs.argentos.ai | head -1
```

### 7. Verify Installer

```bash
curl -fsSL https://argentos.ai/install.sh | head -5
# Must show #!/usr/bin/env bash, not HTML
```

## Post-Release

### 8. Smoke Tests

- [ ] argentos.ai homepage loads with correct hero tabs
- [ ] Marketplace catalog shows packages with VT badges
- [ ] Marketplace login (GitHub OAuth) works
- [ ] Marketplace package detail pages load with security scan section
- [ ] Docs site loads with Context7 widget
- [ ] `argent marketplace install <pkg>` works from CLI
- [ ] Newsletter admin at /admin/newsletter loads

### 9. Update Linear

- [ ] Set release issue to Done
- [ ] Note any follow-up issues discovered during smoke test
- [ ] Record Blacksmith CI status for argentos-core

### 10. Announce

- [ ] Discord announcement (if user-facing changes)
- [ ] Update llms.txt if new pages/features added
- [ ] Context7 re-index if docs changed significantly

## Rollback

If a deploy breaks production:

1. `git revert HEAD` on the broken repo
2. Push immediately (don't wait for review)
3. Verify the live URL recovers
4. Create a Linear issue for the root cause
5. Fix properly on a branch, then re-deploy

## Service Map

| Service         | URL                            | Deploys From                      |
| --------------- | ------------------------------ | --------------------------------- |
| Website         | argentos.ai                    | argentos.ai main → Railway        |
| Marketplace     | marketplace.argentos.ai        | argent-marketplace main → Railway |
| Docs            | docs.argentos.ai               | argent-docs main → Railway        |
| CLI installer   | argentos.ai/install.sh         | argentos.ai main → Railway        |
| Marketplace API | marketplace.argentos.ai/api/v1 | Same as marketplace               |
