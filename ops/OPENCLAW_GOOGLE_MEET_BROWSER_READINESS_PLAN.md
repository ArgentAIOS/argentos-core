# OpenClaw Google Meet Browser Readiness Plan

Date: 2026-04-26
Lane: `openclaw`
Branch: `codex/openclaw-audio-process`
Baseline: `e7fdc111`

## Lane Lock

Repo: `ArgentAIOS/argentos-core`
Local path: `/Users/sem/code/argent-core`
Target branch: `dev`
Forbidden repo for this task: `ArgentAIOS/argentos`
Reason: pure core foundation work

## Truth Boundary

Google Meet is currently scaffold/status-only. The plugin can report setup/status, but live `join`, `create`, `leave`, and `recover_current_tab` return `not_implemented`.

The next truthful runtime slice should prove browser readiness and current-tab recovery before any live meeting lifecycle action. Do not claim meeting join/create/leave, microphone bridge, calendar/OAuth create, or realtime agent participation until each piece has its own live evidence.

## Current Surfaces

Google Meet extension:

- `extensions/google-meet/argent.plugin.json` declares setup/status as implemented and join/agent-consult as planned.
- `extensions/google-meet/src/setup.ts` resolves setup checks for OAuth token path, browser profile, audio bridge commands, enabled state, and default transport.
- `extensions/google-meet/src/tool.ts` returns setup/status JSON and defers live actions with `status: "not_implemented"`.
- `extensions/google-meet/src/setup.test.ts` and `extensions/google-meet/src/tool.test.ts` verify setup readiness and live-action deferral.

Browser runtime:

- `src/browser/config.ts` resolves browser profiles, default `argent` profile, built-in `chrome` extension-relay profile, launch/CDP/action timeout config, tab cleanup, and SSRF policy.
- `src/browser/routes/basic.ts` exposes profile-aware `/`, `/start`, `/stop`, `/reset-profile`, and profile CRUD.
- `src/browser/routes/tabs.ts` exposes `/tabs`, `/tabs/open`, `/tabs/focus`, `/tabs/:targetId`, and `/tabs/action`.
- `src/browser/server-context.selection.ts` already has the core recovery primitive: `ensureTabAvailable(targetId?)`, using the last target when possible and falling back to the only attached tab for extension/remote profiles.
- `src/browser/server-context.tab-ops.ts` provides tab list/open/focus/close across loopback CDP and remote Playwright profiles.

## Recommended Next Slice

Implement only a browser-backed readiness/status/recover slice for Google Meet.

### 1. Setup Status Enrichment

Future ownership:

- OpenClaw: `extensions/google-meet/src/setup.ts`
- Tests: `extensions/google-meet/src/setup.test.ts`

Add truth-labeled setup fields:

- `browserProfileConfigured`
- `browserProfileName`
- `audioBridgeConfigured`
- `oauthTokenConfigured`
- `oauthTokenPresent`
- `readyForBrowserRecovery`
- `readyForLiveActions`

Readiness labels:

- `setup-only`: setup/status can be rendered, no browser call attempted.
- `browser-profile-ready`: browser profile is configured enough to attempt status/recover.
- `browser-runtime-ready`: browser status/tabs can be queried.
- `audio-bridge-ready`: record/play commands are configured, not necessarily live-smoked.
- `live-ready`: all setup checks plus live browser/audio/manual smoke evidence. This should remain false until verified.

### 2. Browser Runtime Status

Future ownership:

- OpenClaw: `extensions/google-meet/src/tool.ts`
- Browser owner only if a missing browser API is found.

For `action: "status"`, add an optional browser-runtime status lookup:

- Resolve configured Meet browser profile.
- Query browser status for that profile.
- Query tabs if browser is reachable.
- Identify candidate Meet tabs by URL host/path:
  - `https://meet.google.com/*`
  - `https://meet.google.com/landing`
  - reject non-Meet pages
- Return a truthful status:
  - `ok: true`
  - `action: "status"`
  - `setup`
  - `browser?: { profile, running, cdpReady, tabCount, meetTabCount, currentMeetTab? }`
  - `capabilityStatus: "setup-only" | "browser-runtime-ready" | "live-ready"`

This status can be implemented through the browser client APIs or direct browser service APIs, but it should not import private Workflows/AppForge/AOS internals.

### 3. Recover Current Tab

Future ownership:

- OpenClaw: `extensions/google-meet/src/tool.ts`
- Tests: `extensions/google-meet/src/tool.test.ts`

Make `recover_current_tab` the first non-deferred browser action, but keep it read-only/browser-only:

- Require browser profile configured.
- Start/ensure browser only if configured policy allows it.
- List tabs and select the last/current Meet tab where possible.
- Focus the tab if a single Meet tab is found or a `meetingUrl`/target is supplied.
- Return `status: "recovered"` only after a Meet tab is selected/focused.
- Return `status: "blocked"` with reason labels when not recoverable.

Recommended failure labels:

- `browser_profile_missing`
- `browser_not_running`
- `browser_unreachable`
- `no_meet_tab`
- `multiple_meet_tabs`
- `target_tab_not_found`
- `non_meet_tab`
- `profile_not_found`
- `runtime_error`

Truth boundary: this recovers focus/status for an existing Meet tab. It does not join, create, admit participants, record audio, leave, or control in-meeting UI.

## Explicit Non-Goals

Do not implement in the next slice:

- `join` live meeting action.
- `create` live meeting/calendar action.
- `leave` live meeting action.
- microphone/speaker bridge into the meeting.
- realtime agent consult inside Meet.
- spoken approval or always-on voice listening.
- Google OAuth refresh/token creation flows.
- Workflows/AppForge/AOS/schema changes.
- Telephony default changes.

## Future File Ownership

OpenClaw owns:

- `extensions/google-meet/**`
- Google Meet ops notes under `ops/OPENCLAW_*`

Browser runtime owner owns:

- `src/browser/**` APIs, routes, profile semantics, timeout semantics, navigation guard behavior, tab selection behavior.

Voice owner/OpenClaw owns:

- `extensions/voice-call/src/realtime-voice/**`, but Meet must not consume voice internals until a separate task approves the audio bridge.

Workflows/AppForge/AOS reaction:

- Consume only plugin metadata/capabilities/setup status.
- Do not import Google Meet plugin internals.
- Treat `join/create/leave/live consult` as unavailable until the plugin reports a live-ready capability.

## Tests

Future automated tests:

- `extensions/google-meet/src/setup.test.ts`
  - status distinguishes setup-only, browser-profile-ready, audio-bridge-ready, and live-ready.
  - missing token/profile/audio bridge produce specific labels.

- `extensions/google-meet/src/tool.test.ts`
  - `status` includes browser status when a browser client/service is injected.
  - `status` identifies Meet tabs and ignores non-Meet tabs.
  - `recover_current_tab` blocks when browser profile is missing.
  - `recover_current_tab` blocks when no Meet tab exists.
  - `recover_current_tab` blocks when multiple Meet tabs exist and no target is supplied.
  - `recover_current_tab` returns recovered when exactly one Meet tab exists and focus succeeds.
  - `join/create/leave` remain `not_implemented`.

- Browser regression tests only if shared browser APIs change:
  - preserve profile-aware status/start/tabs/focus behavior.
  - preserve target-id ambiguity handling.
  - preserve extension-relay tab attach behavior.

## Manual Smoke Checklist

Browser status smoke:

1. Configure Google Meet plugin with `browser.profile = "chrome"` or another existing browser profile.
2. Start browser control service.
3. Run `google_meet` with `action: "status"`.
4. Confirm setup is returned and no live meeting claim is made.

Recover existing tab smoke:

1. Open or attach a Chrome tab at `https://meet.google.com/`.
2. Run `google_meet` with `action: "recover_current_tab"`.
3. Confirm response includes:
   - `status: "recovered"`
   - browser profile
   - target/tab id
   - Meet URL
   - no audio/live-join claim

Blocked smoke:

1. Run with no browser profile configured.
2. Confirm `browser_profile_missing`.
3. Run with browser profile configured but no Meet tab.
4. Confirm `no_meet_tab`.

## Blockers And Resolution Options

Blocker: Google Meet plugin currently does not call browser client/service APIs.

- Option A: Inject a tiny browser adapter into `createGoogleMeetTool` for tests and runtime.
- Option B: Call existing browser client helpers directly from the plugin.
- Recommendation: Option A for testability and smaller future refactors.

Blocker: `recover_current_tab` is currently listed with live actions and returns `not_implemented`.

- Option A: Reclassify only `recover_current_tab` as browser-readiness action.
- Option B: Keep it deferred until join/create are ready.
- Recommendation: Option A, with strict truth labels.

Blocker: Setup readiness currently treats OAuth/browser/audio checks equally for live actions.

- Option A: Add separate `readyForBrowserRecovery` and keep `readyForLiveActions` stricter.
- Option B: Keep one readiness boolean and risk overblocking browser-only recovery.
- Recommendation: Option A.

Blocker: Meeting URL validation must avoid arbitrary browser navigation.

- Option A: Recover only existing Meet tabs first; no navigation.
- Option B: Permit opening `https://meet.google.com/*` through existing browser navigation guard.
- Recommendation: Option A for next slice; Option B after recovery is proven.

## Next Assignment Request

Ask Threadmaster to approve one bounded code slice:

- Scope: `extensions/google-meet/src/setup.ts`, `extensions/google-meet/src/tool.ts`, `extensions/google-meet/src/*.test.ts`, and narrow index/export changes only if needed.
- Goal: implement browser-profile readiness labels plus read-only/browser-only `status` and `recover_current_tab`.
- Verification: focused Google Meet tests, browser client/route regression only if touched, oxlint/oxfmt touched files, `git diff --check`, `pnpm check:repo-lane`, and manual browser status/recover checklist.
