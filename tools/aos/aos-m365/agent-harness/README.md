# aos-m365 agent harness

Python Click harness for Microsoft 365 / Graph.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
aos-m365 --json capabilities
aos-m365 --json health
aos-m365 --json config show
aos-m365 --json doctor
```

## Runtime

Required environment:

- `M365_TENANT_ID`
- `M365_CLIENT_ID`
- `M365_CLIENT_SECRET`

Live read commands also need one or more of:

- `M365_TARGET_USER` for mailbox, calendar, and file reads
- `M365_TEAM_ID` and `M365_CHANNEL_ID` for Teams channel reads
- `M365_EXCEL_ITEM_ID`, `M365_EXCEL_WORKSHEET_NAME`, and `M365_EXCEL_RANGE` for Excel reads

Write commands are still scaffolded and will return `NOT_IMPLEMENTED`.
