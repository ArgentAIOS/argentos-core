# 2026-04-24 Richard Core Dev Stabilization

## Context

Richard's M5 was running public Core from the `dev` branch while Jason validated the Swift app and Sapphire's agent tools. The goal was to keep Richard on the normal Core update path while landing fixes in `ArgentAIOS/argentos-core` instead of carrying one-off laptop patches.

## Incidents

### Automatic reasoning fallback selected unconfigured providers

The gateway selected Amazon Bedrock as an automatic reasoning/deep-think fallback even though Bedrock was not configured on Richard's machine. This made chat errors point operators at providers they did not choose and did not have keys for.

Fix:

- `src/agents/model-selection.ts` now limits automatic reasoning selection to configured/authenticated/local providers.
- Chat and CLI call sites use that filtered selector.
- Commit: `6263c969 Keep automatic reasoning on configured providers`

Verification:

- `pnpm vitest run src/agents/model-selection.test.ts`
- `pnpm exec oxfmt --check ...`
- `pnpm exec oxlint --type-aware ...`
- `pnpm build`

### Marketplace existed but was not discoverable to agents

The `marketplace` tool was implemented and public-Core allowed, but it was not included in the always-visible deferred tool registry. Sapphire could not find it through `tool_search marketplace` in an existing session.

Fix:

- `marketplace` was added to `CORE_TOOL_NAMES`.
- Regression coverage was added for tool-search registry behavior.
- Commit: `1b90cdab Surface Marketplace as a core tool`

Verification:

- `pnpm vitest run src/agents/tool-search-registry.test.ts src/agents/argent-tools.public-core.test.ts`
- `pnpm exec oxfmt --check ...`
- `pnpm exec oxlint --type-aware ...`
- `pnpm build`

Follow-up fix:

- The first fix exposed `marketplace` in the registry, but the main agent tool
  factory still loaded it through an optional runtime import. Bundled installs
  do not preserve `./tools/marketplace-tool.js` as a physical path, so the
  optional loader silently dropped the tool from Sapphire's real callable
  surface.
- `src/agents/argent-tools.ts` now imports `createMarketplaceTool` directly and
  always includes it in Core.
- The obsolete bundled `clawhub` skill was removed, and skills CLI hints now
  point at `argent marketplace search` / `argent marketplace install`.
- Commit: `2a963f16 Make Marketplace a first-class Core tool`
- Richard's M5 verified `argent marketplace --help`, a live marketplace search,
  and Sapphire finally found the `marketplace` tool.

### MiniMax/provider turn leaked an internal JavaScript error

Sapphire's transcript recorded:

```text
Cannot read properties of undefined (reading 'some')
```

The server logs did not show a fresh gateway crash. The session JSONL showed the error as an assistant message with `stopReason: "error"` after a tool result turn. This means a malformed provider-bound transcript shape reached the model adapter and surfaced as a raw JavaScript TypeError.

Fix:

- Added `sanitizeMessagesForModelAdapter` at the embedded-runner/provider boundary.
- It repairs missing `content` on user, assistant, and tool-result messages before provider adapters see them.
- It drops tool results without a `toolCallId`, because those cannot be safely attached to a prior tool call.
- `formatAssistantErrorText` now masks undefined-property TypeErrors into a user-facing provider/runtime message instead of exposing raw JS internals.
- Commit: `5031e379 Protect provider turns from malformed transcript state`

Verification:

- `pnpm vitest run src/agents/pi-embedded-runner/run/message-sanitizer.test.ts src/agents/pi-embedded-helpers.formatassistanterrortext.test.ts src/agents/pi-embedded-runner/run/payloads.test.ts`
- `pnpm exec oxfmt --check ...`
- `pnpm exec oxlint --type-aware ...`
- `pnpm build`

## Richard M5 Deployment

Runtime path:

```text
/Users/richard/.argentos/lib/node_modules/argentos
```

Launch agents:

```text
ai.argent.gateway
ai.argent.dashboard-api
ai.argent.dashboard-ui
```

Current deployed build after this stabilization:

```json
{
  "version": "2026.4.24-dev.0",
  "commit": "2a963f16114b75da00697f9aab74b4726e6dd5f9"
}
```

Restart command pattern:

```bash
uid=$(id -u)
for label in ai.argent.gateway ai.argent.dashboard-api ai.argent.dashboard-ui; do
  launchctl kickstart -k "gui/$uid/$label"
done
```

## Follow-Up Checks

- Have Sapphire retry the same Marketplace/tool discovery workflow in a fresh turn.
- Prepare `dev` for a true public Core release; see `docs/debug/2026-04-24-core-release-readiness.md`.
- Watch for `repaired malformed transcript before model adapter` in `~/.argent/logs/gateway.log`; if present, capture the surrounding session JSONL before pruning.
- The older `memory_timeline` `Cannot read properties of undefined (reading 'trim')` errors are separate and should be fixed in the memory timeline tool.
- The older Bedrock diagnostic entries before commit `6263c969` should not recur on new turns unless a configured profile explicitly includes Bedrock.
