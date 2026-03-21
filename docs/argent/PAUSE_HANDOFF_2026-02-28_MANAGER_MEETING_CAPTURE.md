# Pause Handoff — Manager + Meeting Capture (2026-02-28)

This is a checkpoint doc to resume work quickly after switching focus to **Intent guard rails / constraints**.

## Branch + Workspace State

- Branch: `codex/pg17-cutover-migration`
- Worktree: heavily dirty with many pre-existing changes across dashboard/gateway/memory/tools.
- This checkpoint only documents the latest manager/service-start + meeting capture debugging work.

## What Was Fixed In This Checkpoint

### 1) Swift Manager service start failure (`LaunchAgent install failed ()`)

Root issue:

- Manager start path always ran install checks first and could fail on config/plugin validation in bundled runtime context.
- Existing valid LaunchAgents were blocked from starting.

Changes:

- File: `apps/argent-manager/Sources/ArgentManager/ServiceManager.swift`
- `startService(...)` now:
  - checks whether service plist already exists;
  - only runs install flow if plist is missing.
- `startAll()` now:
  - only runs install flow when there are missing plists;
  - still starts services with existing plists even if install step fails for missing ones.
- `parseError(...)` now returns `Unknown launchctl error` instead of empty `()`.

Result:

- Existing gateway/dashboard LaunchAgents can start without failing on install-time config validation.

### 2) App binary rebuild + install

Actions performed:

- Rebuilt `apps/argent-manager` release binary.
- Replaced `/Applications/ArgentOS.app/Contents/MacOS/ArgentManager`.
- Re-signed app bundle with:
  - `Developer ID Application: Jason Brashear (F2DH8T4BVH)`

## Current Known Good Runtime State (at handoff time)

LaunchAgents verified running:

- `ai.argent.gateway`
- `ai.argent.dashboard-ui`
- `ai.argent.dashboard-api`

(Use commands in Resume Checklist below to re-verify.)

## Open Items Still Not Finished

### A) Meeting transcript processing source-selection bug

Symptoms observed:

- Recording can create meeting entries/docs, but processing may fail or remain partial.
- In at least one mic-only flow, merged `.m4a` was tiny while mic `.wav` had real audio.

Likely bug:

- `meeting-recorder-tool` processing path prefers `entry.audioPath` (merged file) even when mic WAV has usable audio.

Files to inspect first:

- `src/agents/tools/meeting-recorder-tool.ts`
- `apps/argent-audio-capture/Sources/AudioCaptureService.swift`
- `apps/argent-audio-capture/Sources/EntryPoint.swift`

Fix direction:

- On stop/process, choose best audio source deterministically:
  - if merged output is tiny/invalid and mic WAV exists with bytes, transcribe mic WAV;
  - persist selected path back to meeting index entry.

### B) Mic permission UX remains brittle

Even after improvements, microphone TCC prompting can still be inconsistent for users.
Continue hardening permission request flow and status messaging in manager UI.

## Security Note (Important)

Current `~/Library/LaunchAgents/ai.argent.gateway.plist` contains many plaintext env secrets in `EnvironmentVariables`.
This is an exposure risk and should be moved toward secret-store/env-file strategy.

## Resume Checklist (copy/paste)

```bash
cd /Users/sem/code/argentos
git branch --show-current
git status --short | sed -n '1,120p'

# Verify launch agent status
launchctl print gui/$(id -u)/ai.argent.gateway | rg "state =|pid =|last exit code"
launchctl print gui/$(id -u)/ai.argent.dashboard-ui | rg "state =|pid =|last exit code"
launchctl print gui/$(id -u)/ai.argent.dashboard-api | rg "state =|pid =|last exit code"

# Verify service ports
lsof -iTCP:18789 -sTCP:LISTEN
lsof -iTCP:8080 -sTCP:LISTEN
lsof -iTCP:9242 -sTCP:LISTEN
```

## Suggested Next Work Order (after intent guardrails task)

1. Patch meeting recorder source selection fallback in `meeting-recorder-tool.ts`.
2. Test start/stop/process in all capture modes:
   - system audio only
   - mic only
   - both
3. Confirm live DocPanel transcript updates and final transcript population.
4. Add regression tests for meeting index audio-path selection.
5. Re-run manager UX pass for permission clarity + error surfaces.
