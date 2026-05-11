---
summary: "CLI reference for `argent skills` (list/info/check) and skill eligibility"
read_when:
  - You want to see which skills are available and ready to run
  - You want to debug missing binaries/env/config for a specific skill
  - You're integrating skills discovery into automation (use `--json`)
title: "skills"
---

# `argent skills`

Inspect skills (bundled + workspace + managed overrides) and see what's eligible vs
missing requirements. Skills are Argent's pluggable verb layer — each skill declares
its dependencies (binaries, env vars, config keys), and `argent skills` reports which
of those are satisfied on the current host.

Related:

- Skills system overview: [Skills](/tools/skills)
- Skills config (overrides, env, install hints): [Skills config](/tools/skills-config)
- Install bundled skills: [ClawHub](/tools/clawhub)
- Health checks (skills section): [`argent doctor`](/cli/doctor)

## Subcommand map

```
argent skills
├── list         List all available skills (optionally filter to eligible)
├── info <name>  Show detailed information about one skill
└── check        Check which skills are ready vs missing requirements
```

## Examples

```bash
# Quick inventory of every skill the host knows about
argent skills list

# Only the skills that are ready to run right now
argent skills list --eligible

# Verbose listing — shows missing requirements per skill
argent skills list --verbose

# Machine-readable for tooling
argent skills list --json | jq '.[] | select(.eligible==false)'

# Drill into one skill (manifest, deps, status)
argent skills info browser-search

# Readiness summary across all skills (good for `doctor`-style checks)
argent skills check
argent skills check --json
```

## `argent skills list`

List discovered skills.

Options:

- `--json` — Output as JSON.
- `--eligible` — Show only eligible (ready-to-use) skills.
- `-v, --verbose` — Show more details including missing requirements per skill.

Use `--eligible` for a "what can I actually call right now" view, and the default
listing when you want to see everything the host has discovered (including skills that
are present but unconfigured).

## `argent skills info <name>`

Show the full manifest and current readiness for a single skill.

Arguments:

- `<name>` — Skill name (as printed by `argent skills list`).

Options:

- `--json` — Output as JSON.

Output includes:

- Manifest metadata (description, source — bundled / workspace / managed).
- Declared requirements (binaries, env vars, config keys, plugins).
- Which requirements are satisfied vs missing.
- Override source (if a workspace or managed override is shadowing a bundled skill).

## `argent skills check`

Readiness summary across every discovered skill. Equivalent to `argent skills list --verbose`
condensed to a pass/fail per skill, with a non-zero exit when any skill is missing
requirements that block its use.

Options:

- `--json` — Output as JSON.

Good fit for cron / CI checks ("does this host have everything the agent needs?").

## Where skills come from

Skills are discovered from (in priority order):

1. **Managed overrides** — installed via ClawHub or marketplace, under
   `~/.argentos/skills/`.
2. **Workspace skills** — `skills/` directory inside the active agent workspace.
3. **Bundled** — shipped with the Argent install.

A higher-priority source shadows a lower one with the same name. `argent skills info`
prints which source won.

## Troubleshooting

- **Skill listed as "missing requirement"** — `argent skills info <name>` shows what's
  missing. Most often: a CLI binary not on `PATH`, or an env var not exported.
- **Skill doesn't appear at all** — check the workspace skill dir
  (`~/.argentos/agents/<agent>/agent/skills/`) and run `argent skills list --json` to
  see exactly what the loader sees.
- **Override not taking effect** — `argent skills info <name>` reports the active
  source; if it's still `bundled`, the override path or manifest is malformed.
