# Business → Core Landing Map (2026-06-10)

**Decision (Jason):** merge all business logic into argent-core as first-class code — one source of truth, open-source posture (Richard consulted; revenue = Titanium services). Distillation merge: no slop, everything that lands must run.

**Recon basis:** 7-agent sweep 2026-06-10 (~1.06M tokens). Full output: session task `w1wmhq3s4`.
**Baseline:** dev @ `8f84de96`, 216 pre-existing TS errors (`ops/known-failing.json` snapshot), 8 orphan tests failing, 3 other tests failing (public-core-denylist fixture missing, etc.).

## What is ALREADY in core (no copy needed)

- All 5 gateway handlers (`src/gateway/server-methods/{jobs,jobs-orchestrator,execution-worker,copilot,intent}.ts`) — byte-identical to Business copies, registered, live.
- All workforce storage: `job_templates/job_assignments/job_runs/job_events` in `src/data/pg/schema.ts:721-823`, full `JobAdapter` (`src/data/adapter.ts:313-371`), `PgJobAdapter` self-bootstraps tables. No migrations needed. The `business_*`-prefixed migrationPreview in business-overlay.json is dead.
- All 14 Business test files (byte-identical, colocated). `exec-approval-forwarder` — core's is NEWER (DI-based), Business copy superseded, do not touch.
- Dashboard `LicensePanel` / `JobsBoardWidget` / `OrgChartWidget` — core copies NEWER; Business copies are stale Legacy snapshots. Skip (one exception below).

## What LANDS (file → destination)

| #   | From (ArgentOS-Business)                                                           | To (argent-core)                              | Notes                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1-5 | `src/tools/{jobs,workforce-setup,onboarding-pack,copilot-system,intent}-tool.ts`   | `src/agents/tools/`                           | un-orphans 4 tests; all imports verified RESOLVE                                                                                                                                                                                                                                                                                                 |
| 6   | `src/governance/intent-simulation.ts`                                              | `src/agents/intent-simulation.ts`             | un-orphans test                                                                                                                                                                                                                                                                                                                                  |
| 7   | `src/governance/intent-runtime-gate.ts`                                            | `src/agents/intent-runtime-gate.ts`           | replaces drifted 63-line `-core` stub; un-orphans test                                                                                                                                                                                                                                                                                           |
| 8   | `src/governance/intent-simulation-runner.ts`                                       | `src/infra/intent-simulation-runner.ts`       | REPLACES 75-line fake-all-pass stub; must keep exporting `loadScenariosFromFile` + scenario type (intent-cli.ts)                                                                                                                                                                                                                                 |
| 9   | `src/governance/intent-simulation-scenarios-t1.ts`                                 | `src/infra/intent-simulation-scenarios-t1.ts` | replaces empty stub; clears known-failing intent-cli.ts:65                                                                                                                                                                                                                                                                                       |
| 10  | `src/workforce/job-orchestrator-runner.ts`                                         | `src/infra/job-orchestrator-runner.ts`        | un-orphans test; clears known-failing jobs-orchestrator.ts:64                                                                                                                                                                                                                                                                                    |
| 11  | `src/workers/execution-worker-runner.ts`                                           | `src/infra/execution-worker-runner.ts`        | UNION-MERGE: Business runner internals + core's evolved helper exports (`buildWorkerTaskSnapshot`, `buildExecutionWorkerStatusHint`, changed `buildPersonalSkillCandidateInputFromTaskOutcome`) consumed by server-close.ts / server-reload-handlers.ts + 4 passing tests. Stays a tsdown standalone entry. Split >500-line result into modules. |
| 12  | `src/licensing/{client,manager,storage,crypto,secret-sync,license,types,index}.ts` | `src/licensing/`                              | `src/plugins/org-scope.ts:35` already expects `../licensing/storage.js`. Startup stays NON-BLOCKING.                                                                                                                                                                                                                                             |

**NOT merged (distillation):**

- `src/workforce/jobs.ts` — legacy SQLite JobsModule, architecturally replaced by PgJobAdapter. Its orphan test `src/data/jobs.test.ts` is DELETED instead.
- `src/contract-draft/`, `src/register.ts`, `business-overlay.json` — dead overlay scaffolding.
- `src/governance/exec-approval-forwarder.ts` — superseded by core's newer DI version.
- Business dashboard `LicensePanel/JobsBoardWidget/OrgChartWidget` — core's are newer. Exception: port the `operatorName` prop into core's OrgChartWidget (core hardcodes "Jason" at :572).

## Seam conversion (loaders → static imports)

Recon proved every relative-specifier optional loader returns null in ALL bundled runtimes (dist flat-chunk layout) — these features were silently dead even in Legacy. Business code is now first-class, so:

- `src/gateway/server-startup.ts:30-32` → static import `validateLicenseOnStartup`
- `src/gateway/server-methods/intent.ts:11-18` → static import `runIntentSimulation`
- `src/gateway/server.impl.ts:219-224` → static imports (execution-worker runner + exec-approval forwarder)
- `src/gateway/job-orchestrator-bridge.ts` → static import `startJobOrchestratorRunner`
- `src/agents/argent-tools.ts:157-175` → static tool imports (delete `loadOptionalToolFactory` usage)
- `src/agents/optional-intent.ts` → static imports
- DELETE dead twins: `license-core.ts`, `intent-core.ts`, `argent-tools-core.ts`, `execution-worker-runner-core.ts` (post union-merge), `intent-runtime-gate-core.ts` + public-core export machinery (`scripts/export-public-core.ts`, `src/infra/public-core-export.ts`, denylist test — already failing on dev).
- `src/agents/public-core-tools.ts` `PUBLIC_CORE_BUSINESS_BLOCKED_TOOL_NAMES` — remove business-name blocking (else merged tools stay invisible); update sentinel test `argent-tools.public-core.test.ts`.

## Dashboard

- Land `WorkforceBoard.tsx`, `WorkerFlowModal.tsx` → `dashboard/src/components/`; swap null bridges (`WorkforceBoardBridge.ts`, `WorkerFlowModalBridge.ts`) to re-export real components.
- Flip `isWorkforceSurfaceAllowed` (configSurfaceProfile.ts:90-93); update sentinel `src/dashboard-surface-profile.test.ts:79-96`; fix stray JSX artifact `App.tsx:5460`.
- `worker-wizard/` → `dashboard/src/components/worker-wizard/`; convert seven raw `fetch("/api/...")` → `fetchLocalApi()` (INV-2 check-invariants hard-fails otherwise); minimal mount from the workforce surface.
- Lint hazard: incoming files need curly/format fixes (root oxlint covers dashboard).
- api-server.cjs license endpoints (now :19983-20296): fallback file paths active; cheap fix = add licensing/manager as tsdown standalone entry so existing delegation resolves; keep fallback. License surface DEPRIORITIZED (services model).

## Verification gates

1. `pnpm tsgo` — error count ≤ 216 (expect DECREASE: known-failing entries for the seams clear).
2. Targeted vitest: 8 formerly-orphaned tests pass (minus deleted jobs.test.ts → 7); 6 already-passing stay green; full unit suite no regression vs dev.
3. `pnpm lint` + `node scripts/check-invariants.mjs` green.
4. `pnpm gateway:dev` boots clean with NO license file; spine smoke: template → assignment → runNow dispatches the (simulate-mode) execution worker; intent.simulate returns a REAL report (no fake pass).
5. Docs/sentinels updated: AGENTS.md:5,9; .argent-repo.json:6; docs/concepts/core-business-boundary.md; README.md:133-141; ops/AGENT_PERSONA_ONBOARDING_PROMPT.md:73.

## Lane 2 (#405) — separate branch `perf/personal-skill-critical-path-405`

Per-agent TTL(60s) + write-invalidated cache wrapping `{reviewPersonalSkillCandidates → listPersonalSkillCandidates(50)}` (the review is an O(N) serial PG chain — 24 candidates rewritten per turn observed), cache-miss fill joins the QW-1 parallel batch (dependency-clean: results first consumed at attempt.ts:872), invalidation at 5 mutation sites. ~250 LOC. Measure: `personal_skills` marker in `[tony-stark]` gateway.log lines, warm-turn target <200ms.
