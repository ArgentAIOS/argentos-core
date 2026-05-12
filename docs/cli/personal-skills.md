---
summary: "CLI reference for `argent personal-skills` (DB-backed Personal Skills maintenance)"
read_when:
  - You need to purge polluted Personal Skill candidates from the local DB
  - Investigating Personal Skill regressions (audio-transcript pollution, dedup drift)
  - Writing a maintenance runbook for a node's Personal Skills store
title: "personal-skills"
---

# `argent personal-skills`

Inspect and maintain **DB-backed Personal Skills** — the recurrence-tracked
candidate skills the assistant promotes from observed activity.

Personal Skills are stored in the local SQLite skills DB (separate from
catalog skills installed via [`argent skills`](/cli/skills) or
[`argent marketplace`](/cli/marketplace)). This command exists to clean up
candidates that were corrupted by upstream regressions (e.g. audio-transcript
pollution prior to [#210](https://github.com/ArgentAIOS/argentos-core/issues/210)).

The command is aliased as `argent personal-skill` (singular) for convenience.

Related:

- Catalog skills + readiness: [`argent skills`](/cli/skills)
- Install community skills: [`argent marketplace`](/cli/marketplace)

## Subcommand map

```
argent personal-skills
└── purge        Soft-delete polluted Personal Skill candidates
```

## Examples

```bash
# Preview which candidates would be purged (no DB writes)
argent personal-skills purge --dry-run

# Purge audio-transcript-polluted candidates
argent personal-skills purge --kind audio-transcript

# Same, but emit JSON for scripts/CI
argent personal-skills purge --kind audio-transcript --json
```

## `argent personal-skills purge`

Soft-delete polluted Personal Skill **candidates** (not promoted skills).
Soft-delete means the row is archived in place — recoverable, not destroyed.

Options:

- `--kind <kind>` — Pollution kind to purge. Currently only `audio-transcript`
  is supported (default: `audio-transcript`).
- `--dry-run` — Print what would be archived without writing to the DB.
- `--json` — Output the result as JSON (counts + archived row ids).

Exit codes:

- `0` — Purge succeeded (or `--dry-run` completed cleanly).
- Non-zero — DB error, or unsupported `--kind`.

## Troubleshooting

- **"no candidates matched"** — either the pollution kind doesn't apply to this
  store, or the fix landed before pollution was introduced. Confirm with
  `--dry-run` first.
- **Promoted skills still misbehaving** — `purge` only touches _candidates_.
  Promoted Personal Skills aren't archived by this command; treat them via the
  normal skill-edit flow.
- **Unsupported `--kind`** — only `audio-transcript` is wired up today. New
  pollution kinds get added as regressions surface.
