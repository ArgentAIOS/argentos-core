# Thread B — Memory Sanitization + Recall Hardening

Branch: codex/thread-b-memory-sanitization

## Build

1. Add memory input sanitizer for known instruction/prompt-override patterns on memory store path.
2. Add configurable severity:

- `log_only`
- `drop`
- `drop_and_alert`

3. Ensure memory recall deep behavior is explicit and tested end-to-end.
4. Add observability counters for sanitized/dropped entries.

## Tests

- Benign memory passes.
- Injection-like memory is flagged and handled by configured policy.
- Deep recall path remains stable and returns non-empty when expected.

## Deliverable

- Commit SHA
- Files changed
- Test results
- Sanitizer false-positive notes
