---
summary: "CLI reference for `argent models` (model discovery, scanning, and provider auth)"
read_when:
  - Wiring a model provider via OAuth, device flow, or paste-token
  - Inspecting configured models, fallbacks, aliases, or auth state
  - Debugging which auth profile the router will pick for a provider
title: "models"
---

# `argent models`

Model discovery, scanning, and provider auth profiles.

For the conceptual walkthrough (browser-based OAuth, device flow, where tokens land), see the user-facing
[OAuth Setup walkthrough](https://docs.argentos.ai/docs/models/oauth-setup) and
[Auth Profiles](https://docs.argentos.ai/docs/models/auth-profiles).

Related:

- Doctor checks for auth: [`argent doctor`](/cli/doctor)
- Plugin enable/install: [`argent plugins`](/cli/plugins)

## Examples

```bash
argent models                             # status of configured models (default subcommand)
argent models list                        # configured models
argent models list --all                  # full catalog
argent models status --probe              # live-probe configured providers
argent models set claude-sonnet-4-20250514

argent models auth login --provider openai-codex --set-default
argent models auth login-github-copilot
argent models auth setup-token --provider anthropic
argent models auth paste-token --provider qwen-portal --profile-id qwen-portal:shared --expires-in 30d

argent models auth order get --provider anthropic
argent models auth order set --provider anthropic anthropic:webdevtoday anthropic:titanium
argent models auth order clear --provider anthropic
```

## Subcommand map

```
argent models
├── list                           # list models (configured by default)
├── status                         # show configured model state (also: argent models)
├── scan                           # rebuild provider catalog
├── set <model>                    # set the default model
├── set-image <model>              # set the image model
├── aliases
│   ├── list
│   ├── add <alias> <model>
│   └── remove <alias>
├── fallbacks
│   ├── list
│   ├── add <model>
│   ├── remove <model>
│   └── clear
├── image-fallbacks
│   ├── list
│   ├── add <model>
│   ├── remove <model>
│   └── clear
└── auth                           # provider auth profiles
    ├── add                        # interactive helper (setup-token or paste)
    ├── login                      # provider plugin auth flow (OAuth/API key)
    ├── login-github-copilot       # GitHub device login → github-copilot:github
    ├── setup-token                # paste claude setup-token (Anthropic)
    ├── paste-token                # paste an arbitrary token for any provider
    └── order
        ├── get                    # show per-agent auth-rotation order
        ├── set                    # pin per-agent auth-rotation order
        └── clear                  # clear per-agent override
```

## Discovery & status

### `argent models list`

```bash
argent models list                       # configured models
argent models list --all                 # full catalog (every provider/model)
argent models list --local               # only local providers (Ollama, LM Studio)
argent models list --provider anthropic
argent models list --json
```

### `argent models status`

```bash
argent models status                     # human-readable summary
argent models status --json
argent models status --check             # exit 1 if expired/missing, 2 if expiring soon
argent models status --probe             # live API probe per configured provider
argent models status --probe --probe-provider openai-codex
argent models status --probe --probe-profile anthropic:webdevtoday
```

`--check` is the script-friendly mode for monitoring/cron — non-zero exit codes signal expiring or missing auth.

Probes are real requests against the configured profile (may consume tokens and trigger rate limits).

Options:

- `--json`, `--plain`
- `--check` — exit `1` (expired/missing) or `2` (expiring)
- `--probe` — live probe configured profiles
- `--probe-provider <name>` — restrict probe to one provider
- `--probe-profile <id>` — restrict probe to specific profile ids (repeat or comma-separated)
- `--probe-timeout <ms>`, `--probe-concurrency <n>`, `--probe-max-tokens <n>`
- `--agent <id>` — agent id to inspect (overrides `ARGENT_AGENT_DIR`/`PI_CODING_AGENT_DIR`)

### `argent models scan`

Rebuild the provider catalog from registry seed (`~/.argentos/provider-registry.json`) and configured plugins. Run this after editing the registry file by hand or installing a new provider plugin.

### `argent models set` / `set-image`

```bash
argent models set claude-sonnet-4-20250514
argent models set codex                  # alias resolves
argent models set-image dall-e-3
```

Both accept either a model id (`provider/model`) or a registered alias.

Notes:

- Model refs are parsed by splitting on the **first** `/`. If the model id itself contains `/` (OpenRouter-style), include the provider prefix — e.g. `openrouter/moonshotai/kimi-k2`.
- If you omit the provider, ArgentOS treats the input as an alias or a model for the **default provider** (only works when there is no `/` in the model id).

## Aliases & fallbacks

### `argent models aliases`

```bash
argent models aliases list
argent models aliases add codex openai-codex/gpt-5-codex
argent models aliases remove codex
```

### `argent models fallbacks`

```bash
argent models fallbacks list
argent models fallbacks add claude-haiku-4-20250514
argent models fallbacks remove claude-haiku-4-20250514
argent models fallbacks clear
```

`image-fallbacks` mirrors `fallbacks` for the image-generation pipeline (`set-image`).

## Auth (`argent models auth …`)

`argent models auth` covers OAuth, device flow, and paste-token wiring for any provider — built-in or plugin-registered. Tokens land in `~/.argentos/agents/<agent>/agent/auth-profiles.json`; the active profile is referenced from `~/.argentos/argent.json` under `auth.profiles`.

For the worked walkthrough (what the browser opens, what shows up in the dashboard, troubleshooting expired refresh tokens, paste-token fallback):
**[docs.argentos.ai/docs/models/oauth-setup](https://docs.argentos.ai/docs/models/oauth-setup)**.

### `argent models auth login`

Run a provider's auth flow. Built-in handler exists for `openai-codex`; everything else dispatches to the provider plugin's `auth.run()`.

```bash
argent models auth login --provider openai-codex
argent models auth login --provider openai-codex --set-default
argent models auth login --provider qwen-portal
argent models auth login --provider google-antigravity
argent models auth login --provider google-gemini-cli
argent models auth login --provider minimax-portal
argent models auth login --provider copilot-proxy
argent models auth login --provider <plugin-id> --method <method-id>
```

Options:

- `--provider <id>` — provider id (built-in or registered by an enabled plugin)
- `--method <id>` — pick a specific auth method when the plugin offers more than one (default: prompt)
- `--set-default` — apply the provider's recommended model. The `openai-codex` built-in uses its hard-coded default; plugin-backed providers honor the recommendation declared on the plugin manifest (`ProviderPlugin.recommendedModel`). When a tier is declared (`fast | balanced | powerful`), the model is written into the active model-router profile for that tier (or top-level `modelRouter.tiers.<tier>` when no active profile is set). Plugins without a `recommendedModel` log a clear "ignored" warning rather than silently no-opping.

Notes:

- Requires an interactive TTY (browser/device flow needs a console). Headless? Use `paste-token`.
- Plugin-backed providers must be enabled. ArgentOS auto-enables a plugin once auth or model config references it (see `~/.argentos/argent.json` `plugins.entries`). Otherwise: `argent plugins install <id>` and retry.

### `argent models auth login-github-copilot`

Dedicated GitHub device flow for the bundled GitHub Copilot provider.

```bash
argent models auth login-github-copilot
argent models auth login-github-copilot --profile-id github-copilot:work
argent models auth login-github-copilot --yes        # overwrite existing profile silently
```

Lands as `github-copilot:github` (default) or `<profile-id>` if specified.

### `argent models auth setup-token`

Paste an Anthropic `claude setup-token` value. Anthropic-only — the only provider that uses claude-cli's setup-token format.

```bash
argent models auth setup-token --provider anthropic
argent models auth setup-token --provider anthropic --yes   # skip the "do you have a token?" confirmation
```

Stored as `anthropic:manual` (token credential) — distinct from API-key (`anthropic:default`) and Max-sub setup-tokens written by the onboarding wizard.

### `argent models auth paste-token`

Generic paste-token flow for any provider — useful for CI, shared-team tokens, or recovering from a backup.

```bash
argent models auth paste-token --provider qwen-portal
argent models auth paste-token --provider openai-codex --profile-id openai-codex:user@example.com
argent models auth paste-token --provider anthropic --expires-in 30d
argent models auth paste-token --provider anthropic --expires-in 12h
```

Options:

- `--provider <id>` (required) — provider id
- `--profile-id <id>` — auth profile id (default `<provider>:manual`)
- `--expires-in <duration>` — optional expiry, parsed as `30d`, `12h`, `45m`. Stored as absolute `expiresAt` so the router cools the profile down automatically when it lapses.

### `argent models auth add`

Interactive helper that walks setup-token (Anthropic only) or paste-token (any provider). Useful when you don't remember which subcommand applies.

```bash
argent models auth add
```

### `argent models auth order`

Per-agent rotation order overrides. The router rotates within a provider's available auth profiles by default; pin an explicit order to control which profile is tried first / second / third.

```bash
argent models auth order get   --provider anthropic
argent models auth order get   --provider anthropic --json
argent models auth order set   --provider anthropic anthropic:webdevtoday anthropic:titanium
argent models auth order clear --provider anthropic

# Targeting a specific agent (default: configured default agent)
argent models auth order set --agent work --provider anthropic anthropic:work-default
```

The override is persisted in `auth-profiles.json` (`order.<provider>`) for the target agent — not in `argent.json`. Clearing the override falls back to the configured / round-robin order.

## File locations

| File                                                  | Contents                                    |
| ----------------------------------------------------- | ------------------------------------------- |
| `~/.argentos/agents/<agent>/agent/auth-profiles.json` | OAuth/token/api-key credentials per profile |
| `~/.argentos/argent.json` → `auth.profiles`           | Which profile is active per provider        |
| `~/.argentos/argent.json` → `agents.defaults.model`   | Default model + fallbacks                   |
| `~/.argentos/provider-registry.json`                  | Provider catalog (seeded; user-editable)    |

`<agent>` defaults to `main`. Override per command via `ARGENT_AGENT_DIR=~/.argentos/agents/<id>/agent` or pass `--agent <id>` to subcommands that accept it (`status`, `auth order …`).

## Troubleshooting

- **"models auth login requires an interactive TTY"** — running inside a pipe / CI / detached shell. Use `argent models auth paste-token` instead.
- **"Unknown provider"** — provider id isn't registered. Either install the plugin (`argent plugins install <id>`) or check the spelling against `argent plugins list`.
- **Codex auth missing a refresh token** — re-run `argent models auth login --provider openai-codex`. The OAuth response sometimes drops the refresh token if two clients approve in parallel.
- **Profile shows but provider isn't picked up** — `auth-profiles.json` has the credential, but `argent.json` `auth.profiles` doesn't reference it. Re-run `argent models auth login` (or `paste-token`) with the same `--profile-id` to re-wire the config.
- **Expired/expiring auth** — `argent doctor` calls `models status --check` and prints guided fixes. `argent models status --probe --probe-provider <id>` makes a live call to confirm.
