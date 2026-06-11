# HANDOFF — argent-core session bridge

**From:** 2026-06-10 evening session (Claude Fable 5; resumed on fresh account after usage ceiling)
**Branch:** `feat/business-into-core-2026-06-10` — based on `origin/dev` @ `8f84de96`
**Theme:** Jason's reset: "merge all business logic back into core, one source of truth" → recon (7 agents) → distillation merge **LANDED, VERIFIED GREEN, SPINE PROVEN** (see ORCHESTRATION.md "Verification evidence"). PR to dev in flight. Lane 2 DONE: #405 read-side fix shipped as PR #436 (measured: critical-path reads 2/turn → 0/turn warm).

> **Status supersedes the sections below** (written mid-interruption, kept for context): slice C is DONE (real 1264-line execution worker union-merged, server.impl.ts static imports, dead twins deleted), green loop DONE (206 TS errors all-baseline vs dev's 216; suite fixes 9 dev-failing files, adds 0), cleanup wave DONE (loaders/public-core machinery deleted; AGENTS.md/.argent-repo.json/README/boundary-doc rewritten to one-repo reality), runtime smoke DONE (gateway boots clean; license real round-trip non-blocking; **governed spine ran end-to-end on fresh Postgres: template → assignment → orchestrator task → worker dispatch → blocked simulate run with review pending**). Version bumped 2026.6.10-dev.0.

## Decisions made THIS session (all logged in ORCHESTRATION.md decision log)

1. **Open source approved** — Jason consulted Richard. Revenue = Titanium services (clients pay for install/run). `ArgentAIOS/argentos-core` is PUBLIC; pushing business code is intentional. Push/PR cleared.
2. **Positioning:** ArgentOS = _governed agent workforce for businesses_ — NOT a Hermes/OpenClaw personal-agent race. Stability/governance/audit is the moat.
3. **Distillation merge** (Jason chose over mechanical): real modules verbatim, slop filtered, spine must RUN.
4. License machinery merges but deprioritized + strictly non-blocking. No gating work.
5. `src/workforce/jobs.ts` (legacy SQLite JobsModule) NOT merged; delete its orphan test `src/data/jobs.test.ts` instead (still TODO).
6. **#405 turn-speed promoted to co-equal goal** — Jason: "turns are painful." Deliver a measured number.

## State of the merge (read `ops/BUSINESS_MERGE_LANDING_MAP_2026-06-10.md` — the canonical plan)

Recon found the merge is SMALL: gateway handlers byte-identical already in core; storage/tables/tests already in core; only ~13 impl files needed + seam conversion. Optional loaders NEVER resolved in bundled runtimes (recon-proven) → all converted to static imports.

**On disk in `abf1340a` (UNVERIFIED — no tsgo/tests/lint run yet):**

- ✅ 5 tools at `src/agents/tools/`, static-imported in `argent-tools.ts`, public-core blocklist removed, `argent-tools-core.ts` deleted
- ✅ Intent: `src/agents/{intent-simulation,intent-runtime-gate}.ts` landed; `src/infra/intent-simulation-{runner,scenarios-t1}.ts` replaced (fake all-pass stub GONE); `intent-core.ts`, `intent-runtime-gate-core.ts`, `intent-cli-core.ts` deleted; static imports in `server-methods/intent.ts` + `optional-intent.ts`
- ✅ `src/infra/job-orchestrator-runner.ts` landed; bridge converted to static import
- ✅ `src/licensing/` (8 files); `server-startup.ts` static import; `license-core.ts` deleted; `org-scope.ts` + `tsdown.config.ts` updated
- ✅ Dashboard: WorkforceBoard + WorkerFlowModal + worker-wizard landed; bridges rewired; `configSurfaceProfile.ts` flipped; `App.tsx` + sentinel test + OrgChartWidget edited
- ❌ **INCOMPLETE — slice C remainder:** `src/infra/execution-worker-runner.ts` union-merge NOT done (core's 178-line facade still in place; Business's 1264-line real runner at `/Users/sem/code/ArgentOS-Business/src/workers/execution-worker-runner.ts` not yet merged; core's evolved helpers must win; keep tsdown standalone entry; consumers: server-close.ts, server-reload-handlers.ts, 4 passing helper tests). Also: `server.impl.ts:219-224` loaders NOT yet converted; `execution-worker-runner-core.ts` not deleted; `src/data/jobs.test.ts` not deleted.

## Next session — exact order

1. Finish slice C (above). Then `git status` sanity vs landing map's "What LANDS" table.
2. **Green loop:** `pnpm tsgo` (baseline = 216 errors on clean dev, count in `/tmp/tsgo-baseline-count.txt`; expect ≤216, several known-failing seam errors should CLEAR); targeted vitest: 7 formerly-orphan tests + 4 execution-worker helper tests + `argent-tools.public-core.test.ts` + `dashboard-surface-profile.test.ts`; then full unit suite vs dev baseline; `pnpm lint`; `node scripts/check-invariants.mjs`; `cd dashboard && npx tsc -b --noEmit` (own project, not covered by root tsgo).
3. **Cleanup wave (slice F):** delete `src/agents/optional-tool-factory.ts` + `src/utils/optional-module.ts` IF importerless now; public-core export machinery (`scripts/export-public-core.ts`, `src/infra/public-core-export.ts`, `public-core-denylist.test.ts` — already failing on dev); docs/sentinels: `AGENTS.md:5,9` (lane-lock still bans business in core — now false), `.argent-repo.json:6`, `docs/concepts/core-business-boundary.md`, `README.md:133-141`, `ops/AGENT_PERSONA_ONBOARDING_PROMPT.md:73`.
4. **Runtime smoke:** `pnpm gateway:dev` boots clean with NO license file; spine demo: jobs template → assignment → `jobs.assignments.runNow` dispatches execution worker (simulate mode); `intent.simulate` returns a REAL report.
5. Dev version bump (`YYYY.M.D-dev.N` per AGENTS.md contract) + push + PR to dev. Push is CLEARED (decision #1).
6. **Lane 2 #405** on `perf/personal-skill-critical-path-405` (@ d5bd5e5d, has writes-fix + `personal_skills` marker): per-agent TTL(60s)+write-invalidated cache wrapping `{reviewPersonalSkillCandidates → listPersonalSkillCandidates(50)}` — the review is an O(N) serial PG chain, 24 candidates rewritten per turn observed, 30k rows in personal_skill_reviews; cache-miss fill joins QW-1 batch (results first consumed attempt.ts:872, dependency-clean); invalidate at 5 mutation sites (personal-skill-tool.ts, server-methods/skills.ts, live-inbox/capture.ts, sis-runner.ts, recordPersonalSkillUsage). ~250 LOC. Measure warm turn <200ms via `[tony-stark]` lines in `~/.argentos/logs/gateway.log` (run `pnpm gateway:dev` + `pnpm tui` — persistent process needed for warm turns).

## Recon artifacts (do NOT redo recon — it's done and paid for)

- Landing map: `ops/BUSINESS_MERGE_LANDING_MAP_2026-06-10.md`
- Full 7-agent recon JSON (175KB): `/private/tmp/claude-501/-Users-sem-code-argent-core/ae3b70e2-17ca-47cc-aebc-b8edbbc477e4/tasks/w1wmhq3s4.output`
- Interrupted landing workflow (5 slices, resumable but slices are mostly on disk — cheaper to just finish slice C by hand): run `wf_31ddadc8-3a4`, script at `.../workflows/scripts/business-into-core-landing-wf_31ddadc8-3a4.js`

## Sticky notes

- Pre-commit hook runs check-invariants (passed at abf1340a). Root `pnpm tsgo` does NOT cover dashboard/.
- `pnpm check:loc` (500-line cap) is NOT in CI — WorkforceBoard 3818 lines landed as-is; splitting = logged follow-up.
- Worker-wizard may still be unmounted (slice E was mid-flight) — check for a mount point + the seven fetchLocalApi conversions.
- ArgentOS-Business + ArgentOS-Legacy repos: read-only sources, do not delete (Jason's call).
- Memory saved: `project_argentos_open_source_positioning.md` (the strategy reset).
