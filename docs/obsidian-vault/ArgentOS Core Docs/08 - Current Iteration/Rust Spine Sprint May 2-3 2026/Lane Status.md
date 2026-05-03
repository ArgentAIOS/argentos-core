# Lane Status

## Rust Gateway

Status: shadow/local candidate proof is strong; executable local rollback proof is in progress.

Contained proof includes:

- local canary receipt harness
- disposable loopback daemon canary proof
- local rehearsal with rollback proof
- redacted denial and duplicate-prevention receipts
- parity report reaching `promotionReady=YES` for the current shadow evidence set

Active gate:

- `rollback-node` now runs as a local-only proof command instead of a read-only plan.
- The command proves Node remains live authority before and after rollback, Rust remains shadow-only, and no authority changes occur.
- Paired `rehearse-loopback` proof still uses only disposable loopback state and canary receipts.

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
