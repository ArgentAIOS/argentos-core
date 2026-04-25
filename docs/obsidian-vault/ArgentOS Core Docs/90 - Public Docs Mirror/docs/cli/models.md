---
summary: "CLI reference for `argent models` (status/list/set/scan, aliases, fallbacks, auth)"
read_when:
  - You want to change default models or view provider auth status
  - You want to scan available models/providers and debug auth profiles
title: "models"
---

# `argent models`

Model discovery, scanning, and configuration (default model, fallbacks, auth profiles).

Related:

- Providers + models: [Models](/providers/models)
- Provider auth setup: [Getting started](/start/getting-started)

## Common commands

```bash
argent models status
argent models list
argent models set <model-or-alias>
argent models scan
```

`argent models status` shows the resolved default/fallbacks plus an auth overview.
When provider usage snapshots are available, the OAuth/token status section includes
provider usage headers.
Add `--probe` to run live auth probes against each configured provider profile.
Probes are real requests (may consume tokens and trigger rate limits).
Use `--agent <id>` to inspect a configured agent’s model/auth state. When omitted,
the command uses `ARGENTOS_AGENT_DIR`/`PI_CODING_AGENT_DIR` if set, otherwise the
configured default agent.

Notes:

- `models set <model-or-alias>` accepts `provider/model` or an alias.
- Model refs are parsed by splitting on the **first** `/`. If the model ID includes `/` (OpenRouter-style), include the provider prefix (example: `openrouter/moonshotai/kimi-k2`).
- If you omit the provider, ArgentOS treats the input as an alias or a model for the **default provider** (only works when there is no `/` in the model ID).

### `models status`

Options:

- `--json`
- `--plain`
- `--check` (exit 1=expired/missing, 2=expiring)
- `--probe` (live probe of configured auth profiles)
- `--probe-provider <name>` (probe one provider)
- `--probe-profile <id>` (repeat or comma-separated profile ids)
- `--probe-timeout <ms>`
- `--probe-concurrency <n>`
- `--probe-max-tokens <n>`
- `--agent <id>` (configured agent id; overrides `ARGENTOS_AGENT_DIR`/`PI_CODING_AGENT_DIR`)

## Aliases + fallbacks

```bash
argent models aliases list
argent models fallbacks list
```

## Auth profiles

```bash
argent models auth add
argent models auth login --provider <id>
argent models auth setup-token
argent models auth paste-token
```

`models auth login` runs a provider plugin’s auth flow (OAuth/API key). Use
`argent plugins list` to see which providers are installed.

Notes:

- `setup-token` prompts for a setup-token value (generate it with `claude setup-token` on any machine).
- `paste-token` accepts a token string generated elsewhere or from automation.
