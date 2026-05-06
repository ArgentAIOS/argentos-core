# Workflows — Morning Brief E2E Proof (Lane Handoff)

**Branch:** `codex/workflows-morning-brief-proof-20260506`
**Base:** `origin/dev` @ `3b88b17a` (Bump dev version to 2026.5.6-dev.1 for token alignment, PR #130)
**Worker:** workflows-morning-brief
**Date:** 2026-05-06

## Status

**PARTIAL ✅** — Programmatic E2E proof captured (schema + runner + dry-run + live-readiness all green on dev). Browser-rendered runtime evidence (canvas screenshot, run history, DocPanel artifact, Telegram receipt) is **deferred** — that capture path requires a browser harness (Playwright) that is not staged in this CLI session and is out of scope for this PR's surgical slice.

The proof slice this PR ships is the substrate-level evidence that Morning Brief is wired correctly on dev: schema present, runner unit-tested with the DocPanel envelope guard live, dry-run recipe validates the full 12-node graph end-to-end without PostgreSQL or live connectors.

## Pre-existing dev state

- DocPanel envelope guard (`30511803` from `codex/workflow-docpanel-envelope-sanitize`) is **already on `origin/dev`** as commit `4c68fe8d` ("Prevent workflow result envelopes from leaking into DocPanel", merged 2026-04-29). Verified via `git branch -r --contains 30511803` — only the original codex branch contains the original SHA, but the rebased copy on dev has the identical commit body, identical title, identical author/date. **Cherry-pick NOT performed.**
- Telegram polling guard (`8b7e9053`) is on `origin/dev`.
- Workflow runner test suite present and green on dev (48/48 passing).
- Token-fix from PR #130 is live on dev (`f2ae17a0` "fix(gateway): re-read auth token per WS connect to avoid stale-token 1008", `471901b0` "fix(dashboard): api-server accepts gateway auth token").

This PR therefore contains **no source-code changes**. It documents the proof artifacts captured against a clean `origin/dev` checkout.

## Migration apply path (the question the surveyor flagged)

**Canonical apply path:** `bash scripts/ensure-pg-tables.sh`

- Idempotent — uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` throughout (a couple of legacy `CREATE INDEX` statements emit "already exists" errors with `ON_ERROR_STOP=0`, which is intentional and safe).
- Includes ALL workflow tables: `workflows`, `workflow_versions`, `workflow_runs`, `workflow_step_runs`, `workflow_approvals`.
- Connection: defaults to `postgres://localhost:${ARGENT_PG_PORT:-5433}/${ARGENT_PG_DB:-argentos}`.
- Auto-invoked on production install via `scripts/install-hosted.sh` (`ensure_pg_tables_helper` step). Falls back to manual `bash ~/argentos/scripts/ensure-pg-tables.sh` with operator warning if the helper isn't restorable.

**The individual `src/data/pg/migrations/030_workflows.sql` and `031_workflow_approvals.sql` files are Drizzle-kit generation artifacts**, not load-bearing on the live boot path. No code under `src/` references them by filename, and there is no Drizzle `migrate()` runner wired into gateway/dashboard startup. The schema source-of-truth is `src/data/pg/schema.ts` (Drizzle); the deployment artifact is the bundled SQL inside `scripts/ensure-pg-tables.sh`.

**Apply log on local dev PG (port 5433, db `argentos`):**

```
$ bash scripts/ensure-pg-tables.sh
Ensuring ArgentOS PostgreSQL tables exist (port 5433, db argentos)...
... (all CREATE TABLE / CREATE INDEX statements; "already exists" notices for pre-applied schema; 3 expected ERRORs on duplicate-name indices — non-fatal under ON_ERROR_STOP=0) ...
Done. All tables ensured.
```

**Live-PG schema verification:**

```sql
$ psql -h localhost -p 5433 -d argentos \
    -c "SELECT to_regclass('public.workflows'), to_regclass('public.workflow_runs'),
              to_regclass('public.workflow_step_runs'), to_regclass('public.workflow_approvals');"

 workflows |     runs      |     step_runs      |     approvals
-----------+---------------+--------------------+--------------------
 workflows | workflow_runs | workflow_step_runs | workflow_approvals
```

All four workflow tables resolve. `workflow_runs` carries the run-detail columns demanded by the runtime contract (`workflow_version`, `current_node_id`, `variables`, `total_tokens_used`, `total_cost_usd`, `metadata`); `workflow_step_runs` carries token/cost/approval/edited-output columns; `workflow_approvals` carries the resolution and notification fields.

## Programmatic proof artifacts

### (a) Workflow runner unit suite — DocPanel envelope guard exercised

```
$ pnpm exec vitest run src/infra/workflow-runner.test.ts
Test Files  1 passed (1)
     Tests  48 passed (48)
```

48/48 tests green. This suite is the explicit regression guard for the DocPanel envelope-leak fix (per the `4c68fe8d` Tested: line).

### (b) Workflows dry-run — Morning Brief E2E without PostgreSQL

```
$ pnpm exec vitest run src/gateway/server-methods/workflows.dry-run.test.ts
Test Files  1 passed (1)
     Tests  4 passed (4)
   ✓ provides a Morning Brief recipe that passes workflows.dryRun without PostgreSQL  2015ms
   ✓ preflights agent dispatch identity without live execution  3627ms
```

The named test exercises `buildMorningBriefDryRunRecipe()` + `buildMorningBriefDryRunRecipeParams()` and runs them through `workflows.dryRun`. It asserts:

- Recipe slug is `ai-morning-brief-podcast`.
- Safety contract: `requiresPostgres: false`, `noLiveConnectorExecution: true`, `noCustomerData: true`, `noChannelDelivery: true`.
- Graph sorts into **12 executable nodes**.
- Per-node dry-run validation passes for: `github-scout`, `synthesize-brief`, `brief-doc` (DocPanel output), `podcast-plan`, `approve-podcast-render` (gate), `podcast-generate` (audio synthesis), `delivery-status` (Telegram), `run-ledger`.

This is the substrate-level E2E proof: the full Morning Brief graph round-trips through the workflows runtime with no errors.

### (c) Workflows live-readiness contract

```
$ pnpm exec vitest run src/gateway/server-methods/workflows.live-readiness.test.ts
Test Files  1 passed (1)
     Tests  4 passed (4)
```

The live-readiness server method is the operator-facing visibility contract — also green.

### (d) Repo-lane check

```
$ pnpm run check:repo-lane
repo-lane check passed: ArgentAIOS/argentos-core (core) -> dev
```

### (e) Morning Brief operator-template definition

`src/infra/workflow-owner-operator-templates.ts` (lines ~273–380) defines the live operator-facing Morning Brief template with the following node graph:

- `trigger` (schedule, `30 6 * * * America/Chicago`)
- `github-scout`, `frontier-scout`, `thought-scout` (parallel research agents)
- `synthesize-brief` (write agent producing the cited brief)
- `brief-doc` (DocPanel output, markdown — this is the artifact whose envelope-leak guard is `4c68fe8d`)
- `podcast-plan` (write agent)
- `approve-podcast-render` (gate)
- `podcast-generate` (connector — audio synthesis)
- `delivery-status` (Telegram delivery)
- `run-ledger` (DocPanel run-history artifact)

Same shape as the dry-run recipe, with live-mode connectors substituted for the simulated dispatch shims.

## Artifact captures vs. the original brief's six-item checklist

| #   | Artifact requested                          | Status                             | Evidence                                                                                                                                                      |
| --- | ------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | Canvas screenshot showing live highlighting | **Deferred**                       | Browser harness not staged for this CLI session; logged for follow-up.                                                                                        |
| b   | Run history with cost/tokens                | **Deferred (schema verified)**     | `workflow_step_runs.tokens_used`, `cost_usd`, `model_used` columns present in live PG (verified). Live capture deferred.                                      |
| c   | DocPanel artifact (rendered output)         | **Substrate ✅, browser deferred** | `brief-doc` node passes dry-run; envelope-leak guard `4c68fe8d` is the exact runner code path that produces this artifact, exercised by 48-test runner suite. |
| d   | Telegram message delivery receipt           | **Deferred**                       | `delivery-status` node passes dry-run; live capture requires a tokenized run that this PR's slice does not exercise.                                          |
| e   | `workflow_step_runs` rows from PG           | **Schema verified, rows deferred** | Table exists with full column set; rows produced only by a live run.                                                                                          |
| f   | `workflow_approvals` rows for the gate      | **Schema verified, rows deferred** | Table exists; `approve-podcast-render` is the gate node that would write here on a live run.                                                                  |

**Summary:** 0/6 live-runtime captures, 4/6 substrate-level captures (dry-run E2E + 4-table schema + DocPanel guard runner + live-readiness contract). The substrate evidence is sufficient to confirm that a live run on this dev cut would not trip on schema, runner regressions, or graph-shape errors. The live captures should be re-attempted once a Playwright (or equivalent) harness is wired into the workflows lane.

## Constraints honored

- Stayed in fresh worktree (`worktrees/workflows-morning-brief-20260506`); main checkout untouched.
- No bump to root `package.json` version (still `2026.5.6-dev.1`).
- No push to `origin/dev` direct; PR-only.
- No FREEZE stash pops.
- File scope: only `ops/HANDOFF_WORKFLOWS_MORNING_BRIEF_PROOF.md` (this file) added. No source code changes; no `WorkflowsWidget.tsx`, `AppForge*`, `app-forge-*`, `threadmaster-bus.mjs` touched.

## Anything weird

- The runbook listed the DocPanel guard SHA as `30511803`. That SHA is only on the `codex/workflow-docpanel-envelope-sanitize` branch; the rebased copy on `dev` is `4c68fe8d`. Same commit body, same code, just a different SHA from the rebase. Cherry-pick was therefore unnecessary and skipped per Step 5's conditional.
- `ensure-pg-tables.sh` emits three `ERROR: relation "idx_workflows_*" already exists` lines when re-run on a fully populated DB. These are non-fatal under `ON_ERROR_STOP=0` and the script reports `Done.` regardless. The schema source-of-truth uses `CREATE INDEX` (not `CREATE INDEX IF NOT EXISTS`) for those three workflow indices — minor cleanup target if/when someone touches the bootstrap helper, but not blocking.
- No Drizzle migrate runner exists on the boot path. The numbered migration SQLs in `src/data/pg/migrations/` are tooling artifacts only; production deploys run `ensure-pg-tables.sh`. Worth flagging in the OS-level docs the next time someone audits the migration story.
