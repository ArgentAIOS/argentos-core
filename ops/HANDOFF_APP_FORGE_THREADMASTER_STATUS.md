# AppForge 2.0 Threadmaster Status

## Lane Lock

Repo: `ArgentAIOS/argentos-core`
Local path: `/tmp/argent-core-appforge-threadmaster`
Target branch: `dev`
Forbidden repo for this task: `ArgentAIOS/argentos`
Reason: pure core foundation work

## Current Position

AppForge is past the mock-shell stage and is now a usable single-user, metadata-backed workspace. Phase 1 is late-stage foundation work; Phase 2 now has a pure core model, an expanded adapter contract, and an initial `appforge.bases.*` gateway surface. Durable storage and table/record-level gateway migration are still pending.

Latest pushed AppForge commits:

- `e3fc0496 Define the AppForge adapter contract`
- `737de016 Lock down AppForge structured metadata behavior`
- `3bac9914 Introduce the AppForge core model foundation`

## Phase Progress

- Phase 1, workspace MVP: roughly 75-80% complete.
- Phase 2, first-class data domain: started, roughly 20-25% complete.
- Phase 3, grid/saved view quality: partially started early through typed editors plus per-view filter/sort/group controls.
- Phase 5, workflow event bridge: producer/consumer foundation is stronger than expected; coverage and targeted resume hardening remain.
- Phase 6, permissions/audit: design risk identified; do not ship multi-user semantics until actor binding and AppForge-specific authorization exist.

## Team Findings

### Phase 1 Coverage

Core AppForge coverage already existed for workflow capabilities, workflow event normalization, workflow builder behavior, and AppForge-triggered workflow starts. The main gap was dashboard/AppForge structured-data coverage.

Completed in this run:

- Added regression coverage for metadata-backed default base projection.
- Added regression coverage for legacy structured metadata normalization.
- Added typed value coercion coverage for AppForge structured fields.
- Added dashboard API negative-path checks for missing AppForge workflow event type and unknown apps.

Remaining Phase 1 test gaps:

- Real hook tests for table/field/record mutation calls and emitted event payloads.
- Component/browser tests for AppForge UI persistence, delete guards, and workflow event failure state.
- Manual browser smoke remains required until the UI test harness is wired.

### Phase 2 Data Domain

AppForge is not first-class core storage yet. Structured data still lives under `metadata.appForge.structured`; capabilities are still projected from metadata paths. The adapter contract is the first explicit storage seam, and `appforge.bases.*` is now the first gateway boundary over that seam, but it is still backed by an in-memory reference implementation only.

Completed in this run:

- Added `src/infra/app-forge-adapter.ts`.
- Added `src/infra/app-forge-adapter.test.ts`.
- Expanded the adapter contract to table and record operations.
- Added `src/gateway/server-methods/app-forge.ts`.
- Added `src/gateway/server-methods/app-forge.test.ts`.
- Registered `appforge.bases.list`, `appforge.bases.get`, `appforge.bases.put`, and `appforge.bases.delete` for discovery and gateway auth.
- Added `src/infra/app-forge-model.ts`.
- Added field/value model types.
- Added field-aware record validation for text, long text, select, multi-select, number, date, checkbox, URL, email, attachment, and linked-record placeholders.
- Added revision conflict checking.
- Added compatibility projection from legacy metadata-backed structured apps into a core base.

Next Phase 2 slices:

- Add PG/schema migration plan and tests.
- Expand gateway server-method surface from base CRUD to tables/fields/views/records.
- Migrate dashboard from whole-app metadata PATCHes to core AppForge operations once server methods exist.

### Workflow Bridge

The bridge is already wired through metadata/events only:

- AppForge producers emit canonical `forge.*` events.
- Dashboard API forwards to `workflows.emitAppForgeEvent`.
- Workflow side normalizes, broadcasts, starts matching `appforge_event` workflows, and resumes targeted waits.

Completed in this run:

- Added normalization coverage for all six canonical `forge.*` event types.
- Added malformed AppForge trigger filter coverage.

Remaining gaps:

- End-to-end dashboard API tests for record create/update/delete event submissions.
- Explicit targeted resume tests for `workflowRunId` + `nodeId`.
- Validate the mixed table id convention: `dashboard_apps` for app records vs structured table ids for base records.

### Permissions And Audit

Current gateway write scope is too coarse for mature AppForge. `workflows.emitAppForgeEvent` is behind generic `operator.write`, and approval identity can be caller-supplied text.

Security review marked this as a hard pre-multi-user gate, not a blocker for the current single-operator base gateway foundation.

Completed in this run:

- Added `src/infra/app-forge-permissions.ts`.
- Added `src/infra/app-forge-permissions.test.ts`.
- Defined the pure actor envelope, ACL roles, permission checks, and audit event builders.

Do not treat Phase 6 as ready until:

- AppForge has owner/editor/viewer policy checks.
- Event ingress carries trusted actor/workspace/app context.
- Approval identity binds to authenticated connection/device, not request body.
- Audit rows include role snapshot, session/device context, before/after or diff hash, and rollback target.

## Verification From This Run

Passing:

- `pnpm check:repo-lane`
- `pnpm exec vitest run src/infra/app-forge-adapter.test.ts src/infra/app-forge-permissions.test.ts src/gateway/server-methods/app-forge.test.ts src/infra/app-forge-model.test.ts src/infra/appforge-workflow-events.test.ts src/gateway/server-methods/workflows.appforge-events.test.ts src/infra/appforge-workflow-capabilities.test.ts src/infra/app-forge-structured-data.test.ts`
- `pnpm exec vitest run src/gateway/server-methods/app-forge.test.ts src/infra/app-forge-adapter.test.ts src/infra/app-forge-model.test.ts src/infra/appforge-workflow-events.test.ts src/gateway/server-methods/workflows.appforge-events.test.ts`
- `pnpm exec vitest run src/infra/app-forge-model.test.ts src/infra/app-forge-structured-data.test.ts src/infra/appforge-workflow-events.test.ts src/infra/appforge-workflow-capabilities.test.ts src/gateway/server-methods/workflows.appforge-events.test.ts`
- `node --test --test-name-pattern='Apps' dashboard/tests/api-server.test.cjs`
- `pnpm exec oxlint --type-aware src/infra/app-forge-adapter.ts src/infra/app-forge-adapter.test.ts src/infra/app-forge-permissions.ts src/infra/app-forge-permissions.test.ts src/gateway/server-methods/app-forge.ts src/gateway/server-methods/app-forge.test.ts`
- `pnpm exec oxlint --type-aware src/gateway/server-methods/app-forge.ts src/gateway/server-methods/app-forge.test.ts src/gateway/server-methods.ts src/gateway/server-methods-list.ts src/infra/appforge-workflow-events.test.ts src/gateway/server-methods/workflows.appforge-events.test.ts`
- `pnpm exec oxlint --type-aware src/infra/app-forge-model.ts src/infra/app-forge-model.test.ts src/infra/app-forge-structured-data.test.ts`
- File diagnostics for AppForge model/test and structured hook/test surfaces

Known unrelated failures:

- Full root TypeScript check still fails in unrelated agent/model runner files.
- Full dashboard TypeScript check still fails in unrelated dashboard files.
- Full dashboard API suite still has unrelated task/proxy expectation failures.
- Root oxlint on `dashboard/src/hooks/useForgeStructuredData.ts` reports pre-existing curly-style issues; dashboard eslint on the file passes.

## Next Work Order

Sub-agent lanes:

1. Lane A: add a real AppForge hook/component test harness or move the mutable structured-data logic into pure core functions that can be tested without a browser DOM.
2. Lane B: draft and coordinate PG schema/migration files with Threadmaster authority before touching storage surfaces.
3. Lane C: expand gateway methods from base CRUD into tables/fields/views/records.
4. Lane D: add focused workflow bridge tests for targeted AppForge event resume and dashboard record-event API submissions.
5. Lane E: patch the AppForge permission/actor/audit seam before any multi-user collaboration claims.
