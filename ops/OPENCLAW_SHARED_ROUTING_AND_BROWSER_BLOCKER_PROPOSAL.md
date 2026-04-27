# OpenClaw Shared Routing And Browser Blocker Proposal

LANE LOCK:
Repo: `ArgentAIOS/argentos-core`
Local path: `/Users/sem/code/argent-core`
Target branch: `dev`
Forbidden repo for this task: `ArgentAIOS/argentos`
Reason: pure core foundation work

## Status

- Lane: `openclaw`
- Branch: `codex/openclaw-audio-process`
- Current prompt from master: prepare a narrow proposal/patch for shared
  operator-alert routing and the browser-control WebSocket `1006` smoke blocker.
- Runtime code in this packet: none.
- Purpose: identify exact files, safe patch boundaries, blockers, and
  verification before touching shared gateway/workflow surfaces.

## Current Facts

Operator alert route:

- `src/infra/operator-alerts.ts` defines the shared `OperatorAlertEvent`
  contract.
- `src/infra/workflow-execution-service.ts` broadcasts
  `operator.alert.requested` when a workflow approval is created.
- `extensions/voice-call/src/realtime-voice/operator-alert-voice-route.ts`
  can consume an `OperatorAlertEvent`, but it is callable/exported only.
- No shared internal subscriber/router currently invokes the voice route from
  the gateway/workflow broadcast path.

Browser blocker:

- Google Meet `status` and `recover_current_tab` use the browser runtime through
  `extensions/google-meet/src/tool.ts`.
- Manual smoke via `pnpm argent browser --browser-profile chrome status --json`
  failed before browser status returned with gateway/browser-control WebSocket
  `1006`.
- The failure sits below the Google Meet extension. The Meet slice should not be
  expanded until browser-control health is diagnosable.

## Proposed Patch A: Shared Operator Alert Router

Goal: allow optional OpenClaw voice output to subscribe to
`OperatorAlertEvent` without coupling Workflows to voice-call internals.

Recommended file ownership:

- Add `src/infra/operator-alert-router.ts`
- Add `src/infra/operator-alert-router.test.ts`
- Add `extensions/voice-call/src/realtime-voice/operator-alert-router-registration.ts`
- Add `extensions/voice-call/src/realtime-voice/operator-alert-router-registration.test.ts`
- Update `extensions/voice-call/src/realtime-voice/index.ts`
- Update `ops/THREADMASTER_COORDINATION.md`

Shared files that require master approval before implementation:

- `src/infra/operator-alert-router.ts`
- `src/infra/operator-alert-router.test.ts`

Do not edit without explicit direction:

- `src/infra/workflow-execution-service.ts`
- `src/gateway/server-methods/workflows.ts`
- `dashboard/**`
- `src/data/**`
- `src/gateway/server-methods.ts`

Proposed contract:

- Core infra owns a tiny in-process router:
  - `registerOperatorAlertSink(sink): unregister`
  - `routeOperatorAlertEvent(event, context): Promise<summary>`
  - Sink result labels: `sent`, `skipped`, `failed`
  - Failures are best-effort and never block workflow approval creation.
- Voice-call owns the optional sink registration:
  - registration is disabled unless `ARGENT_OPERATOR_ALERT_VOICE_ENABLE=1`
  - sink calls `runOperatorAlertVoiceRoute`
  - privacy defaults remain `title-only`
  - route does not resolve approvals or speak action payloads
- Workflows keep producing the existing `OperatorAlertEvent`; they do not import
  voice-call code.

Two implementation options:

| Option | Description                                                                                                   | Pros                                                      | Cons                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A1     | Core router only, with tests and voice-call registration helper; actual gateway/workflow hook assigned later. | Lowest shared blast radius; establishes contract cleanly. | Voice route still not automatic until hook is assigned.                                            |
| A2     | Core router plus a narrow hook at the current `operator.alert.requested` broadcast point.                     | Makes voice alerts automatic behind gates.                | Requires editing workflow execution service, so Workflows/master should own or explicitly approve. |

Recommended first patch: A1. It unblocks a clean contract while honoring the
current boundary: no Workflows/AppForge/AOS/schema edits.

Acceptance for A1:

- Router has deterministic tests for no sinks, disabled/skipped sink, success,
  and failure isolation.
- Voice registration has tests proving disabled default, enabled call-through,
  privacy default, and non-blocking failure labels.
- No live voice claim. Live playback still requires the existing explicit voice
  env gates.

## Proposed Patch B: Browser-Control WS 1006 Diagnostic Smoke Path

Goal: make the Google Meet manual smoke blocker diagnosable without changing
Meet live actions.

Recommended file ownership:

- `src/cli/browser-cli-shared.ts`
- `src/cli/browser-cli-manage.ts`
- `src/cli/browser-cli-manage.timeout-option.test.ts`
- `src/gateway/server-methods/browser.ts`
- `src/gateway/server-methods/browser*.test.ts` if an existing focused test
  matches the failure path
- `ops/THREADMASTER_COORDINATION.md`

Shared files that require master approval before implementation:

- `src/gateway/server-methods/browser.ts`
- any `src/gateway/**` tests touched for browser request diagnostics

Proposed contract:

- Preserve existing `argent browser status` behavior.
- Add a diagnostic mode or richer error details for browser request failures:
  - requested method/path/profile
  - whether a node browser proxy was selected
  - whether local browser control was disabled
  - gateway error code
  - node invoke error payload when available
  - suggested command: `argent browser status --json --timeout <ms>`
- Do not auto-restart, reset profiles, or kill browser processes in this patch.
- Do not implement Google Meet `create`/`join`/`leave`.

Two implementation options:

| Option | Description                                                                      | Pros                                                                                              | Cons                                                             |
| ------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| B1     | Docs/checklist only: keep current code and record the exact diagnostic commands. | Zero runtime risk.                                                                                | Does not improve the operator's next failure report.             |
| B2     | CLI/gateway diagnostic labels only.                                              | Helps prove whether WS `1006` is gateway, node proxy, browser-control disabled, or CDP readiness. | Touches gateway browser request surface. Needs master approval.  |
| B3     | Add restart/recovery behavior.                                                   | Could self-heal some cases.                                                                       | Too broad for this lane; could mask real browser-control issues. |

Recommended first patch: B2 if master approves the exact shared files above;
otherwise keep B1 and wait for browser/gateway owner.

Acceptance for B2:

- Existing browser status/start/stop tests keep passing.
- New tests prove `browser.request` exposes actionable diagnostics for local
  control disabled and node proxy invoke failure.
- CLI preserves JSON output shape for success and only enriches failure text or
  structured error details.
- Manual Meet smoke remains blocked until `argent browser status --json`
  succeeds against the local gateway.

## Blockers And Decisions Needed

| Item                             | Decision needed                                                    | From             |
| -------------------------------- | ------------------------------------------------------------------ | ---------------- |
| Operator alert automatic routing | Approve A1 contract-only patch or A2 workflow hook.                | Master/Workflows |
| Browser WS `1006` next move      | Approve B2 shared gateway/CLI diagnostics or assign browser owner. | Master/browser   |
| Google Meet live actions         | Keep deferred until browser status/recover smoke is healthy.       | Master/OpenClaw  |

## Verification Plan

For A1:

- `pnpm exec vitest run src/infra/operator-alert-router.test.ts extensions/voice-call/src/realtime-voice/operator-alert-router-registration.test.ts`
- `pnpm exec vitest run extensions/voice-call/src/realtime-voice/operator-alert-voice-route.test.ts`
- `pnpm exec oxlint src/infra/operator-alert-router.ts extensions/voice-call/src/realtime-voice/operator-alert-router-registration.ts`
- `pnpm exec oxfmt --check <touched files>`
- `git diff --check`
- `pnpm check:repo-lane`

For B2:

- Focused browser gateway/CLI tests for touched files.
- `pnpm exec oxlint src/gateway/server-methods/browser.ts src/cli/browser-cli-shared.ts src/cli/browser-cli-manage.ts`
- `pnpm exec oxfmt --check <touched files>`
- `git diff --check`
- `pnpm check:repo-lane`

Full repo `tsc` should remain a separate signal because current dev has known
unrelated type errors outside OpenClaw-touched surfaces.
