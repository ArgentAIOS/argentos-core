# Rust Gateway Protocol Parity Fixtures

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core-rust-spine
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: core gateway/kernel/Rust foundation work

## Purpose

This is the first golden-fixture policy for comparing the live Node gateway with the Rust shadow gateway. It does not switch live authority. It defines which frames are safe to replay against `argentd` while Node remains live, and which surfaces must stay blocked until isolated canary and rollback gates exist.

The source of truth for the fixture list is `src/infra/rust-gateway-parity-fixtures.ts`.
The current replay/classification engine is `src/infra/rust-gateway-parity-runner.ts`.
The WebSocket transport adapter is `src/infra/rust-gateway-parity-ws-transport.ts`.
The isolated service coordinator is `src/infra/rust-gateway-parity-isolated.ts`.
The concrete isolated process starters are `src/infra/rust-gateway-parity-services.ts`.
The operator report/readiness helpers are `src/infra/rust-gateway-parity-report.ts`.
The shadow drift JSONL formatter is `src/infra/rust-gateway-shadow-drift-log.ts`.
The opt-in local report entrypoint is `scripts/rust-gateway-parity-report.ts` via `pnpm rust-gateway:parity:report -- [options]`.

## Fixture Labels

- `exact`: Rust should match Node envelope and payload semantics exactly.
- `schema-compatible`: Rust may include different values, but the envelope and payload schema must stay client-compatible.
- `mock-compatible`: Rust only returns synthetic/mock data today. This is useful for shape checks, not promotion evidence.
- `unsupported`: Node supports the method, Rust does not yet.
- `unsafe`: Do not replay outside an isolated canary because the method can create live side effects.

## Initial Fixture Matrix

| Fixture                | Method             | Surface   | Safety    | Expected Rust Parity | Reason                                                                                     |
| ---------------------- | ------------------ | --------- | --------- | -------------------- | ------------------------------------------------------------------------------------------ |
| connect-v3-token       | connect            | connect   | read-only | schema-compatible    | Both gateways should negotiate protocol v3 and return a hello-ok envelope.                 |
| rpc-health             | health             | health    | read-only | schema-compatible    | Health payloads may differ in detail, but the RPC envelope and health shape must validate. |
| rpc-status             | status             | status    | read-only | mock-compatible      | Rust reports a synthetic gateway status and queued event view; Node remains live truth.    |
| rpc-system-presence    | system-presence    | presence  | read-only | schema-compatible    | Presence must remain an array-shaped read surface for dashboard and Swift clients.         |
| rpc-commands-list      | commands.list      | commands  | read-only | mock-compatible      | Rust returns a static command list; fixture checks read envelope shape only.               |
| rpc-config-schema      | config.schema      | config    | read-only | schema-compatible    | Config schema is a read-only shape surface and must not expose config secrets.             |
| rpc-models-list        | models.list        | models    | read-only | mock-compatible      | Rust reports a synthetic model catalog; fixture checks read envelope shape only.           |
| rpc-channels-status    | channels.status    | channels  | read-only | mock-compatible      | Rust has no channel adapter authority; fixture only checks response envelope shape.        |
| rpc-connectors-catalog | connectors.catalog | catalog   | read-only | mock-compatible      | Rust does not discover live AOS manifests yet; fixture guards catalog envelope shape only. |
| rpc-sessions-list      | sessions.list      | sessions  | read-only | mock-compatible      | Rust must not own live session state before migration; fixture is shape-only.              |
| rpc-cron-status        | cron.status        | timers    | read-only | mock-compatible      | Rust must not own timers yet; fixture is shape-only and does not execute schedules.        |
| rpc-cron-list          | cron.list          | timers    | read-only | mock-compatible      | Rust must not own schedules yet; fixture is shape-only and does not list live timers.      |
| rpc-node-list          | node.list          | nodes     | read-only | mock-compatible      | Rust reports synthetic node presence; fixture is shape-only until node registry parity.    |
| rpc-tools-status       | tools.status       | tools     | read-only | mock-compatible      | Rust has no dynamic tool/plugin registry yet; fixture is shape-only.                       |
| rpc-workflows-list     | workflows.list     | workflows | read-only | unsupported          | Rust gateway does not implement workflow authority or workflow read APIs yet.              |
| rpc-chat-send          | chat.send          | agent-run | unsafe    | unsafe               | Would create user-visible chat/run behavior if replayed against a live authority.          |
| rpc-cron-add           | cron.add           | timers    | unsafe    | unsafe               | Would create a timer and risks duplicate scheduled work outside isolated canary state.     |
| rpc-workflows-run      | workflows.run      | workflows | unsafe    | unsafe               | Would dispatch workflow execution and must wait for isolated workflow canary gates.        |

## Current Contract

- Replayable fixtures are only those with `safety != "unsafe"` and `expectedParity != "unsafe"`.
- `mock-compatible` fixtures cannot be used as promotion evidence; they only prove envelope/schema continuity.
- `unsupported` fixtures are safe to include in reports because they expose known gaps without exercising side effects.
- Slow read-only surfaces may carry fixture-level timeout overrides. `connectors.catalog` currently allows 10s because Node can perform connector discovery.
- Unsafe methods must remain blocked until:
  - isolated state/config exists,
  - Rust cannot duplicate timers/channels/runs,
  - Node fallback/rollback is tested,
  - operator can disable Rust authority explicitly.

## Harness Progress

The pure replay runner now:

- skips unsafe fixtures without calling transport,
- validates response frames,
- classifies `exact`, `schema-compatible`, `mock-compatible`, and `unsupported` results,
- marks mock-compatible results as shape checks only, not promotion evidence.
- validates known schema-compatible payload shapes for `connect`, `health`, `system-presence`, and `config.schema`, so clean evidence is no longer only an envelope `ok=true` check.

The WebSocket transport now:

- connects to explicit Node/Rust loopback URLs,
- sends a protocol v3 `connect` frame before non-connect RPC fixtures,
- returns the connect response directly for connect fixtures,
- leaves service startup and shutdown to the process wrapper.

The isolated coordinator now:

- starts supplied Node and Rust shadow service handles,
- runs the replay engine through the WebSocket transport,
- stops services in reverse startup order,
- cleans up already-started services if later startup fails.

The concrete service starters now:

1. Starts an isolated Node gateway.
2. Starts `argentd` on a random loopback port.
3. Uses a shared explicit token for both gateways.
4. Uses a temp `HOME`/XDG state root for the Node gateway.
5. Waits for readiness output before returning service handles.
6. Kills and cleans up processes on startup failures and normal stops.

The report helpers now:

- render parity replay output as operator-facing Markdown,
- evaluate promotion readiness blockers and warnings,
- reject mock-compatible results as promotion evidence,
- preserve unsupported surfaces as warning-level ownership gaps.

The drift formatter now:

- emits JSONL-safe `rust_gateway_shadow_drift` events,
- logs failed parity as `error`,
- logs mock-compatible and unsupported surfaces as `warn`,
- keeps clean parity results out of drift output.

## Next Harness Step

The local report entrypoint now:

1. Creates the isolated service starters.
2. Runs `runIsolatedRustGatewayParity`.
3. Writes JSON and Markdown reports under an ignored runtime/output path.
4. Writes shadow drift JSONL for non-clean results.
5. Keeps unsafe fixtures blocked by the fixture safety policy.
6. Supports `--strict` for CI-style non-zero exit when readiness is not clean.
7. Separates `--startup-timeout-ms` from `--request-timeout-ms` so local rebuilds do not make every replay drift check slow.
8. Supports `--json-summary` for CI-friendly machine-readable stdout without scraping human text.
9. Writes `rust-gateway-readiness-summary.json` with fixture groups, authority labels, and explicit promotion-gate statuses.

## Next Harness Step

Next, add a small smoke target that runs the report command in non-strict mode on developer machines where `cargo` and Node dependencies are available, then records the generated report paths in status/doctor output without requiring Rust to be promotion-ready.
