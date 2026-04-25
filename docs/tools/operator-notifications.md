---
summary: "Configuring operator notifications for kernel requests"
read_when:
  - Wiring Telegram, Slack, or other channel notifications for operator-needed kernel work
  - Reviewing how the consciousness kernel surfaces requests for human policy or approval
title: "Operator Notifications"
---

# Operator notifications

Argent can already send ordinary outbound messages through configured chat channels such as
Telegram. Kernel operator notifications use that same delivery pipeline instead of hardcoding a
single channel.

Example:

```json5
{
  agents: {
    defaults: {
      kernel: {
        enabled: true,
        mode: "shadow",
        operatorNotifications: {
          enabled: true,
          cooldownMs: 900000,
          targets: [
            { channel: "telegram", to: "123456789" },
            { channel: "slack", to: "U12345678" },
          ],
        },
      },
    },
  },
}
```

When the kernel detects that work is blocked on operator input, it sends a concise message with the
question, reason, and source. Repeated identical requests are suppressed by `cooldownMs`.

Other operator surfaces remain available:

- Telegram/manual outbound: `argent message send --channel telegram --target 123456789 --message "hi"`
- macOS slide-down alert: `argent nodes notify --node <id> --title "Argent" --body "Input needed" --sound Glass`
- Voice/TTS alerts: configure gateway `messages.tts` and use the audio alert/TTS flows.
