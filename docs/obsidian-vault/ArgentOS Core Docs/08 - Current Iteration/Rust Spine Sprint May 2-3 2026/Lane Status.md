# Lane Status

## Rust Gateway

Status: shadow/local candidate proof is strong.

Contained proof includes:

- local canary receipt harness
- disposable loopback daemon canary proof
- local rehearsal with rollback proof
- redacted denial and duplicate-prevention receipts
- parity report reaching `promotionReady=YES` for the current shadow evidence set

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
