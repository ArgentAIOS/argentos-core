---
name: send-payload
summary: Fan out one payload to multiple channels/surfaces (including main session and audio alerts).
---

# Send Payload Skill

Use the core `send_payload` tool to deliver one message to many routes in a single call.

## Routes

- External channels: `discord`, `slack`, `telegram`, `whatsapp`, etc.
- `main-session`: injects payload directly into a webchat session (`chat.inject`)
- `audio`: generates an `audio_alert` and injects `[ALERT]/MEDIA` into main session

## Required Inputs

- `message`: base payload text
- `routes`: array of route objects with `channel` and (for external channels) `target`

## Optional Inputs

- `media`: array of media URLs/paths (emitted as `MEDIA:` lines)
- `sessionKey`: default session key for `main-session`/`audio`
- `title`, `voice`, `mood`, `urgency`: audio route options
- `maxChars` per route for chunking
- `bestEffort` per route

## Example

```json
{
  "message": "VIP email detected from Dustin.",
  "routes": [
    { "channel": "discord", "target": "user:123" },
    { "channel": "main-session" },
    { "channel": "audio", "bestEffort": true }
  ]
}
```
