# Sprint Slice 3 — Security + Jobs Control + Partner Release

Date: 2026-03-05
Coordinator: Codex
Objective: Keep autonomous capability while adding hard safety gates and stabilizing a partner-ready release build.

## Outcomes

1. Identity and memory hardening Phase 1 shipped.
2. Jobs/agents control plane hardened (simulate/live, allowlists, approvals).
3. Partner install release candidate produced from a clean branch.

## Thread Map (A-F)

- Thread A: Identity tamper detection + startup gate
- Thread B: Memory sanitization + recall hardening
- Thread C: Jobs runtime policy gates (simulate/live + external action lock)
- Thread D: Org plugin isolation (marketplace boundaries, non-core MSP tools)
- Thread E: Release candidate build + install verification on secondary machine
- Thread F: Critical service health observability in dashboard (PG/Redis/gateway/ollama)

## Execution Order

1. A and C first (hard blockers for autonomous safety).
2. B and D in parallel.
3. F in parallel once A landed (it consumes new health signals).
4. E starts after A/C green, ends with partner handoff package.

## Acceptance Gates

### G1 — Identity Integrity

- Core identity docs checked at startup with hash verification.
- Boot warns or blocks (configurable) on tamper.
- Identity file change audit events recorded.

### G2 — Memory Safety

- Memory store path rejects obvious instruction payloads/system override patterns.
- `memory_recall` deep-mode behavior is deterministic and tested.

### G3 — Job Safety

- Default execution mode is simulation for external-effect actions.
- External actions require explicit live-mode + approval policy.
- Worker default scope remains assigned-only.

### G4 — Tenant Isolation

- Titanium-specific MSP plugins moved/declared org-scoped, not core-global defaults.
- Marketplace/org policy documented and enforced in loading path.

### G5 — Service Visibility

- Dashboard shows critical service status and alerting for hard-down components.
- Operator gets explicit critical alert when PG/storage is unavailable.

### G6 — Partner RC

- Clean release branch/tag candidate built.
- Install/run smoke checklist passes on non-dev target machine.
- Update path confirms no dirty/fallback false-fail UX blocker.

## Merge Sequence

1. A
2. C
3. B
4. D
5. F
6. E

## Risk Controls

- No broad refactors in this slice.
- Feature flags/default-safe behavior only.
- Each thread lands with targeted tests and rollback note.

## Definition of Done

- All gates G1-G6 met.
- Docs updated: operator runbook + security runbook + release runbook.
- Open follow-up issues filed for Phase 2/3 security work.
