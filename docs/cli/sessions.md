---
summary: "CLI reference for `argent sessions` (list stored sessions + usage)"
read_when:
  - You want to list stored sessions and see recent activity
  - You're looking up a session id to resume via `argent agent --session-id`
  - You want token-usage / context-window data per session
title: "sessions"
---

# `argent sessions`

List stored conversation sessions across all agents and channels.

A session is the unit of conversational memory Argent persists between turns. Each
session has a key (often `channel:recipient`), an id, a last-activity timestamp, and —
when the agent reports it — a token-usage snapshot. `argent sessions` is the read-only
inventory.

Related:

- Resume a session from the CLI: [`argent agent --session-id`](/cli/agent)
- Attach a TUI to a session: [`argent tui --session`](/cli/tui)
- Channel + session health summary: [`argent status`](/cli/status)

## Examples

```bash
# List all stored sessions
argent sessions

# Only sessions touched in the last 2 hours
argent sessions --active 120

# Machine-readable output for scripts / jq
argent sessions --json

# Inspect a non-default session store path
argent sessions --store ./tmp/sessions.json

# Verbose output (extra metadata)
argent sessions --verbose
```

## Options

| Option               | Description                                                                       |
| -------------------- | --------------------------------------------------------------------------------- |
| `--json`             | Output as JSON.                                                                   |
| `--verbose`          | Verbose logging (extra metadata per session).                                     |
| `--store <path>`     | Path to the session store file. Defaults to the path resolved from `argent.json`. |
| `--active <minutes>` | Only show sessions updated within the past N minutes.                             |

## What gets listed

Each row includes:

- **Session key** — `channel:recipient` for routed sessions, or `main`/`global` for
  ambient ones.
- **Session id** — opaque id, what you pass to `argent agent --session-id`.
- **Last activity** — relative timestamp.
- **Agent** — the agent id this session is bound to (when isolation is on).
- **Token usage** — when the agent reports it. If `agents.defaults.contextTokens` is
  set, the listing also shows percent-of-window so you can spot sessions nearing the
  cap.

## Session stores

Each agent has its own session store at
`~/.argentos/agents/<agent>/agent/sessions.json` (path varies with profile + `--dev`).
By default `argent sessions` reads the active agent's store. Use `--store <path>` to
read a different one — useful when triaging another agent without switching profiles.

## Token-usage cap

Set `agents.defaults.contextTokens` in `argent.json` to cap the visible context window.
When set, `argent sessions` renders a percentage column so you can see which sessions
are approaching their cap and may need compaction or a fresh session.

## Troubleshooting

- **Empty list** — store path may be wrong. Check `argent config get
agents.defaults.sessionsPath` (or use `--store`).
- **Token columns blank** — the agent never reported usage for those sessions
  (older sessions, or model providers that don't surface it).
- **Stale sessions cluttering output** — narrow with `--active`, or archive the store.
