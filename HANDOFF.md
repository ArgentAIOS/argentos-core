# HANDOFF — argent-core session bridge

**From:** 2026-06-04 session (operator: Jason, assistant: Claude Opus 4.8)
**To:** the next session (morning 2026-06-05)
**Branch:** `dev` @ `8f84de96`; `main` @ `v2026.5.6.7`
**Theme:** shipped 2 installer fixes → deleted-then-recovered the Grok work → _measured_ the real perf truth (and reversed the plan) → found the trust-breaking bottleneck → built a new working method (`goal-contract`)

> Vault story: `~/Obsidian Vault/Argent/Daily Updates/2026-06-04 - Perf truth-finding, Grok recovery, working-method.md` + `Orchestration Handoffs/2026-06-04 - Perf truth, Grok recovery, working-method.md`.

---

## TL;DR — where everything stands

| Thread                               | State                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#432** installer path unification  | ✅ Shipped to prod (`argentos.ai` `8633ee5`), verified via deploy-success signal, **closed**                                                                             |
| **#429** unattended-install hang     | ✅ Fixed, merged to `dev` (PR #434), functionally tested, **closed**                                                                                                     |
| **Grok self-extension**              | ⚠️ I deleted it (wrong call), recovered the recoverable half → `grok-recovery/self-extension`. Runtime half lost; design reconstructed. **Reference, not a foundation.** |
| **#406** session-pipeline cache      | 🛑 **Premise disproven by measurement.** Cache built + tested but **held unwired** — it targets ~3% of the cost.                                                         |
| **#405** turn latency (the real one) | 🟢 Real bottleneck found + safe half fixed on `perf/personal-skill-critical-path-405`. **This is the morning priority.**                                                 |
| **Method**                           | 🆕 `goal-contract` skill created (`~/.claude/skills/goal-contract/SKILL.md`)                                                                                             |
| **ArgentOS direction**               | Keep (Richard's selling it) but **narrow to the agent-governance spine**                                                                                                 |

## The morning priority — finish #405 (turn speed = Jason's trust)

The real reason turns feel slow: the **personal-skill block** in `src/agents/pi-embedded-runner/run/attempt.ts` (~525–609, added **2026-05-03**) runs ~5 **sequential memory-backend awaits every turn**, eagerly and serially _before_ the QW-1 parallel-I/O batch (line ~668). Measured: it's **81% of slow-turn wall-clock** on May operator turns; slow-turn rate doubled April→May (12%→25%), matching this code's date.

**Done (safe half, `d5bd5e5d`):** the two bookkeeping _writes_ (`createPersonalSkillReviewEvent`, `lastUsedAt` updates) are now fire-and-forget (results unused in-turn; safe in the persistent gateway), plus a `markPhase("personal_skills")` so the read cost is measurable.

**Next (use the `goal-contract` skill to lock it first):**

1. **Measure the read cost** — run 2–3 turns with `perf/personal-skill-critical-path-405` active, read the new `personal_skills` phase from `~/.argentos/logs/gateway.log` `[tony-stark]` lines.
2. **Fix the reads** — `getMemoryAdapter` + `reviewPersonalSkillCandidates` + `listPersonalSkillCandidates(50)`. Options, pick by the number: **cache candidates per agent** across turns / **parallelize** into the QW-1 batch / **gate** the whole block when there are no candidates.

Suggested locked contract:

```
GOAL: cut per-turn personal-skill latency so a warm turn starts responding <1s.
ACCEPTANCE: personal_skills phase <200ms on 2nd+ turn (tony-stark); same skills still matched.
NON-GOALS: session-pipeline cache, installer, dashboard, tool-registry rebuild.
BUDGET: ~half-day, ≤4 files, behind the existing memory adapter.
TRIPWIRE: new subsystem or >4 files → STOP and report.
```

## Grok work — recovered, durable, reference-only

I deleted the May-28 Grok tree on a wrong "not needed" call; Jason clarified mid-delete that it was the real fix (Hermes-style fast skill injection + memory + autonomy).

- **Recovered:** delegation/skill/autonomy half (5 files) + reconstructed design doc → **`origin/grok-recovery/self-extension`** (`7204772c`), type-clean.
- **Lost:** runtime fast-path half (uncommitted in a worktree, `--force` removed). Design + snippets survive in `ops/GROK-ENHANCEMENTS-SELF-EXTENSION-PHASES-4-5-2026-05-28.md`.
- It's **reference** — the gate is a brittle `process.cwd()` match, `promotePattern` is a stub, `_delegationHints` is ignored by the gateway. Mine it for the governance/skill-injection build; don't harden it as-is.

## Branch ledger (all pushed to origin)

| Branch                                  | Commit     | Contains                                            | Next                                                   |
| --------------------------------------- | ---------- | --------------------------------------------------- | ------------------------------------------------------ |
| `perf/personal-skill-critical-path-405` | `d5bd5e5d` | writes off critical path + `personal_skills` marker | **measure reads → fix reads**                          |
| `perf/session-pipeline-cache-406`       | (slice 1)  | `SessionPipelineCache` + 12 tests                   | held unwired (premise disproven); reference            |
| `grok-recovery/self-extension`          | `7204772c` | recovered Grok code + design doc                    | Jason's call; reference for governance/skill-injection |

## Strategic + method context (don't lose this)

- **ArgentOS is kept** (Richard committed to selling it) but the direction is **narrow to the governance spine** — agents with their own jobs + tools, governed. The bloat is _blocking_ the actual product. **subCTL is NOT for sale.** North-star: Hermes-style fast skill injection (the #405 fix is step one).
- **Working method (new):** use the **`goal-contract`** skill before any phase — Goal / Acceptance / Non-goals / **Budget** / **Tripwire**. The budget+tripwire are the missing "cost leg" that caps BOTH objective-drift and overcorrection (the 1-hour-task-becomes-a-day failure). Report against the contract at the budget and before declaring done. It's a _visibility_ forcing-function, not a programmatic lock — Jason stays the circuit-breaker.

## Sticky notes

- **gpt-5.3-codex at `think low` silently skips tool calls** — bump to medium or swap if Argent's tools aren't firing.
- **argentos.ai auto-deploys from `main`** (Railway, ~30-40min cold / 1-3min warm). Verify a deploy via the GitHub deployment `success` state, NOT curl alone (zero-downtime swap + identical content can mask it).
- **Lockfile:** `@noble/ed25519@3.0.0` must be in the **root importer** of `pnpm-lock.yaml` or frozen-lockfile CI insta-fails (fixed on both branches).
- Closet items logged in `~/Obsidian Vault/Follow-Ups & To-Dos.md` (Grok fate, #429 prod-ship-on-release, #426 deferred).

## Verification commands

```bash
cd /Users/sem/code/argent-core
git log --oneline origin/dev -2
git branch -r | grep -E "perf/|grok-recovery"          # the 3 work branches
ls ~/.claude/skills/goal-contract/SKILL.md             # new method skill
# read the real perf numbers any time:
grep -a "tony-stark" ~/.argentos/logs/gateway.log | grep -aE "tools=1(0|1)[0-9]" | tail -5
```

---

_Session ended ~bedtime 2026-06-04. Two fixes shipped + closed, Grok recovered, the real perf bottleneck found and half-fixed, and — maybe the most important thing — a working method (`goal-contract`) to stop the drift/overcorrection that's been the core friction. Morning pickup: finish #405 (turn speed), locked via goal-contract._
