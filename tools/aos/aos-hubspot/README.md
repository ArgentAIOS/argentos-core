# aos-hubspot

`aos-hubspot` is an agent-native HubSpot connector with live read-only CRM access and scaffolded write paths.

- Backend: `hubspot`
- Interface: stable `aos-*` contract
- Scope: contacts, companies, deals, tickets, owners, and pipelines
- Status: read-only commands are live; write commands remain explicit stubs

## Covered Resources

- `contact`
- `company`
- `deal`
- `ticket`
- `owner`
- `pipeline`
- `note`

## Runtime Setup

Recommended environment variables:

- `HUBSPOT_PORTAL_ID`
- `HUBSPOT_ACCOUNT_ALIAS`
- `HUBSPOT_ACCESS_TOKEN`
- `HUBSPOT_APP_ID`
- `HUBSPOT_WEBHOOK_SECRET`

Legacy `AOS_HUBSPOT_*` variable names are still accepted.

`health` now checks both local configuration and a lightweight HubSpot API probe.

## Install (development)

```bash
cd aos-hubspot/agent-harness
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
aos-hubspot --help
aos-hubspot --json capabilities
```

## Examples

```bash
aos-hubspot --json health
aos-hubspot --json config show
aos-hubspot --json contact list --limit 10
aos-hubspot --json contact search --query "someone@example.com"
aos-hubspot --json company read 123456789
aos-hubspot --json deal search --pipeline-id default --stage-id appointmentscheduled
aos-hubspot --json ticket list --property subject --property hs_pipeline_stage
```

## Preflight

Use the preflight script during installer/bootstrap to validate local HubSpot runtime configuration.

```bash
python3 aos-hubspot/installer/preflight_hubspot.py --json
python3 aos-hubspot/installer/preflight_hubspot.py --require-auth --json
```

## First-Pass Notes

- `capabilities`, `health`, and `config show` are implemented.
- `owner.list`, `pipeline.list`, `contact.*` read paths, `company.*` read paths, `deal.*` read paths, and `ticket.*` read paths are live.
- Write paths remain permission-gated and return scaffold responses until the mutation bridge is implemented.
