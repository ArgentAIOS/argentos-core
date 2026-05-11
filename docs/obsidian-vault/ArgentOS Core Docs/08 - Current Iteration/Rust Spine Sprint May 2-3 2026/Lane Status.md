# Lane Status

## Rust Gateway

Status: shadow/local candidate proof is strong; executable local rollback proof is contained.

Contained proof includes:

- local canary receipt harness
- disposable loopback daemon canary proof
- local rehearsal with rollback proof
- executable local-only `rollback-node` proof
- redacted denial and duplicate-prevention receipts
- parity report reaching `promotionReady=YES` for the current shadow evidence set

Contained rollback gate:

- `rollback-node` now runs as a local-only proof command instead of a read-only plan.
- The command proves Node remains live authority before and after rollback, Rust remains shadow-only, and no authority changes occur.
- Paired `rehearse-loopback` proof still uses only disposable loopback state and canary receipts.

## Workflows

Status: run/session handoff boundary is visible for future Rust ownership.

Contained proof includes:

- dry-run canvas payload validation stays local and does not persist workflow runs
- live workflow runs remain Node workflow authority, isolated-session owned, and PostgreSQL-gated
- duplicate-prevention expectations are documented in status/tests
- Rust remains observe-only for workflow scheduler/session/run ownership

## Rust Kernel

Status: shadow runtime spine is active as read-only/reporting evidence.

Contained proof includes:

- `argent-execd` readiness with `kernelShadow`
- durable snapshot and append-only journal recovery model
- restart smoke proving state recovery
- semantic fail-closed guards in TypeScript

## Live Authority

Status: unchanged.

Node remains live authority. Rust must not take over without explicit Master/operator promotion.
