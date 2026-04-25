# argent-execd Promotion Checklist

Use this checklist before treating `argent-execd` as more than a shadow runtime.

This document is intentionally strict. Promotion should happen only when the
substrate is boring, observable, and hard to misunderstand.

## 1. Contract integrity

- [ ] `pnpm run protocol:gen:executive-shadow`
- [ ] `pnpm run protocol:check`
- [ ] `src/infra/executive-shadow-contract.test.ts` passes
- [ ] generated artifacts are clean:
  - `dist/executive-shadow.protocol.schema.json`
  - `rust/argent-execd/executive-shadow.protocol.schema.json`

## 2. Rust substrate health

- [ ] `cargo test -p argent-execd`
- [ ] `bash rust/argent-execd/scripts/restart-smoke.sh`
- [ ] `bash rust/argent-execd/scripts/lease-soak.sh`
- [ ] `bash rust/argent-execd/scripts/restart-poll-soak.sh`

Recommended stronger evidence before promotion:

- [ ] rerun `restart-poll-soak.sh` with a higher cycle count
- [ ] capture logs for at least one successful longer soak run

## 3. TS consumer integrity

- [ ] `pnpm exec vitest run src/infra/executive-shadow-contract.test.ts`
- [ ] `pnpm exec vitest run src/infra/executive-shadow-client.test.ts`
- [ ] `pnpm exec vitest run src/infra/executive-shadow-client.integration.test.ts`
- [ ] `pnpm exec vitest run src/infra/executive-shadow-kernel-inspector.test.ts`
- [ ] `pnpm exec vitest run src/commands/status.executive-shadow.test.ts`
- [ ] `pnpm exec vitest run src/commands/status.test.ts`

## 4. Read-only visibility

- [ ] `argent status` shows:
  - `Executive shadow`
  - `Exec inspect`
- [ ] direct HTTP surfaces respond:
  - `GET /health`
  - `GET /v1/executive/state`
  - `GET /v1/executive/metrics`
  - `GET /v1/executive/timeline?limit=<n>`
  - `GET /v1/executive/journal?limit=<n>`

## 5. Authority boundary

All of these must remain true:

- [ ] no live kernel control wiring
- [ ] no live gateway control wiring
- [ ] TypeScript is consumer/client only
- [ ] `argent-execd` remains the only authority for executive substrate state
- [ ] no hidden fallback that silently returns executive truth to TypeScript

## 6. Human/operator readiness

- [ ] README quick checks are accurate
- [ ] contract doc reflects actual current routes and payloads
- [ ] operator can explain:
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
