# Voice MVP Status — March 7, 2026

## Why this document exists

This is a checkpoint for the current MVP voice lane.

The goal is to keep one accurate record of:

- what we were trying to achieve
- what we changed
- what is working now
- what is still broken
- what should be fixed next

This is specifically for the current macOS Swift app + embedded dashboard voice path.

## MVP target

The intended MVP architecture is:

1. The Swift app owns voice input/output.
2. The embedded dashboard is the authoritative chat surface when it is open.
3. Push-to-talk in Swift should submit into the same visible dashboard chat thread.
4. The spoken user turn should appear in dashboard chat history like a normal user message.
5. The assistant reply shown in dashboard chat should be the same reply that gets spoken.
6. Only one spoken reply should play.
7. Raw voice markup like `[TTS:...]`, `[TTS_NOW:...]`, and `[MOOD:...]` should not render visibly in the normal chat UI.
8. When the dashboard is closed, Swift can fall back to a native standalone voice/chat path.

## What we changed

### 1. Stabilized the native Swift audio stack

We replaced the PCM streaming player path that matched the AVAudio crash and rebuilt the app.

Relevant checkpoint:

- `5302e5750` `fix macos talk-mode pcm playback crash`

Relevant files:

- `apps/shared/ArgentKit/Sources/ArgentKit/PCMStreamingAudioPlayer.swift`
- `apps/shared/ArgentKit/Sources/ArgentKit/ElevenLabsKitShim.swift`
- `apps/shared/ArgentKit/Tests/ArgentKitTests/PCMStreamingAudioPlayerTests.swift`

### 2. Unified Swift talk mode toward the dashboard session

We changed talk mode so that when the embedded dashboard is open, Swift prefers the dashboard-visible chat session instead of a separate native chat lane.

Relevant checkpoints:

- `bce155290` `docs: add mvp voice system plan`
- `37e99e478` `feat: route swift talk mode into dashboard chat session`

Main files involved:

- `apps/macos/Sources/Argent/DashboardManager.swift`
- `apps/macos/Sources/Argent/DashboardWindowController.swift`
- `apps/macos/Sources/Argent/TalkModeRuntime.swift`

### 3. Moved Swift TTS onto the backend secret-backed path

The Swift app was previously depending on app-side ElevenLabs key access.
That was wrong.

We changed the native app to use gateway TTS instead, so the key stays in the backend secret system.

Relevant checkpoint:

- `cc51a4699` `fix native voice routing and gateway tts playback`

Relevant file:

- `src/gateway/server-methods/tts.ts`

### 4. Checkpointed the voice package state

Relevant checkpoint:

- `4733ef49d` `chore: checkpoint voice app package state`

This was mainly to preserve package/build state and stop the branch from drifting while testing.

## What is working now

### Working

1. The Swift app can hear push-to-talk input.
2. The embedded dashboard receives the message on the intended visible thread in at least part of the current path.
3. ElevenLabs/Jessica playback has worked from the Swift app.
4. The old Apple-voice-only failure mode is no longer the primary path.
5. The app is no longer failing on the original PCM crash every time a background spoken response fires.
6. The dashboard itself still has a clean typed-chat rendering path, proven by normal typed turns and normal spoken-summary rendering on the dashboard side.

### Partially working

1. Swift voice routing to the dashboard is close, but not fully normalized.
2. Correct voice playback can happen, but the timing and trigger path are still unreliable.
3. The dashboard is sometimes the right authoritative thread, but the native voice playback still appears to react to the wrong reply shape or the wrong event timing.

## What is still broken

### 1. Duplicate spoken reply behavior

Current symptom:

- after a push-to-talk turn, two spoken replies can happen close together
- the first is often a short acknowledgment
- the second is the fuller reply
- sometimes both use the correct voice

Most likely cause:

- there are still two separate playback triggers for the same conversational turn
- likely one native trigger and one dashboard-related trigger, or one early-turn trigger and one final-turn trigger

### 2. Spoken reply is not always based on the final normalized assistant turn

Current symptom:

- the voice can speak the wrong fragment or an early fragment
- the visible dashboard message may be correct while the spoken reply reflects an earlier response shape

Most likely cause:

- the native side is still not fully anchored to the dashboard’s final authoritative reply artifact
- it may still be reacting to an earlier event or preliminary TTS payload

### 3. Spoken user turn is not being persisted/rendered like a normal dashboard user message

Current symptom:

- the user can speak and get a response
- but the spoken user turn does not always appear in chat history the same way as a typed dashboard message

This matters because:

- it weakens session continuity
- it makes the dashboard history inaccurate
- it makes replay/debugging harder

### 4. Raw markup still leaks in some paths

Current symptom:

- `[TTS:...]`, `[TTS_NOW:...]`, and mood markup have leaked into visible reply content in the native-side flow
- the dashboard’s normal typed path can look correct, which suggests the voice-injected path is bypassing normal render cleanup somewhere

### 5. Startup latency is still too high

Observed behavior:

- first audio often starts roughly 9 to 15 seconds after releasing push-to-talk

What this means:

- true streaming behavior is not yet proven
- current playback is still too slow for a strong conversational feel

## What we learned

### 1. The main problem is no longer raw transport

The system is not fundamentally failing to:

- hear the user
- route to a model
- generate a reply
- play audio

The remaining failures are mostly in:

- event timing
- reply selection
- chat normalization
- duplicate playback suppression

### 2. The embedded dashboard should be the source of truth when it is open

This is the right MVP architecture.

The native Swift chat window should not be treated as authoritative in the demo flow.
If the dashboard is open, all voice interaction should be attached to the dashboard thread.

### 3. The browser/dashboard path already proves what “clean” looks like

Normal dashboard typed chat shows:

- proper user turn rendering
- proper assistant turn rendering
- spoken summary handled separately
- no raw TTS markers in the normal typed path

That means we do not need a brand-new render architecture.
We need the voice-injected path to use the same one.

### 4. This is not yet true HTTP streaming TTS in the dashboard

Current state:

- Swift/native playback is the active voice path
- dashboard/browser-side true HTTP streaming TTS is not yet implemented
- the current 9-15 second delay strongly suggests we are still not getting early playback in the way we want

## Most likely root causes

The most likely current causes are:

1. Native voice is still speaking off an early assistant event instead of the dashboard’s final normalized spoken-summary / reply artifact.
2. There are two playback triggers for one user turn.
3. The voice-injected send path is not yet going through the same persistence/render normalization as typed dashboard chat.
4. The TTS path is still too buffered or too late-bound to count as truly streaming.

## Recommended next fixes

### Fix 1: Make the dashboard reply authoritative for speech when the dashboard is open

When the dashboard is open:

- Swift should not infer what to say from any intermediate event
- it should wait for the final dashboard assistant reply artifact
- it should speak only that reply

This should eliminate the “fast short acknowledgment + full answer” split.

### Fix 2: Ensure spoken user turns are created as normal dashboard user messages

Push-to-talk should write a normal user message into the current dashboard thread.
That makes:

- history accurate
- visible session continuity correct
- debugging much easier

### Fix 3: Route voice-injected turns through the same assistant render cleanup path as typed turns

The assistant reply used for voice-injected turns should be normalized by the same dashboard post-processing logic that already removes voice markup in the clean typed-chat path.

### Fix 4: Add per-turn single-playback suppression

Once one assistant turn has begun speaking, any duplicate playback trigger for that same turn should be suppressed.

### Fix 5: Instrument the latency path

We need exact timing for:

- transcript received
- dashboard user message persisted
- assistant reply start
- assistant final reply ready
- TTS request start
- first audio byte
- playback start

Without that, “streaming” remains a guess.

## Recommended order of work

1. Fix dashboard-open authority for reply selection.
2. Make spoken user turns appear as normal dashboard user messages.
3. Remove duplicate playback for a single turn.
4. Strip all raw voice markup from the visible voice-injected path.
5. Add timing instrumentation.
6. Only then move to true dashboard/browser HTTP streaming TTS.

## What to defer

These are real ideas, but not the immediate fix lane:

1. Replacing native STT with a better service.
2. Integrating Wispr Flow directly.
3. Adopting Sesame CSM/Maya-style voice locally.
4. Reworking the dashboard into a native Swift or Electron app.

Those are strategic follow-ons, not this MVP unblocker.

## Strategic conclusion

We are close.

The core path is there:

- Swift can capture voice
- the dashboard can hold the main conversation
- the backend can produce voice
- the app can play it

What is missing is not another architecture.
It is proper normalization of one voice turn into one dashboard turn and one spoken reply.

That should be the focus of the next session.
