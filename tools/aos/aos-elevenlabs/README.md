# aos-elevenlabs

`aos-elevenlabs` is a vendored ElevenLabs connector for ArgentOS with full
voice generation capabilities.

## Capabilities

- **tts.generate** / **tts.stream** — Text-to-speech with voice settings
  (stability, similarity boost, style). Returns inline base64 or writes to file.
- **voices.list** / **voices.get** — Browse and inspect ElevenLabs voices.
- **voices.clone** — Create instant voice clones from audio sample files.
- **sfx.generate** — Generate sound effects from a text description.
- **audio.isolate** — Remove background noise from an audio file.
- **history.list** / **history.download** — Browse and download generation history.
- **model.list** — List available ElevenLabs models.
- **user.read** — Read account and subscription info.

## Auth

Live access requires `ELEVENLABS_API_KEY`. Optional env vars:

- `ELEVENLABS_BASE_URL` — Non-default API host
- `ELEVENLABS_VOICE_ID` — Default voice for TTS commands
- `ELEVENLABS_MODEL_ID` — Default model (e.g. `eleven_multilingual_v2`)
- `ELEVENLABS_HISTORY_ITEM_ID` — Default history item for downloads
