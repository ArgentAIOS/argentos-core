# aos-elevenlabs

`aos-elevenlabs` is a vendored ElevenLabs connector with live read access for
voices, models, history, and user/account metadata.

`synthesize` is a live write bridge that POSTs to ElevenLabs and returns either
inline base64 audio or a file reference if `--output` is supplied. Live access
uses `ELEVENLABS_API_KEY` and optional `ELEVENLABS_BASE_URL`.
