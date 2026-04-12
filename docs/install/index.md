---
summary: "Install ArgentOS from the hosted git rail or from source"
read_when:
  - Installing ArgentOS
  - You want to install from GitHub
title: "Install"
---

# Install

Use the installer unless you have a reason not to. It sets up the CLI and runs onboarding.

## Quick install (recommended)

```bash
curl -fsSL https://argentos.ai/install.sh | bash
```

Ubuntu uses the same installer entrypoint. There is no separate `install-linux.sh` rail for the MVP.
For headless Linux servers, set a gateway password up front:

```bash
ARGENT_GATEWAY_PASSWORD='<strong-password>' curl -fsSL https://argentos.ai/install.sh | bash
```

Windows (PowerShell):

```powershell
iwr -useb https://argentos.ai/install.ps1 | iex
```

Next step (if you skipped onboarding):

```bash
argent onboard --install-daemon
```

## System requirements

- **Node >=22**
- macOS, Linux, or Windows via WSL2
- `pnpm` only if you build from source
- Ubuntu is the supported Linux MVP for the hosted installer path

## Choose your install path

### 1) Installer script (recommended)

Clones/builds ArgentOS from GitHub by default, installs the `argent` wrapper,
and runs onboarding. If the current Node runtime is unsupported, the installer
provisions a private Node 22 runtime and uses that runtime for the wrapper and
native module rebuilds.

```bash
curl -fsSL https://argentos.ai/install.sh | bash
```

Installer flags:

```bash
curl -fsSL https://argentos.ai/install.sh | bash -s -- --help
```

Details: [Installer internals](/install/installer).

Non-interactive (skip onboarding):

```bash
curl -fsSL https://argentos.ai/install.sh | bash -s -- --no-onboard
```

### 2) From source (contributors/dev)

```bash
git clone https://github.com/ArgentAIOS/argentos.git
cd argentos
pnpm install
pnpm ui:build # auto-installs UI deps on first run
pnpm build
argent onboard --install-daemon
```

Tip: if you don’t have `argent` on PATH yet, run repo commands via `pnpm argent ...`.

### 3) Other install options

- Docker: [Docker](/install/docker)
- Nix: [Nix](/install/nix)
- Ansible: [Ansible](/install/ansible)
- Bun (CLI only): [Bun](/install/bun)

## After install

- Run onboarding: `argent onboard --install-daemon`
- Quick check: `argent doctor`
- Check gateway health: `argent status` + `argent health`
- Open the dashboard: `argent dashboard`
- On Ubuntu MVP installs, the supported browser UI is the gateway/dashboard URL printed by the installer and protected by gateway auth

## Install method: hosted git rail

Hosted install channel semantics:

- `stable` (default): install from the latest GitHub release tag
- `beta`: install from the latest beta/stable GitHub release tag
- `dev`: track `main`

### CLI flags

```bash
# Default hosted rail
curl -fsSL https://argentos.ai/install.sh | bash -s -- --install-method git
```

Common flags:

- `--install-method git`
- `--channel stable|beta|dev` (`stable` is the default public rail)
- `--git-dir <path>` (default: `~/argentos`)
- `--no-git-update` (skip `git pull` when using an existing checkout)
- `--no-prompt` (disable prompts; required in CI/automation)
- `--dry-run` (print what would happen; make no changes)
- `--no-onboard` (skip onboarding)

### Environment variables

Equivalent env vars (useful for automation):

- `ARGENTOS_INSTALL_METHOD=git`
- `ARGENTOS_INSTALL_CHANNEL=stable|beta|dev`
- `ARGENTOS_GIT_DIR=...`
- `ARGENTOS_GIT_UPDATE=0|1`
- `ARGENTOS_NO_PROMPT=1`
- `ARGENTOS_DRY_RUN=1`
- `ARGENTOS_NO_ONBOARD=1`
- `ARGENT_GATEWAY_BIND=lan|loopback|auto|custom|tailnet`
- `ARGENT_GATEWAY_AUTH=password|token`
- `ARGENT_GATEWAY_PASSWORD=...`
- `ARGENT_GATEWAY_TOKEN=...`
- `ARGENT_GATEWAY_PUBLIC_HOST=server.example.com`
- `SHARP_IGNORE_GLOBAL_LIBVIPS=0|1` (default: `1`; avoids `sharp` building against system libvips)

## Troubleshooting: `argent` not found (PATH)

Quick diagnosis:

```bash
node -v
printf '%s\n' "$HOME/bin"
echo "$PATH"
```

If `$HOME/bin` is **not** present inside `echo "$PATH"`, your shell can’t find the hosted installer’s `argent` wrapper.

Fix: add it to your shell startup file (zsh: `~/.zshrc`, bash: `~/.bashrc`):

```bash
# macOS / Linux
export PATH="$(npm prefix -g)/bin:$PATH"
```

On Windows, add the output of `npm prefix -g` to your PATH.

Then open a new terminal (or `rehash` in zsh / `hash -r` in bash).

## Update / uninstall

- Updates: [Updating](/install/updating)
- Partner RC handoff: [Partner RC Runbook](/install/partner-release-rc)
- Migrate to a new machine: [Migrating](/install/migrating)
- Uninstall: [Uninstall](/install/uninstall)
