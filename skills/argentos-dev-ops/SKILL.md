---
name: argentos-dev-ops
description: ArgentOS development operations workflow — Linear tracking, CodeRabbit reviews, Blacksmith CI, GitHub branch protection, and inter-agent handoff protocol. Use when working on any ArgentOS repo, creating PRs, managing CI/CD, coordinating between agents, syncing installers, or setting up new project infrastructure. Trigger on mentions of Linear, CodeRabbit, Blacksmith, branch protection, handoff, installer sync, or dev workflow.
---

# ArgentOS Development Operations

Standard operating procedures for all ArgentOS development across five repos.

## Repos and Ownership

| Repo                 | Agent  | Purpose                                      |
| -------------------- | ------ | -------------------------------------------- |
| `argentos`           | Codex  | Private monorepo — full OS source            |
| `argentos-core`      | Codex  | Public core — exported from argentos         |
| `argentos.ai`        | Claude | Marketing website + newsletter + analytics   |
| `argent-marketplace` | Claude | Marketplace — catalog, submissions, scanning |
| `argent-docs`        | Claude | Documentation site (Fumadocs + Next.js)      |

## Linear — Source of Truth

Workspace: `webdevtoday`. Team key: `WEB`.

**Projects:** ArgentOS, AOS Website, AOS Marketplace, AOS Docs, AOS Licensing Server.

**Before starting work:** Find or create the Linear issue. Record active branch, target repo, acceptance criteria. Set to In Progress.

**During work:** Update with current blocker, commit/PR link, review gates. For release-facing work, track Blacksmith and CodeRabbit state.

**After work:** Link merged PR. Set to Done. Create handoff issue if cross-repo work is needed.

If Linear is unavailable, say so immediately. Do not pretend work is tracked.

## CodeRabbit — PR Review

Every PR gets CodeRabbit before human review.

```bash
pnpm review:coderabbit          # Full review
pnpm review:coderabbit:prompt   # Prompt-only for CI/agent handoff
```

Fix CodeRabbit findings before requesting human review. Configured at org level.

## Blacksmith — CI Runners

All argentos-core CI runs on Blacksmith runners. Track Blacksmith status in Linear for release work. Dashboard: https://blacksmith.sh

## GitHub Branch Protection

**argentos-core**: Direct push blocked. PRs required. CodeRabbit must pass.

**All other repos**: Direct push to main allowed for speed.

**Branches:** `codex/*` for Codex work, `feat/*` for features, `fix/*` for bugs.

## Inter-Agent Handoff

Two agents. Jason coordinates. Never modify another agent's repo without a handoff.

```
HANDOFF TO CLAUDE:  (website/marketplace/docs)
HANDOFF TO CODEX:   (argentos/argentos-core)

Linear: WEB-XX
Repo: target repo
Task: one-line summary
Context: what triggers this
What needs to happen: specific changes
Acceptance: how to verify
```

Update Linear and notify Jason after completing a handoff.

## Installer Sync

```
argentos/scripts/install-hosted.sh    ← source of truth (Codex)
  ↓
argentos.ai/scripts/install.sh        ← website copy (Claude syncs)
argentos.ai/public/install.sh         ← public copy (Claude syncs)
  ↓
https://argentos.ai/install.sh        ← live
```

Both website copies must be byte-for-byte identical. Verify: `curl -fsSL https://argentos.ai/install.sh | head -5`

## Shared Infrastructure

| Service      | Detail                                   |
| ------------ | ---------------------------------------- |
| PostgreSQL   | Railway, shared by website + marketplace |
| R2           | argentos-licensing-marketplace bucket    |
| Resend       | hello@argentos.ai                        |
| VirusTotal   | Package scanning (free, 500/day)         |
| GitHub OAuth | Marketplace (Ov23liooePHo3G5yoroe)       |
| Context7     | /websites/argentos_ai                    |

## PR Workflow

1. Branch from main.
2. Implement. `pnpm build` must pass.
3. `pnpm review:coderabbit` if available.
4. Push, create PR. CodeRabbit reviews.
5. Fix findings. Human review. Merge.
6. Update Linear with PR link and Done.

argentos-core: PR required. Other repos: direct push OK for urgent fixes.
