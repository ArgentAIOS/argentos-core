# Rust Gateway Shadow Parity Sprint 1

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core-rust-spine
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: core gateway/kernel/Rust foundation work

## Goal

Turn the Rust gateway shadow parity harness from a manual smoke into a repeatable readiness lane with clear drift evidence, status visibility, and concrete next parity gaps while Node remains live gateway authority.

## Guardrails

- Do not switch live gateway authority.
- Do not give Rust authority over workflows, timers, channels, sessions, or agent runs.
- Do not change dashboard/AppForge API contracts without AppForge coordination.
- Do not change AOS connector exposure without AOS coordination.
- Keep unsafe fixtures blocked unless they run in isolated throwaway state.
- Work from `/Users/sem/code/argent-core-rust-spine`.

## Approved Scope

1. Parity report status surface.
2. Doctor/readiness check.
3. Report freshness contract.
4. Parity gap report.
5. Read-only fixture coverage expansion.
6. Rust gateway health detail.
7. CI-friendly script mode.
8. Protocol drift notes.
9. Coordination and docs.
10. Verification packet.

## Acceptance Criteria

- `pnpm rust-gateway:parity:report` remains working and smoke-tested.
- `argent status` or status summary can point operators to the latest parity report.
- Missing, stale, and invalid reports are handled gracefully.
- Reports clearly separate mock-only success from promotion evidence.
- New fixtures are read-only and covered by tests.
- No live gateway authority changes are made.

## Execution Order

Start with read-only status visibility, then freshness classification, then doctor/readiness. Expand fixtures only after status and report evidence paths are stable.

## Progress

- Completed: parity report status surface and freshness classification.
- Completed: doctor/readiness check for Rust gateway parity tooling and latest report state.
- Completed: CI-friendly script mode with machine-readable parity summary output.
- Completed: parity gap report grouping and protocol drift note improvements.
- Completed: fixture-level timeout override for slow read-only connector catalog parity.
- Completed: safe read-only fixture expansion for commands, config schema, models, cron list, and node list.
- Completed: Rust gateway HTTP health detail now reports shadow mode, protocol version, Node live authority, shadow-only gateway authority, promotion readiness false, and memory-only persistence; `argent status` surfaces these facts.
- Completed: scheduler/timer boundary and rollback/fallback command planning in `ops/RUST_GATEWAY_SCHEDULER_TIMER_BOUNDARY_PLAN.md`.
- Completed: read-only scheduler authority report for `argent status`; it labels Node as live scheduler authority, Rust as shadow-only, and counts cron/workflow timers without arming or mutating them.
- Completed: promotion-readiness handoff packet in `ops/RUST_GATEWAY_PROMOTION_READINESS_HANDOFF.md`.
- Completed: machine-readable parity readiness summary output at `rust-gateway-readiness-summary.json`.
- Completed: read-only `argent gateway authority status` surface.
- Completed: rollback/fallback command design packet in `ops/RUST_GATEWAY_ROLLBACK_FALLBACK_COMMAND_DESIGN.md`.
- Completed: schema-compatible payload validators for `connect`, `health`, `system-presence`, and `config.schema`, strengthening clean evidence beyond envelope checks.
- Completed: readiness summary gate statuses for parity cleanliness, dashboard/Swift smoke, workflow/schedule smoke, rollback, restart/recovery, and duplicate-prevention.
- Next: expand real parity evidence beyond mock-compatible fixtures and add actual dashboard/client smoke runners.
