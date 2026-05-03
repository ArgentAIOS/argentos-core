# argent-execd Control Contract

This document defines the current shadow control surface for the Rust executive
substrate. It is intentionally narrow and substrate-only.

Promotion criteria live in:

- `rust/argent-execd/PROMOTION_CHECKLIST.md`

## Purpose

`argent-execd` owns:

- durable executive state
- scheduler / tick loop
- lane arbitration
- continuity journal
- restart recovery
- executive health / observability

TypeScript remains the cognition and product layer. It does **not** co-own the
executive substrate.

## Current transport

- local HTTP on loopback
- JSON payloads
- shadow-only

This is a temporary transport, not a final product-facing protocol.

## Routes

### `GET /health`

Returns a health summary:

```json
{
  "status": "ok",
  "uptimeSeconds": 12,
  "bootCount": 2,
  "tickCount": 4,
  "activeLane": "operator",
  "journalEventCount": 9,
  "stateDir": "/Users/sem/.argentos/runtime/argent-execd-shadow",
  "nextTickDueAtMs": 1776653178605
}
```

### `GET /v1/executive/state`

Returns runtime config plus the full current executive state snapshot.

### `GET /v1/executive/metrics`

Returns a compact observability view designed for polling and operator status
surfaces:

```json
{
  "activeLane": "operator",
  "laneCounts": { "idle": 1, "pending": 1, "active": 1 },
  "bootCount": 2,
  "tickCount": 4,
  "journalEventCount": 9,
  "nextTickDueAtMs": 1776653178605,
  "lastTickAtMs": 1776653173605,
  "lastRecoveredAtMs": 1776653158589,
  "nextLeaseExpiryAtMs": 1776653198600,
  "highestPendingPriority": 20
}
```

### `GET /v1/executive/timeline?limit=<n>`

Returns a compact operator-readable summary derived from the journal:

```json
{
  "activeLane": "operator",
  "journalEventCount": 9,
  "recentEvents": [
    {
      "seq": 9,
      "atMs": 1776653173605,
      "type": "lane_activated",
      "lane": "operator",
      "summary": "lane operator activated (lease expires at 1776653198600)"
    }
  ],
  "counts": {
    "booted": 1,
    "recovered": 1,
    "tick": 4,
    "lane_requested": 2,
    "lane_activated": 1,
    "lane_released": 0
  },
  "lastRequestAtMs": 1776653166950,
  "lastActivationAtMs": 1776653168603,
  "lastReleaseAtMs": null,
  "lastReleaseOutcome": null
}
```

### `GET /v1/executive/readiness`

Returns the current shadow-readiness contract for Kernel/Executive promotion:

```json
{
  "mode": "shadow-readiness",
  "authoritySwitchAllowed": false,
  "promotionStatus": "blocked",
  "kernelShadow": {
    "reachable": true,
    "status": "fail-closed",
    "authority": "shadow",
    "wakefulness": "active",
    "agenda": {
      "activeLane": "operator",
      "pendingLanes": ["background"],
      "focus": "interactive"
    },
    "focus": "interactive",
    "ticks": {
      "count": 4,
      "lastTickAtMs": 1776653168603,
      "nextTickDueAtMs": 1776653173603,
      "intervalMs": 5000
    },
    "reflectionQueue": {
      "status": "shadow-only",
      "depth": 1,
      "items": [
        {
          "lane": "background",
          "priority": 20,
          "reason": "reflection",
          "requestedAtMs": 1776653166950
        }
      ]
    },
    "persistedAt": 1776653168603,
    "restartRecovery": {
      "model": "snapshot-plus-journal-replay",
      "status": "recovered",
      "bootCount": 2,
      "lastRecoveredAtMs": 1776653160000,
      "journalEventCount": 8,
      "snapshotFile": "executive-state.json",
      "journalFile": "executive.journal.jsonl"
    }
  },
  "currentAuthority": {
    "gateway": "node",
    "scheduler": "node",
    "workflows": "node",
    "channels": "node",
    "sessions": "node",
    "executive": "shadow-only"
  },
  "persistenceModel": {
    "snapshotFile": "executive-state.json",
    "journalFile": "executive.journal.jsonl",
    "restartRecovery": "snapshot-plus-journal-replay",
    "leaseRecovery": "tick-expiry-before-promotion"
  },
  "promotionGates": [
    {
      "id": "contract-integrity",
      "status": "blocked",
      "owner": "master-operator"
    },
    {
      "id": "restart-and-lease-recovery",
      "status": "blocked",
      "owner": "master-operator"
    },
    {
      "id": "authority-boundary",
      "status": "blocked",
      "owner": "master-operator"
    }
  ]
}
```

### `GET /v1/executive/journal?limit=<n>`

Returns the most recent journal records. This is the continuity/debugging
surface.

### `POST /v1/lanes/request`

Request a lane:

```json
{
  "lane": "operator",
  "priority": 95,
  "reason": "interactive",
  "leaseMs": 8000
}
```

Effects:

- records `lane_requested`
- leaves activation to tick/arbitration

### `POST /v1/lanes/release`

Release a lane:

```json
{
  "lane": "operator",
  "outcome": "completed"
}
```

Effects:

- records `lane_released`
- clears active ownership if this lane is active

### `POST /v1/executive/tick`

Manually advance the executive loop:

```json
{
  "count": 1
}
```

Effects:

- records one or more `tick` events
- may expire a lease
- may promote the next pending lane

### `POST /v1/executive/shutdown`

Request clean shutdown:

```json
{
  "reason": "restart-smoke"
}
```

Effects:

- stops accept loop
- stops tick loop
- allows a new daemon instance to recover from persisted snapshot + journal

## Journal event types

Current event vocabulary:

- `booted`
- `recovered`
- `tick`
- `lane_requested`
- `lane_activated`
- `lane_released`

## Boundary rules

- No prompt logic in `argent-execd`
- No model/provider logic in `argent-execd`
- No tool policy in `argent-execd`
- No dashboard/product behavior in `argent-execd`
- No second authority for runtime state outside `argent-execd` once this surface is promoted

## Expected next step

The next non-shadow step should be a thin TypeScript client/adapter that calls
this contract and treats `argent-execd` as the substrate authority for:

- health
- metrics
- executive state
- lane requests/releases
- continuity journal inspection

Current prototype:

- `src/infra/executive-shadow-client.ts`
- `src/commands/status.executive-shadow.ts` (read-only status consumer)
- `src/infra/executive-shadow-client.integration.test.ts` (live TS-to-Rust proof)
- `scripts/executive-shadow-protocol-gen.ts`
- `rust/argent-execd/executive-shadow.protocol.schema.json`

Current status:

- implemented as an experimental standalone client
- implemented as a read-only best-effort status consumer
- experimentally proven against a live `argent-execd` daemon in test
- experimentally proven to observe lease-expiry and lane-promotion transitions through read-only metrics/state
- experimentally proven to support stable read-only polling across live daemon ticks
- exported as repo-native JSON schema artifacts for cross-runtime consumption
- no live kernel/gateway wiring
- TS-side validation is working in this worktree
