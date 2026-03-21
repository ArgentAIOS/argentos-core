# Sprint Locks

Shared lock index for parallel sprint threads. Each thread owns only the files listed in its lock file.

## Active Threads

| Thread | Issue                     | Branch                                  | Lock File                                | Status      |
| ------ | ------------------------- | --------------------------------------- | ---------------------------------------- | ----------- |
| Main   | #63                       | (active workspace branch)               | `docs/sprint-locks/thread-d-63.md`       | In progress |
| A      | #59                       | `codex/sprint-embeddings-local-only`    | `docs/sprint-locks/thread-a-59.md`       | In progress |
| B      | #65 (started), #61 (done) | `codex/sprint-auth-failover`            | `docs/sprint-locks/thread-b-61.md`       | In progress |
| C      | #62                       | `codex/sprint-permissions-allowlist`    | `docs/sprint-locks/thread-c-62.md`       | In progress |
| B      | Memory Pack #2            | `codex/sprint-memory-memu-guardrails-2` | `docs/sprint-locks/thread-b-memory-2.md` | In progress |
| C      | Memory Pack #3            | `codex/sprint-memory-sis-reliability-3` | `docs/sprint-locks/thread-c-memory-3.md` | In progress |
| A      | Memory Pack #1            | `codex/sprint-memory-memu-guardrails-2` | `docs/sprint-locks/thread-a-memory-1.md` | Done        |

## File Reservations (Current)

- Reserved to Thread C (`#62`):
- `dashboard/api-server.cjs`
- `src/gateway/*` files needed for denial approval event plumbing
- `src/security/audit*.ts` files needed for allowlist approval audit wiring
- `dashboard/src/hooks/useGateway.ts`
- `dashboard/src/components/SessionDrawer.tsx` (or active tool-error/event surface)
- `src/gateway/server-node-events.ts` and related gateway event bridge files

- Reserved to Thread B (Memory Pack `#2`):
- `dashboard/src/components/ConfigPanel.tsx`
- `src/config/schema.ts`
- `src/config/zod-schema.agent-runtime.ts`
- `src/memory/llm-config.ts`
- `src/memory/llm-config.test.ts`

- Reserved to Thread C (Memory Pack `#3`):
- `src/infra/sis-runner.ts`
- `src/infra/sis-lesson-extractor.ts`
- `src/infra/sis-self-eval.ts`
- `src/infra/episode-types.ts`
- `src/infra/sis-runner.test.ts`
- `src/infra/sis-lesson-extractor.test.ts`

## Locking Rules

- Update your thread lock file before editing any new file.
- Do not edit files owned/locked by another thread.
- Keep lock file planned paths current as scope changes.
