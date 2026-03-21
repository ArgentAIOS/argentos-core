# Workforce Phase 4 Deletion Map (SQLite Path Removal)

## Goal

Remove SQLite as a workforce/jobs runtime path after PG-canonical acceptance gates are complete.

## Preconditions (must be true before deletion)

1. Workforce gateway and integration tests pass in strict PG mode.
2. Production runtime remains `backend=postgres`, `readFrom=postgres`, `writeTo=["postgres"]`.
3. Operator workflows (template create/edit, assignment bind/update, run review) are verified on PG path.

## Contract surfaces to preserve

- `StorageAdapter.jobs` public contract in [adapter.ts](/Users/sem/code/argentos/src/data/adapter.ts)
- Gateway `jobs.*` RPC method behavior in [jobs.ts](/Users/sem/code/argentos/src/gateway/server-methods/jobs.ts)
- Tool surfaces that depend on jobs/workforce behavior:
  - `workforce_setup_tool`
  - `jobs_tool`

## Files directly involved in SQLite workforce path

### Primary removal targets

- [jobs.ts](/Users/sem/code/argentos/src/data/jobs.ts)
  - SQLite `JobsModule` implementation (now isolated from runtime adapter paths; retained only as legacy/test harness)
- [sqlite-adapter.ts](/Users/sem/code/argentos/src/data/sqlite-adapter.ts)
  - `SQLiteJobsAdapter` stub (explicit unsupported errors)

### Dual-path routing targets

- [dual-adapter.ts](/Users/sem/code/argentos/src/data/dual-adapter.ts)
  - `DualJobAdapter` now PG-only for workforce methods (SQLite fanout removed)

### Factory/wiring targets

- [storage-factory.ts](/Users/sem/code/argentos/src/data/storage-factory.ts)
  - `DONE` SQLite adapter creation no longer wires `jobsModule`
- [index.ts](/Users/sem/code/argentos/src/data/index.ts)
  - `DONE` `DataAPI` no longer initializes or exposes `jobs`

### SQLite test targets to retire or re-scope

- [jobs.test.ts](/Users/sem/code/argentos/src/data/jobs.test.ts)
  - currently validates SQLite `JobsModule`; convert to smoke-only or replace with PG-targeted tests

## Execution order (smallest safe sequence)

1. Freeze feature changes to SQLite jobs code.
2. Move remaining workforce acceptance tests to PG paths:
   - gateway-level + tool-level + PG adapter validation.
3. `DONE` Remove workforce fanout logic from `DualJobAdapter` for SQLite side.
4. `DONE` Remove `JobsModule` wiring from `SQLiteAdapter`/`storage-factory`.
5. Remove or isolate `JobsModule` SQLite implementation:
   - delete file or retain only migration harness with no runtime wiring.
6. `DONE` Update `DataAPI` wiring so SQLite path no longer constructs workforce runtime.
7. Remove/replace SQLite workforce-specific tests.
8. Run regression:
   - workforce gateway tests
   - workforce tool tests
   - PG adapter tests/integration tests

## Risk points and mitigations

- Risk: hidden call sites still instantiate SQLite jobs path.
  - Mitigation: `rg` for `jobsModule`, `new JobsModule`, `SQLiteJobsAdapter`, `DataAPI().jobs`.
- Risk: Dual mode paths silently expecting SQLite job writes.
  - Mitigation: explicitly fail tests if dual workforce writes hit SQLite.
- Risk: tooling assumptions around `dashboard.db`.
  - Mitigation: add runtime assertions in workforce handlers that active adapter is PG-family only.

## Completion definition

- No production/runtime workforce call path references SQLite jobs module.
- Workforce tests no longer rely on SQLite jobs implementation.
- PG adapter/gateway/tool paths are the only maintained workforce execution path.
