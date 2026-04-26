# OpenClaw 4.24 First Wave Merge Packet

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core
Target branch: dev
Forbidden repo: ArgentAIOS/argentos
Reason: pure core foundation work

## Summary

OpenClaw lane has a first-wave implementation ready for review/merge planning.

- Lane: `openclaw`
- Branch: `codex/aos-updates-and-patching-verified`
- Current branch head while preparing this packet: `4d7604b4`
- Directive reference: prepare merge packet for first wave originally coordinated at `d67473c1`
- Status: first-wave changes are currently working-tree changes on top of `4d7604b4`
- Merge target: `dev`

Note: the branch advanced from `d67473c1` to `4d7604b4` through AOS lane work. The OpenClaw first-wave files were reapplied/verified on the current branch head.

## Intended Source/Test Files

Browser config foundation:

- `src/config/types.browser.ts`
- `src/browser/config.ts`
- `src/browser/config.test.ts`

Plugin metadata foundation:

- `src/plugins/types.ts`
- `src/plugins/manifest.ts`
- `src/plugins/manifest.test.ts`
- `src/plugins/manifest-registry.ts`
- `src/plugins/registry.ts`
- `src/plugins/loader.ts`
- `src/plugins/loader.test.ts`

Realtime voice substrate:

- `extensions/voice-call/src/realtime-voice/index.ts`
- `extensions/voice-call/src/realtime-voice/provider-types.ts`
- `extensions/voice-call/src/realtime-voice/provider-registry.ts`
- `extensions/voice-call/src/realtime-voice/provider-resolver.ts`
- `extensions/voice-call/src/realtime-voice/provider-resolver.test.ts`
- `extensions/voice-call/src/realtime-voice/session-runtime.ts`
- `extensions/voice-call/src/realtime-voice/session-runtime.test.ts`

Google Meet scaffold:

- `extensions/google-meet/package.json`
- `extensions/google-meet/argent.plugin.json`
- `extensions/google-meet/index.ts`
- `extensions/google-meet/src/setup.ts`
- `extensions/google-meet/src/setup.test.ts`
- `extensions/google-meet/src/tool.ts`
- `extensions/google-meet/src/tool.test.ts`

Ops/handoff:

- `ops/OPENCLAW_4_24_PORT_IMPLEMENTATION_PLAN.md`
- `ops/HANDOFF_OPENCLAW_4_24_FIRST_WAVE_MERGE_PACKET.md`
- `ops/THREADMASTER_COORDINATION.md`

Coordination bus state currently changed by required polling/posting:

- `ops/threadmaster-bus/acks.json`
- `ops/threadmaster-bus/messages.jsonl`

Master should decide whether bus state is included in the merge commit or handled as coordination-only state.

## Explicit Exclusions

No changes are intended for:

- `tools/aos/**`
- `src/infra/workflow-*`
- `src/gateway/server-methods/workflows*`
- `dashboard/src/components/widgets/WorkflowsWidget.tsx`
- `src/infra/app-forge-*`
- `src/gateway/server-methods/app-forge*`
- `dashboard/src/components/AppForge.tsx`
- `/Users/sem/code/argent-marketplace/**`
- `ArgentAIOS/argentos`

## Capability Truth Table

| Surface                                   | Status                                     | Evidence                                                             | Boundary                                                                            |
| ----------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Browser config fields                     | live-ready config parsing                  | `src/browser/config.test.ts` passed                                  | Config/schema only. Runtime action paths are not yet wired to these fields.         |
| Plugin manifest metadata parsing          | live-ready parser                          | `src/plugins/manifest.test.ts` passed                                | Metadata accepted and filtered; not yet rendered in dashboard/marketplace UI.       |
| Plugin record metadata surfacing          | live-ready registry surface                | `src/plugins/loader.test.ts` passed                                  | Consumers should read plugin records, not plugin internals.                         |
| Realtime voice provider registry/resolver | live-ready contract/runtime unit           | provider resolver tests passed                                       | No OpenAI/Google live adapter wired yet.                                            |
| Realtime voice bridge session runtime     | live-ready contract/runtime unit           | session runtime tests passed                                         | Not yet integrated into voice-call media streams.                                   |
| Google Meet setup/status                  | scaffold/deferred with tested setup/status | `extensions/google-meet/src/setup.test.ts` and `tool.test.ts` passed | Setup/status only.                                                                  |
| Google Meet join/create/leave/recover     | scaffold/deferred                          | Tool returns `not_implemented` for live actions                      | Do not claim live runtime support.                                                  |
| Google Meet realtime agent consult        | scaffold/deferred                          | Manifest marks planned dependency on realtime voice                  | Not wired until realtime provider lifecycle lands.                                  |
| External marketplace API/web              | not touched                                | Explicit exclusion                                                   | Requires separate coordination before editing `/Users/sem/code/argent-marketplace`. |

## Verification

Repository lane check:

```sh
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git remote get-url origin
pwd
pnpm check:repo-lane
```

Result:

- Branch: `codex/aos-updates-and-patching-verified`
- HEAD: `4d7604b4`
- Remote: `git@github.com:ArgentAIOS/argentos-core.git`
- Path: `/Users/sem/code/argent-core`
- `pnpm check:repo-lane`: passed

Focused tests:

```sh
pnpm exec vitest run \
  src/plugins/loader.test.ts \
  src/plugins/manifest.test.ts \
  src/browser/config.test.ts \
  extensions/voice-call/src/realtime-voice/provider-resolver.test.ts \
  extensions/voice-call/src/realtime-voice/session-runtime.test.ts \
  extensions/google-meet/src/setup.test.ts \
  extensions/google-meet/src/tool.test.ts
```

Result:

- 7 test files passed
- 46 tests passed
- Expected existing stderr in `src/plugins/loader.test.ts`: `fails fast on invalid plugin config`

Touched-file typecheck filter:

```sh
pnpm exec tsc --noEmit --pretty false 2>&1 | rg 'extensions/google-meet|extensions/voice-call/src/realtime-voice|src/browser/config|src/config/types.browser|src/plugins/(manifest|manifest-registry|loader|registry|types)' || true
```

Result: no touched-file typecheck output.

Diff/whitespace checks:

```sh
git diff --check -- \
  ops/THREADMASTER_COORDINATION.md \
  ops/OPENCLAW_4_24_PORT_IMPLEMENTATION_PLAN.md \
  ops/threadmaster-bus/acks.json \
  ops/threadmaster-bus/messages.jsonl \
  src/browser/config.ts \
  src/browser/config.test.ts \
  src/config/types.browser.ts \
  src/plugins/manifest.ts \
  src/plugins/types.ts \
  src/plugins/manifest-registry.ts \
  src/plugins/loader.ts \
  src/plugins/loader.test.ts \
  src/plugins/registry.ts
rg -n "[ \\t]+$" src/plugins/manifest.test.ts extensions/voice-call/src/realtime-voice extensions/google-meet ops/OPENCLAW_4_24_PORT_IMPLEMENTATION_PLAN.md || true
```

Result: clean.

Threadmaster bus state:

```sh
pnpm threadmaster:status
pnpm threadmaster:list --lane openclaw --unacked
pnpm threadmaster:task-list --lane openclaw
```

Result at packet time:

- `openclaw`: 0 unacked messages
- `openclaw`: 0 active tasks

## Known Gaps

- Google Meet live join/create/leave/recover is deferred and returns `not_implemented`.
- Realtime voice has provider-neutral contracts but no OpenAI/Google live adapter integration yet.
- Voice-call media stream still uses the existing path; it is not switched to the new realtime voice bridge.
- Browser runtime/tool action paths do not yet consume the new timeout/config fields.
- Dashboard/marketplace UI does not yet render the new plugin metadata.
- External marketplace API/web has not been touched.
- Full repo typecheck is known to have unrelated pre-existing errors outside this lane; touched-file filter is clean.

## Contract Boundaries To Preserve

- Workflows must consume plugin/browser/Meet capability metadata only; no plugin internals.
- AppForge must consume plugin metadata/setup status only; no Workflow or plugin UI imports.
- AOU should verify any parity claim against tests and mark deferred surfaces honestly.
- AOS connector contracts remain manifests, permissions, command capabilities, `action_class`, and runtime commands only.
- Google Meet live actions must stay labelled scaffold/deferred until tested against real browser/realtime runtime.

## Next Wave Proposal

Next wave should focus on browser runtime integration plus realtime voice lifecycle:

1. Browser runtime integration:
   - Thread `actionTimeoutMs` through browser action/tool execution.
   - Thread `localLaunchTimeoutMs` and `localCdpReadyTimeoutMs` through local browser launch/readiness paths.
   - Add browser setup/doctor diagnostics that report profile, CDP, and launch readiness.
   - Keep all tool schema changes additive.

2. Realtime voice lifecycle:
   - Add an OpenAI realtime voice bridge adapter using the new provider interface.
   - Add fake-provider integration tests around voice-call media stream lifecycle before changing defaults.
   - Add Google realtime provider only after OpenAI adapter contract is stable.
   - Keep `realtime.*` config optional and preserve current voice-call behavior when disabled.

3. Google Meet runtime:
   - Wire setup/status to actual browser profile readiness.
   - Add real recover-current-tab/status before join/create.
   - Enable join/create only after browser runtime and realtime voice are verified.

4. Marketplace surfacing:
   - Render plugin-record metadata in marketplace/details tooling and dashboard.
   - Coordinate separately before touching `/Users/sem/code/argent-marketplace`.

## Merge Ask

Request from `master`:

- Review this packet and assign whether OpenClaw should create a commit from this working tree or split commits by surface:
  - browser config
  - plugin metadata
  - realtime voice substrate
  - Google Meet scaffold
  - ops/bus coordination
- Confirm whether `ops/threadmaster-bus/**` changes should be included in the merge commit or treated as local coordination state.
