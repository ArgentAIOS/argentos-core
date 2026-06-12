# HANDOFF — argent-core session bridge

**From:** 2026-06-11 all-day session (Claude Fable 5: v2 design → 5 shipped contracts; the 6/10 handoff is superseded, in git history)
**Branch:** `dev` @ `fb726ece` = **v2026.6.11-dev.5** — clean, pushed, deployed to Jason's live box (snapshot synced, gateway restarted, kernel quiet verified live at 02:30:49Z)
**Mission:** OVERNIGHT SPRINT (Jason's explicit authorization, 2026-06-11 ~21:45: "a really big sprint… throughout the night while I'm sleeping"). Work the backlog below in order, one locked contract at a time.

---

## What landed today (all on dev, all measured)

| PR/commit                                    | What                                                                                                                                                                                                                       | Proof                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| #447                                         | Worker native tool calls + `promptMode:"minimal"` worker lane (#442/#407)                                                                                                                                                  | worker prompt 40k→2,056 tokens; native `tools` field on the wire                                               |
| #450                                         | `work_report` completion contract (v2 D5) + **the dropped-customTools fix** (`createAgentSession` ignored `options.customTools` — NO custom tool executed on the embedded pi_only path; masked by boardChanged acceptance) | conductor demo **COMPLETED on gemma-4-12b-QAT**, 2,934-char triage log on the run record, zero board mutations |
| #451                                         | Kernel deterministic salience gate (LIMBIC law 3) + self-stimulation guard (`origin: background` zero-weighted for salience)                                                                                               | 60-min soak: 117 ticks, 0 inference; natural A/B: old code burned ~25 reflections same hour, same LM Studio    |
| #448                                         | Updater runs native rebuilds under the gateway's pinned Node + ABI verify/heal                                                                                                                                             | closes #416                                                                                                    |
| fb726ece                                     | Update unstick (regenerated artifacts blocked rebase → box stuck on dev.1 two days) + disableImageTool flags actually implemented                                                                                          | Jason's box updated dev.1→dev.5 minutes later                                                                  |
| `ops/WORKER_RUNTIME_V2_DESIGN_2026-06-11.md` | The flagship design: D1–D11, Pi-Conductor + LIMBIC addenda; P1 + P4-lite delivered with measured numbers                                                                                                                   | Jason approved; Pi gate numbers + PG-native grades LOCKED                                                      |

**Doctrine inputs (read before working):** project memory dir (worker-blank-slate law incl. position-ledger refinement · machine-purrs-first · cost discipline · sandbox gateway isolation · autonomy: pick next work, no menus), the v2 design doc above, and `/Users/sem/code/evy-mini/EVY-KERNEL-DESIGN.md` (LIMBIC/1 — Jason wants its DNA in everything kernel/worker).

## OVERNIGHT BACKLOG — in order, one locked contract each

### 1. Worker Runtime v2 P2 — blank-slate ephemeral sessions + role profiles (THE flagship, due before 6/22)

```
=== LOCKED CONTRACT ===
GOAL: Worker runs execute in ephemeral role-scoped sessions built FROM the
template (v2 D1+D2) — the worker prompt provably contains ONLY company
alignment + role contract + granted tools + granted knowledge; the
withSessionToolPolicyOverride mutate/restore hack dies.
ACCEPTANCE:
  - Role profile compiled per (templateId, version): system prompt = alignment
    block + rolePrompt + SOP + successDefinition + mode directives + tool
    rules; tool set = grants + work_report; cached, invalidated on edit
  - Worker session is ephemeral per run (worker:<assignmentId>:<runId>, or via
    the sessions_spawn seam), never the agent main session; discarded after
  - withSessionToolPolicyOverride deleted; grant filtering structural
  - Prompt-cleanliness test BY INSPECTION (the law): the worker transcript
    contains zero SOUL/IDENTITY/memory/skills/operator text beyond the profile
  - Conductor demo still COMPLETES on gemma-4-12b-QAT (sandboxed gateway,
    isolation flags); worker prompt stays ≤2.5k tokens
  - Full suite at dev baseline parity (42/134 + the documented model-auth flake)
NON-GOALS: P3 (leases), P5 (grading), position-ledger retrieval, dashboard,
cross-process workers.
BUDGET: the night's big rock — ~10 files. TRIPWIRE: if the sessions_spawn
seam can't carry it without refactoring the spawn machinery itself, ship the
profile-compile + prompt-cleanliness half and report the ripple.
RULES: house rules + sandbox isolation flags + API_PORT override + never seed
via :9242. Report against ACCEPTANCE in the PR body before merging.
=== Work only to this contract. ===
```

### 2. P3 — lease lifecycle (claim/heartbeat/halt + full runNow semantics) — only if P2 lands clean

Design is locked: v2 doc D4+D6 (CAS claim + TTL, runner-side heartbeat, alive handshake, kill flag, boot-time orphan sweep; runNow re-queues the blocked task by default, `{fresh:true}` supersedes). Closes #445 properly, advances #425. Same rules. ~Half a night; skip without guilt if P2 consumed it.

### 3. Heartbeat + contemplation deterministic gating (the remaining fan-spinners)

Same LIMBIC treatment as #451: ~96 full idle agent turns/day between them (30m defaults each). Salience/presence-gate them with first-class skip reasons; config semantics preserved. Inventory in PR #451's body.

### 4. Closet quick wins (only if time remains)

- api-server.cjs ignores `ARGENT_PG_URL` (isolation leak #5 — caused a live-board incident this week; see closet)
- gateway.log rotation (the 755MB incident)
- dependabot triage pass (148 vulns, 11 critical — repo is public now)

## Overnight ground rules (Jason-specific)

- **NO voice pings 23:00–07:00** (he is sleeping; mirror his Evy quiet-hours constants). Morning deliverables instead: vault note `Argent/Daily Updates/2026-06-12 - Overnight sprint….md` (follow the 6/11 note's shape: shipped / honest findings / morning checklist / open follow-ups) + ONE voice ping after 07:00 if the session is still alive.
- **His LIVE box is hands-off** — no `argent update`, no gateway restarts, no writes to `~/.argentos` or his PG (`postgres://localhost:5433/argentos`). Test gateways: scratch `ARGENT_STATE_DIR` + `ARGENT_DISABLE_BONJOUR=1` + `ARGENT_KEYCHAIN_DISABLE_WRITE=1` + `ARGENT_SKIP_PLUGINS=1` + `API_PORT≠9242` + `ARGENT_PG_URL=<scratch db on :5433>` + kill-by-port teardown. The dashboard api child connects to HIS PG regardless (known leak) — never seed through it.
- **Merging:** PRs to dev; self-merge when (a) full suite at baseline parity, (b) acceptance measured and written in the PR body, (c) version bump per AGENTS.md (`2026.6.12-dev.N`, start dev.0). Matches the #444 overnight precedent. Anything irreversible or outward-facing beyond this repo waits for morning.
- **Cost discipline** (memory): one contract at a time; no parallel fleets without a named payoff. Five subscriptions exist; the constraint is judgment, not tokens.
- **Update-flow knowledge:** Jason's install = git clone `/Users/sem/argentos` (NOT `/Users/sem/code/argent-core`, the dev workspace) → runtime snapshot at `~/.argentos/lib/node_modules/argentos`; `/Users/sem/bin/argent` shim sets `ARGENT_GIT_DIR`. Never run `argent update` with cwd inside the dev workspace.

## Live-system facts (verified tonight)

- LM Studio on THIS box (M5 Max) :1234, `google/gemma-4-12b-qat` loaded at 80k ctx. The M3 Ultra (256GB, tailnet) is the designated cognition host going forward (needs LM Studio network serving enabled).
- Scratch PG `argentos_wr2_test` on :5433 still exists (6 demo tickets + work_report-SOP template + assignment `6aabe019-fe73-4b82-876c-71dbd5c3bec8`). Sandbox state dir `/tmp/argent-wr2-test` intact — reusable for P2 measurement. WS helper: `/tmp/argent-wr2-test/runnow.mjs` (connect handshake requires `client.id: "test"` literally).
- Suite baseline: 42 failed files / 134 failed tests on dev; `model-auth.test.ts` flakes +1 under any scheduling change (closet-owned, passes in isolation). The `pi-tools.ts:396` net-new tsc error is FIXED as of fb726ece.
- Open issues touched today: #445 (P0 shipped; full semantics = P3), #446 (config auto-migrate doesn't persist), #449 (closed twin of #450).

## Open decisions awaiting Jason (do NOT decide overnight)

- v2 design: `work_report` `need_input` routing (park vs page); whether `toolsDeny` dies in the grant-only migration.
- Evy Week-1 kernel build kickoff (separate project; the evy-mini session owns it).
- Dependabot triage priorities.
