# aos-m365

Agent-native Microsoft 365 / Graph connector.

## Generated From ArgentOS

- System: Microsoft 365 / Graph
- Category: productivity-suite
- Backend: microsoft-graph
- Target root: /Users/sem/code/argentos-m365-connector-setup-20260318/tools/aos

## Runtime Surface

Implemented live reads:

- `mail.search` and `mail.read`
- `calendar.list`
- `file.list`
- `excel.read_rows` when workbook context is configured
- `teams.list_messages` when team and channel IDs are configured

Write paths remain scaffolded and return a truthful `NOT_IMPLEMENTED` error:

- `mail.reply`
- `mail.send`
- `calendar.create`
- `excel.append_rows`
- `teams.reply_message`

## Auth

- Kind: oauth-service-key
- Required: yes
- Service keys:
  - M365_TENANT_ID
  - M365_CLIENT_ID
  - M365_CLIENT_SECRET
- Interactive setup:
  - Register an application in Microsoft Entra ID.
  - Grant the Microsoft Graph application permissions required for the surfaces you plan to use.
  - Add M365_TENANT_ID, M365_CLIENT_ID, and M365_CLIENT_SECRET in API Keys.
  - Set M365_TARGET_USER for mailbox, calendar, and OneDrive-backed reads.
  - Set M365_TEAM_ID and M365_CHANNEL_ID for Teams reads.
  - Set M365_EXCEL_ITEM_ID, M365_EXCEL_WORKSHEET_NAME, and M365_EXCEL_RANGE for Excel reads.
  - Restrict mailbox, Teams, and workbook scope before going live.

## Health

- `health` checks auth readiness, target-user readiness, and live Graph probe status.
- `config show` reports redacted config plus the live probe result.
- `doctor` summarizes readiness and remaining setup gaps.

## Next Steps

1. Finish write-path implementations.
2. Expand integration coverage against a live Microsoft Graph tenant.
3. Create a venv and install with `pip install -e '.[dev]'`.
4. Verify `capabilities`, `health`, `config show`, and `doctor` before assigning the connector to a worker.
