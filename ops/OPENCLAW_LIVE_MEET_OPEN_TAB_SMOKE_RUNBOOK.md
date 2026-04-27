# OpenClaw Live Meet Open-Tab Smoke Runbook

Date: 2026-04-27
Lane: `openclaw`
Branch: `codex/openclaw-audio-process`
Target branch: `dev`

This runbook tests Google Meet `recover_current_tab` against a real already-open
Google Meet tab after the OpenClaw Google Meet recovery packet is merged.

It does not test join, create, leave, in-meeting UI control, or audio
participation.

## Prerequisites

1. Pull a dev build that includes OpenClaw commit `231e42de` or a later merge
   containing the Google Meet recovery smoke runner and lazy browser imports.
2. Use a dedicated Chrome profile for Argent browser testing.
3. Sign that Chrome profile into the Google Workspace account:
   `argent@argentos.ai`.
4. Confirm browser status works:

   ```sh
   pnpm argent browser --browser-profile chrome status --json
   ```

5. Open a real Google Meet tab manually in that Chrome profile:

   ```text
   https://meet.google.com/
   ```

   A disposable Meet URL is preferred. Do not join a private/customer meeting for
   this smoke.

## Commands

### Browser Status

```sh
pnpm argent browser --browser-profile chrome status --json
```

Expected useful fields:

- `enabled: true`
- `profile: "chrome"`
- `running`
- `cdpReady`
- `cdpHttp`
- `cdpUrl`
- `detectedBrowser`
- `detectedExecutablePath`

Success truth label:

- `browser-runtime-status-live`

Failure truth label:

- `browser-runtime-status-blocked`

Capture any diagnostic block if this fails.

### Browser Tabs

```sh
pnpm argent browser --browser-profile chrome tabs --json
```

Expected useful fields:

- `tabs`
- tab `targetId`
- tab `title`
- tab `url`

Success truth label:

- `browser-tabs-live`

Failure truth label:

- `browser-tabs-blocked`

The tab list should contain a URL beginning with:

```text
https://meet.google.com/
```

### Simulated Recovery Sanity Check

```sh
pnpm exec tsx extensions/google-meet/src/recover-smoke.ts
```

Expected useful fields:

- `ok: true`
- `truthLabel: "simulated-browser-runtime"`
- `liveBrowserRuntime: false`
- `recover.status: "recovered"`

Success truth label:

- `meet-recover-simulated`

This is not a live browser proof.

### Real Open-Tab Recovery

Use the Google Meet plugin/tool path after the packet is merged into the target
dev checkout. The test input should be:

```json
{
  "action": "recover_current_tab"
}
```

Expected useful fields:

- `ok: true`
- `action: "recover_current_tab"`
- `status: "recovered"`
- `browser.profile: "chrome"`
- `browser.cdpReady: true`
- `browser.meetTabCount: 1`
- `tab.targetId`
- `tab.url`

Success truth label:

- `meet-recover-open-tab-live`

If no Meet tab is open, expected failure fields are:

- `ok: false`
- `status: "not_found"`
- `reason: "no_meet_tab"`

No-tab truth label:

- `meet-recover-live-no-tab`

If more than one Meet tab is open, expected failure fields are:

- `ok: false`
- `status: "not_found"`
- `reason: "multiple_meet_tabs"`

Multiple-tab truth label:

- `meet-recover-live-ambiguous-tabs`

## Required Evidence Packet

Post the following to Threadmaster after the smoke:

- Branch and commit tested.
- Chrome profile name.
- Whether the profile is signed into `argent@argentos.ai`.
- Browser status JSON summary.
- Browser tabs JSON summary, redacting private tab URLs except the Meet host/code
  shape if needed.
- Google Meet recover payload.
- Truth label from this runbook.
- Whether any real meeting was joined. Expected answer for this runbook: no.
- Known gaps.

## Blocker Options

If browser status fails:

- Owner: browser/gateway.
- Suggested next action: capture diagnostics from `argent browser status --json`
  and check gateway/browser-control health.

If tabs do not show the Meet page:

- Owner: operator/OpenClaw.
- Suggested next action: confirm the test Chrome profile is the same profile the
  browser runtime controls.

If recover returns `multiple_meet_tabs`:

- Owner: operator/OpenClaw.
- Suggested next action: close extra Meet tabs or add an explicit target URL in a
  future assigned slice.

If recover returns `not_implemented`:

- Owner: release/merge coordinator.
- Suggested next action: confirm the checkout includes the OpenClaw Google Meet
  recover implementation and not the older scaffold.

If recover succeeds:

- Next possible assignment: scoped planning for Google Meet pre-join detection
  and join/leave lifecycle, still without audio claims.
