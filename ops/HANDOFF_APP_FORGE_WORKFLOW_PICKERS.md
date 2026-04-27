# AppForge Workflow Picker Contract

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core-appforge-picker
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: pure core foundation work

## Purpose

Workflows can populate AppForge binding dropdowns without importing AppForge UI internals.

The boundary is read-only gateway data:

- `appforge.bases.list`
- `appforge.tables.list`

Workflow UI/runtime code should treat these responses as picker data and keep manual fallback fields for empty, legacy, or custom values.

## Base Picker

Request:

```json
{
  "method": "appforge.bases.list",
  "params": {
    "appId": "optional-app-id"
  }
}
```

Response:

```json
{
  "bases": [
    {
      "id": "base-1",
      "name": "Campaign Review",
      "appId": "app-1",
      "revision": 3,
      "description": "Review workspace",
      "activeTableId": "table-1",
      "updatedAt": "2026-04-25T20:00:00.000Z",
      "tableCount": 2,
      "tables": []
    }
  ]
}
```

Stable picker fields:

- `id`: durable AppForge base id; use for workflow dependency binding.
- `name`: operator-facing label for dropdowns.
- `appId`: owning AppForge app id.
- `revision`: current base revision for stale-state display or refresh hints.
- `description`: optional dropdown helper text.
- `activeTableId`: default table hint.
- `updatedAt`: sort/display freshness hint.
- `tableCount`: dropdown summary count.

The response currently preserves the full `tables` tree for AppForge dashboard compatibility. Workflows should not depend on records from `appforge.bases.list`; use `appforge.tables.list({ baseId })` for table choices.

## Table Picker

Request:

```json
{
  "method": "appforge.tables.list",
  "params": {
    "baseId": "base-1"
  }
}
```

Response:

```json
{
  "tables": [
    {
      "id": "table-1",
      "name": "Reviews",
      "revision": 2,
      "fields": [
        {
          "id": "status",
          "name": "Status",
          "type": "single_select",
          "required": false,
          "description": "Current status",
          "options": ["Open", "Closed"]
        }
      ],
      "fieldCount": 1,
      "recordCount": 12,
      "records": []
    }
  ]
}
```

Stable picker fields:

- `id`: durable AppForge table id; use for workflow table binding.
- `name`: operator-facing dropdown label.
- `revision`: current table revision.
- `fields`: durable field metadata for later field mapping pickers.
- `fieldCount`: dropdown summary count.
- `recordCount`: dropdown summary count.

The response currently preserves `records` for AppForge dashboard compatibility. Workflows should not require records for base/table binding.

## Workflow Binding Guidance

Recommended binding storage:

```json
{
  "source": "appforge",
  "appForgeBaseId": "base-1",
  "appForgeBaseName": "Campaign Review",
  "appForgeTableId": "table-1",
  "appForgeTableName": "Reviews"
}
```

Names are display/cache hints. IDs are authoritative when present.

Manual fallback remains required when:

- the gateway is unavailable
- the operator is binding a legacy AppForge metadata-only app
- a workflow package references a base/table name not found in durable storage yet
- the workspace has no AppForge bases or tables

## Verification

Focused tests cover:

- `appforge.bases.list` returns stable base picker fields from the AppForge store.
- `appforge.tables.list({ baseId })` returns stable table picker fields and fields.
- Store-backed writes are visible through subsequent base/table list calls.

No Workflow UI/runtime files are part of this contract.
