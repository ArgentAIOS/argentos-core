# Current Status

Last updated: 2026-05-03 14:12 UTC

## Latest contained build

- Package: `2026.5.3-dev.6`
- Source READY packet: `tm-20260503134225-3qu1mw`
- Contained source: `0d02d402` as custody `012d30ea`
- Master packet: `tm-20260503134922-j5u217`

## Active rollback gate

- Branch: `origin/codex/rust-gateway-executable-rollback-20260503`
- Task: `task-20260503132702-2un2zw`
- Goal: keep `argent gateway authority rollback-node --reason <reason> --json` executable as a local-only proof.
- Current proof shape: before/after authority snapshots both show Node live and Rust shadow-only, `authorityChanges=[]`, `productionTrafficUsed=false`, and `authoritySwitchAllowed=false`.
- Paired rehearsal: disposable loopback `rehearse-loopback` proves canary receipts for `chat.send`, `cron.add`, and `workflows.run` using temp HOME/state, random local port/token, and no installed service control.

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
