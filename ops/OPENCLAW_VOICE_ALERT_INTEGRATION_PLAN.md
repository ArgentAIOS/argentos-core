# OpenClaw Voice Alert Integration Plan

Date: 2026-04-26
Lane: `openclaw`
Branch: `codex/openclaw-audio-process`
Baseline before this plan: `fa3c4d55` rebased onto `origin/dev` at `ca7efa17`

## Lane Lock

Repo: `ArgentAIOS/argentos-core`
Local path: `/Users/sem/code/argent-core`
Target branch: `dev`
Forbidden repo for this task: `ArgentAIOS/argentos`
Reason: pure core foundation work

## Truth Boundary

Voice alerts should be one optional operator notification output channel. They are not always-on assistant listening, not Google Meet live support, and not a replacement for the existing approval resolver paths.

The current OpenClaw realtime/local audio work has proven:

- live OpenAI realtime text-to-audio response support with `OPENAI_API_KEY`
- synthetic audio input and capture-only output adapters
- gated macOS process-mode wrapper and smoke harness paths for `ffmpeg` and `ffplay`; real-device success remains manual evidence, not a checked-in automated guarantee
- an extension-local operator CLI/dev wrapper with explicit gate and preflight labels

This plan does not add product code. It names the next integration shape and the ownership boundaries needed before coding.

## Existing Entry Points

Use these current surfaces rather than inventing a parallel notification path:

- Exec approvals: `src/gateway/server-methods/exec-approval.ts` broadcasts `exec.approval.requested` and `exec.approval.resolved`; the approval forwarder is optional and can be unavailable in some builds.
- Workflow approvals: `src/infra/workflow-execution-service.ts` broadcasts `workflow.approval.requested`, then calls `notifyWorkflowApprovalRequest` in `src/infra/workflow-approval-notifier.ts`.
- Operator notification config: `agents.defaults.kernel.operatorNotifications` already has `enabled`, `cooldownMs`, and `targets`.
- Telegram delivery: `src/channels/plugins/outbound/telegram.ts` supports text, media, and channel-specific button payloads; `src/auto-reply/reply/commands-approve.ts` resolves exec approvals by `/approve`.
- macOS notification: `src/cli/nodes-cli/register.notify.ts` invokes node command `system.notify`, with allowlist policy in `src/gateway/node-command-policy.ts`.
- Existing dashboard audio alert: `src/agents/tools/audio-alert-tool.ts` renders dashboard alert markers and optional ElevenLabs MP3 media. Keep this separate from realtime operator voice until a shared contract exists.
- Realtime voice: `extensions/voice-call/src/realtime-voice/operator-voice-cli.ts` exposes the proven local voice preflight and live smoke path behind explicit gates.

## Recommended Contract

Add a shared operator alert contract before adding a voice route. Suggested future file:

- `src/infra/operator-alerts.ts`

Suggested event shape:

```ts
export type OperatorAlertEvent = {
  id: string;
  kind: "operator.alert.requested" | "operator.alert.resolved";
  source: "exec-approval" | "workflow-approval" | "kernel" | "audio-alert" | "manual";
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
  workflow?: {
    runId: string;
    workflowId: string;
    workflowName?: string;
    nodeId?: string;
    nodeLabel?: string;
  };
  privacy: {
    speakPayload: "title-only" | "summary" | "redacted";
    mayIncludeSecrets: false;
    rawAudioCapture: false;
  };
  routes: OperatorAlertRoute[];
};
```

Suggested route shape:

```ts
export type OperatorAlertRoute =
  | { channel: "telegram"; to: string; accountId?: string; threadId?: string | number }
  | { channel: "macos"; nodeId: string; delivery?: "system" | "overlay" | "auto" }
  | {
      channel: "voice";
      mode: "dry-run" | "process";
      providerId: "openai";
      voice?: string;
      maxDurationMs?: number;
      requireLiveConfirmation: true;
    };
```

The contract should be render-first: every route consumes the same `OperatorAlertEvent`, then renders channel-specific text, buttons, system notification fields, or spoken text.

## Gating And Configuration

Default posture:

- `voice` route disabled by default.
- No raw audio persistence by default.
- No always-on listening mode.
- Voice alerts speak title and redacted summary only unless config explicitly allows a less-redacted summary.
- Approval decisions still happen through existing resolver commands and gateway methods. Spoken approval should remain deferred.

Recommended config extension after Threadmaster approval:

- Extend `agents.defaults.kernel.operatorNotifications.targets[]` or introduce `operatorAlerts.targets[]` with route-specific targets.
- Add a voice route target only when explicitly configured:
  - `channel: "voice"`
  - `mode: "dry-run" | "process"`
  - `providerId: "openai"`
  - `maxDurationMs`
  - `minSeverity`
  - `categories`
  - `quietHours`
  - `cooldownMs`
  - `speakPayload`

Mandatory runtime gates for local process voice remain:

- `OPENAI_API_KEY` must be configured.
- `ARGENT_REALTIME_AUDIO_PROCESS_ENABLE=1`
- `ARGENT_REALTIME_AUDIO_CONFIRM_LIVE=1`
- `ffmpeg` available for mic/process capture when needed.
- `ffplay` available for local speaker playback.
- `ARGENT_REALTIME_AUDIO_CAPTURE_PATH` absent by default. If set, the run must report that raw audio capture is enabled.

## Shared Route Behavior

Telegram, macOS, and voice should share one event contract:

- Telegram renders title, summary, approval ID, and optional action buttons or `/approve` hints.
- macOS renders concise title/body through `system.notify`.
- Voice renders a short spoken phrase: title, severity, redacted summary, and approval hint. It should not read command strings, secrets, previous output bodies, or full payloads by default.
- Dashboard audio alert remains marker/media based until it is adapted to consume the same contract.

## Future File Ownership

OpenClaw owns:

- `extensions/voice-call/src/realtime-voice/**`
- future voice route adapter files inside the voice-call extension, for example `extensions/voice-call/src/realtime-voice/operator-alert-voice-route.ts`
- voice-route tests and live smoke harnesses

Workflows owns:

- `src/infra/workflow-approval-notifier.ts`
- `src/infra/workflow-execution-service.ts`
- workflow approval persistence and gateway methods

Gateway/master owns:

- future `src/infra/operator-alerts.ts`
- gateway event naming and websocket broadcast scope guards
- exec approval request/resolve contracts
- node command policy for `system.notify`

Channel owners own:

- Telegram outbound rendering under `src/channels/plugins/outbound/telegram.ts`
- Telegram approval commands under `src/auto-reply/reply/commands-approve.ts`
- macOS/node notification CLI under `src/cli/nodes-cli/register.notify.ts`

AOS/AppForge/Workflows reaction:

- Consume alert metadata/events only.
- Do not import voice-call internals.
- Do not assume voice route availability unless configuration and capability metadata say it is enabled.

## Implementation Slices

1. Contract slice:
   - Add `src/infra/operator-alerts.ts`.
   - Add pure render helpers for Telegram, macOS, and voice text.
   - Add serialization tests and redaction tests.

2. Workflow approval route slice:
   - Convert `notifyWorkflowApprovalRequest` into an `OperatorAlertEvent`.
   - Keep existing outbound delivery behavior.
   - Add tests proving current Telegram/text notification output does not regress.

3. Exec approval route slice:
   - Adapt `exec.approval.requested` forwarding to the same alert contract.
   - Preserve current `operator.approvals` scope checks and `/approve` resolver behavior.

4. Voice route slice:
   - Add a route adapter that consumes `OperatorAlertEvent` and calls the already gated realtime voice local path.
   - Support `dry-run` tests with fake/synthetic output.
   - Support optional `process` manual smoke only when all live gates are present.

5. macOS route slice:
   - Add a renderer that maps `OperatorAlertEvent` to `system.notify` title/body/priority.
   - Keep node command allowlist and permission behavior unchanged.

6. Dashboard audio alert consolidation slice:
   - Optionally adapt `audio_alert` marker generation to emit or mirror `OperatorAlertEvent`.
   - Keep ElevenLabs/dashboard MP3 markers truth-labeled as dashboard audio, not realtime operator voice.

## Tests

Required automated tests:

- `src/infra/operator-alerts.test.ts`: contract normalization, route selection, redaction, cooldown/dedupe keys.
- `src/infra/workflow-approval-notifier.test.ts`: workflow approval event renders the same existing text fields and records notification status.
- `src/gateway/server-methods/exec-approval.test.ts`: exec approval request keeps scoped broadcasts and alert event payload references.
- Telegram route tests: channel data and approval hints/buttons are present without leaking secrets.
- macOS route tests: notification title/body/priority are generated and `system.notify` stays allowlisted.
- Voice route tests under `extensions/voice-call/src/realtime-voice/**`: voice route refuses missing gates, uses redacted summary, never starts process mode by default, and reports dry-run versus real-device evidence.

Manual smoke checklist:

1. Configure `OPENAI_API_KEY`.
2. Run voice route in dry-run mode and confirm `realDeviceEvidence=false`.
3. Run process-mode voice smoke with:
   - `ARGENT_REALTIME_AUDIO_PROCESS_ENABLE=1`
   - `ARGENT_REALTIME_AUDIO_CONFIRM_LIVE=1`
   - no `ARGENT_REALTIME_AUDIO_CAPTURE_PATH`
4. Trigger a workflow approval and verify:
   - existing outbound target still receives the approval text
   - voice route speaks only title/redacted summary
   - notification status is recorded
5. Trigger an exec approval and verify:
   - websocket event still requires `operator.approvals`
   - Telegram `/approve` or gateway resolve still performs the decision
   - voice route does not accept spoken approval
6. Trigger macOS `system.notify` route on a paired node and verify the title/body match the alert contract.

## Blockers And Resolution Options

Blocker: Contract ownership crosses OpenClaw, Workflows, gateway, and channel delivery.

- Option A: Master owns `src/infra/operator-alerts.ts`; OpenClaw only builds the voice route after the contract lands.
- Option B: OpenClaw drafts the contract under `ops/**` first, then master assigns the shared code slice.
- Recommendation: Option A for product code.

Blocker: Current operator notification config is kernel-named, but workflow approvals already reuse it.

- Option A: Extend the existing config with typed route targets.
- Option B: Add a new `operatorAlerts` config and migrate workflow approval notifier later.
- Recommendation: Option B if the contract becomes a general alert bus; Option A if Threadmaster wants the smallest diff.

Blocker: Voice route can speak alerts but should not resolve approvals by speech yet.

- Option A: Keep voice output-only; approvals resolved through Telegram, dashboard, CLI, or gateway.
- Option B: Add push-to-talk spoken approval later with transcript confirmation and explicit second-factor prompt.
- Recommendation: Option A for next wave.

Blocker: macOS route depends on a paired node declaring `system.notify`.

- Option A: Route through `node.invoke system.notify` only when capability metadata shows it is available.
- Option B: Use local process notification as a separate desktop helper later.
- Recommendation: Option A for core.

Blocker: Real-device voice alerts need local audio permissions and device tools.

- Option A: Use current `ffmpeg`/`ffplay` process-mode path with explicit gates.
- Option B: Add an installer-owned native helper later for reliable device I/O and permission UX.
- Recommendation: Option A now, Option B for polished product UX.

## Next Assignment Request

Ask Threadmaster to assign one of these:

1. Master/gateway: implement `src/infra/operator-alerts.ts` plus render tests.
2. Workflows: adapt `notifyWorkflowApprovalRequest` to build `OperatorAlertEvent` while preserving current outbound behavior.
3. OpenClaw: after the contract exists, implement the voice route adapter under `extensions/voice-call/src/realtime-voice/**`.

OpenClaw should not edit Workflows, gateway, channel delivery, or schema files for this task unless Threadmaster explicitly widens the scope.
