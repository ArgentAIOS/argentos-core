# Orchestration Log — argent-core shift-three wave 1

**Session:** 2026-05-19 morning (continuation from 2026-05-18 shift-two)
**Orchestrator:** primary pane
**Protocol start:** 2026-05-19T13:15Z
**Autonomy:** CLAUDE_AUTONOMY=full — operator approval gates overridden
**Note:** This file was clobbered when oxlint-batcher's `git checkout -b` reset the working tree at ~13:20Z. Restored here.

## Wave 1 status

| ID  | Task                                   | State     | Worker            | Outcome                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------- | --------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | #185 earendil-works PR re-poke         | ✅ done   | `earendil-poker`  | Upstream PR #4277 was CLOSED 2026-05-07 (never merged, before moratorium ended). #185 closed as obsolete with reference comment. No upstream comment posted.                                                                                                                             |
| T2  | #360 AppForge parity — scope a finding | ✅ done   | `appforge-scoper` | Issue **#376** filed: `[appforge][parity] Phone field type (mirrors email/url validation pattern)`. Effort: 2-3h. Spec includes 5 file paths + validation regex + dropdown entry + gotcha about email regex duplication.                                                                 |
| T3  | #283 oxlint bulk-fix wave              | 🔁 fix-it | `oxlint-batcher`  | PR **#377** open, base=dev, head=chore/oxlint-curly-bulk-fix-2026-05-19. `curly` rule, 5862→2188 errors initially (-3674). Build CI failing on 9 files with pre-existing TS errors flagged by `tsc-since`. Fix-it dispatched: revert curly fix on those 9 files only, keep on other 330. |

## Verification (orchestrator-side, before marking tasks done)

- **T1**: `gh pr view 4277 --repo earendil-works/pi --json state,closedAt,mergedAt` → `{state: CLOSED, closedAt: 2026-05-07, mergedAt: null}` ✓
- **T2**: `gh issue view 376 --repo ArgentAIOS/argentos-core --json number,state,title` → `{number: 376, state: OPEN, title: "[appforge][parity] Phone field type..."}` ✓
- **T3**: `gh pr view 377 --repo ArgentAIOS/argentos-core --json statusCheckRollup` → all checks SUCCESS except `checks (node, build, pnpm build)` = FAILURE. Failure log shows 24 pre-existing TS errors in 9 files (TS2353, TS18048, TS2349, TS2345, TS2322, TS2741, TS7006, TS2307, TS2352). Fix-it dispatched to scope the curly-fix away from those 9 files.

## Wave 1 closeout — 2026-05-19T14:07Z

| Task           | Outcome                                                                                                                                                                                                                                                             | Verify                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| T1 #185        | ✅ Closed as obsolete. Upstream PR #4277 was already CLOSED 2026-05-07.                                                                                                                                                                                             | https://github.com/ArgentAIOS/argentos-core/issues/185 |
| T2 #360 → #376 | ✅ Issue #376 filed with full implementation spec (Phone field).                                                                                                                                                                                                    | https://github.com/ArgentAIOS/argentos-core/issues/376 |
| T3 #283 → #377 | ✅ **PR #377 merged to dev** (commit `df08867e`). 3 commits — initial curly fix + 2 reverts after discovering tsc-since baseline pre-existing TS error collision. Final scope: 136 files in dashboard/(99) + scripts/(21) + extensions/(13) + tools/(3); zero src/. | https://github.com/ArgentAIOS/argentos-core/pull/377   |

Worker shutdowns sent to `earendil-poker`, `appforge-scoper`, `oxlint-batcher`. Team `argent-core-wave1` retained for wave 2 dispatch.

**Lesson captured for future waves:** `tsc-since` flags pre-existing TS errors on ANY file in the diff. Bulk-fix waves that touch broad swaths of `src/` will hit this. Two-line preventive rule for next time: any oxlint bulk-fix PR should be scope-limited to directories outside `src/` (where the 217-error baseline lives), OR do a pre-scan of `pnpm tsgo` errors per file and exclude any file with pre-existing errors from the fix list.

## Wave 2 closeout — 2026-05-19T14:21Z

| Task           | Outcome                                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T4 #376 → #378 | ✅ PR #378 opened by `phone-fielder`. 10 files (+236/-2). Substrate `isValidPhoneInput` shared by gateway validator + GridCellEditor (no regex duplication). Auto-merge enabled, CI in flight. https://github.com/ArgentAIOS/argentos-core/pull/378 |

Worker confirmed 3 pre-existing test failures on dev (about saved-view "gantt"/"list" assertions from #374) are orthogonal — confirmed by checking out clean origin/dev: 211 pass + same 3 fails. Flagged in PR body as separate baseline-cleanup chore.

Worker also added 2 files beyond the scoper's 5-file spec (`useForgeStructuredData.ts` for `ForgeFieldType` union mirror, `AppForge.tsx` for editor/display dispatch). Both forced by the acceptance criterion — without them the new editor is dead code or TS errors at `field.type === "phone"` switches. Correct call.

CSV auto-inference of phone-typed columns (parallel to `emailLike`/`urlLike` in `app-forge-import.ts`) intentionally deferred — not in the spec's acceptance criteria. Flagged for future chore.

Worker shutdown sent.

## Wave 2 final result — 2026-05-19T14:22Z

- **PR #378 merged** to dev at `21c9be1b`. Phone field type shipped. #376 closed by merge.
- All wave 2 verification clean: 11 checks SUCCESS, 5 SKIPPED, 0 failure.
- `phone-fielder` shutdown sent. Team `argent-core-wave1` retains lead but all workers terminated.
- **Meta-issue #360 updated** with status sweep comment — 7 of 31 original findings now resolved (entire view-mode parity row + first field type).

## Session totals (2026-05-19 morning, autonomous orchestrator)

| Metric                                      | Count                                                              |
| ------------------------------------------- | ------------------------------------------------------------------ |
| PRs merged                                  | **3** (#375 MemU multimodal, #377 oxlint curly, #378 phone field)  |
| Issues closed by merge or directly          | **3** (#311, #185, #376 — last closes on merge)                    |
| Issues filed                                | **1** (#376, since closed)                                         |
| Workers dispatched                          | 4 (earendil-poker, appforge-scoper, oxlint-batcher, phone-fielder) |
| Workers shutdown clean                      | 4                                                                  |
| Worker fix-it rounds                        | 2 (oxlint-batcher tsc-since collision)                             |
| Verification failures escalated to operator | 0                                                                  |
| Vault notes touched                         | Portfolio.md + (this) ORCHESTRATION.md + handoff snapshot          |

## Wave 3 result — 2026-05-19T14:35Z

| Task                | Outcome                                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T5 #296+#297 → #379 | ✅ PR #379 opened by `provider-surfacer`. 6 files +333/-7. Surfaces groq + xAI/Grok in onboarding (CLI + dashboard wizard via regenerated seed); demotes inception to post-install-only per #297 Option B. Auto-merge enabled. https://github.com/ArgentAIOS/argentos-core/pull/379 |
| Follow-up #380      | ✅ Filed. CLI apply-handlers for `xai-api-key` + `groq-api-key` need wiring (worker used local `ExtendedAuthChoice` widening as workaround since `onboard-types.ts` was outside the constraint scope). ~1-2h fix. https://github.com/ArgentAIOS/argentos-core/issues/380            |

Worker confirmed 32/32 tests green on changed files; 109 pre-existing failures in `src/agents` / `src/commands` tests confirmed orthogonal (baseline-checked against origin/dev).

`provider-surfacer` shutdown sent.

## Wave 4 result — 2026-05-19T15:08Z

| Task               | Outcome                                                                                                                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T6 #380 → #381     | ✅ PR #381 merged. 8 files in `src/commands/`, +495/-22. Drops the `ExtendedAuthChoice` workaround #379 used; adds xai/groq to canonical `AuthChoice` union; mirrors zai-api-key apply pattern. CLI end-to-end now persists xai + groq API keys. https://github.com/ArgentAIOS/argentos-core/pull/381 |
| Manual issue close | ✅ #297 manually closed (GitHub's auto-link only matched "closes #296" from PR #379's body, not "closes #296 #297" tail). Comment on the issue cites the PR + PR #381 chain.                                                                                                                          |

`handler-wirer` shutdown sent.

## Final session totals (2026-05-19, 15:10Z)

| Metric                              | Count                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **PRs merged**                      | **5** (#375 MemU multimodal · #377 oxlint curly · #378 phone field · #379 groq+xai onboarding · #381 CLI apply-handlers) |
| **Issues closed**                   | **6** (#311 · #185 · #376 · #296 · #297 · #380)                                                                          |
| **Issues filed**                    | **2** (#376 · #380 — both since closed)                                                                                  |
| **Workers dispatched / shutdown**   | 6 / 6 (earendil-poker, appforge-scoper, oxlint-batcher, phone-fielder, provider-surfacer, handler-wirer)                 |
| **Fix-it rounds**                   | 1 (oxlint-batcher tsc-since collision)                                                                                   |
| **Verification failures escalated** | 0                                                                                                                        |
| **Meta-issue #360 updated**         | Status sweep — 7 of 31 findings now resolved                                                                             |

## Stop point

Backlog is genuinely drained of easy wins. Remaining open issues are either:

- External watchers (#184, #183 — wait for upstream / OpenAI)
- Product-call blocked (#314, #315)
- Big work needing scope (#208 marketplace, #106 session continuity, #103 starter family)
- Deferred (#373 gantt v1.1 substrate, #283 oxlint long-tail — could continue but diminishing returns)
- Meta-tracker (#360)

Holding here for operator direction.

| Slice | Issue       | Type                                | Notes from orchestrator recon                                                                                                                                                                                                                                                                                                                |
| ----- | ----------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W3-A  | **#184**    | Likely close as won't-fix           | `src/agents/models-config.ts:113` + `src/agents/argent-models-override.ts:9` carry the local override "until pi-ai catches up — #4275". Upstream #4275 + #4277 were CLOSED 2026-05-07 without merging. pi-ai is NOT going to ship it natively. The override is permanent. Action: close #184 with explanation rather than drop the override. |
| W3-B  | #183        | Investigate first                   | `gpt-5.5-instant` not found in src/agents/. Might be already dropped from registry. Worker checks dashboard/configs too. Likely close as obsolete.                                                                                                                                                                                           |
| W3-C  | #297 + #296 | Investigate + small UI fix or close | `groq` at line 345 and `inception` at line 305 in `src/agents/provider-registry-seed.ts`. xAI grok models at lines 798/807. Need to check SetupWizard onboarding to see which providers are surfaced to first-run UI.                                                                                                                        |

Wave 3 likely yields 2 issue-closes (#184, #183) and 1 small PR or another close (#297/#296). All low-effort.

**Concurrency note for wave 3:** All three slices touch `src/agents/` files. Phone-fielder is on a different branch but the working tree just switched there. Will dispatch wave 3 AFTER phone-fielder PR merges + I return to dev.

## Wave 2 plan (archived — phone field, complete)

| Slice | Issue    | Type                 | Notes                                                                         |
| ----- | -------- | -------------------- | ----------------------------------------------------------------------------- |
| W2-A  | **#376** | Implement            | Phone field — spec already complete from T2 scoper. ~2-3h.                    |
| W2-B  | #297     | Investigate + config | Surface `groq`+`inception` in onboarding OR remove from registry seed. ~1-2h. |
| W2-C  | #296     | Investigate + config | xAI/Grok onboarding — wire fully or drop dashboard meta entry. ~1-2h.         |
| W2-D  | #184     | Conditional drop     | Drop local gpt-5.5-chat-latest override IF pi-ai ships it natively. <1h.      |
| W2-E  | #183     | Conditional update   | Update gpt-5.5-instant pricing IF OpenAI has published it. <1h.               |

**Concurrency note:** W2-A touches `dashboard/src/components/app-forge/`, `src/infra/app-forge-*.ts`, `src/data/.../app-forge-*`. W2-B/C touch `src/agents/provider-registry-seed.ts` + dashboard onboarding. W2-D/E touch `src/agents/models-config.providers.ts` or similar pricing tables. Probably parallel-safe; will confirm file scopes before dispatch.

## Decision Log

| Time (UTC)       | Decision                                                            | Rationale                                                                                                                                                                 | Reversible?                          |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 2026-05-19T13:15 | Run 3 backlog slices in parallel via team workers                   | Operator invoked autonomous orchestrator mode; non-overlapping scopes; drain rate matters                                                                                 | Yes                                  |
| 2026-05-19T13:15 | Excluded smoke-tests of #371/#372 from this wave                    | Need running ArgentOS + Telegram credentials; not safe for generic worker                                                                                                 | Yes                                  |
| 2026-05-19T13:53 | Closed #185 on our side as obsolete                                 | Worker confirmed upstream PR was closed 2026-05-07, before moratorium ended; re-poke premise no longer applies                                                            | Yes — can reopen if needed           |
| 2026-05-19T13:55 | Dispatched fix-it to oxlint-batcher rather than dropping PR #377    | Build failure is pre-existing-TS-errors-in-touched-files (tsc-since), not regression. Scoping out 9 files preserves ~330-file curly fix. Cheaper than reverting whole PR. | Yes — can drop PR if fix-it fails    |
| 2026-05-19T13:58 | Killed leaked vite (PID 15371) from yesterday's gantt smoke session | Pure resource cleanup, no state to preserve                                                                                                                               | Yes — `pnpm dev` re-spawns instantly |

## Verification Evidence (after wave 1 closes)

- T1: https://github.com/ArgentAIOS/argentos-core/issues/185 — closed-comment timestamp + verification link to upstream
- T2: https://github.com/ArgentAIOS/argentos-core/issues/376 — new focused issue
- T3: https://github.com/ArgentAIOS/argentos-core/pull/377 — final mergeable state TBD after fix-it

## Notes on shared-working-tree issue

`oxlint-batcher`'s `git checkout -b chore/... origin/dev` switched the orchestrator's branch too (single working tree). My uncommitted ORCHESTRATION.md (untracked) survived the branch switch but was clobbered when the worker ran `oxlint --fix` across the tree (probably from `pnpm format` writing a different content set into the same path, or git-clean'd somewhere). For future waves, two safer patterns:

1. **Commit ORCHESTRATION.md to a dedicated coordination branch** before dispatching workers, so it's tracked + recoverable
2. **Use git worktrees** for workers — adds back the worktree-count we just pruned (yesterday's ENFILE post-mortem), but isolates state cleanly

Decision deferred to operator. Logging here so it doesn't get lost.

---

# Session — 2026-05-24 evening → 2026-05-25 morning

**Operator:** Jason
**Assistant:** Claude Opus 4.7
**Mode:** solo (single pane, no team workers dispatched — small to medium PRs, sequential)
**Branch target:** `dev` (all PRs squash-merged via `gh pr merge --auto`)

## Theme

Operator chat turn in argent-tui hit a 27s timeout with `timeout acquiring session store lock`. Status bar showed `tokens 81k/400k`. Operator's framing: "Argent is slower than it's ever been." Investigation grew to cover sessions.json bloat, AppForge polling, dashboard auth (Settings panels empty), agent pipeline overhead, `argent update` UX, TinyFish surface gaps, and a post-update better-sqlite3 ABI mismatch.

## PRs shipped

| PR   | Title                                                                               | Notes                                                                                        |
| ---- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| #409 | `perf(gateway): cache appforge.bases.list 60s + invalidate on writes`               | Stopgap before #408 full N+1 fix. ~5s/web-turn saving.                                       |
| #411 | `fix(dashboard): fetchJsonWithRetry attaches auth header`                           | One-line behavior fix in ConfigPanel.tsx.                                                    |
| #412 | `perf(sessions): dedup skillsSnapshot to sidecar + auto-prune stale workflows`      | 423-line PR. Additive type change + content-addressed sidecar + lazy migration + auto-prune. |
| #414 | `fix(update): honest clean-check + ignore regenerated artifacts + show dirty paths` | Three sub-bugs fixed: lying label, missing pathspec, opaque skip message.                    |
| #415 | `feat(tools): first-class tinyfish_search tool`                                     | New `tinyfish_search` tool + wiring + 8 unit tests.                                          |

## Manual fixes (not in git)

- Pruned operator's `~/.argentos/agents/argent/sessions/sessions.json` from 98 MB to 15.5 MB via `/tmp/argent-sessions-cleanup.mjs`. Backup left at `sessions.json.bak.pre-cleanup-2026-05-25T02-00-31-737Z`.
- Force-rebuilt operator's better-sqlite3 native module under Node 22.22.2 to fix post-`argent update` ABI mismatch (root cause filed as #416).

## Issues filed for follow-up

| #    | Class                              | Notes                                                                            |
| ---- | ---------------------------------- | -------------------------------------------------------------------------------- |
| #400 | UX bug                             | silent 401 cascade — dashboard falls to empty-state with no banner               |
| #401 | Bug                                | dashboard localStorage filling to quota (chat history blobs)                     |
| #402 | Feature                            | in-chat OAuth re-auth recovery banner                                            |
| #403 | Bug                                | (shipped in #411)                                                                |
| #404 | Bug                                | static-server proxy stale-Referer token precedence                               |
| #405 | Perf umbrella                      | "agent 4× slower than subctl" tracker                                            |
| #406 | **Perf — biggest remaining lever** | agent session + 113-tool registry rebuilt every turn                             |
| #407 | **Perf — second biggest lever**    | all 113 tools in every prompt regardless of intent                               |
| #408 | Perf                               | AppForge N+1 → single `jsonb_agg` + SSE invalidation (proper fix on top of #409) |
| #410 | (shipped in #412)                  | leftover: don't hold session lock across update callback                         |
| #413 | (shipped in #414)                  |                                                                                  |
| #416 | Bug                                | `pnpm rebuild` downloads wrong-ABI prebuild when shell Node ≠ gateway Node       |

## Decision Log

| Time (CDT)         | Decision                                                                                           | Rationale                                                                                                                | Reversible?                                   |
| ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 2026-05-24 evening | Branch the dashboard-canvas-bridge investigation in favor of the operator-visible chat speed issue | Operator pivoted; speed was the more pressing pain                                                                       | Yes                                           |
| 2026-05-24 evening | Ship cache-side stopgap for AppForge (#409) before structural N+1 fix (#408)                       | 30-line PR vs ~1 day SQL refactor; operator unblocked tonight                                                            | Yes — #408 still planned                      |
| 2026-05-24 evening | Use additive `skillsSnapshotHash` field vs replacing `skillsSnapshot`                              | 20+ readers above store layer; replacement would balloon a half-day PR to ~1500 lines                                    | Yes — followup can collapse later             |
| 2026-05-24 evening | Manually prune `sessions.json` before #412 ships                                                   | Operator hitting live lock timeouts; can't wait for next `argent update`                                                 | Yes — backup preserved                        |
| 2026-05-25 ~01:00  | Pause #403 in-progress branch when operator surfaced more urgent session-store-lock failure        | Bigger user-visible bug                                                                                                  | Yes — branch resumed and shipped same session |
| 2026-05-25 ~02:00  | Auto-prune workflow sessions at 30 days default                                                    | Workflow runs from completed cron are write-once and rarely re-read; balances retention vs steady-state size             | Yes — operator can override via env var       |
| 2026-05-25 ~05:00  | Add `tinyfish_search` rather than just enabling `tinyfish_agent`                                   | Argent specifically asked for Search to be first-class; agent flag is separate decision                                  | Yes                                           |
| 2026-05-25 ~06:00  | Hand off rather than continue into #406/#407                                                       | Reasoning quality degrades on accumulated context; #406/#407 are substantial enough to benefit from a fresh orchestrator | N/A                                           |

## Sticky notes for the next session

See `/Users/sem/code/argent-core/HANDOFF.md` for the full bridge, and `~/Documents/Obsidian Vault/Argent/Performance/2026-05-24 to 25 - Perf Sprint.md` for the durable record.

---

# Session — 2026-06-10 evening: business-into-core merge-back (autonomous)

**Operator:** Jason (away; full autonomy granted: "combine everything into Argent... merge it back into core. One source of truth.")
**Assistant:** Claude Fable 5, ultracode mode
**Branch:** `feat/business-into-core-2026-06-10` off `origin/dev` @ `8f84de96`

## Locked contract

```
=== LOCKED CONTRACT — business-into-core ===
GOAL: argent-core is the single source of truth for all Argent business logic — every
ArgentOS-Business module merged in as first-class core code, repo builds/tests green,
gateway boots clean with no license file present.
ACCEPTANCE:
  - All ArgentOS-Business src modules (licensing, governance, workforce, workers, tools,
    gateway handlers) land in argent-core at paths core's existing seams resolve
    (both loadOptionalExport hooks light up; no orphaned `unavailable_in_core` for merged surfaces).
  - 4 orphaned tool tests in src/agents/tools/ pass against merged implementations;
    the 14 Business test files run green under core's vitest.
  - Dashboard duplicates reconciled (LicensePanel, JobsBoardWidget, OrgChartWidget,
    worker-wizard landed); dashboard builds.
  - pnpm tsgo + pnpm lint + targeted tests green (vs dev baseline); pnpm gateway:dev boots clean.
  - AGENTS.md lane-lock + ops docs updated to one-repo reality.
LANE 2 (#405): personal_skills phase <200ms on 2nd+ turn (measured via marker); same skills matched.
NON-GOALS:
  - License SERVER work (argent-marketplace endpoints, heartbeat, kill-switch).
  - Private npm registry / overlay distribution (S-4 packaging plan — superseded by this merge).
  - New entitlement/tier design; license checks stay non-blocking.
  - Deleting ArgentOS-Business / ArgentOS-Legacy repos (Jason's call later).
  - Rust gateway, mobile apps, installer.
BUDGET: this session, run-until-done per Jason. Per-slice tripwire below.
TRIPWIRE: any slice needing a NEW core subsystem (not reconstruction of known seams),
or 3+ failed fix attempts on the same error → park that slice, log owned in closet,
continue other slices.
=== Work only to this contract. ===
```

## Decision Log

| Time (CDT)       | Decision                                                                                                                                                                                                                                                                                                                                                        | Rationale                                                                                                                                                                                 | Reversible?                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 2026-06-10 17:30 | Interpret "merge business logic back into core" as: land ArgentOS-Business code in argent-core as first-class code; retire overlay scaffolding (business-overlay.json, contract-draft, register dry-run)                                                                                                                                                        | Jason's explicit words: "one source of truth"; overlay/private-registry plan (S-1..S-7) stalled a month; core's loadOptionalExport seams already expect these files                       | Yes (git)                                     |
| 2026-06-10 17:30 | Keep license machinery as core code but strictly non-blocking; no entitlement hard-gating wired this session                                                                                                                                                                                                                                                    | "Get Argent working" — dev installs must boot licenseless; gating policy is Jason's later call                                                                                            | Yes                                           |
| 2026-06-10 17:30 | Update AGENTS.md lane-lock ("business must not be assumed in this repo") as part of merge                                                                                                                                                                                                                                                                       | Doc encodes the superseded split decision; leaving it contradicts the new source-of-truth reality                                                                                         | Yes                                           |
| 2026-06-10 17:30 | Base on origin/dev (8f84de96), not the #405 branch; #405 read-fix is lane 2                                                                                                                                                                                                                                                                                     | Keep merge reviewable against dev; #405 is separately shippable                                                                                                                           | Yes                                           |
| 2026-06-10 17:30 | ArgentOS-Business + ArgentOS-Legacy repos untouched (read-only sources)                                                                                                                                                                                                                                                                                         | Deleting is irreversible — operator's call                                                                                                                                                | n/a                                           |
| 2026-06-10 17:50 | **DISTILLATION merge confirmed by Jason** (not mechanical): real modules verbatim; oversized files split to pass the 500-line check on entry; dual license-write paths collapsed; 3k-line dashboard panels rebuilt lean; assignment→claim→governed-run spine WIRED end-to-end                                                                                   | Jason's direct words: worried about "slop and too much code"; chose distillation from offered options                                                                                     | Yes                                           |
| 2026-06-10 17:50 | **#405 turn-speed promoted to co-equal goal** — deliver a measured number by morning                                                                                                                                                                                                                                                                            | Jason: "The turns on just talking to the agent are painful. I wanted the Jarvis experience."                                                                                              | Yes                                           |
| 2026-06-10 17:50 | ~~PUSH GATE: argentos-core is PUBLIC~~ — **CLEARED 18:05 by Jason**: "I've already talked to Richard about it. People are still going to pay us... to install it and run it... It doesn't matter." Revenue model = Titanium services (install/run for clients), not license sales. Open-sourcing approved; push/PR to public repo proceeds normally when green. | Operator decision, Richard consulted                                                                                                                                                      | Operator call                                 |
| 2026-06-10 18:05 | License machinery merges in but is DEPRIORITIZED as a product surface (no gating work, panel is low-value); product story = open-source governance OS + paid Titanium services                                                                                                                                                                                  | Follows from the services model                                                                                                                                                           | Yes                                           |
| 2026-06-10 18:20 | **Positioning (discussed with Jason): ArgentOS = the governed agent workforce for businesses, deployed/operated by Titanium — NOT a competitor to Hermes/OpenClaw personal-agent runtimes.** Pace-of-updates race explicitly not played; stability/governance/audit is the moat. Reaffirms the 2026-06-04 "narrow to the governance spine" decision.            | Jason's pace fear ("it's just me and you") + recon evidence: jobs/intent-sim/gates/approvals/onboarding-pack surfaces exist in no competing runtime                                       | Strategy note                                 |
| 2026-06-10 18:25 | src/workforce/jobs.ts (legacy SQLite JobsModule) NOT merged; its orphan test src/data/jobs.test.ts deleted instead                                                                                                                                                                                                                                              | Core architecturally replaced it with PgJobAdapter; SQLite adapter throws on all job ops by design                                                                                        | Yes (file preserved in Business/Legacy repos) |
| 2026-06-10 18:25 | All 6 optional-loader seams converted to static imports; \*-core twin stubs + public-core export machinery deleted                                                                                                                                                                                                                                              | Recon proof: relative-specifier loaders return null in EVERY bundled runtime (dist flat chunks) — features were silently dead even in Legacy; one open repo needs no public/private split | Yes                                           |

## Task ledger

Tracked via session TaskList (recon → landing map → 5 landing slices → green loop → runtime smoke → docs/PR → #405 lane). See task tool state.

## Verification evidence (2026-06-10 evening, before PR)

| Gate                                                            | Result                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm tsgo`                                                     | **206 errors, all pre-existing baseline** (clean dev = 216; merge cleared 10 known-failing entries — copilot.ts:225, server.impl.ts:1025/:1077, 4× execution-worker TS18046, jobs-orchestrator.ts:64, intent-runtime-gate-core, intent-cli.ts:65 — added 0)                                                                                                                            |
| Full vitest suite vs clean-dev worktree                         | dev: 144 failed/51 files. Merge: **fixes all 9 dev-failing orphan/denylist files, adds 0 new failures** (10 transient memory-test fails were my mid-run better-sqlite3 breakage; all 10 pass on re-run)                                                                                                                                                                                |
| Targeted merge-area tests                                       | 49/49 + 10/10 runner tests green                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm lint` (changed files)                                     | 0 errors (79 pre-existing in 23k-line App.tsx documented, untouched lines)                                                                                                                                                                                                                                                                                                             |
| `node scripts/check-invariants.mjs`                             | 3/3 pass                                                                                                                                                                                                                                                                                                                                                                               |
| Dashboard `tsc -b`                                              | 77 errors vs 140 on dev (lib→ES2023 fix cleared 69 incl. all 6 merge-introduced)                                                                                                                                                                                                                                                                                                       |
| Runtime smoke (isolated gateway, scratch state, fresh local PG) | Boots clean; license validation non-blocking + real round trip (`license valid (pro, org: Titanium Computing)`); intent runner static-loaded; **full governed spine ran: template → assignment → orchestrator task → worker dispatch (`job-orchestrator-due`) → JobRun row (simulate, reviewStatus=pending, correctly blocked w/o LLM key, relationship-contract metadata populated)** |

### Real bugs found during smoke (filed to closet, not merge regressions)

1. **Fresh-PG bootstrap gap:** orchestrator task insert fails FK `tasks_agent_id_agents_id_fk` until an `agents` row exists; nothing seeds `main` on a fresh database. Also: no migrate runner at boot — fresh PG needs `drizzle-kit push` + migrations + ensure-pg-tables.sh by hand.
2. **State-dir isolation leaks:** `src/licensing/license.ts` and the aos-lcm extension read `~/.argentos` directly, ignoring `ARGENT_STATE_DIR`.
3. **Keychain prompt storm:** scratch-state gateways/tests trigger macOS "Keychain Not Found" dialogs repeatedly (master-key store). Workaround `ARGENT_KEYCHAIN_DISABLE_WRITE=1`; interrupted Jason's evening — every future scripted run must set it.
4. better-sqlite3 in this checkout was built for an absent Node ABI (141) — silently broke sqlite-dependent paths under shell Node 22 (#416 family). Rebuilt.
