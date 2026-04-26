# agent-cli-tools

Agent-native CLI tools that expose real software capabilities through structured commands, consistent JSON output, and built-in permission enforcement.

## Core Idea

`aos-*` tools make software usable by any agent that can run shell commands.

- No MCP server requirement
- No long-running daemons
- JSON-first command output
- Uniform permission model (`readonly`, `write`, `full`, `admin`)
- Self-describing capabilities (`capabilities --json`)

## Repository Docs

- `ARCHITECTURE.md` - system thesis and design
- `HARNESS-SPEC.md` - required contract for every `aos-*` tool
- `PERMISSIONS.md` - permission tiers and enforcement rules
- `templates/python-click-tool/` - starter scaffold for new tools

## Quick Start

```bash
git clone https://github.com/webdevtodayjason/agent-cli-tools.git
cd agent-cli-tools
```

Use the template to start a new tool:

```bash
cp -R templates/python-click-tool aos-mytool
cd aos-mytool
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
aos-template-tool --help
pytest -q
```

## Standard Global Interface

Every tool must implement:

- `--json`
- `--mode [readonly|write|full|admin]`
- `--verbose`
- `--version`
- `capabilities --json`
- `health`
- `config show`

## Readiness Index

Generate the workflow-facing connector metadata index with:

```bash
node tools/aos/readiness-index.mjs
node tools/aos/readiness-index.mjs --check
```

The generated `tools/aos/readiness-index.json` is the public AOS contract for Workflows, AppForge, and AOU. Consumers should use it instead of inspecting connector internals.

Important fields:

- Connector `readiness`: `live-ready`, `read-only`, `preview-only`, `manifest-only`, or `scaffold/deferred`.
- Connector `auth.service_keys` and `auth.service_key_provider`: operator service-key requirements for linked external systems.
- Connector `workflow.output_destination_allowed`: true only when at least one live writable command has bindable operator service keys and is eligible for Workflow output destinations.
- Command `workflow_source_allowed`: true for runtime-backed read/source actions, excluding connector diagnostics and configuration commands.
- Command `workflow_destination_allowed`: true only for explicitly live writable output actions with bindable operator service keys.
- Command `side_effect_class`: derived or manifest-provided side-effect class. Use top-level `side_effect_classes` for the observed values in the generated index.
- Command `writable_resource`, `writable_operation`, `resource_label`, and `operation_label`: resource/operation metadata for Workflow pickers.
- Command `dry_run_supported`, `test_supported`, and `picker_hint`: UI and validation hints when the command or manifest provides enough evidence. `test_supported=true` requires command-level evidence and is not inferred from the presence of a connector test directory.

`workflow_destination_allowed=true` is metadata eligibility, not proof that operator credentials are configured at runtime. A write command is not destination-eligible unless the connector declares an explicit live write bridge and required operator service keys. External mutations remain approval-gated through `approval_required` unless a later contract explicitly changes that policy.

## Initial Targets

- `aos-obsidian`
- `aos-pg`
- `aos-gh`
- `aos-google` (wrapping `gws`)
- `aos-slack` (wrapping ArgentOS Slack runtime requirements)
- `aos-m365` (wrapping Microsoft Graph / Microsoft 365 auth and resources)
- `aos-stripe` (wrapping Stripe payments, billing, and refund workflows)
- `aos-hubspot` (wrapping HubSpot CRM, deals, tickets, and notes)
- `aos-airtable` (wrapping Airtable bases, tables, and records)
- `aos-shopify` (wrapping Shopify store, product, order, customer, and fulfillment workflows)
- `aos-notion` (wrapping Notion databases, pages, blocks, and search)
- `aos-n8n` (wrapping n8n workflow catalogs, status, and future automation triggers)
- `aos-zapier` (wrapping Zapier zap catalogs, status, and future trigger bridges)
- `aos-quickbooks` (wrapping QuickBooks Online accounting entities)
- `aos-wordpress` (wrapping WordPress REST publishing workflows)
- `aos-nanob` (wrapping Gemini image generation, prompt building, edits, and batch creative runs)
- `aos-mailchimp` (wrapping Mailchimp audiences, members, campaigns, and reports)
- `aos-elevenlabs` (wrapping ElevenLabs voices, models, history, and synthesis workflows)
- `aos-klaviyo` (wrapping Klaviyo account, list, profile, and campaign discovery)
- `aos-buffer` (wrapping Buffer account, channel, profile, and post discovery workflows)
- `aos-hootsuite` (wrapping Hootsuite member, organization, social profile, team, and message discovery)
- `aos-trello` (wrapping Trello account, member, board, list, and card discovery)
- `aos-monday` (wrapping Monday.com account, workspace, board, item, and update discovery)
- `aos-clickup` (wrapping ClickUp workspace, space, folder, list, and task discovery)
- `aos-make` (wrapping Make organizations, teams, scenarios, connections, executions, and trigger bridges)
