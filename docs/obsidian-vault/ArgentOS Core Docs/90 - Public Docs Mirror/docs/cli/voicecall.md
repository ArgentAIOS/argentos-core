---
summary: "CLI reference for `argent voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
title: "voicecall"
---

# `argent voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:

- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
argent voicecall status --call-id <id>
argent voicecall call --to "+15555550123" --message "Hello" --mode notify
argent voicecall continue --call-id <id> --message "Any questions?"
argent voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
argent voicecall expose --mode serve
argent voicecall expose --mode funnel
argent voicecall unexpose
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.
