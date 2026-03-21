# MVP Voice System Plan

This document defines the immediate MVP voice architecture for ArgentOS.

The goal is not a final platform design. The goal is a reliable, demo-safe,
operator-clear voice system built on the strongest working path in the current
codebase.

## Goal

Create **one conversation system**:

- Swift app owns voice input and audio playback
- Dashboard remains the primary visible chat UI
- Gateway remains the session/state source of truth
- Voice and text share the same conversation thread

## Problem Statement

Today there are effectively two different voice systems:

1. **Swift app talk mode**
   - native push-to-talk
   - Apple speech recognition
   - native audio device control
   - ElevenLabs streaming playback

2. **Dashboard/browser voice path**
   - browser speech recognition or Whisper upload
   - separate microphone behavior
   - browser audio constraints
   - separate failure modes

This split creates:

- duplicated voice logic
- mismatched session behavior
- inconsistent reliability
- more operator confusion than the MVP can afford

## MVP Architecture

### Swift app responsibilities

The Swift app should own:

- push-to-talk
- speech-to-text
- audio device selection
- interruption handling
- spoken response playback

### Dashboard responsibilities

The dashboard should own:

- visible main chat transcript
- streamed assistant text
- message history
- tasks, docs, memory, worker controls

### Gateway responsibilities

The gateway should own:

- the canonical chat session
- message ordering
- agent execution
- streamed response delivery

## Desired User Experience

1. User presses push-to-talk in the Swift app
2. Swift app captures speech and transcribes it
3. Swift app submits the transcript into the same main dashboard conversation
4. Dashboard immediately shows the user message in the main thread
5. Assistant response streams into the dashboard as text
6. Swift app speaks the assistant response out loud
7. Both voice and text remain part of one thread

## What We Keep

- current dashboard as the chat/control surface
- current Swift app as the native shell
- current gateway and session model
- ElevenLabs as the active voice provider
- Apple Speech as the active Swift STT provider

## What We De-emphasize

- dashboard mic as the primary voice input
- separate voice-only session behavior
- browser speech as the main demo path

The dashboard mic may stay as a fallback, but it should not define the MVP.

## Technical Plan

### Phase 1 — Trace and align

Identify:

- current Swift talk-mode transcript submission path
- current dashboard main chat send path
- current session/thread keys used by dashboard chat
- where Swift diverges into a separate talk-mode path today

Deliverable:

- exact map of `Swift -> gateway -> dashboard main chat`

### Phase 2 — Session unification

Change Swift talk mode so its recognized transcript is sent into the main
dashboard/gateway conversation instead of a separate talk-mode lane.

Deliverable:

- spoken user turns appear in the dashboard’s main chat thread

### Phase 3 — Reply ownership

Keep reply responsibilities split cleanly:

- dashboard renders the text stream
- Swift app owns spoken output playback

Tie spoken playback to the same assistant message turn.

Deliverable:

- one reply, two surfaces:
  - dashboard text
  - Swift audio

### Phase 4 — Turn coordination

When push-to-talk starts:

- stop current TTS playback
- mark the voice turn active

When transcript is finalized:

- submit to main session

When response streams:

- dashboard shows text

When response is ready for speech:

- Swift app plays TTS

Deliverable:

- clean turn-taking with no duplicated or competing outputs

### Phase 5 — Dashboard voice fallback

Keep dashboard voice controls as a fallback only.

Do not rely on browser mic for the primary demo path.

Deliverable:

- dashboard mic is optional, not critical

### Phase 6 — Streaming polish

Improve dashboard TTS from full-blob playback to HTTP streaming playback.

This is important for perceived latency, but secondary to having one coherent
conversation path.

Deliverable:

- faster voice playback start in browser paths

## Near-Term Voice Stack

### Active speech-to-text

- Swift app: Apple Speech
- Dashboard: fallback only (browser speech / Whisper)

### Active text-to-speech

- ElevenLabs

### Future voice provider

- Sesame CSM, tracked separately in:
  - `/Users/sem/code/argentos/docs/argent/CSM_PROVIDER_BUILD_PLAN.md`

## Why This Is the Right MVP

This gives the product:

- one transcript
- one visible conversation
- one response path
- one native voice shell

It reduces complexity without needing a platform rewrite.

## What We Are Not Doing Yet

- porting the dashboard to native Swift
- switching to Electron
- replacing ElevenLabs immediately
- making dashboard mic the primary path

Those are later platform decisions, not MVP blockers.

## Risks

1. Swift and dashboard may currently use different session keys
2. TTS may still be triggered from the wrong point in the turn lifecycle
3. browser mic code may still confuse operators if it looks “primary”
4. background spoken responses must not reintroduce the previous crash path

## Acceptance Criteria

The MVP voice system is done when:

1. user speaks in Swift app
2. transcript lands in the main dashboard thread
3. assistant reply streams as text in the dashboard
4. assistant reply is spoken from Swift
5. no duplicate threads or separate voice conversation
6. no talk-mode playback crash

## Recommended Build Order

1. document the architecture
2. rebuild and verify Swift crash fix
3. unify Swift transcript injection into main chat
4. verify one-thread behavior
5. improve dashboard TTS with HTTP streaming
6. stabilize dashboard mic later

## Monday Demo Recommendation

Primary demo path:

- Swift push-to-talk
- dashboard visible text
- Swift spoken reply

Fallback path:

- text-only dashboard chat

Do not make the demo depend on:

- dashboard mic
- local heavy voice inference
- new voice-provider experiments
