---
summary: "CLI reference for `argent tui` (terminal UI connected to the Gateway)"
read_when:
  - You want a terminal UI for the Gateway (remote-friendly)
  - You want to pass url/token/session from scripts or SSH sessions
  - You're debugging history/thinking-level/initial-message behavior
title: "tui"
---

# `argent tui`

Open the Argent terminal UI connected to the Gateway. Unlike [`argent agent`](/cli/agent),
which runs a single turn and exits, `tui` is an interactive client — it streams the
session, surfaces tool calls and approvals, and lets you continue a conversation.

Works against any reachable Gateway, including remote ones over WebSocket — pass
`--url` and `--token` for that. With no flags, it uses `gateway.remote.url` from
`argent.json` (set during `argent configure`).

Related:

- TUI guide (keybindings, panes, layout): [TUI](/tui)
- One-shot turn: [`argent agent`](/cli/agent)
- Session inventory: [`argent sessions`](/cli/sessions)

## Examples

```bash
# Local Gateway, default session
argent tui

# Remote Gateway with explicit URL + token
argent tui --url ws://10.0.0.5:18789 --token <token>

# Pick a specific session and deliver assistant replies through its channel
argent tui --session main --deliver

# Open with an initial message and a higher thinking level
argent tui --message "Plan the migration" --thinking high

# Password-gated Gateway (paired devices)
argent tui --url wss://gw.example.com --password <password>

# Larger history window for a long-running session
argent tui --session ops --history-limit 1000
```

## Options

| Option                  | Description                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--url <url>`           | Gateway WebSocket URL. Defaults to `gateway.remote.url` from `argent.json` when configured, else the local Gateway.            |
| `--token <token>`       | Gateway token, if the Gateway requires one.                                                                                    |
| `--password <password>` | Gateway password, if the Gateway is password-gated (paired-device flow).                                                       |
| `--session <key>`       | Session key. Default `main`; or `global` when scope is global.                                                                 |
| `--deliver`             | Deliver assistant replies through the session's configured channel (instead of only showing them in the TUI). Default `false`. |
| `--thinking <level>`    | Thinking level override: `off \| minimal \| low \| medium \| high`.                                                            |
| `--message <text>`      | Send an initial message after connecting (skips the empty-prompt landing screen).                                              |
| `--timeout-ms <ms>`     | Agent timeout in ms. Defaults to `agents.defaults.timeoutSeconds` from config.                                                 |
| `--history-limit <n>`   | History entries to load on connect. Default `200`.                                                                             |

## Connection precedence

The Gateway URL is resolved in this order:

1. `--url` flag.
2. `gateway.remote.url` in `argent.json` (set by `argent configure`).
3. Local Gateway on the configured port (`18789` default, `19001` for `--dev`).

If `--password` is set, the TUI performs the paired-device handshake. If `--token` is
set, the token is passed in the WebSocket subprotocol. You can't combine the two — pick
the auth mode that matches your Gateway's `gateway.auth` config.

## Sessions

`--session <key>` selects which conversation thread to attach to. Common keys:

- `main` — the default global session.
- `global` — when running with a global scope.
- A channel-derived key (e.g. `whatsapp:+15555550123`) — opens the same conversation
  the channel side sees.

Use [`argent sessions`](/cli/sessions) to list available session keys.

## Initial message + delivery

`--message` is the scripted equivalent of typing the first line and hitting send. Combine
with `--deliver` to push the assistant's response back through the channel — useful when
you want a TUI window to watch a turn complete while still delivering the reply.

## Troubleshooting

- **`ECONNREFUSED` / `socket hang up`** — Gateway isn't running, or `--url` points at the
  wrong host/port. Verify with `argent health` or `argent status`.
- **`401` / token errors** — token is stale or wrong. Re-run `argent configure` or fetch
  a fresh token via `argent dashboard --no-open` and copy the displayed value.
- **TUI hangs on startup** — bump `--timeout-ms` for slow remote Gateways, or check that
  `--history-limit` isn't too large for the session store size.
