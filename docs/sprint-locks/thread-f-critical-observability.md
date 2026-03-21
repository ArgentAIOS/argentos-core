# Thread F — Critical Service Observability

Branch: codex/thread-f-critical-observability

## Build

1. Add critical service panel/alerts for PG, Redis, gateway, ollama, memory adapter state.
2. Raise operator-critical alerts when storage is down/degraded.
3. Include last-success timestamps and stale thresholds.
4. Add clear remediation hints.

## Tests

- Simulated PG down produces critical alert.
- Recovery clears alert and records recovery timestamp.
- No noisy spam when state unchanged.

## Deliverable

- Commit SHA
- Files changed
- Test results
- Screenshot/JSON sample of alerts
