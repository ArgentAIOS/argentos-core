# AppForge Phase 3A Durable Storage Handoff

## Lane Lock

Repo: `ArgentAIOS/argentos-core`
Local path: `/Users/sem/code/argent-core-appforge-dev`
Target branch: `dev`
Forbidden repo for this task: `ArgentAIOS/argentos`
Reason: pure core foundation work

## Scope

Phase 3A makes AppForge base/table/record CRUD durable through the core PostgreSQL storage path.

This slice does not implement richer Airtable UX, live connector-backed tables, multi-user ACL enforcement, or natural-language app editing.

## Storage Status

Status: `live-ready` for gateway CRUD when core storage is configured with PostgreSQL and migration `032_appforge_storage.sql` has been applied.

Status: `preview-only` for the dashboard desktop source-of-truth migration. The dashboard still needs the next slice to read and write through the gateway as its primary data path.

Status: `scaffold/deferred` for multi-user permissions. The actor/ACL/audit seam exists separately, but this slice does not enforce it end-to-end.

## Durable Tables

Migration: `src/data/pg/migrations/032_appforge_storage.sql`

Schema exports:

- `appForgeBases`
- `appForgeTables`
- `appForgeRecords`
- `appForgeIdempotencyKeys`

Database tables:

- `appforge_bases`
- `appforge_tables`
- `appforge_records`
- `appforge_idempotency_keys`

The schema stores table fields as JSONB and record values as JSONB. This keeps Phase 3A compatible with the current AppForge model while leaving room for later field-level indexing.

## Gateway Source Of Truth

When runtime storage is configured for PostgreSQL, `src/gateway/server-methods/app-forge.ts` now uses the Postgres-backed AppForge store through a module-level cached singleton.

When PostgreSQL is not configured, the gateway falls back to the in-memory store so existing preview/dev behavior remains available.

Gateway methods preserved:

- `appforge.bases.list`
- `appforge.bases.get`
- `appforge.bases.put`
- `appforge.bases.delete`
- `appforge.tables.list`
- `appforge.tables.get`
- `appforge.tables.put`
- `appforge.tables.delete`
- `appforge.records.list`
- `appforge.records.get`
- `appforge.records.put`
- `appforge.records.delete`

## Revision And Idempotency Semantics

The store preserves the existing AppForge adapter contract:

- Base writes increment base revision.
- Table writes increment base and table revision.
- Record writes increment base, table, and record revision.
- Delete operations return the deleted resource with the next revision.
- Idempotent writes replay the stored response by `idempotencyKey`.

## Boundaries

Workflows should continue consuming AppForge only through metadata and local events.

AppForge does not import Workflow dashboard/runtime internals.

Connector-backed tables remain deferred to a later phase and should consume connector manifests/capabilities rather than connector internals.

## Verification

Focused verification expected for this slice:

- `pnpm check:repo-lane`
- AppForge store/gateway tests
- Existing AppForge workflow event tests
- `oxlint --type-aware` on touched files
- `git diff --check`
- Type diagnostics for touched files

Known caveat: full project `tsc --noEmit` still reports an unrelated existing error in `src/agents/pi-tools.schema.ts`.

## Next Slice

Phase 3B should migrate the AppForge desktop hook/UI from metadata PATCH durability toward gateway-backed base/table/record reads and writes, with metadata fallback documented as legacy/best-effort.
