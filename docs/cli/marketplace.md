---
summary: "CLI reference for `argent marketplace` (browse and install packages from the ArgentOS Marketplace)"
read_when:
  - You want to discover skills, plugins, or agents from the marketplace
  - You're installing a marketplace package onto this host
  - You want to inspect package metadata before installing
title: "marketplace"
---

# `argent marketplace`

Browse and install packages from the ArgentOS Marketplace.

The marketplace catalogs community + first-party packages — skills, model-provider
plugins, agent presets, and channel plugins. `argent marketplace` is the CLI side of
the same catalog the Control UI shows under **Marketplace**.

Related:

- Manage installed plugins (post-install state): [`argent plugins`](/cli/plugins)
- Skills inventory + readiness: [`argent skills`](/cli/skills)
- Package an extension for the marketplace: `argent extension` (see top-level help)

## Subcommand map

```
argent marketplace
├── search [query]        Browse or search marketplace packages
├── details <packageId>   Show package details (metadata, requirements, version)
└── install <packageId>   Download and install a marketplace package
```

## Examples

```bash
# Browse the full catalog
argent marketplace search

# Search by keyword
argent marketplace search browser

# Filter by category, capped at 10 results
argent marketplace search --category skills --limit 10

# Inspect a package before installing
argent marketplace details claude-mem

# Install a package by id
argent marketplace install claude-mem
```

## `argent marketplace search`

Browse or search packages.

Arguments:

- `[query]` — Optional search query (matches name, description, tags).

Options:

- `-c, --category <category>` — Filter by category (e.g. `skills`, `plugins`, `agents`,
  `channels`).
- `-l, --limit <limit>` — Max results to return.

With no arguments and no filters, prints the catalog (paged by `--limit`).

## `argent marketplace details <packageId>`

Show full details for a single package.

Arguments:

- `<packageId>` — Package id, as shown by `argent marketplace search`.

Output includes:

- Description, category, author, license.
- Version + last updated.
- Declared requirements (binaries, env vars, plugins, host OS).
- Install size and any post-install steps.

## `argent marketplace install <packageId>`

Download and install a marketplace package.

Arguments:

- `<packageId>` — Package id to install.

Installation writes the package to `~/.argentos/marketplace/<packageId>/` and registers
it with the appropriate subsystem (skills loader, plugin registry, etc.). After install:

- For **skills**, verify with `argent skills list` / `argent skills info <name>`.
- For **plugins**, verify with `argent plugins list` and enable as needed.
- For **agents**, see `argent agents list`.

## Troubleshooting

- **Package not found** — id mismatch. Use `argent marketplace search` to confirm the
  exact id (case-sensitive).
- **Install fails on requirements** — `argent marketplace details <id>` lists what the
  package needs; install missing binaries or set env vars and retry.
- **Installed but not visible** — for skills, the loader may need a reload. Re-run
  `argent skills list`; for plugins, check `argent plugins list` and enable.
