---
summary: "Install ArgentOS (recommended installer, global install, or from source)"
read_when:
  - Installing ArgentOS
  - You want to install from GitHub
title: "Install"
---

# Install

Use the installer unless you have a reason not to. It sets up the CLI and runs onboarding.

Treat source checkout installs as a contributor / validation path, not the primary end-user path.

## Quick install (recommended for end users)

```bash
curl -fsSL https://argentos.ai/install.sh | bash
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

- **Node >=22.12.0** for source builds
- macOS, Linux, or Windows via WSL2
- `pnpm` only if you build from source

## Choose your install path

### 1) Installer script (recommended for end users)

Installs `argent` globally via npm and runs onboarding.

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

### 1a) Prefix-scoped CLI installer

Use this when you want an isolated CLI install under a dedicated prefix, including app-driven installs:

```bash
curl -fsSL https://argentos.ai/install-cli.sh | bash
```

Useful flags:

```bash
curl -fsSL https://argentos.ai/install-cli.sh | bash -s -- --help
```

### 2) Global install (manual)

If you already have Node:

```bash
npm install -g argentos@latest
```

If you have libvips installed globally (common on macOS via Homebrew) and `sharp` fails to install, force prebuilt binaries:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install -g argentos@latest
```

If you see `sharp: Please add node-gyp to your dependencies`, either install build tooling (macOS: Xcode CLT + `npm install -g node-gyp`) or use the `SHARP_IGNORE_GLOBAL_LIBVIPS=1` workaround above to skip the native build.

Or with pnpm:

```bash
pnpm add -g argentos@latest
pnpm approve-builds -g                # approve argent, node-llama-cpp, sharp, etc.
```

pnpm requires explicit approval for packages with build scripts. After the first install shows the "Ignored build scripts" warning, run `pnpm approve-builds -g` and select the listed packages.

Then:

```bash
argent onboard --install-daemon
```

### 3) From source (contributors/dev)

This path is for contributors and clean-machine validation. End users should prefer the hosted installer or the macOS app distribution.

```bash
git clone https://github.com/ArgentAIOS/argentos-core.git
cd argentos-core
pnpm install
pnpm build
bash install.sh
argent onboard --install-daemon
```

`install.sh` will bootstrap a private supported Node runtime for the installed CLI/services when the active system Node is missing or outside the supported runtime range.

On macOS source checkouts, `install.sh` now also installs `Argent.app` when a bundle
is already present in the repo output or when the local Swift app sources can be built
successfully. That keeps the Mac source-install path aligned with the flagship app-first
experience instead of leaving the native app out by default.

Tip: if you don’t have a global install yet, run repo commands via `pnpm argent ...`.

### 4) Other install options

- Docker: [Docker](/install/docker)
- Nix: [Nix](/install/nix)
- Ansible: [Ansible](/install/ansible)
- Bun (CLI only): [Bun](/install/bun)

## After install

- Run onboarding: `argent onboard --install-daemon`
- Quick check: `argent doctor`
- Check gateway health: `argent status` + `argent health`
- Open the dashboard: `argent dashboard`

## Install method: npm vs git (installer)

The installer supports two methods:

- `npm` (default): `npm install -g argentos@latest`
- `git`: clone/build from GitHub and run from a source checkout

### CLI flags

```bash
# Explicit npm
curl -fsSL https://argentos.ai/install.sh | bash -s -- --install-method npm

# Install from GitHub (source checkout)
curl -fsSL https://argentos.ai/install.sh | bash -s -- --install-method git
```

Common flags:

- `--install-method npm|git`
- `--git-dir <path>` (default: `~/argentos`)
- `--no-git-update` (skip `git pull` when using an existing checkout)
- `--no-prompt` (disable prompts; required in CI/automation)
- `--dry-run` (print what would happen; make no changes)
- `--no-onboard` (skip onboarding)

### Environment variables

Equivalent env vars (useful for automation):

- `ARGENTOS_INSTALL_METHOD=git|npm`
- `ARGENTOS_GIT_DIR=...`
- `ARGENTOS_GIT_UPDATE=0|1`
- `ARGENTOS_NO_PROMPT=1`
- `ARGENTOS_DRY_RUN=1`
- `ARGENTOS_NO_ONBOARD=1`
- `SHARP_IGNORE_GLOBAL_LIBVIPS=0|1` (default: `1`; avoids `sharp` building against system libvips)

## Troubleshooting: `argent` not found (PATH)

Quick diagnosis:

```bash
node -v
npm -v
npm prefix -g
echo "$PATH"
```

If `$(npm prefix -g)/bin` (macOS/Linux) or `$(npm prefix -g)` (Windows) is **not** present inside `echo "$PATH"`, your shell can’t find global npm binaries (including `argent`).

Fix: add it to your shell startup file (zsh: `~/.zshrc`, bash: `~/.bashrc`):

```bash
# macOS / Linux
export PATH="$(npm prefix -g)/bin:$PATH"
```

On Windows, add the output of `npm prefix -g` to your PATH.

Then open a new terminal (or `rehash` in zsh / `hash -r` in bash).

## Update / uninstall

- Updates: [Updating](/install/updating)
- Clean-machine validation: [Second Mac Validation](/install/second-mac-validation)
- Partner RC handoff: [Partner RC Runbook](/install/partner-release-rc)
- Migrate to a new machine: [Migrating](/install/migrating)
- Uninstall: [Uninstall](/install/uninstall)
