---
name: podcast-production
description: Plan, generate, mix, and publish a daily multi-persona podcast episode using podcast_plan + podcast_generate, with optional HeyGen video and YouTube upload flow.
metadata:
  {
    "argent":
      {
        "emoji": "podcast",
        "skillKey": "podcast-production",
        "requires": { "envAny": ["ELEVENLABS_API_KEY", "XI_API_KEY"] },
      },
  }
---

# Podcast Production

Use this skill when the user asks to create/ship podcast episodes end-to-end.

## Primary Tools

- `podcast_plan`: normalize script/personas, produce `podcast_generate` payload + runbook
- `podcast_generate`: one-shot ElevenLabs dialogue render + optional FFmpeg intro/outro/bed mix
- `podcast_publish_pipeline`: one-call orchestrator for audio -> HeyGen -> YouTube metadata -> thumbnail -> optional YouTube upload
- `heygen_video`: avatar/voice discovery, HeyGen video generation, status polling, downloads
- `youtube_metadata_generate`: YouTube title + description + chapters + thumbnail brief
- `youtube_thumbnail_generate`: generate final thumbnail image asset
- `sessions_spawn` / `sessions_send`: dispatch research minions/family agents
- `web_search` / `web_fetch`: source and verify stories

## Daily Flow (Autonomous)

1. Research swarm

- Spawn 2-6 research agents focused on model releases, infra, pricing, and notable papers.
- Require source URLs and publication timestamps for each claim.
- Merge into a short ranked shortlist (3-5 stories + 1 deep dive).

2. Script planning

- Build a host/cohost script with clear segments.
- Call `podcast_plan` with `personas` (1-3), script, and publish targets.
- Reuse `podcast_plan.podcast_generate` output as the direct next call payload.

3. Audio generation

- Call `podcast_generate` exactly once for dialogue rendering.
- If music assets exist, pass `music.intro_path`, `music.outro_path`, `music.bed_path`.
- Keep `ducking: true` for speech clarity unless the user asks otherwise.

4. Publish operations

- Spotify: use Spotify for Creators web flow for episode publish.
- HeyGen (optional): generate avatar/headless video from script/audio.
  - For scene cuts/B-roll style sequencing, pass `scenes[]` to `heygen_video` so each entry maps to one `video_inputs[]` scene.
  - Default Argent avatar ID for this setup: `885b0ad5cd61488b8a9828ff0e244e15` (pass as `default_avatar_id`, or set `HEYGEN_DEFAULT_AVATAR_ID`).
- YouTube packaging: run `youtube_metadata_generate`, then `youtube_thumbnail_generate`.
  - For creator-style long descriptions, use:
    - `description_style: "creator_longform"`
    - `style_profile_path: "skills/podcast-production/references/youtube-style-creator-longform.json"`
- YouTube upload (optional): upload video using YouTube Data API workflow.

5. Record outcomes

- Save URLs, episode title/date, and blockers into memory/tasks.
- Log follow-up improvements for tomorrow's run.

## Constraints

- Do not split dialogue into per-line TTS files unless one-shot generation fails.
- Keep persona count between 1 and 3.
- Treat publishing as separate from generation; generation success does not imply publish success.
- If a platform publish step fails, still deliver usable audio/video artifacts and report exact failure.

## Quick Start Payload Shape

```json
{
  "title": "Bleeding Edge Episode",
  "personas": [
    { "id": "argent", "voice_id": "cgSgspJ2msm6clMCkdW9", "aliases": ["ARGENT", "HOST"] },
    { "id": "juniper", "voice_id": "aMSt68OGf4xUZAnLpTU8", "aliases": ["JUNIPER"] }
  ],
  "script": "ARGENT: ...\nJUNIPER: ...",
  "publish": { "spotify": true, "heygen": true, "youtube": true },
  "publish_time_local": "08:00",
  "timezone": "America/Chicago"
}
```

Use the returned `podcast_generate` object directly in the next tool call.

## One-Call Pipeline Example

```json
{
  "mode": "run",
  "podcast_generate": {
    "title": "Bleeding Edge Episode",
    "dialogue": [
      { "text": "[energetic] You're listening to Argent.", "voice_id": "cgSgspJ2msm6clMCkdW9" },
      { "text": "[warm] Juniper here.", "voice_id": "aMSt68OGf4xUZAnLpTU8" }
    ],
    "model_id": "eleven_v3",
    "output_format": "mp3_44100_192"
  },
  "heygen": {
    "enabled": true,
    "wait_for_completion": true,
    "params": {
      "default_avatar_id": "885b0ad5cd61488b8a9828ff0e244e15",
      "scenes": [
        {
          "script": "Argent opening.",
          "voice_id": "REPLACE_HEYGEN_VOICE_ID",
          "background_type": "color",
          "background_value": "#0F172A"
        }
      ]
    }
  },
  "youtube_metadata": {
    "description_style": "creator_longform",
    "style_profile_path": "skills/podcast-production/references/youtube-style-creator-longform.json"
  },
  "youtube_upload": {
    "enabled": true,
    "privacy_status": "private",
    "notify_subscribers": false
  }
}
```

## References

- For current publish platform notes, read [references/publish-targets.md](references/publish-targets.md).
- For reusable longform YouTube description defaults, read [references/youtube-style-creator-longform.json](references/youtube-style-creator-longform.json).
- For a ready HeyGen scene template using Argent's avatar ID, read [references/heygen-scenes-argent.json](references/heygen-scenes-argent.json).
