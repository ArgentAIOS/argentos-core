---
summary: "CLI reference for `argent logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling (jq pipelines, log shippers)
  - You're waiting for an agent turn to complete (`--expect-final`)
title: "logs"
---

# `argent logs`

Tail Gateway file logs over RPC. Works against both local and remote Gateways, so you
don't need SSH on the host to see what the daemon is doing.

The Gateway buffers recent log lines and serves them through the same WebSocket RPC the
TUI uses. `argent logs` is the read-only client.

Related:

- Logging overview + log file locations: [Logging](/logging)
- Doctor (looks at logs for known errors): [`argent doctor`](/cli/doctor)
- Live Gateway health: [`argent health`](/cli/health)

## Examples

```bash
# Print the last 200 lines and exit
argent logs

# Follow logs (tail -f), default 1s poll interval
argent logs --follow

# JSON lines for jq / log shippers
argent logs --json --follow | jq 'select(.level=="error")'

# Larger window when investigating an incident
argent logs --limit 2000 --max-bytes 1000000

# Strip ANSI for grep-friendly output
argent logs --plain | grep ERROR

# Point at a remote Gateway explicitly
argent logs --url ws://10.0.0.5:18789 --token <token> --follow

# Block until an agent turn finalizes (useful in scripts)
argent agent --to +15555550123 --message "long task" --deliver &
argent logs --follow --expect-final
```

## Options

| Option            | Description                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--limit <n>`     | Max lines to return per poll. Default `200`.                                                                                      |
| `--max-bytes <n>` | Max bytes to read from the log buffer. Default `250000`. Use to widen the window when `--limit` truncates mid-line on dense logs. |
| `--follow`        | Follow log output (like `tail -f`). Default `false`.                                                                              |
| `--interval <ms>` | Polling interval in ms when following. Default `1000`.                                                                            |
| `--json`          | Emit JSON log lines (one object per line).                                                                                        |
| `--plain`         | Plain text output, no ANSI styling.                                                                                               |
| `--no-color`      | Disable ANSI colors (alias for `--plain` in some terminals).                                                                      |
| `--url <url>`     | Gateway WebSocket URL. Defaults to `gateway.remote.url` from `argent.json`.                                                       |
| `--token <token>` | Gateway token, if the Gateway requires one.                                                                                       |
| `--timeout <ms>`  | RPC timeout in ms. Default `30000`.                                                                                               |
| `--expect-final`  | Wait for the next agent turn to emit its final response, then exit `0`. Useful for scripted "wait until done" flows.              |

## Follow mode

`--follow` polls the Gateway's log buffer every `--interval` ms and prints new lines.
This is not a true streaming socket — it's a poll loop — so set `--interval` based on
how chatty you want the output:

- `--interval 250` — near-realtime, more RPC load.
- `--interval 1000` (default) — fine for human watching.
- `--interval 5000` — quiet background tail.

Press `Ctrl-C` to exit cleanly. The Gateway is not affected.

## JSON output

`--json` emits one structured object per line. Common fields:

- `ts` — RFC3339 timestamp.
- `level` — `debug | info | warn | error`.
- `source` — gateway subsystem (e.g. `agent`, `channels`, `rpc`).
- `msg` — human-readable message.
- `meta` — structured extras (varies per source).

Pipe through `jq` for filtering: `argent logs --follow --json | jq -c 'select(.level=="error")'`.

## `--expect-final`

`--expect-final` makes `argent logs` block until the Gateway emits a final agent
response, then exits `0`. This is the right primitive when:

- You fire `argent agent ... --deliver` in the background and want to wait for it.
- A CI job needs to gate on an agent turn finishing.

Exits non-zero on timeout (`--timeout`) or RPC failure.

## Troubleshooting

- **No lines printed** — Gateway is up but the log buffer is empty (recent restart).
  Try `--limit 50` or generate a turn with `argent agent`.
- **`ECONNREFUSED`** — local Gateway isn't running. Start it with `argent gateway` or
  check `argent status`.
- **Truncated lines on dense logs** — bump `--max-bytes`.
- **ANSI escapes in your log shipper** — add `--plain` (or `--no-color`).
