---
summary: "How the hosted installer and repo-root source installer work, plus flags and automation"
read_when:
  - You want to understand `argentos.ai/install.sh`
  - You want to automate installs (CI / headless)
  - You want to install from a GitHub checkout
title: "Installer Internals"
---

# Installer internals

ArgentOS currently has two distinct shell install surfaces:

- `https://argentos.ai/install.sh` — hosted installer. Source of truth in this repo: `scripts/install-hosted.sh`
- repo-root `install.sh` — macOS source/tarball installer for a built checkout or packaged runtime

To see the current flags/behavior, run:

```bash
curl -fsSL https://argentos.ai/install.sh | bash -s -- --help
```

Windows (PowerShell) help:

```powershell
& ([scriptblock]::Create((iwr -useb https://argentos.ai/install.ps1))) -?
```

If the installer completes but `argent` is not found in a new terminal, it’s usually a Node/npm PATH issue. See: [Install](/install#nodejs--npm-path-sanity).

## Hosted install.sh (recommended)

What it does (high level):

- Detect OS (macOS / Linux).
- Prefer the `git` rail by default; `npm` remains opt-in.
- Use a compatible system Node when available, otherwise install a private Node 22 runtime.
- Derive `npm` / `corepack pnpm` from the selected runtime instead of trusting whatever `node` is on `PATH`.
- For git installs: clone/update the checkout, run `pnpm install`, `pnpm build`, and `pnpm rebuild better-sqlite3`, then write the `argent` wrapper against the selected runtime.
- Install the generated public Core docs Obsidian vault at `~/.argentos/vaults/ArgentOS Core Docs` so the local operator agent has a clean docs source for setup and troubleshooting questions.

If you _want_ `sharp` to link against a globally-installed libvips (or you’re debugging), set:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=0 curl -fsSL https://argentos.ai/install.sh | bash
```

### Why Git is needed

Git is required for the default hosted rail because it clones/pulls the source checkout.

For `npm` installs, Git is _usually_ not required, but some environments still end up needing it (e.g. when a package or dependency is fetched via a git URL). The installer currently ensures Git is present to avoid `spawn git ENOENT` surprises on fresh distros.

## Repo-root install.sh (macOS source/tarball installer)

The repo-root `install.sh` is a different script with a different purpose:

- macOS only
- expects a built checkout or packaged runtime already present
- installs the local runtime, dashboard services, wrappers, optional `Argent.app`, and the generated public Core docs Obsidian vault

## Core docs vault

The shipped Core docs vault is generated from public docs with:

```bash
pnpm docs:vault
```

The generator copies public Markdown and MDX docs into `docs/obsidian-vault/ArgentOS Core Docs`, builds Obsidian-friendly indexes, and excludes private/debug/agent-only material such as `CLAUDE.md`, `docs/debug`, archives, research dumps, and the generated vault itself.

Set `ARGENT_SKIP_CORE_DOCS_VAULT=1` to skip installing the vault during installer automation.
