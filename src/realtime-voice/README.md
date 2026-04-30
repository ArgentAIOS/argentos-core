# Realtime Voice Providers

## Google Gemini Live

Status: preview/live-ready provider boundary for gateway relay only.

The Gemini Live provider registers as `google` with aliases `gemini`, `google-live`, and `gemini-live`. It requires `GEMINI_API_KEY` or `GOOGLE_API_KEY` on the gateway process, or `talk.realtime.providers.google.apiKey` in config. It uses the official Gemini Live WebSocket flow: connect to the Live API endpoint, send the setup message first, then stream realtime input and receive server content, audio, transcripts, and tool calls.

Browser-direct Gemini Live is intentionally blocked until Argent adds an ephemeral token service. A browser-direct connection must not expose the Google API key. Use `transport: "gateway-relay"` for Gemini Live.

Operator surface plan for the next UI/control slice:

- Start location: Talk realtime voice session entry in the operator UI or Control UI, backed by `talk.realtime.session`.
- Controls: provider, model, voice, transport, and explicit labels for live, preview, test-only, key-gated, and not-configured states.
- Device state: microphone permission, selected input, selected speaker, sample-rate/encoding status, mute state, and audio activity meters.
- Session visibility: connecting, ready, connected, reconnecting, stopped, transcript stream, incoming audio activity, tool-call activity, errors, and retry guidance.
- Actions: start, stop, cancel, mute/unmute, retry, and copy sanitized diagnostics.
- Secret behavior: never render API keys, client secrets, access tokens, or raw auth headers in UI/log views.
- Manual smoke: configure provider key, start gateway, open gateway-hosted UI, start Talk realtime with provider `google` and transport `gateway-relay`, grant mic permission, speak a short prompt, confirm transcript/audio/tool/error events, then stop and verify no secrets appear in diagnostics.
- Current non-goals: Google Meet live join/create/leave, phone-call voice sessions, broad dashboard UI, Workflows/AppForge/AOS coupling, and browser-direct Gemini Live without an ephemeral token service.

Primary references used for this boundary: official Gemini Live WebSocket reference at `https://ai.google.dev/api/live` and Live capabilities guide at `https://ai.google.dev/gemini-api/docs/live-guide`.
