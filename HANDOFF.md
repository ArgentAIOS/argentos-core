# HANDOFF — argent-core session bridge

**From:** 2026-06-11→12 overnight sprint (Claude Fable 5, autonomous; Jason asleep). Supersedes the 2026-06-11 handoff (in git history at 54295c27).
**Branch:** `dev` @ 963f3eec = **v2026.6.12-dev.2** — clean, pushed. P2 (#452), P3 (#453), and item 3 + closet quick wins (#454) ALL MERGED.
**Jason's live box: untouched all night.** Every measurement ran on the sandboxed gateway (scratch `ARGENT_STATE_DIR=/tmp/argent-wr2-test` + scratch PG `:5433/argentos_wr2_test`, mdns/keychain/plugins off, port 18999, kill-by-port teardown).

---

## What landed overnight (all measured, details in PR bodies)

| PR                | What                                                                                                                                                                                                                                                                                                                                                                                                                           | Proof                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#452 (MERGED)** | **WR2 P2** — compiled role profiles + blank-slate ephemeral worker sessions (`agent:<id>:worker:<assignmentId>:<runId>`); `withSessionToolPolicyOverride` deleted; `systemPromptOverride` threaded through the embedded runner                                                                                                                                                                                                 | conductor demo COMPLETED ×2 on gemma-4-12b-QAT; worker system prompt **828 tokens** (wire-captured, law audit: zero operator markers); 3 tool schemas; ~63s dispatch→report; suite at exact baseline 42/134                                                                             |
| **#453 (MERGED)** | **WR2 P3** — lease lifecycle (claim CAS, runner heartbeat, boot orphan sweep, `execution.worker.halt`) + full runNow semantics; **closes #445**                                                                                                                                                                                                                                                                                | halt→stopped **66ms** (no ack); orphan sweep live-verified ×2 incl. a real killed-mid-flight run; runNow re-queue + `{fresh:true}` supersede drills measured; 7-case lease test suite                                                                                                   |
| **#454 (MERGED)** | **Item 3** — heartbeat + contemplation idle-salience gates (LIMBIC law 3, kernel `decideTickSalience` reused); config `{heartbeat,contemplation}.salienceGate`/`salienceAnchorHours` registered in types+zod+labels. **Plus closet quick wins:** api-server `ARGENT_PG_URL`/state-dir fix (isolation leak #5) · launchd gateway.log in-process rotation (755MB incident) · known-failing.json 198→191 (2 real fixes, zero new) | 62-min idle soak: 2 designed baseline turns at +30m, then **`skip(no-salience)` both runners at +60m — zero inference after the baselines** (was ~96 idle turns/day); the soak caught + fixed a phantom board-delta admit pre-merge; gate tests 7/7, rotation 3/3, suite exact baseline |

**Drill-caught bugs (why live drills matter):** (1) aborts surface as `meta.aborted` normal returns, not exceptions — pre-fix halt re-claimed the task 85ms later; (2) `runNow(fresh)` consumed assignment due-ness before superseding, so the fresh task never cut. Both fixed and re-drilled.

**Behavior changes to know:** grant-less job templates now compile to **work_report-only** workers (the v1 full-registry fallthrough WAS the leak). Interval heartbeats/contemplations now **skip on an idle box** (`no-salience`, anchor default 24h; `salienceGate: false` opts out; exec-event/cron/manual triggers bypass).

## Doctrine inputs (unchanged)

Project memory dir (worker-blank-slate law · machine-purrs-first · cost discipline · sandbox isolation — note its 2026-06-12 update: leak #5 fixed, `ARGENT_WORKER_KEEP_SESSIONS` + `ARGENT_CACHE_TRACE` are the law-audit tools) · `ops/WORKER_RUNTIME_V2_DESIGN_2026-06-11.md` · `/Users/sem/code/evy-mini/EVY-KERNEL-DESIGN.md`.

## Next up (in order)

0. **LIVE-BOX BUG CLUSTER (new #1 — Jason hit this 2026-06-12 ~12:50 after updating to dev.2; his daily-driver chat is flaky):**
   **STATUS 2026-06-12 ~15:00 (Fable session, Jason re-engaged): PR #455 MERGED (33acd593, v2026.6.12-dev.3) — Jason reviewed+merged via this session.** `/compact` wrong-agent fixed in BOTH paths (gateway `commands.compact` used `resolveDefaultAgentId` + no `agentDir` → fell back to `agents/main/agent`; chat handler same missing `agentDir`) with 2 regression tests; doctor now sweeps deprecated CLI profiles from EVERY agent's store raw/unmerged (why main's survived — cleanup only ran on the default store; `updateAuthProfileStoreWithLock` grew a `raw` mode so main creds never smear into agent files); overflow classification now logs the raw provider rejection (the capture half of the discriminator); 2 baseline tsc errors fixed honestly (known-failing 191→189). **After merge+update: rerun doctor (cleans main's stale codex-cli), then retry the codex question — the raw rejection will be in gateway logs** (`prompt error classified as context_overflow ... raw:`). contextTokens staleness likely self-heals on the next successful turn (persist chain refreshes from catalog); verify. #407 operator-lane diet = its own next slice (issue has the locked ordering, option 1 toolkit gating first). Closet updated (3 lines).
   - **Webchat main-session turn failed as "Context overflow"** on openai-codex/gpt-5.5: ~20s on the codex websocket (OAuth JWT injected), zero model activity, then a pi-classified overflow. Input was only ~77k vs the 272k catalog window — likely a misclassified codex/auth/transport rejection (it was the FIRST session after the update retired the deprecated codex-cli auth profile). Discriminator still pending: retry the same question; if it persists, capture the raw rejection (ARGENT_CACHE_TRACE / payload logging).
   - **`/compact` resolves the WRONG AGENT:** for session `agent:argent:main` the compact path resolved bare alias `main` → `agents/main/agent/auth-profiles.json` (Jason has a real agent literally named `main`), found only the DEPRECATED codex-cli profile there → "Compaction skipped: No API key". Fix the alias→agent-id resolution (same landmine sessions_spawn already works around); also clean main's stale codex-cli profile (doctor only cleaned argent's).
   - **Operator-lane prompt diet (#407 operator lane):** Jason's greeting turn cost **76,315 tokens** (120 tool schemas + ~23.5k skills prompt + bootstrap). Workers got the diet in P2; the operator lane never did. This is the structural fix behind all of the above pressure.
   - Cosmetic: main session entry carries stale `contextTokens: 1050000` (from a prior model; catalog says gpt-5.5 = 272k/128k); two state dirs both have launchd logs (`~/.argent` + `~/.argentos` — doctor's "split state dirs" warning).
   - Positive finding while diagnosing: the #454 log rotation already ran on his box (`gateway.log.1` = preserved 8.4MB tail) and #448's ABI heal fixed the better-sqlite3/aos-lcm error during the update.
1. **WR2 P4** — `proposed_action` recording (D9), report/telemetry cross-check (owns the late-report-after-supersede residual), run-event log + Workforce Board read (D7). Design locked in the v2 doc.
2. **D8 escalation ladder** — primary → bigger model on no-progress; hooks P3's attempt machinery.
3. **Dependabot P1 bumps** (baileys → protobufjs → one hono sweep → shell-quote) — triage table in the 2026-06-12 vault note; bumps need Jason-awake testing of the WhatsApp channel.

## Live-system facts

- Scratch PG `argentos_wr2_test` (:5433) + `/tmp/argent-wr2-test` intact and re-usable: 6 demo tickets pending, conductor template/assignment, helpers `gw.mjs` (generic RPC), `runnow.mjs`, `worker-dispatch.mjs`. Sandbox config still has heartbeat/contemplation 30m + `logging.level: debug` left over from the soak — strip before reusing for non-gate work.
- LM Studio on this box (:1234) with `google/gemma-4-12b-qat` @ 80k ctx — all worker measurements used it.
- Suite baseline: **42 failed files / 134 failed tests**; known flakes that fire ±1 under scheduling: `model-auth.test.ts`, `connectors/catalog.test.ts` (both pass in isolation, closet-owned).
- tsc gate baseline: `ops/known-failing.json` at **191** (was 198; refreshed honestly — verified zero new by line-insensitive diff).

## Open decisions awaiting Jason (NOT decided overnight)

- `work_report.need_input` routing (park vs page) · whether `toolsDeny` dies in the grant-only migration · dependabot bump scheduling · Evy Week-1 kickoff (evy-mini session owns it).

## Morning deliverables (done per ground rules)

Vault note `Argent/Daily Updates/2026-06-12 - Overnight sprint - WR2 P2+P3 shipped, fan-spinners gated.md` (incl. dependabot triage table) · closet updated (6 lines) · #445 closed, #425/#423 updated · Loom registry/journal current · ONE voice ping after 07:00 if session alive.
