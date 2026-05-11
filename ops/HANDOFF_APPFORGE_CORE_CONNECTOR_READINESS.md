# AppForge Core Connector Readiness

## Task

Threadmaster task: `task-20260430233639-2x2inw`

Goal: unblock Workflows live-readiness auditing by exposing the core AppForge
metadata/event boundary in connector discovery without pretending it is a
runnable external connector runtime.

## Connector Catalog Boundary

Canonical connector id: `appforge-core`

Readiness label: `metadata-only`

Workflow readiness projection: `read_ready`

This is intentionally not `write_ready`. AppForge Core is a core gateway/event
surface, not a CLI connector harness. Workflow connector actions must not try to
execute `appforge-core` through `runConnectorCommandJson`.

Catalog entry:

```json
{
  "tool": "appforge-core",
  "label": "AppForge Core",
  "backend": "core-gateway",
  "installState": "metadata-only",
  "status": {
    "ok": true,
    "label": "Metadata only"
  },
  "categories": ["appforge", "table", "workflow"],
  "resources": ["base", "table", "record", "event"]
}
```

Advertised read contracts:

- `appforge.bases.list`
- `appforge.tables.list`
- `appforge.records.list`
- `workflows.emitAppForgeEvent`

The event ingress command is advertised as metadata/read contract only. Actual
event delivery remains the existing gateway boundary.

## Base/Table Contract

Workflows should use the gateway methods directly:

- `appforge.bases.list({ appId? })`
- `appforge.tables.list({ baseId })`

Stable base fields:

- `id`
- `name`
- `appId`
- `revision`
- `updatedAt`
- `tableCount`

Stable table fields:

- `id`
- `name`
- `fields`
- `revision`
- `fieldCount`
- `recordCount`

For full picker examples, keep using
`ops/HANDOFF_APP_FORGE_WORKFLOW_PICKERS.md`.

## Event Contract

Canonical AppForge event types:

- `forge.table.created`
- `forge.table.updated`
- `forge.table.deleted`
- `forge.record.created`
- `forge.record.updated`
- `forge.record.deleted`
- `forge.review.requested`
- `forge.review.completed`
- `forge.capability.completed`

Events normalize through `normalizeAppForgeWorkflowEvent` and enter Workflows via
`workflows.emitAppForgeEvent`.

## Readiness Truth

- Connector catalog discovery: `read_ready` / `metadata-only`.
- Base/table picker reads: live when AppForge gateway storage is available.
- Record reads: live when a base/table exists.
- Events: live through `workflows.emitAppForgeEvent` and gateway mutation
  best-effort emission.
- Runtime connector action execution: blocked by design; no CLI harness exists
  for `appforge-core`.
- Setup caveat: workspaces with no AppForge bases/tables still require base/table
  seed or manual fallback before templates can be enabled live.

## Harness Path

Focused proof commands:

```sh
pnpm exec vitest run src/connectors/catalog.test.ts src/gateway/server-methods/workflows.output-channels.test.ts src/infra/appforge-workflow-events.test.ts src/gateway/server-methods/app-forge.test.ts
pnpm check:repo-lane
git diff --check
```

Optional catalog probe:

```sh
pnpm exec tsx -e "import { discoverConnectorCatalog } from './src/connectors/catalog.ts'; const c=(await discoverConnectorCatalog()).connectors.find((x)=>x.tool==='appforge-core'); console.log(JSON.stringify(c,null,2));"
```
