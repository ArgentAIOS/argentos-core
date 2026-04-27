# OpenClaw Operator Alert Voice Adapter Notes

Date: 2026-04-26
Lane: `openclaw`
Branch: `codex/openclaw-audio-process`
Baseline: `685e0aea`

## Lane Lock

Repo: `ArgentAIOS/argentos-core`
Local path: `/Users/sem/code/argent-core`
Target branch: `dev`
Forbidden repo for this task: `ArgentAIOS/argentos`
Reason: pure core foundation work

## Purpose

These notes prepare the OpenClaw side of voice alerts while Workflows defines the shared `OperatorAlertEvent` producer contract. No runtime code should be added until that contract exists.

Voice remains an optional notification output. It is not always-on listening, not spoken approval resolution, not Google Meet support, and not a telephony default.

## Expected Input Contract

OpenClaw should consume a stable shared event from the future contract owner. The voice adapter only needs these fields:

```ts
type VoiceAlertInput = {
  id: string;
  severity: "info" | "warning" | "urgent";
  category: "approval" | "reminder" | "runtime" | "security" | "system";
  title: string;
  summary: string;
  createdAt: string;
  expiresAt?: string;
  correlationId?: string;
  approval?: {
    type: "exec" | "workflow";
    id: string;
    approveHint: string;
    denyHint: string;
  };
  privacy: {
    speakPayload: "title-only" | "summary" | "redacted";
    mayIncludeSecrets: false;
    rawAudioCapture: false;
  };
  route: {
    channel: "voice";
    mode: "dry-run" | "process";
    providerId: "openai";
    voice?: string;
    maxDurationMs?: number;
    requireLiveConfirmation: true;
  };
};
```

If the shared contract changes field names, OpenClaw should adapt through a tiny mapper inside the voice-call extension instead of importing Workflows internals.

## Adapter Behavior

Future OpenClaw-owned adapter:

- File: `extensions/voice-call/src/realtime-voice/operator-alert-voice-route.ts`
- Exports a pure preflight function and a run function:
  - `preflightOperatorAlertVoiceRoute(input, env)`
  - `runOperatorAlertVoiceRoute(input, options)`
- Builds a short spoken phrase from `title`, `severity`, and the allowed privacy summary.
- Refuses to read command strings, raw previous outputs, secrets, credentials, or arbitrary payload bodies.
- Reports dry-run versus process-mode evidence using the same truth labels as the current operator voice CLI.
- Does not resolve approvals by speech. It may speak approval hints like "approval required" and "check Telegram or dashboard."

Suggested spoken text:

```text
Urgent approval needed. Deploy workflow is waiting. Open Telegram or the dashboard to approve or deny.
```

For `privacy.speakPayload === "title-only"`, speak only severity and title.
For `privacy.speakPayload === "redacted"`, speak title plus a generic redacted summary.
For `privacy.speakPayload === "summary"`, speak the sanitized summary only after redaction checks pass.

## Gates

Voice route is disabled unless the shared event explicitly includes a voice route and local configuration allows it.

Required live/process gates:

- `OPENAI_API_KEY` configured.
- `ARGENT_REALTIME_AUDIO_PROCESS_ENABLE=1`.
- `ARGENT_REALTIME_AUDIO_CONFIRM_LIVE=1`.
- `ffmpeg` available when process-mode input is needed.
- `ffplay` available when local speaker playback is needed.
- `route.providerId === "openai"`.
- `route.requireLiveConfirmation === true`.

Raw audio capture remains disabled by default:

- `ARGENT_REALTIME_AUDIO_CAPTURE_PATH` must be unset for normal alert playback.
- If it is set, the adapter must return evidence that raw audio capture was explicitly enabled.

## Privacy Defaults

Default voice route policy:

- Speak title-only unless config explicitly allows summary.
- Never speak secrets, command bodies, environment variables, credentials, previous-output full bodies, or uploaded file content.
- Keep maximum spoken text short enough for an alert, not a transcript.
- Keep cooldown and dedupe outside the voice adapter in the shared alert router.
- Do not persist raw audio unless an explicit capture path is configured.
- Do not start microphones for one-way alert playback unless the selected mode truly needs input; alert playback should prefer output-only where the eventual adapter supports it.

## Failure Labels

Reuse the existing CLI labels where possible and add voice-alert-specific labels only at the adapter boundary:

- `missing_audio_process_gate`
- `missing_audio_live_confirmation`
- `missing_openai_api_key`
- `missing_ffmpeg`
- `missing_ffplay`
- `unsupported_platform`
- `privacy_policy_blocked`
- `voice_route_not_configured`
- `voice_route_not_enabled`
- `unsupported_provider`
- `expired_alert`
- `smoke_failed`
- `microphone_or_speaker_permission`
- `runtime_error`

The route result should include:

- `ok`
- `status: "passed" | "blocked" | "failed"`
- `alertId`
- `correlationId`
- `mode`
- `providerId`
- `realDeviceEvidence`
- `failureType`
- `error`

## Manual Smoke Checklist

Dry-run smoke:

1. Create a redacted test `OperatorAlertEvent` with `route.channel = "voice"` and `mode = "dry-run"`.
2. Verify preflight reports provider/key/gate state without printing secrets.
3. Verify result reports `realDeviceEvidence=false`.
4. Verify spoken text rendering excludes approval command bodies and previous-output bodies.

Process-mode smoke:

1. Configure `OPENAI_API_KEY`.
2. Set `ARGENT_REALTIME_AUDIO_PROCESS_ENABLE=1`.
3. Set `ARGENT_REALTIME_AUDIO_CONFIRM_LIVE=1`.
4. Leave `ARGENT_REALTIME_AUDIO_CAPTURE_PATH` unset.
5. Run one urgent approval alert through the voice route.
6. Confirm local speaker playback and result evidence:
   - `ok=true`
   - `status=passed`
   - `mode=process`
   - `providerId=openai`
   - `realDeviceEvidence=true`
7. Confirm no secrets or raw audio paths are printed.

Permission failure smoke:

1. Deny microphone or speaker permission if the process path requests it.
2. Verify failure label is `microphone_or_speaker_permission`.
3. Verify the adapter exits without retry loops or raw audio persistence.

## Future Tests

OpenClaw-owned tests after contract lands:

- Voice route blocks missing event route.
- Voice route blocks unsupported provider.
- Voice route blocks expired alerts.
- Voice route applies `title-only`, `redacted`, and `summary` privacy modes.
- Voice route refuses `privacy.mayIncludeSecrets !== false`.
- Voice route never starts process mode by default.
- Voice route reports existing preflight labels for missing gates/key/tools.
- Voice route maps process permission errors to `microphone_or_speaker_permission`.
- Voice route preserves dry-run/process/live evidence labels.

## Blockers

OpenClaw is blocked on product-code implementation until:

- Workflows/shared owner lands the `OperatorAlertEvent` contract or an equivalent stable event shape.
- Threadmaster confirms whether the shared config lives under existing `agents.defaults.kernel.operatorNotifications.targets[]` or a new `operatorAlerts.targets[]`.
- Threadmaster confirms whether voice route should be output-only for the first implementation. OpenClaw recommendation: yes, output-only first.

Once unblocked, OpenClaw can implement only the extension-local voice adapter and tests under `extensions/voice-call/src/realtime-voice/**`.
