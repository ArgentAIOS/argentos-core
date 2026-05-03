# Open Blockers

## Promotion blockers

- No production Rust daemon rollout has been approved.
- No live gateway, scheduler, workflow, channel, session, or run authority switch has been approved.
- No connector execution, customer/company/API/OAuth data, or production traffic may be used for Rust proof.
- The new `rollback-node` command is local proof only. It does not promote Rust and does not control the installed production daemon.
- Workflows run/session handoff proof is contract/status only. It does not execute saved live workflows or promote Rust workflow authority.

## Semantic blocker

Agent Persona semantic contract is still blocked/stale. Current `kernelShadow` semantics are temporary, shadow-only, and guarded:

- wakefulness is derived from active and pending lanes
- focus mirrors the active or pending lane reason
- agenda pending lanes must match reflection queue lanes
- persisted timestamps must not lag tick or restart recovery evidence
- recovery must include journal replay evidence
- mutation-like payload fields are rejected

## Next useful proof

The next Rust Gateway slice should prove an installed local daemon canary path without production traffic.

The next Rust Kernel slice should keep moving the always-on consciousness kernel toward durable Rust ownership while staying shadow-only until promotion is explicitly approved.

The next Workflows slice should wait for either installed local daemon canary coordination or a Rust consumer implementation task.
