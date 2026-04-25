---
summary: "CLI reference for `argent config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `argent config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `argent configure`).

## Examples

```bash
argent config get browser.executablePath
argent config set browser.executablePath "/usr/bin/google-chrome"
argent config set agents.defaults.heartbeat.every "2h"
argent config set agents.list[0].tools.exec.node "node-id-or-name"
argent config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
argent config get agents.defaults.workspace
argent config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
argent config get agents.list
argent config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
argent config set agents.defaults.heartbeat.every "0m"
argent config set gateway.port 19001 --json
argent config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
