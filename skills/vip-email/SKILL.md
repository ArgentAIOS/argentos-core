---
name: vip-email
description: Configure and operate VIP Gmail monitoring with deduped alerts, cron scanning, and gog OAuth fallback.
metadata: { "argent": { "emoji": "📨", "requires": { "bins": ["gog"] } } }
---

# vip-email

Use the `vip_email` tool to monitor high-priority senders in Gmail and alert once per new message.

## First run (required)

If `vip_email` reports `setupRequired: true`, switch to the `gog` skill and complete OAuth:

- `gog auth credentials /path/to/client_secret.json`
- `gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets`
- `gog auth list --json`

Then return to `vip_email`.

## Core setup

1. Add VIP senders:
   - `vip_email` action `add_vip` with `email` and optional `name`
2. Set allowed inbox accounts (optional; defaults to discovered gog accounts):
   - `vip_email` action `set_accounts` with `accounts`
3. Configure alerts:
   - `vip_email` action `set_alerts` with:
     - `ttsEnabled` (true/false)
     - `channelRoutes` array (`channel`, `target`, optional `accountId`, `bestEffort`)
4. Install monitor cron:
   - `vip_email` action `ensure_cron_monitor` with optional `intervalSeconds`

## Operations

- Health/status: `vip_email` action `status`
- Manual scan now: `vip_email` action `scan_now`
- List VIPs: `vip_email` action `list_vips`
- Remove VIP: `vip_email` action `remove_vip`
- Read and clear queued items: `vip_email` action `check_pending` (`clear` defaults true)
- Disable monitor cron: `vip_email` action `disable_cron_monitor`
- Reset dedupe set: `vip_email` action `clear_seen`

## Notes

- Dedupe is key-based per account+message id; the same email should not alert twice.
- Pending queue defaults to `/tmp/vip-email-pending.json` for downstream processors.
- Cron monitor runs isolated and invokes `vip_email` scan action.
