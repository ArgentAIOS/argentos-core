# OpenClaw Voice And Google Meet Current-Dev Packet

LANE LOCK:
Repo: `ArgentAIOS/argentos-core`
Local path: `/Users/sem/code/argent-core`
Target branch: `dev`
Forbidden repo for this task: `ArgentAIOS/argentos`
Reason: pure core foundation work

## Status

- Lane: `openclaw`
- Local worktree used for verification: `/tmp/argent-core-openclaw-audio-process`
- Branch: `codex/openclaw-audio-process`
- Current `origin/dev`: `38289381`
- Current local head after reconstructing from `origin/dev`: `38289381`
- Pending feature diff over `origin/dev`: none
- Packet type: current-dev merge/status packet plus blocker matrix

The OpenClaw voice and Google Meet slices listed below are already contained in
`origin/dev`. No runtime code is pending on this branch after rebasing onto
current dev.

## Exact Commits In Current Dev

| Commit     | Slice                                                 | Status                 |
| ---------- | ----------------------------------------------------- | ---------------------- |
| `bc72ac11` | Realtime voice fake-provider lifecycle substrate      | Merged in `origin/dev` |
| `6a8641bd` | Fake-provider async tool-call determinism             | Merged in `origin/dev` |
| `4c8f7203` | Operator fake realtime voice session contract         | Merged in `origin/dev` |
| `b2a81768` | Deterministic fake operator CLI harness               | Merged in `origin/dev` |
| `82e5a03d` | OpenAI Realtime provider adapter and live/fake labels | Merged in `origin/dev` |
| `32b035bc` | OpenAI Realtime session.update compatibility          | Merged in `origin/dev` |
| `967c308f` | Live OpenAI text-to-audio smoke harness               | Merged in `origin/dev` |
| `2a0ddd64` | Synthetic local audio I/O seam                        | Merged in `origin/dev` |
| `7ddfb0e3` | Gated local audio process wrappers                    | Merged in `origin/dev` |
| `de4ac1dd` | Gated local audio operator sessions                   | Merged in `origin/dev` |
| `00f87b1c` | Gated local audio live-smoke harness                  | Merged in `origin/dev` |
| `092c6d4e` | Gated extension-local operator voice CLI smoke        | Merged in `origin/dev` |
| `6bf0849b` | Voice alert integration plan                          | Merged in `origin/dev` |
| `cb93846c` | OperatorAlertEvent voice adapter notes                | Merged in `origin/dev` |
| `e522a763` | Google Meet browser readiness plan                    | Merged in `origin/dev` |
| `5b07c393` | Google Meet browser status and `recover_current_tab`  | Merged in `origin/dev` |
| `1c2afaa0` | Optional OperatorAlertEvent voice route               | Merged in `origin/dev` |

## Exact Files Covered By These Slices

Voice realtime and operator audio:

- `extensions/voice-call/src/realtime-voice/fake-provider.ts`
- `extensions/voice-call/src/realtime-voice/fake-provider.test.ts`
- `extensions/voice-call/src/realtime-voice/index.ts`
- `extensions/voice-call/src/realtime-voice/local-audio-io.ts`
- `extensions/voice-call/src/realtime-voice/local-audio-io.test.ts`
- `extensions/voice-call/src/realtime-voice/local-audio-live-smoke.ts`
- `extensions/voice-call/src/realtime-voice/local-audio-live-smoke.test.ts`
- `extensions/voice-call/src/realtime-voice/local-audio-process.ts`
- `extensions/voice-call/src/realtime-voice/local-audio-process.test.ts`
- `extensions/voice-call/src/realtime-voice/local-audio-process-session.ts`
- `extensions/voice-call/src/realtime-voice/local-audio-process-session.test.ts`
- `extensions/voice-call/src/realtime-voice/openai-realtime-live-smoke.ts`
- `extensions/voice-call/src/realtime-voice/openai-realtime-live-smoke.test.ts`
- `extensions/voice-call/src/realtime-voice/openai-realtime-provider.ts`
- `extensions/voice-call/src/realtime-voice/openai-realtime-provider.test.ts`
- `extensions/voice-call/src/realtime-voice/operator-cli-harness.ts`
- `extensions/voice-call/src/realtime-voice/operator-cli-harness.test.ts`
- `extensions/voice-call/src/realtime-voice/operator-session.ts`
- `extensions/voice-call/src/realtime-voice/operator-session.test.ts`
- `extensions/voice-call/src/realtime-voice/operator-voice-cli.ts`
- `extensions/voice-call/src/realtime-voice/operator-voice-cli.test.ts`
- `extensions/voice-call/src/realtime-voice/provider-types.ts`
- `extensions/voice-call/src/realtime-voice/session-runtime.ts`
- `extensions/voice-call/src/realtime-voice/session-runtime.test.ts`

Voice alert route:

- `extensions/voice-call/src/realtime-voice/operator-alert-voice-route.ts`
- `extensions/voice-call/src/realtime-voice/operator-alert-voice-route.test.ts`

Google Meet:

- `extensions/google-meet/src/setup.ts`
- `extensions/google-meet/src/setup.test.ts`
- `extensions/google-meet/src/tool.ts`
- `extensions/google-meet/src/tool.test.ts`

Ops notes:

- `ops/OPENCLAW_GOOGLE_MEET_BROWSER_READINESS_PLAN.md`
- `ops/OPENCLAW_OPERATOR_ALERT_VOICE_ADAPTER_NOTES.md`
- `ops/OPENCLAW_VOICE_ALERT_INTEGRATION_PLAN.md`
- `ops/THREADMASTER_COORDINATION.md`

This packet adds only this handoff file and a coordination-board summary.

## Truth Labels

| Surface                             | Truth label                               | What works now                                                                                                      | What is not claimed                                                                |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Fake realtime provider              | Test-only                                 | Deterministic lifecycle, transcript, audio token, async tool call/result, close, and error behavior for tests.      | Not an operator-facing live provider.                                              |
| Operator fake session/harness       | Test/dev harness                          | Local deterministic session contract and scripted CLI harness for repeatable tests.                                 | Not live mic/speaker or OpenAI support.                                            |
| OpenAI Realtime adapter             | Live-ready with key/gates                 | WebSocket adapter opens against OpenAI Realtime, accepts session update, and has live text-to-audio smoke evidence. | Not always-on voice; not implicit without `OPENAI_API_KEY`.                        |
| Local audio process wrappers        | Live-ready when explicitly gated          | `ffmpeg` mic capture and `ffplay` playback are checked and gated by explicit env confirmation.                      | No background listening; no raw audio persistence unless capture path is explicit. |
| Operator voice CLI                  | Extension-local live smoke surface        | Dry-run and process modes are explicitly labeled and require live gates for real device use.                        | Not registered as a core global CLI command.                                       |
| Operator alert voice route          | Live-ready callable route, not subscribed | Consumes `OperatorAlertEvent`, defaults off, privacy-filters spoken text, and can route to the gated voice path.    | No shared alert router subscription yet; no spoken approval resolution.            |
| Google Meet setup/status            | Browser-readiness surface                 | Reports browser profile/readiness truthfully.                                                                       | Not OAuth calendar creation or live meeting management.                            |
| Google Meet `recover_current_tab`   | Browser-only recovery                     | Can detect/focus exactly one already-open Meet tab through browser runtime APIs.                                    | No create/join/leave/recover of failed live meeting sessions.                      |
| Google Meet `create`/`join`/`leave` | Deferred/not implemented                  | Unsupported actions remain explicitly `not_implemented`.                                                            | No live Google Meet join/create/leave claim.                                       |

## Verification Evidence

Evidence collected during the OpenClaw slices:

- Realtime voice fake/provider/session wave: focused realtime voice tests, voice-call regression subsets, `oxlint`, `oxfmt`, `git diff --check`, `pnpm check:repo-lane`, and filtered touched-surface `tsc` checks passed on each slice.
- Live OpenAI Realtime smoke: `/v1/models/gpt-realtime` returned `200`; Realtime WebSocket opened; `session.update` accepted; live helper returned `ok: true`, provider `openai`, final transcript `Argent realtime smoke ok.`, and audio chunks.
- Local audio process smoke: process-mode evidence returned `ok: true`, `realDeviceEvidence: true`, provider `openai`, transcript `Argent local audio smoke ok.`, and audio chunks with `ffmpeg`/`ffplay` present.
- Operator voice CLI: dry-run and process modes passed with labeled evidence; process mode reported `realDeviceEvidence: true`.
- Operator alert voice route: focused route/CLI/smoke tests passed `14/14`; full realtime-voice suite passed `72/72`; `oxlint`, `oxfmt`, `git diff --check`, `pnpm check:repo-lane`, and filtered touched-surface `tsc` passed.
- Google Meet browser status/recover: focused Google Meet tests passed `11/11`; `oxlint`, `oxfmt`, `git diff --check`, `pnpm check:repo-lane`, and filtered touched-surface `tsc` passed.

Known verification gap:

- Full repo `pnpm exec tsc --noEmit --pretty false` remained red during the slices on unrelated dev-wide errors outside the touched OpenClaw surfaces.
- Manual Google Meet browser/CDP smoke is blocked by gateway/browser-control WebSocket `1006` before browser status can be returned.
- Operator alert voice route has not been live-smoked through a shared alert subscription path because that subscription/router is not implemented.

## Blocker Matrix

| Blocker                                   | Current state                                                      | Owner / needed reaction                                                   | Unblock path                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Google Meet manual browser recovery smoke | Blocked by gateway WebSocket `1006` before browser status returns. | Browser/gateway owner or master diagnostic task.                          | Restore browser-control WebSocket health, then run the existing already-open Meet tab checklist.            |
| Google Meet live `create`/`join`/`leave`  | Explicitly deferred and returns `not_implemented`.                 | OpenClaw after browser smoke is healthy; may need Google/OAuth direction. | Implement only after browser status/recover smoke passes and meeting auth/lifecycle contract is assigned.   |
| Google Meet audio bridge                  | Deferred.                                                          | OpenClaw plus voice/audio owner direction.                                | Reuse the gated local audio process abstractions only after live Meet session lifecycle is real.            |
| Shared operator alert subscription        | Not implemented. The route is callable/exported only.              | Workflows/master or shared notification owner.                            | Wire `OperatorAlertEvent` broadcasts into the voice route behind `ARGENT_OPERATOR_ALERT_VOICE_ENABLE=1`.    |
| Core/global operator CLI registration     | Not implemented. Voice CLI is extension-local.                     | CLI owner or master task.                                                 | Register a core command that shells into the gated extension-local smoke path without weakening live gates. |

## Merge / Split Recommendation

No feature merge is pending: the listed commits are already in `origin/dev`.

If Threadmaster wants to audit or revert in smaller units, preserve these packet
boundaries:

1. Realtime voice substrate and fake-provider tests:
   `bc72ac11`, `6a8641bd`, `4c8f7203`, `b2a81768`
2. OpenAI Realtime and local audio live path:
   `82e5a03d`, `32b035bc`, `967c308f`, `2a0ddd64`, `7ddfb0e3`,
   `de4ac1dd`, `00f87b1c`, `092c6d4e`
3. Voice alert plans and optional route:
   `6bf0849b`, `cb93846c`, `1c2afaa0`
4. Google Meet browser readiness/recovery:
   `e522a763`, `5b07c393`

Do not block the voice runtime surfaces on the Google Meet manual smoke blocker.
The Meet slice is truth-labeled and keeps live meeting actions deferred.

## Cross-Lane Reactions

- Workflows/master: if voice alerts should run from real approval/alert events,
  assign the shared subscription/router wiring explicitly.
- Browser/gateway: diagnose gateway WebSocket `1006` before asking OpenClaw for
  more Google Meet manual smoke evidence.
- AOS/AppForge: no required reaction. These slices do not change connector
  manifests, AppForge contracts, workflow runtime contracts, schema, or gateway
  method registries.
