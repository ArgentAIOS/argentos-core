---
summary: "CLI reference for `argent agent` (send one agent turn via the Gateway or embedded)"
read_when:
  - You want to run one agent turn from scripts (optionally deliver reply)
  - You want to route a turn to a non-default channel or target a specific agent
  - You're debugging session resumption (`--session-id` vs `--to`)
title: "agent"
---

# `argent agent`

Run a single agent turn via the Gateway. Useful for scripts, cron jobs, and one-shot
automations where you don't want to keep a TUI session open.

By default the command talks to the running Gateway. Pass `--local` to run the embedded
agent in-process — this requires model-provider credentials in your shell environment
(see [`argent models auth`](/cli/models)).

Related:

- Conversation TUI: [`argent tui`](/cli/tui)
- Send a message without an agent turn: [`argent message`](/cli/message)
- Manage isolated agents (workspaces + routing): [`argent agents`](/cli/agents)
- Agent send tool (internal): [Agent send](/tools/agent-send)

## Examples

```bash
# Start a new session, scoped to a recipient
argent agent --to +15555550123 --message "status update"

# Resume an existing session by id
argent agent --session-id 1234 --message "Summarize inbox" --thinking medium

# Pin a specific agent (overrides routing bindings)
argent agent --agent ops --message "Summarize logs"

# Run embedded (no Gateway required) — needs model API keys in your env
argent agent --local --message "Draft a release note"

# Deliver the reply back through the inferred channel
argent agent --to +15555550123 --message "Send hello" --deliver

# Override the reply channel/target (deliver elsewhere than where the request came from)
argent agent --agent ops --message "Generate report" \
  --deliver --reply-channel slack --reply-to "#reports"

# Persist verbose level for the session and emit JSON
argent agent --to +15555550123 --message "Trace logs" --verbose on --json
```

## Options

| Option                      | Description                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-m, --message <text>`      | Message body for the agent. Required.                                                                                                                                                                                                                            |
| `-t, --to <number>`         | Recipient number in E.164. Used to derive the session key when no `--session-id` is given.                                                                                                                                                                       |
| `--session-id <id>`         | Use an explicit session id (resumes that session).                                                                                                                                                                                                               |
| `--agent <id>`              | Pin a specific agent id. Overrides routing bindings configured in `argent.json`.                                                                                                                                                                                 |
| `--thinking <level>`        | Thinking level: `off \| minimal \| low \| medium \| high`.                                                                                                                                                                                                       |
| `--verbose <on\|off>`       | Persist agent verbose level for the session. Survives reconnects.                                                                                                                                                                                                |
| `--channel <channel>`       | Delivery channel. One of: `last`, `telegram`, `whatsapp`, `discord`, `googlechat`, `slack`, `signal`, `imessage`, `feishu`, `nostr`, `msteams`, `mattermost`, `nextcloud-talk`, `matrix`, `bluebubbles`, `line`, `zalo`, `zalouser`, `tlon`. Default `whatsapp`. |
| `--reply-to <target>`       | Delivery target override (separate from session routing).                                                                                                                                                                                                        |
| `--reply-channel <channel>` | Delivery channel override (separate from routing).                                                                                                                                                                                                               |
| `--reply-account <id>`      | Delivery account id override.                                                                                                                                                                                                                                    |
| `--local`                   | Run the embedded agent in-process. Requires model-provider API keys in your shell.                                                                                                                                                                               |
| `--deliver`                 | Send the agent's reply back to the selected channel.                                                                                                                                                                                                             |
| `--json`                    | Output result as JSON (machine-readable).                                                                                                                                                                                                                        |
| `--timeout <seconds>`       | Override the agent command timeout. Default 600s or the value from `agents.defaults.timeoutSeconds`.                                                                                                                                                             |

## Session resolution

`argent agent` resolves a session in this order:

1. If `--session-id` is set, that session is used directly.
2. Else if `--to` is set, the session key is derived from `(channel, recipient)`.
3. Otherwise a new ephemeral session is started.

Use `argent sessions` to list stored session ids, or `argent status` for a summary by
recipient. See [`argent sessions`](/cli/sessions) and [`argent status`](/cli/status).

## Routing & delivery

The `--channel` / `--reply-channel` split is intentional:

- `--channel` controls **routing** — which channel's session key + bindings to use.
- `--reply-channel` / `--reply-to` control **delivery only** — where the reply lands.

This lets you, for example, run a turn under a Telegram session but deliver the answer
into Slack: `--channel telegram --reply-channel slack --reply-to "#ops"`.

`--deliver` is required for any reply to actually be sent; without it, the reply is
printed to stdout (or returned as JSON with `--json`) and not pushed to any channel.

## Embedded mode (`--local`)

`--local` skips the Gateway and runs the agent in-process. This is the right mode when:

- You're scripting in CI and don't want a long-running service.
- You're debugging a model-provider plugin without restarting the Gateway.

Requirements:

- Model provider API keys must be available in the shell environment (or via
  `argent models auth login` so the resolved auth profile is readable).
- Skills + tools requiring the Gateway (channel send, browser, sandbox RPC) are not
  available in embedded mode.

## Exit codes

- `0` — success (and reply delivered if `--deliver` was set).
- Non-zero — connection failure, timeout, or agent-side error. Use `--json` to surface
  the structured error payload.
