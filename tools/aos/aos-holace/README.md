# aos-holace

Agent-native HoLaCe connector — first-party reference implementation.

HoLaCe is an AI-enhanced SaaS for personal injury law firms. This connector provides full read and write access to cases, clients, documents, deadlines, settlements, billing, and communications.

- `case.list`, `case.get`, `case.create`, `case.update`, and `case.timeline` manage the full case lifecycle.
- `client.list`, `client.get`, `client.create`, and `client.intake` handle client records and intake workflows.
- `document.list`, `document.get`, `document.generate`, and `document.upload` manage case documents including AI-generated demand letters.
- `deadline.list`, `deadline.create`, and `deadline.check_statute` track deadlines and statute of limitations.
- `settlement.list`, `settlement.get`, and `settlement.tracker` provide settlement pipeline visibility.
- `billing.list` and `billing.create_invoice` manage case billing.
- `communication.log` and `communication.list` track client communications.
- `report.case_status` and `report.pipeline` generate firm-level analytics.

## Auth

The connector expects a HoLaCe API key via `HOLACE_API_KEY`.

Optional scope hints:

- `HOLACE_ATTORNEY_ID` to default attorney filters.
- `HOLACE_CASE_ID` to preselect a case scope.
- `HOLACE_CLIENT_ID` to preselect a client scope.
- `HOLACE_DOCUMENT_ID` to preselect a document scope.
- `HOLACE_SETTLEMENT_ID` to preselect a settlement scope.

## Live Reads + Writes

This is a first-party connector with full live read and write support. All commands hit the HoLaCe API directly. Document generation uses AI templates for demand letters, medical summaries, and other PI law documents.
