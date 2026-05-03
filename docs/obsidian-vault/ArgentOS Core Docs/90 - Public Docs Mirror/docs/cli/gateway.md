---
summary: "ArgentOS Gateway CLI (`argent gateway`) — run, query, and discover gateways"
read_when:
  - Running the Gateway from the CLI (dev or servers)
  - Debugging Gateway auth, bind modes, and connectivity
  - Discovering gateways via Bonjour (LAN + tailnet)
title: "gateway"
---

# Gateway CLI

The Gateway is ArgentOS’s WebSocket server (channels, nodes, sessions, hooks).

Subcommands in this page live under `argent gateway …`.

Related docs:

- [/gateway/bonjour](/gateway/bonjour)
- [/gateway/discovery](/gateway/discovery)
- [/gateway/configuration](/gateway/configuration)

## Run the Gateway

Run a local Gateway process:

```bash
argent gateway
```

Foreground alias:

```bash
argent gateway run
```

Notes:

- By default, the Gateway refuses to start unless `gateway.mode=local` is set in `~/.argentos/argent.json`. Use `--allow-unconfigured` for ad-hoc/dev runs.
- Binding beyond loopback without auth is blocked (safety guardrail).
- `SIGUSR1` triggers an in-process restart when authorized (enable `commands.restart` or use the gateway tool/config apply/update).
- `SIGINT`/`SIGTERM` handlers stop the gateway process, but they don’t restore any custom terminal state. If you wrap the CLI with a TUI or raw-mode input, restore the terminal before exit.

### Options

- `--port <port>`: WebSocket port (default comes from config/env; usually `18789`).
- `--bind <loopback|lan|tailnet|auto|custom>`: listener bind mode.
- `--auth <token|password>`: auth mode override.
- `--token <token>`: token override (also sets `ARGENTOS_GATEWAY_TOKEN` for the process).
- `--password <password>`: password override (also sets `ARGENTOS_GATEWAY_PASSWORD` for the process).
- `--tailscale <off|serve|funnel>`: expose the Gateway via Tailscale.
- `--tailscale-reset-on-exit`: reset Tailscale serve/funnel config on shutdown.
- `--allow-unconfigured`: allow gateway start without `gateway.mode=local` in config.
- `--dev`: create a dev config + workspace if missing (skips BOOTSTRAP.md).
- `--reset`: reset dev config + credentials + sessions + workspace (requires `--dev`).
- `--force`: kill any existing listener on the selected port before starting.
- `--verbose`: verbose logs.
- `--claude-cli-logs`: only show claude-cli logs in the console (and enable its stdout/stderr).
- `--ws-log <auto|full|compact>`: websocket log style (default `auto`).
- `--compact`: alias for `--ws-log compact`.
- `--raw-stream`: log raw model stream events to jsonl.
- `--raw-stream-path <path>`: raw stream jsonl path.

## Query a running Gateway

All query commands use WebSocket RPC.

Output modes:

- Default: human-readable (colored in TTY).
- `--json`: machine-readable JSON (no styling/spinner).
- `--no-color` (or `NO_COLOR=1`): disable ANSI while keeping human layout.

Shared options (where supported):

- `--url <url>`: Gateway WebSocket URL.
- `--token <token>`: Gateway token.
- `--password <password>`: Gateway password.
- `--timeout <ms>`: timeout/budget (varies per command).
- `--expect-final`: wait for a “final” response (agent calls).

Note: when you set `--url`, the CLI does not fall back to config or environment credentials.
Pass `--token` or `--password` explicitly. Missing explicit credentials is an error.

### `gateway health`

```bash
argent gateway health --url ws://127.0.0.1:18789
```

### `gateway status`

`gateway status` shows the Gateway service (launchd/systemd/schtasks) plus an optional RPC probe.

```bash
argent gateway status
argent gateway status --json
```

Options:

- `--url <url>`: override the probe URL.
- `--token <token>`: token auth for the probe.
- `--password <password>`: password auth for the probe.
- `--timeout <ms>`: probe timeout (default `10000`).
- `--no-probe`: skip the RPC probe (service-only view).
- `--deep`: scan system-level services too.

### `gateway authority`

`gateway authority` is the read-only operator surface for Rust Gateway shadow/promotion checks.
It does not switch authority. TypeScript remains live Gateway, scheduler, workflow, channel,
session, and run authority unless a separate release/promotion process explicitly changes that.

Status check:

```bash
argent gateway authority status --json
```

Local installed-canary smoke:

```bash
argent gateway authority smoke-local \
  --reason "local canary receipt proof" \
  --confirm-local-only \
  --installed-canary-url ws://127.0.0.1:<port> \
  --installed-canary-token <token> \
  --json
```

Use `--installed-canary-password <password>` instead of `--installed-canary-token <token>`
when the target daemon is configured for password auth. Do not put tokens, passwords, or
command output containing sensitive local paths in git, docs, Threadmaster bus messages, or
handoff artifacts.

The smoke is intentionally default-blocked. It only queries
`rustGateway.canaryReceipts.status`; it does not start, stop, restart, install, configure, or
send traffic through a daemon. A passing local smoke requires:

- `--confirm-local-only` was provided.
- The installed canary URL and explicit token/password were provided.
- `rustGateway.canaryReceipts.status` returned `status=ok`.
- `productionTrafficUsed=false`.
- `authoritySwitchAllowed=false`.
- `canaryFlagEnabled=true` for a disposable local canary harness.
- Receipt redaction is verified.
- Denial and duplicate-prevention receipts are present.

Common blocked states:

- `not-configured`: rerun with `--installed-canary-url` and explicit credentials.
- `blocked`: URL was configured but no explicit token/password was provided.
- `unavailable`: the daemon could not be reached or the status RPC timed out.
- `unsafe`: the daemon payload did not prove the safety invariants above.

Generate the local parity proof separately:

```bash
pnpm rust-gateway:parity:report -- --startup-timeout-ms 60000 --request-timeout-ms 10000
```

The parity report is evidence only. It does not authorize production traffic or a Rust authority
switch.

### `gateway probe`

`gateway probe` is the “debug everything” command. It always probes:

- your configured remote gateway (if set), and
- localhost (loopback) **even if remote is configured**.

If multiple gateways are reachable, it prints all of them. Multiple gateways are supported when you use isolated profiles/ports (e.g., a rescue bot), but most installs still run a single gateway.

```bash
argent gateway probe
argent gateway probe --json
```

#### Remote over SSH (Mac app parity)

The macOS app “Remote over SSH” mode uses a local port-forward so the remote gateway (which may be bound to loopback only) becomes reachable at `ws://127.0.0.1:<port>`.

CLI equivalent:

```bash
argent gateway probe --ssh user@gateway-host
```

Options:

- `--ssh <target>`: `user@host` or `user@host:port` (port defaults to `22`).
- `--ssh-identity <path>`: identity file.
- `--ssh-auto`: pick the first discovered gateway host as SSH target (LAN/WAB only).

Config (optional, used as defaults):

- `gateway.remote.sshTarget`
- `gateway.remote.sshIdentity`

### `gateway call <method>`

Low-level RPC helper.

```bash
argent gateway call status
argent gateway call logs.tail --params '{"sinceMs": 60000}'
```

## Manage the Gateway service

```bash
argent gateway install
argent gateway start
argent gateway stop
argent gateway restart
argent gateway uninstall
```

Notes:

- `gateway install` supports `--port`, `--runtime`, `--token`, `--force`, `--json`.
- Lifecycle commands accept `--json` for scripting.

## Discover gateways (Bonjour)

`gateway discover` scans for Gateway beacons (`_argent-gw._tcp`).

- Multicast DNS-SD: `local.`
- Unicast DNS-SD (Wide-Area Bonjour): choose a domain (example: `argent.internal.`) and set up split DNS + a DNS server; see [/gateway/bonjour](/gateway/bonjour)

Only gateways with Bonjour discovery enabled (default) advertise the beacon.

Wide-Area discovery records include (TXT):

- `role` (gateway role hint)
- `transport` (transport hint, e.g. `gateway`)
- `gatewayPort` (WebSocket port, usually `18789`)
- `sshPort` (SSH port; defaults to `22` if not present)
- `tailnetDns` (MagicDNS hostname, when available)
- `gatewayTls` / `gatewayTlsSha256` (TLS enabled + cert fingerprint)
- `cliPath` (optional hint for remote installs)

### `gateway discover`

```bash
argent gateway discover
```

Options:

- `--timeout <ms>`: per-command timeout (browse/resolve); default `2000`.
- `--json`: machine-readable output (also disables styling/spinner).

Examples:

```bash
argent gateway discover --timeout 4000
argent gateway discover --json | jq '.beacons[].wsUrl'
```
