# HANDOFF — argent-core session bridge

**From:** 2026-07-02 session (Fable 5) — _approval-system integrity + Workforce P5_. Supersedes the 2026-06-16 unit-suite bridge (that work merged as PR #461; its carried items are resolved or re-filed below).

---

## TL;DR — what happened this session

Two lanes, both **merged to `dev` and DEPLOYED + LIVE-VERIFIED** (gateway running+healthy):

1. **Approval-system integrity (PRs #462 + review-hardening).** Root-caused the Telegram approval flood: the "MSP Morning Podcast 2" workflow had **self-replicated into 143 copies** (11 active, cron-firing 7 AM daily) because workflow agents got the full 121-tool set — `toolsAllow` was prompt prose, not policy. Fixed four production bugs: Telegram **Deny resumed runs as approved** (now a shared fail-closed deny path), **approval timeouts never fired** for durable runs (now swept with atomic claim + compensation + orphan sweep; `timeout_action='approve'` deliberately fails closed until gated on operator sign-off), **send_email swallowed all failures** (empty recipient/unknown provider/retry-exhaustion now fail the step — the old retry check `length===0 && items[0]` was unsatisfiable), and **toolsAllow now enforced structurally** via session-entry seeding (same seam as WR2 ephemeral workers; session keys got a random suffix against same-ms collisions; `sessions.toolsAllow` is fail-closed in pi-tools). Live cleanup executed: 143 dupes parked, 70 zombie approvals + 70 frozen runs cancelled, 12 cron entries disabled, two active workflows' empty `to:` backfilled, Morning Brief Podcast 2.0 parked, stale plist `DASHBOARD_API_TOKEN` scrubbed.
2. **Workforce P5 — D10 grading (PR #463).** Append-only `job_grade_events` (PG-native per lock), pure gate math (`src/infra/worker-grading.ts`: **≥95% correct over ≥50 graded, sustained 14d**, exact integers, dip resets clock, **gate informs / never auto-promotes**), gateway `jobs.grades.record|approveAll|list` + `jobs.scorecard`, Workforce Board grading panel + scorecard/gate chip. Review round fixed: gate now reads the FULL grade history (a default LIMIT 5000 asc froze it on the oldest window → permanent false "eligible"), and batch grades get per-row +1ms offsets so sustain-clock resets are deterministic.

- **Branches:** all merged; `dev` HEAD `d94d5c08`. Deploy = `~/argentos` ff → `scripts/out-of-sync-patch.sh` (gateway runs the installed snapshot, NOT the repo).
- **Live-verified:** `job_grade_events` + 3 indexes created by adapter init; grade round-trip on P4 regression run `9d42b3dd-8da1…` → scorecard 1/1 (100%), gate `needs 49 more`; unknown-run grade rejected fail-closed.
- **Trunk is `dev`, not `main`** (PRs → dev; main is ancient).

## Verify before trusting

```bash
argent gateway status                          # running+healthy, RPC probe: ok
argent gateway call jobs.scorecard --params '{"templateId":"34490eb5-2cf8-42e5-bbea-b4d5fe4507e6"}'
pnpm test:unit                                 # 7,820+ passed (now includes grading suites)
node scripts/tsc-since.mjs                     # 0 net-new (189 baseline)
```

## Next steps (in order)

1. **Prove D9 live**: create/enable a simulate assignment on a **write-granting** role → `proposed_action` events fire → they become the first real gradable components (Workforce Board run panel now has ✓/±/✗ + approve-all).
2. **Re-enable the repaired MSP keeper** when Jason wants it: workflow `4a4a8932` (definition fixed: recipient, `{{steps.agent-draft.text}}`, de-poisoned rolePrompt) is INACTIVE; flip `is_active` + `argent cron enable e1193528-…`. Tomorrow 7 AM is otherwise silent by design.
3. Remaining hardening backlog: **Follow-Up Closet → "argent-core — approval-system hardening leftovers (filed 2026-07-02)"** (Morning Brief 2.0 wiring, Three-Scout DocPanel 503s, silent notification failures, stale-runs sweep, workflows.resume replay guard, arm timeoutAction:'approve' behind operator sign-off, builder tool-name normalization, Brave 1req/s).
4. **Open design Qs for Jason** (WR2 doc §8): need_input routing, lease TTL sanity vs DGX models, drop legacy toolsDeny?

## Gotchas for the next session

- **Budget discipline:** Jason flagged $250/session burn from workflow-subagent fleets. Use `model: "sonnet"` / `effort: "low"` on verify/mechanical workflow stages; no fleets past ~80% of a session window (memory: `feedback-lean-orchestration-budget`).
- Keychain "Reset To Defaults" modal during tests = keychain shell-out guard missing on that branch (fixed on dev; never click Reset).
- `gh pr merge` can detach the main checkout's HEAD (happened once; `git branch -f <branch> HEAD && git switch <branch>`).
- Grades are append-only — never add UPDATE/DELETE paths; the gate's math depends on full ordered history (no default LIMIT on `listGrades`).

---

_Full record: Obsidian vault `argenos-core/Daily Updates/2026-07-02`, Follow-Ups & To-Dos closet, PRs #461 #462 #463._
