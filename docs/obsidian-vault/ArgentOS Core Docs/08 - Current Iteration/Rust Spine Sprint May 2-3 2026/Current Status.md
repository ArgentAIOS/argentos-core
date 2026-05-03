# Current Status

Last updated: 2026-05-03 07:55 America/Chicago.

## Short version

We are moving faster now.

The local Rust Gateway test path works. The Rust kernel shadow runtime is now in `dev`, and the semantic guard smoke is also in `dev`.

Current `origin/dev` checkpoint:

- commit: `b82391cb`
- package: `2026.5.3-dev.3`

## Done

- Local Rust Gateway disposable loopback smoke passes.
- Gateway rehearsal and rollback proof is in `dev`.
- Workflows scheduler and workflow lease boundary is in `dev`.
- Rust `argent-execd` exposes `kernelShadow` state.
- Kernel shadow restart recovery is proven locally.
- Kernel semantic guard tests are in `dev`.
- Kernel restart smoke now checks `kernelShadow` after restart.

## Still true

- Node remains live authority.
- Rust remains shadow-only.
- `authoritySwitchAllowed=false`.
- No production daemon rollout yet.
- No live connector execution yet.
- No customer, company, OAuth, or API data used.

## What this means for testing

You can test the local Rust path as a disposable local smoke.

This is not a live authority switch yet.
