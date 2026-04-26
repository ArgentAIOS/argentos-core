# OpenClaw 4.24 Port Implementation Plan

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: pure core foundation work

## Coordination State

- Lane: `openclaw`
- Branch: `codex/aos-next-connector-wave`
- Current coordination commit: `ff95fe20`
- Bus bootstrap acked by `openclaw`: `tm-20260426121155-p07tc6`
- Master bus notice posted by `openclaw`: `tm-20260426122430-gpy9dc`
- Current write ownership: this plan, `ops/THREADMASTER_COORDINATION.md`, and threadmaster bus state only.
- Implementation files are not owned yet. Before touching any implementation file below, post the file ownership and contract delta to the bus and update `ops/THREADMASTER_COORDINATION.md`.

## Objective

Port the useful OpenClaw 4.24 work into Argent core dev in the order that unblocks the product direction:

1. Browser-use harness and browser automation parity.
2. Provider-neutral realtime voice substrate.
3. Google Meet plugin built on browser + realtime voice.
4. Marketplace plugin metadata, preflight, and install UX that can carry Google Meet and future high-capability plugins.

The target is not a blind copy of OpenClaw. The target is an Argent-native implementation that preserves existing browser, voice-call, marketplace, Workflows, AppForge, AOU, and AOS contracts while adding the missing upstream capabilities.

## Side-By-Side Feature Weighting

| Area | OpenClaw 4.24 Has | Argent Has Today | What Changes | Weight | Implementation Owner |
| --- | --- | --- | --- | --- | --- |
| Browser harness | Pluginized `extensions/browser`, richer profile/config defaults, doctor/setup, browser runtime API, action/schema parity, attach/existing-session direction | Core browser service/tool/CLI/gateway under `src/browser`, `src/agents/tools/browser-tool.ts`, `src/cli/browser-cli*.ts`, `src/gateway/server-methods/browser.ts` | Add missing browser config/action/diagnostic parity first; defer full pluginization until compatibility is locked | High | `openclaw` after board ownership update; Workflows/AppForge react to tool schema changes |
| Browser use harness | Browser action topology and runtime-service framing that can be used by higher-level plugins like Meet | Existing browser control service, relay, profiles, tool policy integration | Harden timeout budgeting, node selection diagnostics, action timeout, local attach semantics, stable profile resolution | High | `openclaw`; AOU verifies no scaffold-only claims |
| Realtime voice | `src/realtime-voice/*` with provider registry/resolver, bridge session runtime, agent consult tool, Google provider support | `extensions/voice-call` has OpenAI realtime STT/media stream pieces but no shared provider-neutral substrate | Add a reusable realtime bridge with OpenAI first, Google second, preserving current voice-call defaults | Critical | `openclaw`; AppForge/Workflows react if provider/tool metadata is surfaced |
| New AI voice | Provider-neutral realtime session that can power Meet and call flows; model/provider config is not tied to telephony | TTS and voice-call provider overrides, Telegram voice bubble handling, OpenAI realtime STT | Introduce realtime voice as a reusable session substrate rather than another call-only branch | Critical | `openclaw` with voice-call extension ownership update |
| Google Meet plugin | `extensions/google-meet` with create/join/status/setup, OAuth, Chrome/Twilio transports, audio bridge, agent consult | No Google Meet extension; marketplace and plugin system can install extensions | Build an Argent `extensions/google-meet` MVP with create/join/leave/status/setup and one local Chrome transport first | High | `openclaw`; marketplace/AppForge react to plugin capability metadata |
| Marketplace plugin patterns | Rich plugin manifest for config, setup checks, transports, permissions, OAuth, realtime voice provider selection | `argent.plugin.json`, install tooling, dashboard MarketplaceTab, external marketplace API/web | Extend manifest/package metadata with capabilities, setup checks, native requirements, runtime surfaces, permission preview | High | Core + marketplace lanes; must coordinate before touching `/Users/sem/code/argent-marketplace` |
| Better diagnostics | Browser doctor, setup status, transport checks, audio bridge checks | Security audit, runtime services tool, some connector setup cards | Add preflight as a first-class plugin capability and expose it in CLI/dashboard/marketplace | Medium | `openclaw` + AppForge/dashboard owners |

## Decision Drivers

- Realtime voice is a product priority and should become a shared substrate, not a one-off Google Meet implementation.
- Browser harness stability comes before Google Meet because Meet depends on deterministic browser/session behavior.
- Marketplace support must describe plugin capabilities before install so users can understand OAuth, native audio, browser, and permission requirements.
- Existing behavior must remain stable: current browser tool names, voice-call webhook behavior, and marketplace install path should keep working.
- Shared-contract work must be additive first; breaking or renaming public actions waits for an explicit migration plan.

## Architecture Choice

Chosen path: phased additive port.

Alternatives considered:

- Full OpenClaw directory transplant. Rejected because Argent already has browser, plugin, voice-call, and marketplace contracts with active downstream consumers.
- Build Google Meet first and backfill substrate later. Rejected because it would duplicate realtime voice/session/audio logic and make voice-call convergence harder.
- Marketplace-first packaging. Rejected because package metadata is only useful once core can validate runtime/preflight capability checks locally.

Consequences:

- Early phases are less flashy but reduce regressions.
- Google Meet MVP becomes smaller and more dependable.
- The marketplace can present real capabilities instead of marketing claims.

## Phase 0 - Coordination And Baseline

Owned files before implementation:

- `ops/OPENCLAW_4_24_PORT_IMPLEMENTATION_PLAN.md`
- `ops/THREADMASTER_COORDINATION.md`
- Threadmaster bus state under `ops/threadmaster-bus/**`

Required actions:

1. Post this plan to `master` over the bus.
2. Ask `master` to assign or approve implementation lane ownership before source edits.
3. Add overlap-zone rows for browser, realtime voice, Google Meet plugin, and marketplace metadata before source edits.
4. Run the lane lock check before every push or handoff:

```sh
git remote get-url origin
pwd
git rev-parse --abbrev-ref HEAD
pnpm check:repo-lane
```

Acceptance criteria:

- `openclaw` has no unacked bus messages.
- Master has a durable pointer to this plan.
- No implementation source files are modified before the board advertises ownership.

## Phase 1 - Browser Harness Foundation

Primary Argent files:

- `src/config/types.browser.ts`
- `src/browser/config.ts`
- `src/browser/profiles-service.ts`
- `src/browser/control-service.ts`
- `src/browser/client-fetch.ts`
- `src/agents/tools/browser-tool.ts`
- `src/agents/tools/browser-tool.schema.ts`
- `src/agents/argent-tools.ts`
- `src/cli/browser-cli*.ts`
- `src/gateway/server-methods/browser.ts`
- `src/gateway/server-methods.ts`

OpenClaw references:

- `/Users/sem/code/openclaw-official/openclaw/extensions/browser/**`
- `/Users/sem/code/openclaw-official/openclaw/src/config/types.browser.ts`

Implementation:

1. Add optional browser config fields with safe defaults:
   - `localLaunchTimeoutMs`
   - `localCdpReadyTimeoutMs`
   - `actionTimeoutMs`
   - `cdpPortRangeStart`
   - richer `tabCleanup`
   - normalized `allowPrivateNetwork` / `dangerouslyAllowPrivateNetwork` alias handling
2. Preserve existing `argent` and `extension` profile behavior.
3. Harden `browser.request` dispatch diagnostics and timeout budgeting.
4. Add browser doctor/setup status as an additive diagnostic action.
5. Add `existing-session` / attach-only behavior behind an explicit feature flag after config and tool contract tests pass.

What's better:

- Workflows and AppForge can rely on clearer browser failure reasons.
- Browser automation gets deterministic timeout and profile behavior.
- The Google Meet plugin gets a supported browser substrate instead of private Chrome assumptions.

Tests:

- Config normalization tests for alias precedence and defaults.
- Browser tool schema tests for backward-compatible existing actions.
- Gateway routing tests for local/node/sandbox dispatch and timeout behavior.
- CLI parser/help regression tests for browser commands.
- Optional local smoke for existing-session attach.

Cross-lane reactions:

- Workflows/AppForge must treat browser tool schema changes as additive and keep serialized workflow action compatibility.
- AOU should verify new browser actions are real, tested, and not scaffold-only.
- AOS should not consume browser implementation internals; use manifest/capability metadata only.

## Phase 2 - Provider-Neutral Realtime Voice

Primary Argent files:

- `extensions/voice-call/src/config.ts`
- `extensions/voice-call/src/runtime.ts`
- `extensions/voice-call/src/webhook.ts`
- `extensions/voice-call/src/media-stream.ts`
- `extensions/voice-call/src/providers/base.ts`
- `extensions/voice-call/src/providers/stt-openai-realtime.ts`
- `extensions/voice-call/src/response-generator.ts`
- `extensions/voice-call/src/manager.ts`
- `extensions/voice-call/src/types.ts`
- New: `extensions/voice-call/src/realtime-voice/**`

OpenClaw references:

- `/Users/sem/code/openclaw-official/openclaw/src/realtime-voice/**`
- `/Users/sem/code/openclaw-official/openclaw/extensions/google/realtime-voice-provider.ts`
- `/Users/sem/code/openclaw-official/openclaw/extensions/google-meet/src/realtime.ts`
- `/Users/sem/code/openclaw-official/openclaw/extensions/google-meet/src/agent-consult.ts`

Implementation:

1. Add provider-neutral types:
   - `RealtimeVoiceProvider`
   - `RealtimeVoiceBridge`
   - `RealtimeVoiceCallbacks`
   - transcript, audio, mark, clear-audio, tool-call events
2. Add provider registry/resolver:
   - `openai` adapter first, wrapped around existing realtime STT/media behavior
   - `google` adapter second, ported from OpenClaw after the OpenAI path is stable
3. Add `createRealtimeVoiceBridgeSession`:
   - pending audio until ready
   - mark strategy
   - transcript callbacks
   - tool-call callbacks
   - close/error propagation
   - optional greeting
4. Keep default voice-call behavior unchanged unless new `realtime.*` config is enabled.
5. Introduce an Argent equivalent of agent consult as an opt-in tool-call policy, default read-only.

What's better:

- Realtime voice becomes reusable across voice-call, Google Meet, and future live collaboration plugins.
- Provider choice stops being embedded in one telephony path.
- Tool calls from voice sessions get one policy/audit surface.

Tests:

- Provider resolver: missing provider, unknown provider, malformed provider config.
- Session runtime: pending audio, mark strategy, close/error, transcript, tool-call callback.
- Media stream: legacy branch parity and realtime branch behavior with a fake provider.
- Voice-call regression: Twilio/Telnyx/Plivo webhook security and lifecycle remain unchanged.
- Manual smoke: `realtime.enabled=false` produces no behavior delta.

Cross-lane reactions:

- Workflows must treat realtime tool-call events as opt-in action metadata, not automatic workflow triggers.
- AppForge must not expose provider selection UI until config schema and setup checks are stable.
- AOU should check that realtime provider IDs are canonical and not duplicated in another registry.

## Phase 3 - Google Meet Plugin MVP

Primary Argent files:

- New: `extensions/google-meet/**`
- `src/plugins/manifest.ts`
- `src/plugins/types.ts`
- `src/plugins/loader.ts`
- `src/plugins/registry.ts`
- `src/agents/tools/marketplace-tool.ts`
- `dashboard/src/components/MarketplaceTab.tsx`
- `dashboard/src/components/ConnectorSetupCard.tsx`
- `dashboard/src/lib/connectorSetup.ts`

OpenClaw references:

- `/Users/sem/code/openclaw-official/openclaw/extensions/google-meet/**`

MVP scope:

- Actions: `create`, `join`, `leave`, `status`, `setup`, `recoverCurrentTab`.
- Transport: local Chrome/Chrome-node first.
- Audio: command audio bridge with setup status, but no hidden native install assumptions.
- Voice: use Phase 2 realtime voice bridge.
- Agent consult: opt-in, policy-gated, read-only by default.
- OAuth: token path/config support without exposing secrets in marketplace metadata.

Deferred from MVP:

- Twilio transport parity.
- Full live transcript artifacts.
- Calendar/Drive enrichment beyond what the existing Google Workspace extension can safely provide.
- Automatic native dependency installation.

What's better:

- Google Meet ships as a marketplace-capable plugin instead of bespoke core behavior.
- Browser and realtime voice improvements are reusable by other plugins.
- Setup failures become explicit: OAuth, Chrome profile, audio bridge, and transport readiness.

Tests:

- Manifest validation and plugin loader registration.
- Runtime action routing for `create`, `join`, `leave`, `status`, `setup`.
- Setup status with fake OAuth/Chrome/audio bridge states.
- Realtime bridge integration with a fake provider.
- Manual local smoke for join/status using a test Meet or dry-run transport.

Cross-lane reactions:

- Workflows can expose Meet actions only after plugin capabilities are declared and stable.
- AppForge can show plugin capability metadata, but must not import Meet internals.
- AOU should verify the plugin does not advertise Twilio or full transcript artifacts before those are implemented.

## Phase 4 - Marketplace Metadata And Install Preflight

Primary Argent core files:

- `src/plugins/manifest.ts`
- `src/plugins/types.ts`
- `src/plugins/install.ts`
- `src/channels/plugins/catalog.ts`
- `src/cli/plugins-cli.ts`
- `src/agents/tools/marketplace-tool.ts`
- `dashboard/src/components/MarketplaceTab.tsx`
- `dashboard/src/components/MarketplacePanel.tsx`
- `dashboard/src/components/ConnectorSetupCard.tsx`
- `dashboard/src/lib/connectorSetup.ts`

Marketplace repo files that require separate coordination before edits:

- `/Users/sem/code/argent-marketplace/apps/api/src/routes/catalog.ts`
- `/Users/sem/code/argent-marketplace/apps/api/src/routes/publish.ts`
- `/Users/sem/code/argent-marketplace/apps/api/src/db/schema.ts`
- `/Users/sem/code/argent-marketplace/apps/api/src/db/queries.ts`
- `/Users/sem/code/argent-marketplace/apps/web/src/components/PackageCard.tsx`
- `/Users/sem/code/argent-marketplace/apps/web/src/pages/PackagePage.tsx`
- `/Users/sem/code/argent-marketplace/apps/web/src/pages/SubmitPage.tsx`

Implementation:

1. Extend Argent plugin manifests with optional metadata:
   - `capabilities`
   - `permissions`
   - `runtimeSurfaces`
   - `nativeDependencies`
   - `setupChecks`
   - `oauthProviders`
   - `installNotes`
2. Keep unknown-field tolerance where compatibility requires it, but surface known metadata through registry/catalog APIs.
3. Update marketplace install/details tooling to show preflight requirements before install.
4. Update dashboard marketplace detail/install flow to render:
   - what the plugin can do
   - required permissions
   - setup checks
   - native requirements
   - remediation commands or docs links
5. Coordinate the external marketplace API/web changes before editing `/Users/sem/code/argent-marketplace`.

What's better:

- Marketplace plugins become inspectable operational units, not opaque packages.
- Google Meet can explain Chrome/OAuth/audio requirements before installation.
- Future plugins get the same install trust model.

Tests:

- Manifest parser tests for optional metadata and backward compatibility.
- Plugin registry/catalog tests to expose metadata.
- Marketplace tool tests for details/install preflight display.
- Dashboard rendering tests for capability and setup sections.
- Marketplace API/web contract tests after that repo is explicitly coordinated.

Cross-lane reactions:

- AppForge can consume plugin capability metadata, but should not assume install success until local preflight passes.
- Workflows can map plugin actions only through capability metadata.
- AOU should flag marketplace packages that advertise capabilities without setup checks or test evidence.

## Phase 5 - Integration And Release Gate

Sequence:

1. Browser harness foundation lands and is verified.
2. Realtime voice substrate lands behind config/feature flag and is verified with fake provider plus existing voice-call regression.
3. Google Meet plugin MVP lands disabled-by-default or config-gated.
4. Marketplace metadata lands in core.
5. External marketplace API/web updates land only after core metadata shape is stable.
6. Dashboard install/preflight UX lands against the stable metadata.

Release criteria:

- No browser tool or voice-call legacy behavior regressions.
- Google Meet plugin actions are real and tested or explicitly hidden.
- Marketplace displays plugin capabilities and setup requirements without leaking secrets.
- Workflows/AppForge consume only metadata/capabilities/events.
- AOU signs off that advertised OpenClaw parity claims match tested behavior.

## Proposed Task Breakdown

| Task | Owner | Dependencies | Output |
| --- | --- | --- | --- |
| Browser contract baseline | `openclaw` | Phase 0 | Additive browser config/schema/gateway plan and tests |
| Browser existing-session feature | `openclaw` | Browser baseline | Feature-flagged attach support |
| Realtime voice substrate | `openclaw` | Phase 0 | Provider-neutral bridge, fake-provider tests, OpenAI adapter |
| Google realtime provider | `openclaw` | Realtime substrate | Google adapter ported from OpenClaw |
| Google Meet plugin MVP | `openclaw` | Browser + realtime | Installable extension with create/join/status/setup |
| Core marketplace metadata | `openclaw` + master coordination | Manifest plan | Core parser/catalog/tool/dashboard support |
| Marketplace API/web metadata | marketplace owner | Core metadata stable | API/web support for plugin capabilities/preflight |
| Cross-lane verification | master + AOU | Each phase | Stub/parity and contract verification |

## Verification Commands

Use focused tests per phase, then broaden before push:

```sh
pnpm check:repo-lane
pnpm exec vitest run src/agents/tools/browser-tool.test.ts
pnpm exec vitest run extensions/voice-call/src/config.test.ts extensions/voice-call/src/media-stream.test.ts
pnpm exec vitest run src/plugins/manifest.test.ts src/plugins/registry.test.ts
pnpm exec oxlint --type-aware <changed-files>
pnpm threadmaster:status
pnpm threadmaster:list --lane openclaw --unacked
pnpm threadmaster:task-list --lane openclaw
```

Add Playwright/browser smoke only after UI or browser runtime changes exist.

## Bus Messages To Send Before Implementation

Suggested master handoff:

```sh
pnpm threadmaster:post --from openclaw --to master --subject "OpenClaw 4.24 port plan ready" --body "Plan: ops/OPENCLAW_4_24_PORT_IMPLEMENTATION_PLAN.md. Proposed sequence: browser harness foundation, realtime voice substrate, Google Meet plugin MVP, marketplace metadata/preflight. Request lane ownership approval before implementation files are touched."
```

Suggested cross-lane contract notices after master approval:

```sh
pnpm threadmaster:post --from openclaw --to workflows --subject "Browser/realtime capability contracts incoming" --body "OpenClaw port proposes additive browser tool config/actions and opt-in realtime voice tool-call events. Workflows should consume only declared capabilities/metadata and keep serialized action compatibility."
pnpm threadmaster:post --from openclaw --to appforge --subject "Marketplace plugin capability metadata incoming" --body "OpenClaw port proposes plugin manifest metadata for capabilities, setupChecks, runtimeSurfaces, nativeDependencies, oauthProviders, and permissions. AppForge should consume metadata only, not plugin internals."
pnpm threadmaster:post --from openclaw --to aou --subject "OpenClaw parity verification request" --body "Please verify browser/realtime/Google Meet marketplace claims as implementation lands. Flag any advertised actions that are setup-only or scaffold-only."
pnpm threadmaster:post --from openclaw --to aos --subject "No AOS connector contract change expected" --body "OpenClaw port should not consume tools/aos internals. If plugin capability metadata overlaps connector manifests, openclaw will coordinate before changing shared capability shapes."
```
