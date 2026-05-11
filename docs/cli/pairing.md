---
summary: "CLI reference for `argent pairing` (approve/list pairing requests for DM channels)"
read_when:
  - You're using pairing-mode DMs and need to approve senders
  - You need to inspect or clear the pending pairing queue
title: "pairing"
---

# `argent pairing`

Approve or inspect DM pairing requests for channels that support pairing (currently
Telegram, Discord, and Slack).

When a sender first DMs the bot on a paired channel, they must obtain a one-time
pairing code and the operator must approve it before messages flow through. This
command is the operator side of that flow.

Related:

- Pairing concept + sender-side flow: [Pairing](/start/pairing)
- Channel-level config: [`argent channels`](/cli/channels)
- Approve other kinds of actions (exec): [`argent approvals`](/cli/approvals)

## Subcommand map

```
argent pairing
├── list [channel]                       List pending pairing requests
└── approve <codeOrChannel> [code]       Approve a pairing code
```

## Examples

```bash
# List all pending pairing requests across supported channels
argent pairing list

# Restrict to one channel (positional or flag — both work)
argent pairing list telegram
argent pairing list --channel telegram

# JSON for scripts
argent pairing list --json

# Approve a code (channel inferred when only one channel has pending requests)
argent pairing approve 123456

# Explicit channel + code
argent pairing approve telegram 123456

# Approve and notify the requester on the same channel
argent pairing approve telegram 123456 --notify
```

## `argent pairing list`

List pending pairing requests.

Arguments:

- `[channel]` — Optional channel filter (`telegram`, `discord`, `slack`).

Options:

- `--channel <channel>` — Same as the positional argument; either form works.
- `--json` — Print JSON output.

Output columns: channel, requester (display name + handle), pairing code, requested-at
timestamp.

## `argent pairing approve <codeOrChannel> [code]`

Approve a pending pairing code, allowing that sender to DM the bot.

Two calling conventions are supported:

1. `argent pairing approve <code>` — pass just the code (channel inferred when
   unambiguous).
2. `argent pairing approve <channel> <code>` — explicit channel + code.

Options:

- `--channel <channel>` — Channel name. Required when the code is ambiguous across
  channels and you didn't pass channel positionally.
- `--notify` — After approving, send a confirmation message to the requester on the
  same channel. Default `false`.

## Supported channels

Pairing is currently implemented for:

- `telegram`
- `discord`
- `slack`

WhatsApp and iMessage use different anti-spam flows and do not appear here. See
[Channels](/channels) for the per-channel auth/approval model.

## Troubleshooting

- **`No pending requests`** — the code may have already been approved or expired; ask
  the requester to re-run the pairing command on their side.
- **`Channel ambiguous`** — pass `--channel <name>` or use the two-arg form.
- **Requester never gets a confirmation** — pass `--notify` so approval echoes back on
  the same channel.
