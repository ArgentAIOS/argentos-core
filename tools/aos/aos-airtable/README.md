# aos-airtable

Agent-native Airtable connector scaffold.

This package defines the Airtable connector manifest and a Click-based harness.
Live Airtable reads are implemented for base, table, and record discovery.
Write commands remain scaffolded so the surface stays stable while mutation
paths are added deliberately.

## What is included

- `connector.json` manifest for the AOS registry
- `agent-harness/` Python Click CLI
- `capabilities`, `health`, `config show`, and `doctor`
- Worker-visible base, table, and record commands
- Permission gates and JSON envelopes matching the other `aos-*` tools
- Tests for manifest/permissions sync, config redaction, live reads, and scaffold outputs

## Setup intent

Configure a dedicated Airtable personal access token and the base you want this
worker to target. Add `AIRTABLE_TABLE_NAME` if you want a default table scope
for record commands.

The scaffold currently tracks setup state only:

- `AIRTABLE_API_TOKEN`
- `AIRTABLE_BASE_ID`
- optional `AIRTABLE_TABLE_NAME` to pin a default worker table scope
- optional `AIRTABLE_WORKSPACE_ID`
- optional `AIRTABLE_API_BASE_URL`

## Current limitation

The connector does not perform live Airtable writes. Record creation and update
commands are present as scaffolded worker-visible commands so the surface area is
stable, but they return scaffold payloads instead of mutating Airtable.
