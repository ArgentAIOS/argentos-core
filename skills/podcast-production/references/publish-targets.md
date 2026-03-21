# Publish Targets (Validated: 2026-03-03)

## Spotify

- Current practical route is Spotify for Creators web publishing.
- Spotify support docs describe web/mobile upload/publish flow for hosted shows.
- Community guidance indicates no public API endpoint for direct podcast upload/publish.

## HeyGen

- Base URL: `https://api.heygen.com`
- Current key endpoints in docs:
  - `POST /v1/video_agent/generate` (prompt-to-video flow)
  - `POST /v2/video/generate` (structured avatar video generation)
  - `GET /v1/video_status.get?video_id=...` (status + download URLs)
  - `GET /v2/avatars` and `GET /v2/voices` (asset discovery)
- Scene composition:
  - `video_inputs` is an array; each item can act as a scene block (A-roll/B-roll style sequencing).
  - Scene-level background controls (`type`, `value`, optional `play_style`) support video/image cut backgrounds.
- Recommended pattern:
  1. Generate video (`v2/video/generate` or Video Agent).
  2. Poll status endpoint until `completed` or `failed`.
  3. Persist `video_url`, `thumbnail_url`, and failure details.

## YouTube

- Use YouTube Data API `videos.insert` for uploads.
- Upload endpoint: `POST https://www.googleapis.com/upload/youtube/v3/videos`.
- Prefer resumable uploads for larger video artifacts.
- Note: uploads from unverified API projects may default to private until audit completion.

## Operational Pattern

1. Generate final audio (`podcast_generate`).
2. Generate video (optional, HeyGen).
3. Publish/upload (Spotify web flow, YouTube API flow).
4. Store returned URLs + publish status in memory/tasks.
