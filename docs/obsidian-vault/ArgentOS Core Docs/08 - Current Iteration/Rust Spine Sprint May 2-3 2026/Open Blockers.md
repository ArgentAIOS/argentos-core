# Open Blockers

## Promotion blockers

- No production Rust daemon rollout has been approved.
- No live gateway, scheduler, workflow, channel, session, or run authority switch has been approved.
- No connector execution, customer/company/API/OAuth data, or production traffic may be used for Rust proof.

## Semantic blocker

Agent Persona semantic contract is still blocked/stale. Current `kernelShadow` semantics are temporary, shadow-only, and guarded:

- wakefulness is derived from active and pending lanes
- focus mirrors the active or pending lane reason
- agenda pending lanes must match reflection queue lanes
- persisted timestamps must not lag tick or restart recovery evidence
- recovery must include journal replay evidence
- mutation-like payload fields are rejected

## Next useful proof

The next Rust slice should wait for Master assignment or Agent Persona semantics, unless a safe read-only/shadow parity or readiness summary task appears.
