# Thread E — Partner Release Candidate

Branch: codex/thread-e-partner-rc

## Build

1. Cut clean RC branch from merged safety gates.
2. Build package/install artifact.
3. Validate install + first-run + update status on non-dev machine.
4. Capture install runbook and rollback steps.

## Tests

- Fresh install passes.
- Gateway comes up healthy.
- Main agent chat + TTS + STT basic flow passes.
- Update status is sane (no false-fail on clean install).

## Deliverable

- Commit SHA(s)
- Artifact location
- Validation checklist results
- Known caveats
