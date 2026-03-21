# Thread C — Job Policy Gates (Simulate/Live)

Branch: codex/thread-c-job-policy-gates

## Build

1. Add explicit job execution mode with default `simulate`.
2. External-effect tools blocked in simulate mode.
3. `live` mode requires approval policy check + audit trail.
4. Preserve assigned-only worker scope as safe default.
5. Add clear status fields in job board for mode + blocked reason.

## Tests

- Simulate blocks external tools.
- Live requires approval and then executes.
- Unauthorized live attempt is blocked with actionable reason.

## Deliverable

- Commit SHA
- Files changed
- Test results
- Before/after sample job run output
