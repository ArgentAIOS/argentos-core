---
summary: "Linux support + companion app status"
read_when:
  - Looking for Linux companion app status
  - Planning platform coverage or contributions
title: "Linux App"
---

# Linux App

The Gateway is supported on Linux. **Node is the recommended runtime**.
Bun is not recommended for the Gateway (WhatsApp/Telegram bugs).

The current hosted-install target is an **Ubuntu MVP** for **headless server deployments**:

- hosted installer: `curl -fsSL https://argentos.ai/install.sh | bash`
- PostgreSQL 17 + pgvector on port `5433`
- Redis on port `6380`
- Gateway managed as a `systemd` user service when available
- browser access through the gateway on `http://<server-ip>:18789/`
- Linux defaults to `gateway.bind=lan` and app-level auth for remote access
- MVP auth mode is password unless you explicitly override it to token auth

Native Linux companion apps are still planned. Contributions are welcome if you want to help build one.

## Beginner quick path (VPS / Ubuntu)

1. Install with a remote-access password:
   `ARGENT_GATEWAY_PASSWORD='<strong-password>' curl -fsSL https://argentos.ai/install.sh | bash`
2. Verify the gateway is healthy:
   `argent health`
3. Open `http://<server-ip>:18789/` from your laptop/browser
4. Authenticate with the configured gateway password

Step-by-step VPS guide: [exe.dev](/platforms/exe-dev)

## Install

- [Getting Started](/start/getting-started)
- [Install & updates](/install/updating)
- Optional flows: [Bun (experimental)](/install/bun), [Nix](/install/nix), [Docker](/install/docker)

## Gateway

- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway service install (CLI)

Use one of these:

```
argent onboard --install-daemon
```

Or:

```
argent gateway install
```

Or:

```
argent configure
```

Select **Gateway service** when prompted.

Repair/migrate:

```
argent doctor
```

## System control (systemd user unit)

ArgentOS installs a systemd **user** service by default. Use a **system**
service for shared or always-on servers. The full unit example and guidance
live in the [Gateway runbook](/gateway).

Minimal setup:

Create `~/.config/systemd/user/argent-gateway[-<profile>].service`:

```
[Unit]
Description=ArgentOS Gateway (profile: <profile>, v<version>)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/argent gateway --port 18789
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enable it:

```
systemctl --user enable --now argent-gateway[-<profile>].service
```

## Current Ubuntu MVP scope

Supported now:

- hosted installer provisions the CLI/runtime on Ubuntu
- PostgreSQL 17 + pgvector and Redis bootstrap through installer helper scripts
- installer configures the gateway for remote-capable Linux server mode
- `argent setup` and non-interactive `argent onboard --install-daemon` are driven by the installer
- browser UI is accessed through the gateway on the server bind address with app-level auth

Not included in the MVP:

- native Linux menu bar / desktop companion app
- macOS-specific app handoff and launchd flows
- guaranteed auto-supervision of the React dashboard on port `8080`
- reverse proxy / TLS / Cloudflare Tunnel / Tailscale hardening is follow-up work after MVP

## Linux server-mode knobs

The hosted installer understands these Linux-focused environment variables:

```bash
ARGENT_GATEWAY_PASSWORD='strong-password' \
ARGENT_GATEWAY_BIND=lan \
curl -fsSL https://argentos.ai/install.sh | bash
```

Optional overrides:

- `ARGENT_GATEWAY_AUTH=password|token`
- `ARGENT_GATEWAY_PASSWORD=...`
- `ARGENT_GATEWAY_TOKEN=...`
- `ARGENT_GATEWAY_BIND=lan|loopback|auto|custom|tailnet`
- `ARGENT_GATEWAY_PUBLIC_HOST=<server-ip-or-dns-name>` for installer output hints
