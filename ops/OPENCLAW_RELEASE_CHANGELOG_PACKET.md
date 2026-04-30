# OpenClaw Release Changelog Packet

Date: 2026-04-27
Lane: `openclaw`
Branch: `codex/openclaw-audio-process`
Current head: `231e42de`
Target branch: `dev`
Forbidden repo: `ArgentAIOS/argentos`

This packet preserves public-facing release-note language for the OpenClaw 4.24
port work so it is not lost before the next dev release.

## Public Highlights

- Added the foundation for realtime voice sessions, including a provider-neutral
  voice lifecycle, deterministic test provider coverage, and a live OpenAI
  Realtime adapter path.
- Added local operator voice smoke tooling so live and simulated voice evidence
  are clearly labeled.
- Added Google Meet setup/status support and a browser-only recovery path for an
  already-open Meet tab.
- Added browser runtime diagnostics that make browser-control failures easier to
  understand and hand off.
- Added plugin capability metadata so marketplace and plugin surfaces can show
  what is implemented, planned, or deferred.
- Added an optional operator-alert voice route and a shared alert router contract
  for future approval/notification voice output.

## Changes

### Realtime Voice Foundation

Argent now has a provider-neutral realtime voice substrate under the voice-call
extension. It includes session lifecycle primitives, deterministic fake-provider
tests, transcript/audio/tool-call event handling, and clear separation between
test-only fake behavior and live provider behavior.

Impact:

- Gives Argent a stable foundation for voice-to-voice agent sessions.
- Keeps simulated and live voice evidence clearly separated.
- Enables later desktop, terminal, phone, and meeting voice entrypoints to share
  one voice session core.

How it is used:

- Developers use focused realtime voice tests and smoke harnesses to validate
  session lifecycle behavior.
- Live provider paths require explicit live configuration and credentials.

Truth label:

- The substrate is implemented and tested.
- A polished always-available operator voice product flow is not complete yet.

### OpenAI Realtime Adapter

Argent now includes an OpenAI Realtime provider path for live voice-session
experiments.

Impact:

- Moves realtime voice beyond fake-provider-only testing.
- Provides a concrete path for live model audio/text events.

How it is used:

- Configure `OPENAI_API_KEY`.
- Run the OpenAI realtime live smoke harness from the voice-call realtime voice
  extension.

Truth label:

- Live OpenAI Realtime smoke has been proven at adapter/session level.
- Full always-on operator mic/speaker UX is still future product work.

### Local Operator Voice And Audio Smoke Tooling

Argent now has local operator voice/audio smoke tooling with explicit dry-run and
process-mode evidence labels.

Impact:

- Gives the team a repeatable terminal path for validating microphone/speaker
  integration work.
- Helps prevent fake or simulated voice evidence from being mistaken for live
  operator voice calls.

How it is used:

- Run the realtime voice local audio smoke or operator voice CLI harness with the
  required explicit environment gates.

Truth label:

- Local audio smoke paths exist.
- A desktop app "Talk to Argent" button, global hotkey, phone-call entrypoint,
  and polished always-available voice UX are not complete yet.

### Optional Operator Alert Voice Route

Argent now has an optional voice route for operator alert events. It is gated,
disabled by default, and privacy-conscious.

Impact:

- Creates a path for future approvals, reminders, or urgent operator alerts to
  be spoken aloud.
- Keeps alert voice output opt-in instead of always-on.

How it is used:

- A caller routes an `OperatorAlertEvent` into the voice route or shared router.
- The route performs explicit preflight checks and reports failure labels.

Truth label:

- Callable route and router registration are implemented.
- Workflows does not automatically send approval alerts to voice yet.

### Shared Operator Alert Router

Argent now has a small in-process operator alert router contract that can route
`OperatorAlertEvent` values to registered sinks.

Impact:

- Lets OpenClaw consume operator alert events without importing Workflow UI or
  runtime internals.
- Gives Workflows a future contract for voice-alert routing if Threadmaster
  approves that integration.

How it is used:

- Sinks register with the router.
- Callers route an `OperatorAlertEvent` and receive sent/skipped/failed
  summaries.

Truth label:

- Contract is implemented and tested.
- Automatic workflow approval-to-voice routing remains deferred.

### Browser Runtime Diagnostics

Browser-control failures now include richer diagnostic context for request path,
profile, timeout, gateway target/source, and recommended follow-up commands.

Impact:

- Makes browser harness failures easier to debug.
- Gives Threadmaster and lane owners actionable evidence instead of opaque
  WebSocket close messages.

How it is used:

- Run `pnpm argent browser --browser-profile chrome status --json`.
- Run `pnpm argent browser --browser-profile chrome tabs --json`.
- If a gateway/browser failure occurs, inspect the diagnostic block.

Truth label:

- Diagnostics are implemented and verified.
- They do not restart or repair the browser runtime automatically.

### Google Meet Setup And Browser Recovery

Argent now has a Google Meet plugin surface for setup/status and a browser-only
`recover_current_tab` action. The recovery action is scoped to finding and
focusing an already-open Meet tab.

Impact:

- Gives the agent a truthful first Google Meet integration step before attempting
  live meeting control.
- Separates "recover/focus an existing Meet tab" from join/create/leave claims.

How it is used:

- Configure a browser profile for Google Meet, such as a dedicated Chrome profile
  signed into the Google Workspace account `argent@argentos.ai`.
- Run Google Meet setup/status through the plugin.
- After merge, use the live open-tab smoke runbook to test recovery against a
  real open Meet tab.

Truth label:

- Setup/status and browser-only recovery logic are implemented and tested.
- Simulated recovery smoke is available and clearly labeled.
- Live recovery against a real open Meet tab still needs operator smoke.
- Join, create, leave, in-meeting control, and Meet audio participation remain
  deferred.

### Google Meet Recover Smoke Runner

Argent now includes an extension-local Google Meet recovery smoke runner that
exercises setup/status/recover logic without pulling the broader runtime package
path that blocked ad hoc `tsx` smoke.

Impact:

- Provides a stable, repeatable smoke command for recovery logic.
- Keeps the output explicitly labeled as simulated browser-runtime evidence.

How it is used:

```sh
pnpm exec tsx extensions/google-meet/src/recover-smoke.ts
ARGENT_GOOGLE_MEET_RECOVER_SMOKE_MODE=no-meet-tab pnpm exec tsx extensions/google-meet/src/recover-smoke.ts
```

Truth label:

- This is `simulated-browser-runtime` evidence.
- It is not a live Google Meet tab proof.

### Plugin And Marketplace Metadata

Plugin records now carry richer capability/runtime metadata so marketplace and
plugin surfaces can communicate implemented, planned, and deferred features more
truthfully.

Impact:

- Helps users and operators understand what a plugin can actually do today.
- Reduces the chance of scaffolded/deferred features being presented as live.

How it is used:

- Plugin loaders and marketplace-facing surfaces consume manifest/runtime
  metadata.

Truth label:

- Metadata plumbing is in place.
- External marketplace website presentation should still follow its own release
  process.

## Not Included Yet

- Google Meet live join/create/leave.
- Google Meet in-meeting UI control.
- Google Meet audio bridge for agent listening/speaking inside a meeting.
- Phone-call access to the operator voice agent.
- Desktop app voice button/global hotkey.
- Automatic workflow approval alerts to voice.
- Live recovery proof against an actually open Google Meet tab.

## Release Note Candidate

```md
### OpenClaw Browser, Voice, And Google Meet Foundations

- Added realtime voice foundations, including OpenAI Realtime adapter support,
  deterministic lifecycle tests, and local operator voice smoke tooling.
- Added browser Talk realtime session methods so browser clients can request a
  server-side realtime provider session, use OpenAI ephemeral WebRTC client
  secrets, or use gateway PCM relay controls without exposing provider API keys.
- Added browser runtime diagnostics for clearer browser-control failures.
- Added Google Meet setup/status support and browser-only recovery for an
  already-open Meet tab.
- Added plugin capability metadata for marketplace/plugin surfaces.
- Added optional operator-alert voice routing foundations.

Known limitations: Google Meet join/create/leave, in-meeting audio participation,
phone-call voice access, Gemini/Google Live provider parity, remote OpenAI
browser WebRTC smoke, and a polished desktop voice-call UX are not included in
this release. Google Meet recovery is implemented for existing tabs, with live
open-tab smoke still pending.
```

## Root Changelog Ready Section

```md
### OpenClaw Browser, Voice, And Google Meet Foundations

User-visible changes:

- Added browser runtime diagnostics that make browser-control failures easier to
  understand, including profile, timeout, route, and gateway context.
- Added realtime voice foundations with OpenAI Realtime adapter support, local
  operator audio smoke tooling, and explicit fake-vs-live evidence labels.
- Added browser Talk realtime session methods for OpenAI ephemeral browser
  sessions and provider-agnostic gateway relay controls.
- Added optional operator voice-alert foundations for future spoken approvals or
  urgent operator alerts.
- Added Google Meet setup/status support plus browser-only recovery for an
  already-open Meet tab.
- Added plugin/marketplace capability metadata so implemented, planned, and
  deferred OpenClaw features can be described truthfully.

Operator testing notes:

- For voice, set `OPENAI_API_KEY` and use the gated realtime/local audio smoke
  commands. Live provider and local process-mode evidence must stay labeled as
  live; fake-provider tests remain test-only.
- For Google Meet, use a dedicated Chrome profile signed into the Google
  Workspace account `argent@argentos.ai`, open a Meet tab manually, then run the
  live open-tab recovery smoke from
  `ops/OPENCLAW_LIVE_MEET_OPEN_TAB_SMOKE_RUNBOOK.md`.
- Browser status and tab checks should be captured before Meet recovery smoke so
  failures include actionable diagnostics.

Known gaps/deferred work:

- Google Meet join/create/leave, in-meeting control, and Meet audio
  participation are not included yet.
- Live Google Meet open-tab recovery still needs operator smoke after the
  recovery packet is merged into `dev`.
- Phone-call voice access and a polished always-available desktop voice UX are
  not included yet.
- Workflow approval events do not automatically trigger voice output yet.

Included OpenClaw branches/commits:

- Branch `codex/openclaw-audio-process`.
- `231e42de` Google Meet recover smoke runner and lazy browser imports.
- `43e297df` release changelog packet and live Meet open-tab smoke runbook.
- `64ec1738` coordination-board pointer for release/master handoff.
- Earlier OpenClaw voice/browser slices already merged to `dev`, including
  shared alert router and browser diagnostics at `5ec42d61`.
```

## Verification Evidence To Keep With Release Notes

- Google Meet setup/tool/recover smoke tests: `13/13`.
- Google Meet simulated recover smoke: `ok: true`, `truthLabel:
simulated-browser-runtime`, `status: recovered`.
- Google Meet no-tab smoke: `ok: true`, `truthLabel: simulated-browser-runtime`,
  `reason: no_meet_tab`.
- Browser status/tabs CLI returned JSON for profile `chrome`.
- Browser diagnostics added and verified in focused gateway/CLI tests.
- Realtime voice and local audio smoke packets were posted separately in the
  Threadmaster bus with focused test counts and live/simulated labels.
