# Timeline

## May 2, 2026

Rust Gateway work moved from generic parity proof toward real promotion plumbing.

Main focus:

- canary denial receipts
- duplicate-prevention receipts
- rollback rehearsal
- local-only proof
- no live authority switch

AppForge and Workflows also kept moving, but Rust spine became the main push.

## May 3, 2026

### `2026.5.3-dev.0`

Local Rust Gateway loopback smoke landed.

Operator proof passed:

- disposable loopback gateway
- temp home and temp state
- random local port and token
- canary receipts for `chat.send`, `cron.add`, and `workflows.run`
- redaction verified
- production traffic false
- authority switch false

### `2026.5.3-dev.1`

Gateway rehearsal and Workflows lease boundary landed.

This proved:

- local rehearsal path
- rollback boundary
- scheduler and workflow ownership remains Node
- future Rust ownership has a clearer contract

### `2026.5.3-dev.2`

Rust consciousness kernel shadow runtime landed.

This added:

- `kernelShadow` status
- wakefulness
- agenda and focus
- tick accounting
- reflection queue snapshot
- persistence and restart recovery model
- shadow-only authority checks

### `2026.5.3-dev.3`

Kernel semantic guard smoke landed.

This added:

- stronger fail-closed checks
- unsafe authority payload rejection
- stale persistence checks
- shadow-only mutation guard checks
- restart smoke that proves `kernelShadow` after recovery
