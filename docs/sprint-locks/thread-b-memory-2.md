# Thread B - Memory Issue Pack #2 Lock (MemU Guardrails)

Date: 2026-03-05
Issue:

- Memory + SIS Sprint Issue Pack #2
- docs/argent/MEMORY_SIS_ISSUE_PACK.md
  Branch:
- codex/sprint-memory-memu-guardrails-2
  Status:
- done

## Scope

- Prevent embedding-only models from being saved as MemU LLM model.
- Surface actionable UI validation and migration guidance.
- Flag existing invalid configs on load.

## Planned files (owned by Thread B)

- dashboard/src/components/ConfigPanel.tsx
- src/config/schema.ts
- src/config/zod-schema.agent-runtime.ts
- src/memory/llm-config.ts
- src/memory/llm-config.test.ts
- docs/sprint-locks/thread-b-memory-2.md

## Completion

- 2026-03-05: Implemented MemU guardrails for embedding-only model rejection in runtime config helpers and ConfigPanel save/load UX.
- Added regression tests for save-time reject and load-time invalid detection.
- File ownership released.

## Explicit non-goals / do-not-edit

- Do not edit SIS parser or SIS runner files (`src/infra/sis-*`).
- Do not edit contemplation parser files (`src/infra/contemplation-runner.ts`, `src/infra/episode-types.ts`).
- Do not edit files reserved by Thread C lock for issue pack #3.

## Acceptance targets

- `nomic-embed-text` (and other embedding-only models) cannot be saved as MemU LLM model.
- UI displays clear remediation: recommended replacement model.
- Existing invalid MemU config is detected and flagged immediately on panel load.
- Add regression tests for validator + load-time flag behavior.

## Thread prompt (copy/paste)

Implement Memory Issue Pack #2 (MemU Guardrails) only.

Scope:

1. Block embedding-only models from MemU LLM selection/save path.
2. Add UI error in ConfigPanel with specific replacement guidance.
3. On load, detect invalid saved MemU LLM config and surface a warning banner/state.
4. Add regression tests for save-time reject + load-time invalid detection.

Constraints:

- Only edit files listed in this lock.
- Do not touch SIS/contemplation files (owned by Thread C for #3).
- Keep changes minimal and production-safe.

Validation:

- `pnpm vitest run src/memory/llm-config.test.ts`
- `pnpm --dir dashboard exec tsc -p tsconfig.json --noEmit`

Deliver:

- File list changed
- Test commands + results
- Any residual risk
