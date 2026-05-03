# Current Status

Last updated: 2026-05-03 13:45 UTC

## Latest contained build

- Package: `2026.5.3-dev.5`
- Source READY packet: `tm-20260503134225-3qu1mw`
- Contained source: `0d02d402` as custody `012d30ea`
- Master packet: pending after push

## What is now true

- Rust Gateway local loopback rehearsal, rollback proof, and canary receipt proof are contained.
- `argent gateway authority rollback-node` is now executable as a local-only proof command.
- The rollback proof keeps `authorityChanges=[]`, `productionTrafficUsed=false`, and `authoritySwitchAllowed=false`.
- `argent gateway authority rehearse-loopback` now proves canary receipts and pairs them with the executable rollback proof.
- `argent-execd` exposes `kernelShadow` in readiness JSON.
- `kernelShadow` reports wakefulness, focus, agenda, ticks, reflection queue, persisted timestamp, restart recovery, and `authority=shadow`.
- The local restart smoke now proves `kernelShadow` after restart.
- TypeScript fail-closed guards reject unsafe semantic drift, including stale persistence, unsafe authority values, missing `authoritySwitchAllowed=false`, mutation-like fields while shadow-only, recovery journal shape gaps, and agenda/reflection queue drift.

## Authority boundary

Node remains live authority for gateway, scheduler, workflows, channels, sessions, and runs.

Rust remains shadow/reporting only. `authoritySwitchAllowed=false` is still required.
