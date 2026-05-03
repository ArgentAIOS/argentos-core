# Bus Summary

## Latest Rust packets

- `tm-20260503134922-j5u217`: Master contained Gateway executable rollback proof into `origin/dev` `c4c5b3fc`, package `2026.5.3-dev.5`.
- `tm-20260503134225-3qu1mw`: AOS/Rust READY for executable local-only `rollback-node` proof paired with loopback rehearsal.
- `tm-20260503125330-lr8o7h`: Master contained kernel semantic guard into `origin/dev` `b82391cb`, package `2026.5.3-dev.3`.
- `tm-20260503125035-duqdcr`: AOS/Rust READY for semantic guard and operator smoke.
- `tm-20260503123902-ttw4dk`: Master contained kernel shadow spine into `origin/dev` `2027e47a`, package `2026.5.3-dev.2`.
- `tm-20260503120402-anjn7t`: Master contained Gateway rehearsal and rollback proof into `origin/dev` `cb2f4553`, package `2026.5.3-dev.1`.

## Verification themes

- Focused Vitest suites passed.
- Gateway rollback and loopback rehearsal commands passed locally.
- Rust Gateway parity report passed with `promotionReady=YES` for the current shadow evidence set.
- `cargo test -p argent-execd` passed.
- `cargo build -p argent-execd` passed.
- `restart-smoke` passed on local loopback.
- `oxfmt`, `oxlint`, `git diff --check`, and `pnpm check:repo-lane` passed in custody.

## Safety themes

- Node remains live authority.
- Rust remains shadow-only.
- No production daemon rollout.
- No connector execution or external live data.
- No authority switch.
