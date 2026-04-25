# argent-execd

`argent-execd` is the first Rust scaffold for ArgentOS's continuously alive
executive substrate.

Control contract:

- see `rust/argent-execd/CONTRACT.md`
- promotion checklist: `rust/argent-execd/PROMOTION_CHECKLIST.md`

Current scope:

- shadow-only daemon
- durable executive state snapshot
- append-only continuity journal
- scheduler / tick loop
- lane request / activation / release state
- restart recovery from snapshot + journal replay
- local HTTP surfaces for health and state inspection

Current routes:

- `GET /health`
- `GET /v1/executive/state`
- `GET /v1/executive/metrics`
- `GET /v1/executive/timeline?limit=<n>`
- `GET /v1/executive/journal?limit=<n>`
- `POST /v1/lanes/request`
- `POST /v1/lanes/release`
- `POST /v1/executive/tick`
- `POST /v1/executive/shutdown`

Request payloads:

- `POST /v1/lanes/request`

```json
{
  "lane": "operator",
  "priority": 95,
  "reason": "interactive",
  "leaseMs": 8000
}
```

- `POST /v1/lanes/release`

```json
{
  "lane": "operator",
  "outcome": "completed"
}
```

- `POST /v1/executive/tick`

```json
{
  "count": 1
}
```

- `POST /v1/executive/shutdown`

```json
{
  "reason": "restart-smoke"
}
```

Non-goals in this first scaffold:

- no prompt logic port
- no model/provider logic port
- no tool-policy port
- no dashboard/product behavior port
- no gateway shell ownership
- no claim that this is yet the canonical runtime authority

The purpose of this crate is to prove that the executive substrate can exist as
an isolated Rust service with durable state, explicit scheduling, and
restart-safe continuity without interfering with `rust/argentd/**`.

## Operator quick checks

Read-only visibility:

```bash
argent status
```

The current status output includes an `Executive shadow` line when the
best-effort TS consumer can reach `argent-execd`.

Direct inspection:

```bash
curl http://127.0.0.1:18809/health
curl http://127.0.0.1:18809/v1/executive/state
curl "http://127.0.0.1:18809/v1/executive/metrics"
curl "http://127.0.0.1:18809/v1/executive/timeline?limit=10"
curl "http://127.0.0.1:18809/v1/executive/journal?limit=20"
```

Shadow verification:

```bash
bash rust/argent-execd/scripts/restart-smoke.sh
bash rust/argent-execd/scripts/lease-soak.sh
bash rust/argent-execd/scripts/restart-poll-soak.sh
```

Current verification:

- `cargo check -p argent-execd`
- `cargo test -p argent-execd`
- `bash rust/argent-execd/scripts/restart-smoke.sh`
- `bash rust/argent-execd/scripts/lease-soak.sh`
- `bash rust/argent-execd/scripts/restart-poll-soak.sh`
- `pnpm exec vitest run src/infra/executive-shadow-contract.test.ts src/infra/executive-shadow-client.test.ts src/infra/executive-shadow-client.integration.test.ts`

Protocol artifacts:

- `rust/argent-execd/executive-shadow.protocol.schema.json`
- `dist/executive-shadow.protocol.schema.json`

Regenerate with:

```bash
pnpm run protocol:gen:executive-shadow
```

Artifact drift check:

```bash
pnpm run protocol:check
```

What the restart smoke proves:

- the daemon boots from an empty state dir
- a requested lane can be promoted to active
- shutdown works through the control surface
- a fresh daemon instance can recover active executive state from persisted snapshot + journal

What the restart+poll soak proves:

- repeated daemon restarts preserve the same persisted executive state
- read-only health/metrics/state/timeline polling stays consistent across cycles
- the operator-visible timeline summary remains available after restart

Next seam:

- keep the substrate isolated and honest
- add a typed IPC boundary for TypeScript consumption
- prove lane/scheduler continuity across process restarts under light soak runs
