# AppForge Structured Local Event Contract

## Lane Lock

Repo: `ArgentAIOS/argentos-core`
Local path: `/Users/sem/code/argent-core-appforge-dev`
Target branch: `dev`
Forbidden repo for this task: `ArgentAIOS/argentos`
Reason: pure core foundation work

## Boundary

AppForge produces metadata and local events. Workflows consumes metadata and local events.

Do not import AppForge UI internals into Workflows. Do not import Workflow UI internals into AppForge.

The bridge entry point remains `workflows.emitAppForgeEvent`; dashboard AppForge producers call it through the local AppForge workflow-event API.

## Canonical Event Types

| Event type                   | Producer moment                                                          | Workflow use                                                                               |
| ---------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `forge.table.created`        | Table added or duplicated in AppForge structured data                    | Start a workflow when a review/operator table becomes available                            |
| `forge.table.updated`        | Table schema/name/order changes; field edits emit this table-level event | Trigger sync/index/revalidation workflows for changed table shape                          |
| `forge.table.deleted`        | Table removed from an AppForge base                                      | Trigger cleanup, downstream archive, or wait cancellation workflows                        |
| `forge.record.created`       | Record added or duplicated                                               | Trigger record intake, enrichment, or approval workflows                                   |
| `forge.record.updated`       | Cell update or review/capability status write                            | Resume waits or trigger sync workflows for a changed record                                |
| `forge.record.deleted`       | Record removed                                                           | Trigger cleanup/archive workflows                                                          |
| `forge.review.requested`     | Operator requests review on a record                                     | Open or resume review-gate workflows                                                       |
| `forge.review.completed`     | Operator approves or denies a record review                              | Resume `wait_event` or AppForge review gates using `workflowRunId` + `nodeId` when present |
| `forge.capability.completed` | Operator marks a declared AppForge capability complete                   | Resume capability-completion waits or trigger downstream delivery                          |

## Normalized Payload Shape

All events normalize through `normalizeAppForgeWorkflowEvent` into:

```json
{
  "eventType": "forge.record.updated",
  "appId": "app-123",
  "capabilityId": "campaign_review",
  "workflowRunId": "run-456",
  "nodeId": "appforge-review",
  "payload": {
    "source": "appforge",
    "eventType": "forge.record.updated",
    "appId": "app-123",
    "capabilityId": "campaign_review",
    "workflowRunId": "run-456",
    "nodeId": "appforge-review",
    "tableId": "table-main",
    "recordId": "record-1",
    "emittedAt": "2026-04-26T00:00:00.000Z"
  }
}
```

Top-level fields are duplicated into `payload` so workflow trigger filters can match either the canonical envelope or event-specific details.

## Table Event Payload Details

Table events include:

- `tableId`
- `tableName`
- `fieldIds`
- `recordCount`
- `changeType`

`forge.table.created` may include `duplicatedFrom`.

`forge.table.deleted` includes `nextActiveTableId` when another table remains active.

## Record Event Payload Details

Record events include:

- `tableId`
- `recordId`
- `fieldId` and `value` for cell updates
- `values` for create/duplicate/review/capability events
- `duplicatedFrom` for duplicated records

## Review And Capability Details

Review events may include:

- `reviewId`
- `decision`
- `approvedItems`
- `capabilityId`
- `workflowRunId`
- `nodeId`

When `workflowRunId` and `nodeId` are present, Workflows should treat the event as targeted resume input for a `wait_event` node or AppForge review gate.

When they are absent, Workflows may use the event as a trigger if workflow trigger config matches `appId`, `capabilityId`, `eventType`, and optional `eventFilter`.

## Current Runtime Status

Status: `live-ready` for dashboard-emitted local events through the existing AppForge workflow-event API and Workflow gateway consumer.

Storage caveat: AppForge structured table/record persistence still treats metadata PATCH as durable truth. Gateway table/record writes are currently mirrored best-effort until AppForge storage becomes durable.

## Next Work

- Add explicit dashboard/API tests for table event emission once the AppForge hook has a DOM-capable test harness.
- Add durable AppForge storage, then move reads and writes to gateway-backed storage as the source of truth.
- Add targeted review-gate browser/manual verification against a real workflow run once the review-gate UX is active.
