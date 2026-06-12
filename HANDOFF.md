# HANDOFF — argent-core session bridge

**From:** 2026-06-11→12 overnight sprint (Claude Fable 5, autonomous; Jason asleep). Supersedes the 2026-06-11 handoff (in git history at 54295c27).
**Branch:** `dev` — P2 (#452, v2026.6.12-dev.0) and P3 (#453, v2026.6.12-dev.1) MERGED; item 3 + closet quick wins on `feat/wr2-idle-salience-gates` (v2026.6.12-dev.2, merging after the idle-soak measurement lands in the PR body).
**Jason's live box: untouched all night.** Every measurement ran on the sandboxed gateway (scratch `ARGENT_STATE_DIR=/tmp/argent-wr2-test` + scratch PG `:5433/argentos_wr2_test`, mdns/keychain/plugins off, port 18999, kill-by-port teardown).

---

## What landed overnight (all measured, details in PR bodies)

| PR                                          | What                                                                                                                                                                                                                                                                                                                                                                                                                           | Proof                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#452 (MERGED)**                           | **WR2 P2** — compiled role profiles + blank-slate ephemeral worker sessions (`agent:<id>:worker:<assignmentId>:<runId>`); `withSessionToolPolicyOverride` deleted; `systemPromptOverride` threaded through the embedded runner                                                                                                                                                                                                 | conductor demo COMPLETED ×2 on gemma-4-12b-QAT; worker system prompt **828 tokens** (wire-captured, law audit: zero operator markers); 3 tool schemas; ~63s dispatch→report; suite at exact baseline 42/134 |
| **#453 (MERGED)**                           | **WR2 P3** — lease lifecycle (claim CAS, runner heartbeat, boot orphan sweep, `execution.worker.halt`) + full runNow semantics; **closes #445**                                                                                                                                                                                                                                                                                | halt→stopped **66ms** (no ack); orphan sweep live-verified ×2 incl. a real killed-mid-flight run; runNow re-queue + `{fresh:true}` supersede drills measured; 7-case lease test suite                       |
| `feat/wr2-idle-salience-gates` (PR pending) | **Item 3** — heartbeat + contemplation idle-salience gates (LIMBIC law 3, kernel `decideTickSalience` reused); config `{heartbeat,contemplation}.salienceGate`/`salienceAnchorHours` registered in types+zod+labels. **Plus closet quick wins:** api-server `ARGENT_PG_URL`/state-dir fix (isolation leak #5) · launchd gateway.log in-process rotation (755MB incident) · known-failing.json 198→191 (2 real fixes, zero new) | gate unit tests 5/5; rotation tests 3/3 (same-inode + tail-preserved); suite exact baseline; idle soak measuring as of ~23:09, evidence lands in PR body                                                    |

**Drill-caught bugs (why live drills matter):** (1) aborts surface as `meta.aborted` normal returns, not exceptions — pre-fix halt re-claimed the task 85ms later; (2) `runNow(fresh)` consumed assignment due-ness before superseding, so the fresh task never cut. Both fixed and re-drilled.

**Behavior changes to know:** grant-less job templates now compile to **work_report-only** workers (the v1 full-registry fallthrough WAS the leak). Interval heartbeats/contemplations now **skip on an idle box** (`no-salience`, anchor default 24h; `salienceGate: false` opts out; exec-event/cron/manual triggers bypass).

## Doctrine inputs (unchanged)

Project memory dir (worker-blank-slate law · machine-purrs-first · cost discipline · sandbox isolation — note its 2026-06-12 update: leak #5 fixed, `ARGENT_WORKER_KEEP_SESSIONS` + `ARGENT_CACHE_TRACE` are the law-audit tools) · `ops/WORKER_RUNTIME_V2_DESIGN_2026-06-11.md` · `/Users/sem/code/evy-mini/EVY-KERNEL-DESIGN.md`.

## Next up (in order)

1. **Merge `feat/wr2-idle-salience-gates`** once the soak numbers are in the PR (self-merge criteria met: suite baseline parity, acceptance measured).
2. **WR2 P4** — `proposed_action` recording (D9), report/telemetry cross-check (owns the late-report-after-supersede residual), run-event log + Workforce Board read (D7). Design locked in the v2 doc.
3. **D8 escalation ladder** — primary → bigger model on no-progress; hooks P3's attempt machinery.
4. **Dependabot P1 bumps** (baileys → protobufjs → one hono sweep → shell-quote) — triage table in the 2026-06-12 vault note; bumps need Jason-awake testing of the WhatsApp channel.

## Live-system facts

- Scratch PG `argentos_wr2_test` (:5433) + `/tmp/argent-wr2-test` intact and re-usable: 6 demo tickets pending, conductor template/assignment, helpers `gw.mjs` (generic RPC), `runnow.mjs`, `worker-dispatch.mjs`. Sandbox config currently has heartbeat/contemplation 30m + `logging.level: debug` for the soak.
- LM Studio on this box (:1234) with `google/gemma-4-12b-qat` @ 80k ctx — all worker measurements used it.
- Suite baseline: **42 failed files / 134 failed tests**; known flakes that fire ±1 under scheduling: `model-auth.test.ts`, `connectors/catalog.test.ts` (both pass in isolation, closet-owned).
- tsc gate baseline: `ops/known-failing.json` at **191** (was 198; refreshed honestly — verified zero new by line-insensitive diff).

## Open decisions awaiting Jason (NOT decided overnight)

- `work_report.need_input` routing (park vs page) · whether `toolsDeny` dies in the grant-only migration · dependabot bump scheduling · Evy Week-1 kickoff (evy-mini session owns it).

## Morning deliverables (done per ground rules)

Vault note `Argent/Daily Updates/2026-06-12 - Overnight sprint - WR2 P2+P3 shipped, fan-spinners gated.md` (incl. dependabot triage table) · closet updated (6 lines) · #445 closed, #425/#423 updated · Loom registry/journal current · ONE voice ping after 07:00 if session alive.
