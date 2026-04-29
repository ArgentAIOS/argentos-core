# AOS Slack Attention

`aos-slack-attention` is a read-only Slack attention scanner. It watches configured channels for operator mentions, configured names, and attention keywords, then emits structured alert candidates for Workflows.

Required operator configuration:

- `SLACK_BOT_TOKEN`
- `SLACK_ATTENTION_CHANNELS`

Optional operator configuration includes keywords, mention user IDs/names, scan cadence, lookback, dedupe window, quiet hours, and alert destinations.
