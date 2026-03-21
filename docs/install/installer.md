---
summary: "How the installer scripts work (install.sh + install-cli.sh), flags, and automation"
read_when:
  - You want to understand `argentos.ai/install.sh`
  - You want to automate installs (CI / headless)
  - You want to install from a GitHub checkout
title: "Installer Internals"
---

# Installer internals

Current source-controlled installer surface in this repo:

- repo-root `install.sh` — macOS installer for a built checkout/tarball runtime
- `scripts/install-hosted.sh` — hosted shell installer source for `argentos.ai/install.sh`
- repo-root `install-cli.sh` — prefix-scoped CLI installer for hosted/app-driven installs
- repo-root `install.ps1` — Windows PowerShell npm installer
- `pnpm test:install:local:smoke` — isolated macOS smoke for the repo-local runtime installer
- `pnpm test:install:hosted:local:smoke` — isolated local smoke for the hosted shell installer source
- `pnpm test:install:cli:local:smoke` — isolated local smoke for `install-cli.sh`

Hosted distribution URLs should now map to these source-controlled files:

- `https://argentos.ai/install.sh` → `scripts/install-hosted.sh`
- `https://argentos.ai/install-cli.sh`
- `https://argentos.ai/install.ps1`

To see the current flags/behavior, run:

```bash
curl -fsSL https://argentos.ai/install.sh | bash -s -- --help
```

Windows (PowerShell) help:

```powershell
& ([scriptblock]::Create((iwr -useb https://argentos.ai/install.ps1))) -?
```

If the installer completes but `argent` is not found in a new terminal, it’s usually a Node/npm PATH issue. See: [Install](/install#nodejs--npm-path-sanity).

## install.sh (recommended)

What it does (high level):

- Detect OS (macOS / Linux / WSL).
- Ensure Node.js **22+** (macOS via Homebrew; Linux via NodeSource).
- Choose install method:
  - `npm` (default): `npm install -g argentos@latest`
  - `git`: clone/build a source checkout and install a wrapper script
- On Linux: avoid global npm permission errors by switching npm's prefix to `~/.npm-global` when needed.
- If upgrading an existing install: runs `argent doctor --non-interactive` (best effort).
- For git installs: runs `argent doctor --non-interactive` after install/update (best effort).
- Mitigates `sharp` native install gotchas by defaulting `SHARP_IGNORE_GLOBAL_LIBVIPS=1` (avoids building against system libvips).

If you _want_ `sharp` to link against a globally-installed libvips (or you’re debugging), set:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=0 curl -fsSL https://argentos.ai/install.sh | bash
```

### Discoverability / “git install” prompt

If you run the installer while **already inside a ArgentOS source checkout** (detected via `package.json` + `pnpm-workspace.yaml`), it prompts:

- update and use this checkout (`git`)
- or migrate to the global npm install (`npm`)

In non-interactive contexts (no TTY / `--no-prompt`), you must pass `--install-method git|npm` (or set `ARGENTOS_INSTALL_METHOD`), otherwise the script exits with code `2`.

### Why Git is needed

Git is required for the `--install-method git` path (clone / pull).

For `npm` installs, Git is _usually_ not required, but some environments still end up needing it (e.g. when a package or dependency is fetched via a git URL). The installer currently ensures Git is present to avoid `spawn git ENOENT` surprises on fresh distros.

### Why npm hits `EACCES` on fresh Linux

On some Linux setups (especially after installing Node via the system package manager or NodeSource), npm's global prefix points at a root-owned location. Then `npm install -g ...` fails with `EACCES` / `mkdir` permission errors.

`install.sh` mitigates this by switching the prefix to:

- `~/.npm-global` (and adding it to `PATH` in `~/.bashrc` / `~/.zshrc` when present)

## install-cli.sh (non-root CLI installer)

This script installs `argent` into a prefix (default: `~/.argent`) and is the intended hosted/app-facing CLI install rail.

Behavior:

- Uses `ARGENT_NODE_BIN` if provided.
- Otherwise reuses a system Node 22+ if one is already available.
- Otherwise downloads a dedicated Node runtime into the chosen prefix.
- Installs `argentos` under `<prefix>/runtime` and writes stable wrappers to `<prefix>/bin/argent` and `<prefix>/bin/argentos`.

Useful flags:

- `--prefix <path>`
- `--version <version>`
- `--json`
- `--no-onboard`
- `--set-npm-prefix`

Help:

```bash
curl -fsSL https://argentos.ai/install-cli.sh | bash -s -- --help
```

## install.ps1 (Windows PowerShell)

What it does today:

- Requires an existing Node.js **22+** installation.
- Installs `argentos` globally with npm.
- Optionally runs onboarding after install.

Examples:

```powershell
iwr -useb https://argentos.ai/install.ps1 | iex
```

```powershell
iwr -useb https://argentos.ai/install.ps1 | iex -Version "2026.3.2"
```

```powershell
iwr -useb https://argentos.ai/install.ps1 | iex -NoOnboard
```

Common Windows issues:

- **"argent" is not recognized**: your npm global bin folder is not on PATH. Most systems use
  `%AppData%\\npm`. You can also run `npm config get prefix` and add `\\bin` to PATH, then reopen PowerShell.
