# OpenClaw 4.24 Port Implementation Plan

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: pure core foundation work

## Status

- Lane: `openclaw`
- Current branch: `codex/aos-updates-and-patching-verified`
- Current base while implementing: `d67473c1`
- Coordination: bus bootstrap and AOS broadcasts acked; master/workflows/appforge/AOU notified before first-wave source edits.
- Current implementation wave: additive browser config fields, plugin manifest metadata surfaced on plugin records, realtime voice substrate contracts, and Google Meet setup/status scaffold.

## Goal

Port the useful OpenClaw 4.24 direction into Argent core without a blind transplant:

1. Browser harness parity where it strengthens the existing Argent browser service.
2. Provider-neutral realtime voice as a shared substrate.
3. Google Meet as an installable plugin built on browser + realtime voice.
4. Marketplace metadata/preflight so high-capability plugins show permissions, native dependencies, OAuth, and setup status before use.

## Side-By-Side Implementation Map

| Area                | OpenClaw 4.24                                                                                                   | Argent Before This Wave                                 | This Wave                                                                                                         | Next                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Browser harness     | Pluginized browser extension with richer config, action timeouts, diagnostics, setup/doctor direction           | Core `src/browser`, browser tool, CLI, gateway methods  | Added optional config fields: local launch/CDP-ready/action timeouts, CDP range start, tab cleanup policy         | Wire action timeout into tool/runtime paths and add doctor/setup action                  |
| Realtime voice      | Shared `src/realtime-voice` provider registry/resolver/session runtime                                          | Voice-call has OpenAI realtime STT but no shared bridge | Added provider-neutral bridge types, registry/resolver, session runtime, tests                                    | Add OpenAI adapter, then Google adapter; integrate voice-call media stream behind config |
| Google Meet         | `extensions/google-meet` with create/join/status/setup, Chrome/Twilio transports, realtime voice, agent consult | No Google Meet extension                                | Added `extensions/google-meet` manifest, metadata, setup/status tool, tests; live join/create explicitly deferred | Wire to browser harness and realtime voice; add real join/status/recover runtime         |
| Marketplace plugins | Rich manifest/preflight patterns for permissions, transports, OAuth, setup                                      | `argent.plugin.json` only preserved core config fields  | Added optional manifest metadata fields, parser tests, and plugin-record surfacing                                | Surface metadata in dashboard, marketplace tool, external marketplace API/web            |

## Current First-Wave Files

- `src/config/types.browser.ts`
- `src/browser/config.ts`
- `src/browser/config.test.ts`
- `src/plugins/types.ts`
- `src/plugins/manifest.ts`
- `src/plugins/manifest.test.ts`
- `src/plugins/manifest-registry.ts`
- `src/plugins/registry.ts`
- `src/plugins/loader.ts`
- `src/plugins/loader.test.ts`
- `extensions/voice-call/src/realtime-voice/**`
- `extensions/google-meet/**`
- `ops/THREADMASTER_COORDINATION.md`
- `ops/threadmaster-bus/**`

## Shared Contracts

- Browser config additions are optional and default-preserving.
- Plugin manifest metadata is optional and tolerant: invalid metadata entries are filtered without rejecting the manifest, and valid metadata is exposed on plugin records.
- Realtime voice substrate is a pure contract/runtime layer; no voice-call behavior changes yet.
- Google Meet advertises only setup/status as implemented. Join/create/leave/recover return a clear deferred status until real browser/realtime integration lands.

## Required Lane Reactions

- Workflows: consume browser/Meet actions only through declared metadata/capabilities; keep serialized browser action compatibility.
- AppForge: consume plugin capability/setup metadata only; do not import plugin internals.
- AOU: verify parity claims against tests; flag scaffold-only claims.
- AOS: no connector contract change expected; do not couple connector internals to plugin metadata.
- Master: assign/approve next tasks before this lane expands to gateway/dashboard/marketplace API files.

## Next Implementation Phases

1. Browser runtime usage:
   - Thread `actionTimeoutMs`, `localLaunchTimeoutMs`, and `localCdpReadyTimeoutMs` into browser runtime/tool execution paths.
   - Add browser doctor/setup action backed by real diagnostics.
2. Realtime voice adapters:
   - Wrap existing OpenAI realtime STT/media path behind the new bridge interface.
   - Port Google realtime provider after OpenAI adapter tests pass.
3. Voice-call integration:
   - Add optional `realtime.*` config while preserving legacy default behavior.
   - Add fake-provider integration tests and voice-call regression tests.
4. Google Meet MVP:
   - Implement browser-backed status/recover/current-tab first.
   - Implement join/create only after setup checks and browser integration are real.
5. Marketplace surfacing:
   - Update dashboard/marketplace tool to show plugin-record preflight and permissions.
   - Coordinate before touching `/Users/sem/code/argent-marketplace`.

## Verification So Far

Focused first-wave tests:

```sh
pnpm exec vitest run \
  src/browser/config.test.ts \
  src/plugins/manifest.test.ts \
  src/plugins/loader.test.ts \
  extensions/voice-call/src/realtime-voice/provider-resolver.test.ts \
  extensions/voice-call/src/realtime-voice/session-runtime.test.ts \
  extensions/google-meet/src/setup.test.ts \
  extensions/google-meet/src/tool.test.ts
```

Result: 7 files passed, 46 tests passed.

Focused typecheck filter:

```sh
pnpm exec tsc --noEmit --pretty false 2>&1 | rg 'extensions/google-meet|extensions/voice-call/src/realtime-voice|src/browser/config|src/config/types.browser|src/plugins/(manifest|types)' || true
```

Result: no touched-file typecheck output.
