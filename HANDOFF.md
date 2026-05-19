# HANDOFF — argent-core shift-two recovery + gantt verification

**Session close:** 2026-05-18 ~22:30 PT
**Branch you're on at session close:** `working/2026-05-15` (local-only, one shift-two housekeeping commit ahead of where it was)

> Every claim is tagged **[VERIFIED]** (I read code, ran a command, or have a tool result this session) or **[ASSUMED]** (relying on inference, the prior session's HANDOFF, or an external system's reported state).

For the multi-day context that led into this session, see the prior workflows-lane HANDOFF in this file's git history (`git log -p HANDOFF.md` — the 2026-05-14 entry). For tonight's full narrative, see:

`/Users/sem/Documents/Obsidian Vault/ArgentOS Core Docs/08 - Current Iteration/Session 2026-05-18 — shift-two recovery + gantt verification/`

— especially `Start Here.md` and `Shift-two summary.md`.

---

## 1. Current state of the repo + what's deployed where

### Branches

| Branch                     | Tip                                          | Meaning                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                     | `6f108e42` (PR #370 merge)                   | **v2026.5.6.5 released.** [VERIFIED via `gh pr view 370`: MERGED, mergedAt=2026-05-19T00:07:08Z UTC]                                                                                              |
| `dev`                      | 28+ commits past `working/2026-05-15`'s base | Post-release work; includes PR #371 + #372 merged tonight. [VERIFIED via `git log origin/dev`]                                                                                                    |
| `working/2026-05-15`       | one shift-two housekeeping commit            | Local-only working branch. **Do NOT push.** Diverged from origin/dev (1 commit local + 28 commits ahead on origin/dev side per `git status` output at session close). [VERIFIED via `git status`] |
| `feat/gantt-smoke-fixture` | a59092e6                                     | PR #374 open. Awaiting merge.                                                                                                                                                                     |

### Tags

`v2026.5.6.5` (release, pushed) + `salvage/gantt-bucket-v1.1-substrate-from-pr366` (commit `7b7e6ae4`, anchors the v1.1 gantt substrate from the closed PR #366 so the deleted branch didn't lose the code). [VERIFIED via `git ls-remote --tags origin`]

### Release content (v2026.5.6.5)

| Wave           | PRs                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------- |
| Installer fix  | #369 (dev), #370 (release → main)                                                           |
| AppForge views | #368 (list view), #367 (calendar view) — landed before this session; came in via dev merges |

### Open PRs at session close

| #        | Title                                                                   | State           | Recommended next step                                                                             |
| -------- | ----------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| **#374** | `chore(dashboard): add gantt-smoke dev-fixture for visual verification` | OPEN, mergeable | Review/merge or close with a "not landing" note. Diagnostic harness only — not a regression test. |

### Workers / processes

- **No surviving background processes from my side.** [VERIFIED via `pgrep -af vite|api-server.cjs`]
- Two pre-existing services still listening on ports 8080 / 9242 (not mine, not touched). [VERIFIED via `lsof -i :8080 -i :9242`]

### Cron

No session-only crons armed in this session. (Prior workflows-lane bus-loop cron has long since auto-expired.)

---

## 2. What landed this session — at a glance

| Item                                                         | Outcome                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Release v2026.5.6.5                                          | Shipped — merged + tagged + remote release branch deleted |
| Worktree cleanup                                             | 186 → 1                                                   |
| PR #371 — `failWorkflowRun` cost aggregation (closes #352)   | Merged to dev (`c865cfa1`)                                |
| PR #372 — Telegram inline approve/deny buttons (closes #351) | Merged to dev (`0fbb7dd5`)                                |
| PR #366 — gantt v1 (superseded by dev)                       | Closed; salvage tagged + tracked at #373                  |
| PR #374 — gantt-smoke dev-fixture                            | Open, awaiting merge                                      |
| HANDOFF.md updated for next session                          | This file                                                 |

Full narrative + lessons in the vault session folder.

---

## 3. Open issues you'll see in the queue

### Just-closed in this session

- #351 (closed by #372)
- #352 (closed by #371)

### Newly filed

- **#373 [appforge][gantt-v1.1] Lift hierarchy + dependency + critical-path substrate from PR #366.** Lift spec is in the issue body — exact files, exact exports, what to drop. Anchored to tag `salvage/gantt-bucket-v1.1-substrate-from-pr366` (commit `7b7e6ae4`). Only worth doing when v1.1 UI wiring starts; the substrate is preserved and tested but doesn't help until UI consumes it. [VERIFIED]

### Still open from prior HANDOFF (4 days ago) — current state

| #    | Title                                            | Status                                                                          |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| #311 | MemU multimodal preprocess port                  | 🟡 Open. "Cheap next item" per prior HANDOFF — SAFE-PORT, 1-2 days.             |
| #314 | MemU retrieval-stage prompts                     | 🔵 `needs:product-call` — blocked                                               |
| #315 | MemU non-propagate option                        | 🔵 `needs:product-call` — blocked                                               |
| #360 | AppForge → Airtable parity tracker (31 findings) | 🟡 Open. Meta-issue from 2026-05-16 audit. Best bucket of structured next-work. |
| #185 | Re-poke earendil-works PR #4277                  | 🟡 Open. Their moratorium ended 2026-05-17 — actionable now, 5-min task.        |
| #283 | oxlint long-tail cleanup                         | 🟡 Open. Backlog.                                                               |

---

## 4. What the next session should do first

### Priority order

1. **Read this file + the vault session folder.** ~10 min.

2. **Decide on PR #374** (gantt-smoke fixture). One-line decision: merge it (and the fixture becomes a permanent diagnostic surface) or close it as not-landing (and the fixture was a one-shot verification we no longer need). I'd lean merge — it's 167 lines, contained under `dev-fixtures/`, and there's a README pointing at it. Future you might want to re-run the visual check.

3. **Pick next forward-progress work** — most likely:
   - **#311 (MemU multimodal port)** — 1-2 day cheap port from upstream. Concrete forward progress.
   - **#360 AppForge parity** — pick the smallest finding from the meta-issue and land it. Highest backlog leverage but each item needs scoping.
   - **#185 (earendil-works re-poke)** — 5 minutes, just to clear it.

### Don't-do list

- **Don't push `working/2026-05-15`** without rebasing. It's diverged from origin/dev (28 commits behind). Per the prior HANDOFF this is a local-only working pointer.
- **Don't dispatch a codex worker without planning the worktree teardown.** Worktree accumulation is what crashed the box this morning — see the post-mortem in the vault session folder.
- **Don't trust the audit-agent's file citations.** Two of tonight's worked-on issues (#351, #352) had wrong file paths in the audit. Always grep before acting.
- **Don't claim a UI verification done without a styled rendering.** See the lesson note in the vault session folder — I over-claimed once tonight and got rightly called out.

### Smoke-tests recommended before relying on tonight's changes

- **PR #372 Telegram buttons:** unit tests pass, no live Telegram round-trip done. Trigger an approval gate in a real workflow run with a configured Telegram target, tap a button, verify the run resumes + message edits.
- **PR #371 cost aggregation:** unit tests assert SQL shape, no live verification that `workflow_runs.total_cost_usd` is populated correctly after a real timeout/exception. Force a workflow to throw mid-execution, inspect the row.

Neither blocks other work, but both should be exercised before being relied on.

---

## 5. Repo-state quick-check commands

```sh
cd /Users/sem/code/argent-core

# Snapshot
git fetch origin --quiet
git log origin/main --oneline -3
git log origin/dev --oneline -5
gh pr list --state open --limit 10
gh issue list --state open --limit 20 --search "label:workflows OR label:appforge OR label:memu-sync"

# Worktrees (should be 1 — the main repo only)
git worktree list | wc -l

# Tags
git ls-remote --tags origin | grep -E "v2026|salvage"

# Vault entry point
ls "/Users/sem/Documents/Obsidian Vault/ArgentOS Core Docs/08 - Current Iteration/Session 2026-05-18 — shift-two recovery + gantt verification/"
```

---

## 6. Lessons recorded tonight

In the vault under this session's folder:

- **Post-mortem — ENFILE crash from stale worktrees.** Box crashed mid-session because the OS file table saturated. Root cause: 186 stale codex-worker worktrees + Claude Code background bash fanout. Mitigation: pruned to 1, recommendations for future automation.
- **Lesson — never declare visual verification done without styled rendering.** I over-claimed criterion 1 of the gantt close-out goal based on an unstyled component dump; operator called it out. Recovery rebuilt the harness with proper CSS chain; landed real evidence. Rule: visual criteria need visual evidence with full styling, not just "math passes and component mounts".
- **Lesson — squash-merge supersession pattern.** How to recognize and close a PR whose feature has shipped on dev via different commits, while preserving any unique salvage on a tag + tracking issue.

---

## 7. Numbers at session close

|                                    |                                                           |
| ---------------------------------- | --------------------------------------------------------- |
| PRs merged tonight                 | 2 (#371, #372)                                            |
| PRs closed tonight (without merge) | 1 (#366, superseded)                                      |
| PRs opened tonight                 | 3 (#371, #372, #374)                                      |
| Issues filed tonight               | 1 (#373 — gantt v1.1 substrate lift spec)                 |
| Releases shipped                   | 1 (v2026.5.6.5)                                           |
| Worktrees pruned                   | 185                                                       |
| Zombie workers at close            | 0 [VERIFIED via `pgrep`]                                  |
| Vault notes written                | 4 (Start Here, Shift-two summary, Post-mortem, 2 Lessons) |
| Operator interrupts handled        | 1 (visual-verification over-claim called out + recovered) |
