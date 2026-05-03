# Current Status

Last updated: 2026-05-03 14:16 UTC

## Latest contained build

- Package: `2026.5.3-dev.7`
- Source READY packets: `tm-20260503134737-j6bnt4`, `tm-20260503140811-swrwbd`
- Contained sources: Workflows `96de5f07` as custody `443ecfc5`; Gateway rollback clarification `9aad435a` as custody `f32483e4`
- Master packet: pending after push

## Current Rust spine checkpoint

- Gateway: `rollback-node` is executable as a local-only proof. Before/after authority snapshots both show Node live and Rust shadow-only, `authorityChanges=[]`, `productionTrafficUsed=false`, and `authoritySwitchAllowed=false`.
- Gateway rehearsal: disposable loopback `rehearse-loopback` proves canary receipts for `chat.send`, `cron.add`, and `workflows.run` using temp HOME/state, random local port/token, and no installed service control.
- Workflows: `workflows.backendStatus` now reports the workflow run/session handoff contract and duplicate-prevention expectations for future Rust ownership.
- Workflows dry-run stays local/no-PostgreSQL. Live workflow runs remain Node-owned and PostgreSQL-gated.

## What is now true

- Rust Gateway local loopback rehearsal, rollback proof, and canary receipt proof are contained.
- `argent gateway authority rollback-node` is now executable as a local-only proof command.
- The rollback proof keeps `authorityChanges=[]`, `productionTrafficUsed=false`, and `authoritySwitchAllowed=false`.
- `argent gateway authority rehearse-loopback` now proves canary receipts and pairs them with the executable rollback proof.
- Workflow run/session handoff boundaries are visible in status/contract tests: dry-run payload validation does not persist workflow runs, while live workflow runs remain Node-owned.
- Duplicate-prevention expectations are explicit: one workflowRun cron job per active schedule, scheduled duplicates start inactive, stale extra cron jobs are removed, and Rust is observe-only.
- `argent-execd` exposes `kernelShadow` in readiness JSON.
- `kernelShadow` reports wakefulness, focus, agenda, ticks, reflection queue, persisted timestamp, restart recovery, and `authority=shadow`.
- The local restart smoke now proves `kernelShadow` after restart.
- TypeScript fail-closed guards reject unsafe semantic drift, including stale persistence, unsafe authority values, missing `authoritySwitchAllowed=false`, mutation-like fields while shadow-only, recovery journal shape gaps, and agenda/reflection queue drift.

## Authority boundary

Node remains live authority for gateway, scheduler, workflows, channels, sessions, and runs.

Rust remains shadow/reporting only. `authoritySwitchAllowed=false` is still required.
