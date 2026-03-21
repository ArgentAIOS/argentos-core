# CSM Provider Build Plan

This document captures the concrete plan for integrating Sesame CSM as an
Argent voice provider without disrupting the current ElevenLabs path.

## Goal

Add CSM as an optional, provider-backed voice synthesis layer for Argent,
while keeping the current ElevenLabs integration as the default fallback until
CSM is production-stable.

This is a later-stage voice platform project, not the immediate demo path.

## What CSM Should Do in Argent

CSM should own the **speech rendering** layer only.

It should not replace:

- speech-to-text capture
- push-to-talk / wake flow
- gateway orchestration
- response generation / reasoning
- memory retrieval itself

It should replace or complement:

- ElevenLabs voice generation
- local/hosted spoken-response rendering
- expressive continuity across turns

## Where It Should Live

### Runtime provider layer

Primary runtime integration should live under:

- `/Users/sem/code/argentos/src/argent-ai/`
- `/Users/sem/code/argentos/src/agents/provider-registry-seed.ts`

Recommended new files:

- `/Users/sem/code/argentos/src/argent-ai/csm.ts`
- `/Users/sem/code/argentos/src/argent-ai/csm-types.ts`
- `/Users/sem/code/argentos/src/argent-ai/csm-openai-compat.ts`

Purpose:

- provider definition
- request/response mapping
- stream handling
- capability flags

### App/client voice layer

Shared client-side audio/TTS abstraction should remain in:

- `/Users/sem/code/argentos/apps/shared/ArgentKit/`

Recommended new files:

- `/Users/sem/code/argentos/apps/shared/ArgentKit/Sources/ArgentKit/VoiceProvider.swift`
- `/Users/sem/code/argentos/apps/shared/ArgentKit/Sources/ArgentKit/CSMVoiceClient.swift`

Purpose:

- make TTS backend selection explicit
- allow Swift app to choose ElevenLabs or CSM cleanly
- keep streaming playback code backend-agnostic

### Dashboard/backend proxy layer

Dashboard proxy support should live in:

- `/Users/sem/code/argentos/dashboard/api-server.cjs`

Purpose:

- proxy HTTPS streaming from a CSM service
- normalize auth/header handling
- keep browser clients off direct model infra

## Exposure Model

CSM should be exposed as a normal voice provider, not as a one-off special case.

### Provider registry

Add seeded provider entry:

- `providerId: "csm"`

Capabilities:

- `tts`
- `streaming-tts`
- optional `voice-clone` flag if you later support it

### Config surface

It should be selectable in:

- Swift app talk mode settings
- dashboard TTS settings
- per-agent voice settings later

Config should support:

- provider
- voice/model
- endpoint URL
- latency tier / streaming mode
- fallback provider

## Service Shape

The cleanest deployment model is an internal HTTP service with streaming output.

Recommended interface:

- OpenAI-compatible TTS-style HTTP endpoint if practical
- fallback to native CSM endpoint if wrapper quality/performance is better

Do not couple Argent directly to a single third-party wrapper.

Preferred abstraction:

1. Argent voice client protocol
2. ElevenLabs implementation
3. CSM implementation

That preserves optionality.

## MemU Context Strategy

CSM should not get the full raw memory dump.

It should receive a small, purpose-built voice context packet.

Recommended voice context inputs:

1. last 1-3 spoken turns
2. current agent identity summary
3. role/relationship cues
4. emotional state / mood signal
5. response intent class

Good sources:

- recent chat turns
- AEVP / mood state
- intent/role identity
- selected MemU continuity snippets

Do not send:

- broad RAG context
- arbitrary retrieved memory blocks
- large untrusted text blobs

### Proposed voice context object

```json
{
  "agentId": "argent",
  "mood": "focused",
  "identityCue": "calm, direct, trust-preserving",
  "relationshipCue": "operator partner, high clarity, no bluffing",
  "recentTurns": [
    { "speaker": "user", "text": "..." },
    { "speaker": "assistant", "text": "..." }
  ]
}
```

This gives CSM the continuity it needs without turning voice rendering into a
second reasoning stack.

## Resource Profile

### For the laptop

Do not treat the MacBook as the primary CSM host.

Use cases on laptop:

- remote inference against a LAN/GPU service
- maybe local experiments only if proven cool and stable

### For DGX / large Linux GPU nodes

This is the right home for CSM.

Recommended deployment target:

- DGX / GPU Linux service
- exposed over internal HTTPS
- one service per model family / version

### Expected cost classes

1. CPU-only laptop local inference

- wrong target

2. consumer GPU workstation

- plausible for experiments

3. DGX / dedicated GPU host

- correct target for stable deployment

## Streaming Plan

### Immediate path

Keep current ElevenLabs path and improve it:

- Swift app: already streaming
- dashboard: move from blob buffering to true HTTP streaming

### CSM path

Require HTTP streaming support from the provider service.

Argent should expect:

- chunked HTTP response
- PCM or compressed audio chunks
- incremental playback in Swift and dashboard

Do not design a WebSocket requirement into CSM.

That keeps parity with the current ElevenLabs v3 constraint:

- HTTPS streaming
- no WebSocket dependency

## Fallback Strategy

ElevenLabs should remain the operational fallback.

Recommended order:

1. preferred provider: CSM
2. fallback provider: ElevenLabs
3. optional fallback: system TTS for degraded mode only

Fallback should trigger on:

- provider timeout
- stream failure
- service unavailable
- invalid audio payload

Do not silently switch voice character without surfacing it in logs/telemetry.

## Rollout Stages

### Stage 1

Documented only.

### Stage 2

Provider abstraction cleanup:

- unify voice provider interface
- separate provider selection from playback implementation

### Stage 3

Dashboard TTS streaming upgrade:

- stop waiting for full blob
- play streaming audio incrementally

### Stage 4

CSM service prototype:

- internal GPU host
- HTTP streaming endpoint
- manual A/B against ElevenLabs

### Stage 5

Argent provider integration:

- provider registry
- config UI
- fallback chain

### Stage 6

Continuity tuning:

- MemU voice context packet
- mood/identity integration

### Stage 7

Production evaluation:

- latency
- crash safety
- prosody continuity
- relationship alignment

## Risks

1. treating CSM as a rushed ElevenLabs replacement
2. sending too much memory context into voice generation
3. binding to a community wrapper as the only supported interface
4. trying to host heavy local voice inference on the laptop
5. mixing reasoning and speech-rendering responsibilities

## Near-Term Priority

Before any CSM integration work:

1. stabilize Swift talk mode
2. fix dashboard mic path
3. add dashboard HTTP streaming TTS

That work directly benefits both ElevenLabs now and CSM later.
