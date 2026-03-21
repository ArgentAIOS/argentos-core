---
summary: "CLI reference for `argent plugins` (list, install, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
title: "plugins"
---

# `argent plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:

- Plugin system: [Plugins](/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
argent plugins list
argent plugins info <id>
argent plugins enable <id>
argent plugins disable <id>
argent plugins doctor
argent plugins update <id>
argent plugins update --all
```

Bundled plugins ship with ArgentOS but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `argent.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
argent plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
argent plugins install -l ./my-plugin
```

### Update

```bash
argent plugins update <id>
argent plugins update --all
argent plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
