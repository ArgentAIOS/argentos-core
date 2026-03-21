# Workforce PG-Canonical Cutover Plan

## Objective

Make jobs/workforce PostgreSQL-canonical and stop extending the SQLite path, while keeping current operator workflows stable during transition.

## Current Reality (2026-03-08)

- Runtime storage config in `~/.argentos/argent.json` is already PG-only:
  - `backend=postgres`
  - `readFrom=postgres`
  - `writeTo=["postgres"]`
- `getStorageAdapter()` resolves to `PgAdapter` in this runtime.
- Workforce board fetches:
  - `jobs.*` via storage adapter-backed gateway handlers
  - `family.members` via family service (not via storage adapter jobs path)

## Minimal Correct Plan

### Phase 1: Stabilize (now)

- Keep SQLite jobs adapter parity for safety fallback only.
- Do not add new workforce features to SQLite.
- Add one runtime observability point in jobs/workforce startup logs:
  - active backend mode (`sqlite|dual|postgres`)
  - active adapter class (`SQLiteAdapter|DualAdapter|PgAdapter`)

Exit criteria:

- Current board flows (template create, assignment create/update, run review) succeed in PG mode.
- Any accidental SQLite fallback is immediately visible in logs.

Status (2026-03-08):

- `DONE` SQLite adapter parity patch for review/update assignment safety.
- `DONE` One-time workforce storage observability log at handler entry (backend/readFrom/writeTo + adapter class).

### Phase 2: Make PG the only supported production path

- Add explicit guard in workforce gateway handlers:
  - if storage mode is not strict PG in production profile, return a clear error with remediation.
- Keep local-dev override flag if needed (explicit opt-in), not silent behavior.
- Update operator docs/runbooks to state:
  - workforce/jobs requires PG canonical mode.

Exit criteria:

- Production launch profile cannot run workforce on SQLite silently.
- Error messaging is operator-readable and actionable.

Status (2026-03-08):

- `DONE` Guard added in `jobs.*` gateway handlers: non-strict-PG is blocked in production.
- `DONE` Explicit local override supported via `ARGENT_ALLOW_NON_PG_WORKFORCE=1`.

### Phase 3: Deprecate SQLite workforce implementation

- Mark SQLite jobs adapter and `JobsModule` workforce path as deprecated.
- Freeze tests for SQLite workforce to smoke-only coverage.
- Migrate workforce-focused tests to PG adapter and gateway-level integration tests.

Exit criteria:

- All workforce acceptance and e2e tests run against PG path.
- SQLite workforce path is no longer part of feature development.

Status (2026-03-08):

- `IN PROGRESS` SQLite jobs paths marked deprecated.
- `IN PROGRESS` Gateway tests added for strict-PG policy + `family.members` worker discovery.
- `DONE` Added strict-PG production workflow test (`jobs.templates.create` -> `jobs.assignments.create` -> `jobs.runs.review`) to gate handler dispatch on PG-canonical mode.

### Phase 4: Remove SQLite workforce path (scheduled cleanup)

- Remove jobs/workforce implementation from SQLite adapter/module.
- Keep SQLite only for legacy subsystems that still require it (if any).

Exit criteria:

- No workforce code path references SQLite `JobsModule`.
- Storage adapter contracts for workforce are implemented only by PG path (or no-op stubs in local-only test harnesses).

Status (2026-03-08):

- `IN PROGRESS` `workforce_setup_tool` now enforces strict-PG production policy (same as gateway handlers), preventing non-gateway bypass in production.
- `IN PROGRESS` SQLite workforce adapter methods now hard-block in production by default (explicit local fallback only in dev/test or `ARGENT_ALLOW_NON_PG_WORKFORCE=1`).
- `DONE` Removed `JobsModule` wiring from `SQLiteAdapter`/`storage-factory` for workforce. SQLite `jobs` surface is now an explicit unsupported stub.
- `DONE` Removed dual-adapter SQLite workforce mirroring paths. `DualJobsAdapter` is now PG-only for all jobs/workforce operations.

## Non-Goals

- No schema redesign in this cutover.
- No new workforce product features in this plan.
- No broad storage migration changes outside workforce/jobs.

## Immediate Next Work Items

1. Convert workforce integration/e2e suite to assert PG-canonical behavior as the required path.
2. Retire or archive legacy SQLite `JobsModule` tests and replace with PG adapter/integration coverage.
3. Decide whether to fully remove `src/data/jobs.ts` or keep it as an explicit non-runtime legacy harness.
