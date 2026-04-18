# aos-clientsync

Agent-native ClientSync MSP management connector.

ClientSync is Jason's MSP management platform with client portals, compliance tools, and analytics. This connector exposes the full MSP surface: clients, tickets, technicians, compliance frameworks, assets, contracts, analytics, reports, and audit logs.

Both reads and writes are live:

- `client.list` / `client.get` — browse and inspect managed clients.
- `client.create` / `client.update` — onboard and maintain client records.
- `client.portal` — retrieve client portal link and status.
- `ticket.list` / `ticket.get` — browse support tickets, optionally scoped by client or technician.
- `ticket.create` / `ticket.update` / `ticket.assign` / `ticket.resolve` — full ticket lifecycle.
- `technician.list` / `technician.get` / `technician.availability` — technician roster and scheduling.
- `compliance.list` / `compliance.get` / `compliance.check` / `compliance.report` — compliance framework management and audit reporting.
- `asset.list` / `asset.get` / `asset.create` — client asset inventory.
- `contract.list` / `contract.get` / `contract.renew` — service contract management.
- `analytics.dashboard` / `analytics.client_health` / `analytics.sla_performance` — MSP analytics and SLA tracking.
- `report.generate` / `report.list` — report generation and history.
- `audit.list` / `audit.create` — audit trail.

## Auth

The connector expects a ClientSync API key via `CLIENTSYNC_API_KEY`.

Optional configuration:

- `CLIENTSYNC_API_URL` — base URL for self-hosted instances (defaults to `https://api.clientsync.io/v1`).
- `CLIENTSYNC_CLIENT_ID` — preselect a client scope.
- `CLIENTSYNC_TICKET_ID` — preselect a ticket scope.
- `CLIENTSYNC_TECHNICIAN_ID` — preselect a technician scope.
- `CLIENTSYNC_COMPLIANCE_ID` — preselect a compliance framework (e.g., `SOC2`).
- `CLIENTSYNC_SLA_ID` — preselect an SLA agreement scope.
- `CLIENTSYNC_REPORT_TYPE` — default report type (e.g., `monthly_client_review`).

## Live Reads

The harness uses ClientSync API endpoints for client, ticket, technician, compliance, asset, contract, analytics, report, and audit discovery. If the API key is present but the live backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

Write commands are live and perform real mutations against the ClientSync API. They require `--mode write` or `--mode full`. Ticket lifecycle operations (create, update, assign, resolve) generate audit trail entries automatically.
