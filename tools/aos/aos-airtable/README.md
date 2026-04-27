# aos-airtable

Agent-native Airtable connector.

This package defines the Airtable connector manifest and a Click-based harness.
Live Airtable reads are implemented for base, table, and record discovery.
Write-mode record creation and update use Airtable's REST API and remain gated
behind AOS permissions.

## What is included

- `connector.json` manifest for the AOS registry
- `agent-harness/` Python Click CLI
- `capabilities`, `health`, `config show`, and `doctor`
- Worker-visible base, table, and record commands
- Permission gates and JSON envelopes matching the other `aos-*` tools
- Tests for manifest/permissions sync, config redaction, live reads, and write-mode record mutations

## Setup intent

Configure a dedicated Airtable personal access token and the base you want this
worker to target in operator-controlled API Keys. Add `AIRTABLE_TABLE_NAME` if
you want a default table scope for record commands.

- `AIRTABLE_API_TOKEN`
- `AIRTABLE_BASE_ID`
- optional `AIRTABLE_TABLE_NAME` to pin a default worker table scope
- optional `AIRTABLE_WORKSPACE_ID`
- optional `AIRTABLE_API_BASE_URL`

Local process environment variables remain a development fallback only. Runtime
resolution checks operator-controlled service keys first. Scoped repo service
keys are not bypassed with env fallback, including legacy `AOS_AIRTABLE_*`
aliases. `live_write_smoke_tested` remains false until a real operator Airtable
base write smoke is run.

## Write commands

Record creation and update are available in `write` mode or higher:

```sh
aos-airtable --json --mode write record create --table Projects --field Name="New project"
aos-airtable --json --mode write record update rec123 --table Projects --fields-json '{"Status":"Active"}'
```
