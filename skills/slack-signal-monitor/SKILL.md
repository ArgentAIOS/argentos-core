---
name: slack-signal-monitor
description: Configure and run Slack signal monitoring (mentions + keyword watchlist) with dedupe, audio alerts, task creation, and cron automation.
metadata: { "argent": { "emoji": "slack", "skillKey": "slack-signal-monitor" } }
---

# Slack Signal Monitor

Use `slack_signal_monitor` to detect high-signal Slack activity and proactively alert Jason.

## First run

1. Run `slack_signal_monitor` with `action: "status"`.
2. If `setupRequired: true`, configure Slack token/scopes and monitor scope.
3. Set monitor config with `action: "set_config"`.
4. Enable cron with `action: "ensure_cron_monitor"`.

## Recommended first-run commands

1. Configure all-channel monitoring:

```json
{
  "action": "set_config",
  "monitorAllChannels": true,
  "mentionNames": ["jason"],
  "intervalSeconds": 300,
  "lookbackMinutes": 10
}
```

2. Confirm setup:

```json
{ "action": "status" }
```

3. Run an immediate scan:

```json
{ "action": "scan_now" }
```

4. Turn on cron monitor:

```json
{ "action": "ensure_cron_monitor" }
```

## Core actions

- `status`
- `set_config`
- `scan_now`
- `ensure_cron_monitor`
- `disable_cron_monitor`
- `clear_seen`

## Example setup

```json
{
  "action": "set_config",
  "monitorAllChannels": true,
  "mentionNames": ["jason"],
  "keywordWatchlist": [
    "DNS",
    "DMARC",
    "domain transfer",
    "website",
    "Barrett",
    "urgent",
    "ASAP",
    "blocked"
  ],
  "intervalSeconds": 300,
  "lookbackMinutes": 10,
  "taskCreationEnabled": true,
  "audioAlertEnabled": true,
  "mainSessionAudioAlert": true
}
```

## Notes

- `monitorAllChannels: true` scans all active Slack channels visible to the configured token.
- To monitor specific channels only, set `monitorAllChannels: false` and provide `watchedChannels`.
- `watchedChannels` also accepts `"all"` or `"*"` as shorthand for all-channel mode.
- Add `users:read` scope for reliable user display-name resolution.
- Known fallback sender names are used when user lookup fails.
- Monitor is deduped by `channelId:messageTs` so repeated scans do not re-alert old messages.
