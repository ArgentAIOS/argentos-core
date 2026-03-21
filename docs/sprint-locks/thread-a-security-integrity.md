# Thread A — Identity Integrity + Tamper Evidence (Issue #92)

Branch: codex/thread-a-identity-integrity
Status: done
Locks: released

Files touched:

- src/agents/alignment-integrity.ts
- src/agents/alignment-integrity.test.ts
- src/agents/workspace.ts
- src/commands/agent.ts
- src/gateway/server.impl.ts
- src/gateway/server-methods/agents.ts
- docs/sprint-locks/thread-a-security-integrity.md

What shipped:

- Startup integrity verification for protected alignment docs: `SOUL.md`, `IDENTITY.md`, `AGENTS.md`, `USER.md`, `HEARTBEAT.md`, `CONTEMPLATION.md`, `TOOLS.md`, `MEMORY.md`.
- SHA-256 manifest generation/refresh + verification (`.argent-alignment-integrity.json`).
- Startup warnings include exact mismatched files and remediation hint; enforce mode blocks startup.
- Git status warning for tracked alignment-file mutations at startup.
- Protected write audit in `agents.files.set` + automatic manifest refresh after writes.
- Tests added for clean pass, tampered file, missing manifest, refresh flow, git mutation warning.

Validation run:

- pass: `pnpm exec vitest run src/agents/alignment-integrity.test.ts`
- pass: `pnpm exec vitest run src/gateway/boot.test.ts src/commands/agent.test.ts`
- known pre-existing failure (unrelated baseline):
  - `pnpm exec vitest run src/gateway/server-methods/agent.test.ts src/gateway/server-methods/agent-timestamp.test.ts`
  - `src/gateway/server-methods/agent.test.ts` fails with undefined store access at `src/gateway/server-methods/agent.ts:215`.
