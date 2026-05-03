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

Complete and contain the executable local `rollback-node` proof, then keep the next Rust slice focused on either:

- a Master-assigned Gateway promotion blocker, or
- Agent Persona semantic contract alignment for the shadow Kernel.
