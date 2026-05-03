# AppForge Live Persistence And Workflow Resource Readiness

## Task

Threadmaster task: `task-20260501002909-32diqh`

Goal: prove the merged Phase 1+2 AppForge storage path can preserve a base/table
workspace through a close/reopen-shaped gateway/core-store round trip, and restate
the Workflows-facing AppForge resource boundary without overclaiming runtime
readiness.

## What This Slice Proves

- `appforge.bases.list({ appId? })` remains the canonical Workflows picker method
  for durable AppForge bases.
- `appforge.tables.list({ baseId })` remains the canonical Workflows picker method
  for durable AppForge tables and fields.
- AppForge table metadata survives durable store hydration:
  - `activeViewId`
  - `selectedFieldId`
  - `views`
  - saved-view filter/sort/group/visible-field state
- Base/table/record IDs remain stable after recreating the AppForge Postgres store
  object against the same durable SQL state.
- The AppForge schema self-heal path still runs per recreated store instance before
  first durable access.

## Truth Labels

| Surface                                  | Status                                             | Notes                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| AppForge gateway base/table/record CRUD  | `live-ready when PostgreSQL storage is configured` | Runtime falls back to in-memory when storage is not configured for PostgreSQL.                                                               |
| `appforge.bases.list`                    | `live-ready/read-ready`                            | Returns durable base IDs, names, app IDs, revision, updatedAt, activeTableId, tableCount, and hydrated tables.                               |
| `appforge.tables.list`                   | `live-ready/read-ready`                            | Returns durable table IDs, names, fields, revision, records, and table metadata used by saved views.                                         |
| Saved views / selected field persistence | `live-ready through table payload metadata`        | Stored in `appforge_tables.metadata`, not browser `localStorage` alone.                                                                      |
| `appforge-core` connector catalog entry  | `metadata-only/read_ready`                         | This is not a runnable CLI connector and must not be treated as write-ready connector runtime.                                               |
| Workflows live template enablement       | `needs setup/seed`                                 | Templates must verify required AppForge bases/tables/events exist before live enablement.                                                    |
| Multi-user permissions enforcement       | `scaffold/deferred`                                | ACL/audit seam exists but is not enforced end-to-end for all dashboard mutations.                                                            |
| Airtable-class TableForge breadth        | `planned`                                          | Kanban/calendar/gallery/timeline, formulas, linked records, imports, collaboration, permissions, and interface designer remain later phases. |

## Workflow Resource Contract

Workflows should depend only on these gateway/event surfaces:

```text
appforge.bases.list({ appId? })
appforge.tables.list({ baseId })
appforge.records.list({ baseId, tableId })
workflows.emitAppForgeEvent({ eventType, appId?, baseId?, tableId?, recordId?, payload? })
```

Canonical AppForge event types remain:

- `forge.table.created`
- `forge.table.updated`
- `forge.table.deleted`
- `forge.record.created`
- `forge.record.updated`
- `forge.record.deleted`
- `forge.review.requested`
- `forge.review.completed`
- `forge.capability.completed`

Workflows must not import AppForge dashboard/runtime internals. Empty or legacy
workspaces should keep manual fallback controls until required bases/tables are
created or seeded.

## Harness Path

Focused close/reopen proof is now covered by
`src/infra/app-forge-store.test.ts`:

```sh
/Users/sem/code/argent-core/node_modules/.bin/vitest run src/infra/app-forge-store.test.ts
```

The new regression writes a base with one table, saved grid view metadata,
selected field, and record data through `createPostgresAppForgeStore`, recreates
the store instance against the same durable SQL state, then reads it back via
`listBases({ appId })` and `listTables(baseId)`.

Additional readiness proof to run for merge custody:

```sh
/Users/sem/code/argent-core/node_modules/.bin/vitest run \
  src/infra/app-forge-store.test.ts \
  src/gateway/server-methods/app-forge.test.ts \
  src/connectors/catalog.test.ts \
  src/gateway/server-methods/workflows.output-channels.test.ts \
  src/infra/appforge-workflow-events.test.ts
pnpm check:repo-lane
/Users/sem/code/argent-core/node_modules/.bin/oxfmt --check \
  src/infra/app-forge-store.test.ts \
  ops/HANDOFF_APPFORGE_LIVE_PERSISTENCE_READINESS.md
git diff --check
```

Optional connector catalog probe:

```sh
/Users/sem/code/argent-core/node_modules/.bin/tsx -e "import { discoverConnectorCatalog } from './src/connectors/catalog.ts'; void (async () => { const c=(await discoverConnectorCatalog({repoRoots:[], pathEnv:'', timeoutMs:500})).connectors.find((x)=>x.tool==='appforge-core'); console.log(JSON.stringify(c,null,2)); })();"
```

## Remaining TableForge Phase Gaps

AppForge is still roughly an early TableForge foundation, not an Airtable-class
clone. Next highest-value work after this readiness proof:

1. Phase 1E field validation/model hardening: required/default/options validation,
   honest inline errors, and persistence tests.
2. Phase 2 saved views breadth: Kanban, Form, Review, filters/sorts/hidden fields
   as first-class saved view controls.
3. Phase 2/3 workflow readiness seeds: operator-visible setup path that creates
   known bases/tables needed by workflow templates.
4. Phase 3 data model depth: linked records, lookups, rollups, formulas, and typed
   relation/attachment storage.
5. Phase 4 interface/app builder: real Interface pages instead of placeholder
   states, with live/declaration/preview/planned labels preserved.
