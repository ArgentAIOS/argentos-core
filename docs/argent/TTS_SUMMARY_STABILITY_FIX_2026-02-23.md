# TTS + Spoken Summary Stability Fix (2026-02-23)

## Scope

This change set fixes the dashboard spoken-summary pipeline end-to-end:

- Browser freeze during streaming responses
- Intermittent no-audio despite visible `[TTS:...]`
- One-line spoken summaries even when long content exists
- Replay/download blob URL invalidation errors
- Proxy/service-key reliability for TTS routes

## User-Visible Symptoms (Before)

1. Chat response started, then browser tab could freeze or become unresponsive.
2. Spoken Summary panel could render, but no audio played.
3. Spoken summary often collapsed to short one-liners (for example: "`[excited] Let me hear it!`").
4. Console sometimes showed `blob:... net::ERR_FILE_NOT_FOUND` on replay/download.

## Root Causes

1. **Regex backtracking in stream loop**
   - Nested-marker regex parsing for `[TTS:...]` was run repeatedly on partial streamed chunks.
   - This could trigger catastrophic backtracking and lock the main thread.

2. **Short marker selection policy**
   - The app chose the **last** `[TTS:...]` marker.
   - If the model emitted a short final marker, it overrode richer earlier content.

3. **Client-side TTS request resilience gaps**
   - No hard timeout on ElevenLabs fetch path.
   - Dev environment relied on proxy path that could intermittently fail.

4. **Blob URL lifecycle**
   - Blob URLs were revoked too aggressively, causing replay/download references to break.

5. **Proxy key resolution path**
   - TTS proxy key lookup needed PG-aware async resolution and fallback handling.

## What Changed

### 1) Dashboard stream/parser hardening

File: `dashboard/src/App.tsx`

- Replaced regex-based nested marker extraction with linear parsers:
  - `parseStructuredMarkers(...)`
  - `stripStructuredMarkers(...)`
- Removed high-volume per-chunk debug logs in hot path.
- Added internal marker stripping (for tags like `[THINKING:...]`) from display/TTS text.
- Added substantive spoken-summary picker:
  - Scores candidates and prefers richer summary content.
  - Falls back to auto-prepared spoken summary when marker content is too short.

### 2) Gateway client log throttling

File: `dashboard/src/hooks/useGateway.ts`

- Gated verbose stream logging behind:
  - `VITE_DEBUG_GATEWAY_STREAM=1`
- Prevents per-event `JSON.stringify(...)` overhead in normal dev flow.

### 3) TTS client resilience + endpoint fallback

File: `dashboard/src/hooks/useTTS.ts`

- Added `fetchWithTimeout(...)` (15s request timeout).
- Added dev-mode endpoint strategy:
  - First: `http://<host>:9242/api/proxy/tts/elevenlabs`
  - Fallback: `/api/proxy/tts/elevenlabs`
- Preserved no-WebSpeech fallback default (`allowWebSpeechFallback: false`) unless explicitly enabled.
- Improved logging to include endpoint and response phase.
- Resumed `AudioContext` when suspended.
- Stopped auto-revoking blob URLs during playback/stop to keep replay/download stable.

### 4) Dashboard API proxy key/auth path

File: `dashboard/api-server.cjs`

- Added auth passthrough exceptions for:
  - `/api/proxy/tts/elevenlabs`
  - `/api/proxy/tts/openai`
- Added async PG-aware service-key resolution for proxy routes:
  - `resolveServiceKeyForProxy(...)`
  - fallback order: PG/service-keys infra -> direct PG decrypt -> env/json.

### 5) Prompt/bootstrap policy updates

Files:

- `extensions/summarize-tts-enforcer/index.ts`
- `src/agents/bootstrap-files.ts`
- `src/agents/workspace.ts`

- Enforcer now uses `agent:bootstrap` policy injection and stronger guidance for full spoken summaries.
- Added system-injected `TTS_POLICY.md` bootstrap file to keep marker behavior consistent.

## Validation Performed

1. Dashboard typecheck:
   - `pnpm -C dashboard exec tsc --noEmit`
2. Direct TTS proxy tests:
   - `http://localhost:8080/api/proxy/tts/elevenlabs` returned `200 audio/mpeg`
   - `http://localhost:9242/api/proxy/tts/elevenlabs` returned `200 audio/mpeg`
3. Runtime behavior:
   - No browser freeze while streaming responses.
   - Audio playback confirmed with ElevenLabs tags.
   - Spoken Summary panel with replay/download controls confirmed.

## Known Notes

- Log line `Redis agent state init skipped: already connecting/connected` is benign.
- Multiple `[TTS:...]` markers can still appear from model output; client now prefers substantive content.

## Operational Guidance

If spoken summaries regress:

1. Confirm console shows:
   - `[TTS] Requesting eleven_v3 via ...`
   - `[TTS] Response received in ...`
2. Confirm API health:
   - `curl http://localhost:8080/api/apps`
   - `curl -X POST http://localhost:8080/api/proxy/tts/elevenlabs ...`
3. Verify gateway bootstrap logs include:
   - `[summarize-tts-enforcer] Registered agent:bootstrap hook`
