# Pre-Existing TypeScript Errors

Cataloged: 2026-02-11 (gateway-returns branch)
Total: 38 errors across 12 files
Build status: `pnpm build` passes (bundler bypasses tsc strict checks)

---

## agents/bootstrap-files.ts (4 errors)

| Line | Code   | Issue                                                                         |
| ---- | ------ | ----------------------------------------------------------------------------- |
| 53   | TS2741 | Missing `missing` property on `WorkspaceBootstrapFile`                        |
| 255  | TS2322 | `"RECENT_CHANNEL_CONVERSATIONS.md"` not in `WorkspaceBootstrapFileName` union |
| 374  | TS2820 | `"RECENT_CONTEMPLATION.md"` should be `"CONTEMPLATION.md"`                    |
| 500  | TS2741 | Missing `missing` property on `WorkspaceBootstrapFile`                        |

## agents/pi-embedded-runner/run.ts (1 error)

| Line | Code   | Issue                                                  |
| ---- | ------ | ------------------------------------------------------ |
| 124  | TS2339 | `thinking` doesn't exist on `RunEmbeddedPiAgentParams` |

## agents/session-transcript-repair.ts (1 error)

| Line | Code   | Issue                                                                                                 |
| ---- | ------ | ----------------------------------------------------------------------------------------------------- |
| 234  | TS2322 | Content type narrowing — `{ type?: string }` not assignable to `TextContent` (needs literal `"text"`) |

## agents/tools/\*.ts (8 errors)

Tool `execute` return type missing required `details` property on `AgentToolResult`:

| File                     | Line |
| ------------------------ | ---- |
| apps-tool.ts             | 78   |
| audio-generation-tool.ts | 137  |
| doc-panel-delete-tool.ts | 44   |
| doc-panel-tool.ts        | 130  |
| sag-tool.ts              | 307  |
| web-search-tool.ts       | 202  |
| web-search-tool.ts       | 210  |
| web-tool.ts              | 157  |

Fix: Add `details: {}` or `details: null` to each tool's return object, or make `details` optional in `AgentToolResult`.

## commands/agent.ts (2 errors)

| Line | Code   | Issue                                                          |
| ---- | ------ | -------------------------------------------------------------- |
| 66   | TS2345 | `AgentToolResultContent` not assignable to `ToolResultContent` |
| 230  | TS2345 | Same content type mismatch                                     |

## gateway/server-ws-runtime.ts (1 error)

| Line | Code   | Issue                                            |
| ---- | ------ | ------------------------------------------------ |
| 285  | TS2345 | Missing `logHealth` property on handler argument |

## channels/discord/discord-plugin.ts (2 errors)

| Line | Code   | Issue                              |
| ---- | ------ | ---------------------------------- |
| 122  | TS2345 | Type mismatch in interaction reply |
| 232  | TS2345 | Type mismatch in message send      |

## channels/imessage/imessage-plugin.ts (1 error)

| Line | Code   | Issue                                           |
| ---- | ------ | ----------------------------------------------- |
| 256  | TS2345 | Missing `label` on `channelAgentMessage` params |

## memory/memo-schema.ts (7 errors)

All `Record<string, SQLOutputValue>` cast to `Observation`/`ObservationSearchResult` — node:sqlite returns generic records, code casts without `as unknown` intermediate:

Lines: 177, 245, 273, 284, 316, 324, 374

## memory/memo.ts (4 errors)

`node:sqlite` module-level vs instance-level type confusion (`typeof import("node:sqlite")` vs `DatabaseSync`):

Lines: 82, 84, 264, 266, 325, 338

## memory/memu-store.ts (6 errors)

`unknown` not assignable to `SQLInputValue` — embedding values passed without type assertion:

Lines: 424, 722, 797, 1085, 1130, 1340

---

## Suggested Fix Priority

1. **Tool `details` property** (8 errors) — single interface change or 8 one-line fixes
2. **memo/memu SQLite types** (17 errors) — add `as unknown as X` casts or fix the type definitions
3. **bootstrap-files** (4 errors) — add missing `missing` field and update filename union
4. **Everything else** (9 errors) — individual fixes
