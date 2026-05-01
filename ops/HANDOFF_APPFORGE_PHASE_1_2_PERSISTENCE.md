# AppForge Phase 1+2 Persistence Slice

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core/worktrees/appforge-phase1-2-persistence
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: pure core AppForge/TableForge foundation work

## Task

`task-20260430235823-bbgzwp` - Phase 1+2: gateway-backed persistence smoke and
saved views seed.

## Scope

This slice keeps the AppForge name and stays inside AppForge-owned surfaces. It
does not rename to TableForge/Argent Tables/Titan Table, and it does not touch
Workflow runtime/canvas, AOS connectors, schema migrations, package version, or
release files.

## User-Visible Change

- AppForge table metadata now survives the gateway round trip instead of being
  dropped by the Postgres store.
- Saved grid view settings can now carry field visibility/order through the
  existing AppForge table payload.
- The selected field is now persisted on the active table payload instead of
  relying only on dashboard `localStorage`.
- The grid toolbar includes a small field-visibility picker for the active saved
  view.

## Gateway Contract

The existing `appforge.bases.*` and `appforge.tables.*` methods remain the
canonical AppForge boundary. `AppForgeTable` continues to expose stable core
fields:

- `id`
- `name`
- `fields`
- `records`
- `revision`

This slice also preserves AppForge table metadata through the existing
`appforge_tables.metadata` column:

- `activeViewId`
- `selectedFieldId`
- `views`
- future table-scoped metadata keys

Core fields win over metadata if a key overlaps.

## Files

- `dashboard/src/components/AppForge.tsx`
- `dashboard/src/hooks/useForgeStructuredData.ts`
- `src/infra/app-forge-model.ts`
- `src/infra/app-forge-store.ts`
- `src/infra/app-forge-structured-data.test.ts`
- `ops/HANDOFF_APPFORGE_PHASE_1_2_PERSISTENCE.md`

## Verification

Passed:

```sh
pnpm check:repo-lane
/Users/sem/code/argent-core/node_modules/.bin/oxfmt --check \
  dashboard/src/components/AppForge.tsx \
  dashboard/src/hooks/useForgeStructuredData.ts \
  src/infra/app-forge-model.ts \
  src/infra/app-forge-store.ts \
  src/infra/app-forge-structured-data.test.ts
/Users/sem/code/argent-core/node_modules/.bin/oxlint --type-aware \
  dashboard/src/components/AppForge.tsx \
  dashboard/src/hooks/useForgeStructuredData.ts \
  src/infra/app-forge-model.ts \
  src/infra/app-forge-store.ts \
  src/infra/app-forge-structured-data.test.ts
/Users/sem/code/argent-core/node_modules/.bin/vitest run \
  src/infra/app-forge-structured-data.test.ts \
  src/infra/app-forge-store.test.ts \
  src/gateway/server-methods/app-forge.test.ts
git diff --check
```

Focused test result:

```text
src/infra/app-forge-structured-data.test.ts: 14 passed
src/infra/app-forge-store.test.ts: 3 passed
src/gateway/server-methods/app-forge.test.ts: 18 passed
35 tests passed total
```

Browser smoke:

```text
Brave at http://127.0.0.1:8092/
Opened AppForge from the dashboard top bar.
Opened the saved-view Fields picker.
Unchecked Capability.
Observed the Capability column disappear from the grid.
```

Runtime note: the local dashboard displayed `Gateway unavailable; using metadata
fallback` against the already-running gateway, so this browser proof is UI proof.
Durable gateway proof for the persisted metadata path is covered by the focused
AppForge store/gateway tests above.

## Changelog Draft

- AppForge: preserved saved-view metadata, active view, and selected field state
  through gateway-backed table storage.
- AppForge: added first saved-view field visibility control in the dashboard grid.
- AppForge: added regression coverage proving saved views and selected field data
  survive gateway-shaped table payloads.

## Known Gaps

- This is not the full Airtable-class product. Calendar, Kanban, Gallery,
  Interface Designer, advanced formulas, permissions enforcement, collaboration,
  and automation authoring remain later phases.
- A full close/reopen proof against a live gateway should be repeated after this
  branch is merged and the operator stack is running this backend code, because
  the smoke browser was pointed at an already-running gateway.
