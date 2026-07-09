# argent-execd Promotion Checklist

Use this checklist before treating `argent-execd` as more than a shadow runtime.

This document is intentionally strict. Promotion should happen only when the
substrate is boring, observable, and hard to misunderstand.

## 1. Contract integrity

- [x] `pnpm run protocol:gen:executive-shadow`
- [x] `pnpm run protocol:check`
- [x] `src/infra/executive-shadow-contract.test.ts` passes
- [x] generated artifacts are clean:
  - `dist/executive-shadow.protocol.schema.json`
  - `rust/argent-execd/executive-shadow.protocol.schema.json`

## 2. Rust substrate health

- [x] `cargo test -p argent-execd`
- [x] `bash rust/argent-execd/scripts/restart-smoke.sh`
- [x] `bash rust/argent-execd/scripts/lease-soak.sh`
- [x] `bash rust/argent-execd/scripts/restart-poll-soak.sh`

Recommended stronger evidence before promotion:

- [x] rerun `restart-poll-soak.sh` with a higher cycle count
- [x] capture logs for at least one successful longer soak run

## 3. TS consumer integrity

- [x] `pnpm exec vitest run src/infra/executive-shadow-contract.test.ts`
- [x] `pnpm exec vitest run src/infra/executive-shadow-client.test.ts`
- [x] `pnpm exec vitest run src/infra/executive-shadow-client.integration.test.ts`
- [x] `pnpm exec vitest run src/infra/executive-shadow-kernel-inspector.test.ts`
- [x] `pnpm exec vitest run src/commands/status.executive-shadow.test.ts`
- [x] `pnpm exec vitest run src/commands/status.test.ts`

## 4. Read-only visibility

- [x] `argent status` shows:
  - `Executive shadow`
  - `Exec inspect`
- [x] direct HTTP surfaces respond:
  - `GET /health`
  - `GET /v1/executive/state`
  - `GET /v1/executive/metrics`
  - `GET /v1/executive/timeline?limit=<n>`
  - `GET /v1/executive/readiness`
  - `GET /v1/executive/journal?limit=<n>`

## 5. Authority boundary

All of these must remain true:

- [x] no live kernel control wiring
- [x] no live gateway control wiring
- [x] TypeScript is consumer/client only
- [x] `argent-execd` remains the only authority for executive substrate state
- [x] no hidden fallback that silently returns executive truth to TypeScript

## 6. Human/operator readiness

- [x] README quick checks are accurate
- [x] contract doc reflects actual current routes and payloads
- [x] operator can explain:
  - what `argent-execd` owns
  - what TS still owns
  - how to tell whether the shadow daemon is healthy
  - how to tell whether kernel and executive-shadow views align

## Promotion recommendation levels

### Shadow-credible

All sections 1–4 pass.

Meaning:

- okay to merge
- okay to run locally in shadow mode
- okay to use for read-only operator visibility

### Controlled-adoption candidate

All sections 1–6 pass, plus a stronger soak run.

Meaning:

- okay to begin designing a controlled read-only adoption path
- okay to evaluate limited live consumption of read-only data

### Not yet approved

Any of the following are still true:

- contract artifacts drift
- soak scripts are flaky
- TS client cannot validate live daemon payloads
- operator visibility is missing or misleading
- authority boundary is blurred

If any of those are true, stop and fix the boring things first.

---

## Evidence run — 2026-07-02 (operator-directed "skip the soak" pass)

All checkable items executed against fresh `--release` builds of both crates (source at `dev` d94d5c08):

- **§1 contract:** `protocol:gen:executive-shadow` + `protocol:check` clean; generated schemas identical in `dist/` and `rust/argent-execd/`.
- **§2 substrate:** `cargo test` green across the workspace (execd: restart_recovery, lease_expiry, http_control + unit; argentd: ws + http suites). `restart-smoke.sh` PASSED · `lease-soak.sh` PASSED · `restart-poll-soak.sh` PASSED (default 3 cycles — extended-cycle soak intentionally SKIPPED by operator decision 2026-07-02).
- **§3 TS consumers:** all 6 vitest suites green, 42/42 — including the integration test spawning the real freshly built daemon.
- **§4 visibility:** BOTH daemons now installed as KeepAlive LaunchAgents (`ai.argent.rust-gateway-shadow` :18799, `ai.argent.rust-executive-shadow` :18809, state dir `~/.argentos/rust-execd`) — first time running as managed services. `argent status` shows `Rust gateway shadow: reachable` and `Executive shadow: reachable`. Gateway parity report regenerated: **19 passed / 0 failed / 3 skipped, promotionReady=true**, installed where `argent gateway authority status` reads it (`Parity report: fresh · promotionReady=true`).
- **§5 authority boundary:** verified still true — no live control wiring; Node owns scheduler/workflow/channel/session/run authority.

**Status reached: Shadow-credible (sections 1–4), running live in shadow.**

**Honest remainder to real authority (build work, not process):**

1. ~~`argentd` cannot satisfy the installed-canary contract~~ **DONE 2026-07-02 evening (PR #468):**
   argentd speaks the ws JSON-RPC dialect and implements + advertises
   `rustGateway.canaryReceipts.status` / `.generateLocalProof`. Verified live against the
   installed daemon (`ai.argent.rust-gateway-shadow` :18799, canary flag env set in plist):
   `argent gateway authority status-installed --generate-local-receipts --confirm-local-only`
   → **read-only-ready, zero blockers**, receiptProofComplete=true, probe methodAdvertised=true;
   `argent gateway authority smoke-local --confirm-local-only` → **passed, zero blockers**;
   `argent gateway authority status --installed-canary-url ws://127.0.0.1:18799` → canary ok,
   6 receipts covering all three surfaces with DENIED + DUPLICATE_PREVENTED codes.
   Note: receipts are in-memory in the daemon — regenerate proof after a daemon restart with
   `--generate-local-receipts`. The gateway method surface beyond the canary contract is still
   shadow-fixture-backed; full Rust gateway reimplementation remains the long pole.
2. Scheduler/executive cutover: the Node side never delegates (workflows.backendStatus hardcodes `rust_scheduler_shadow_only` / `authority_switch_not_allowed` by design). The delegation seam **design is now LOCKED** — `rust/AUTHORITY_DELEGATION_SEAM.md` (2026-07-02, adversarially reviewed): rung ladder R0–R3 for controlled read-only adoption, first surface `workflows.list`, prerequisites P1–P5 (P1 fail-closed daemon auth is R2-blocking). Build work remains: P1–P5, the Rust read-model, the comparer, the authority record.
3. ~~Canary receipts machinery end-to-end once (1) exists.~~ Covered by (1): canary receipts machinery ran end-to-end against the installed daemon 2026-07-02.
