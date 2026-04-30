# aos-holace

Agent-native HoLaCe connector for personal-injury legal operations.

This connector is a true AOS CLI app with a live-read HTTP bridge, focused tests, and an agent harness. It intentionally exposes read-only commands only. The prior stub advertised case/client/document/billing writes, but no verified write bridge or tenant smoke evidence exists in this repo.

## Read Commands

- `case.list`, `case.get`, and `case.timeline`
- `client.list` and `client.get`
- `document.list` and `document.get`
- `deadline.list` and `deadline.check_statute`
- `settlement.list`, `settlement.get`, and `settlement.tracker`
- `billing.list`
- `communication.list`
- `report.case_status` and `report.pipeline`
- `capabilities`, `config.show`, `health`, and `doctor`

## Operator Service Keys

Configure these values in operator-controlled service keys before linking HoLaCe to another system:

- `HOLACE_API_KEY` (required)
- `HOLACE_API_BASE_URL` (required; the connector does not assume a public default API host)

Optional scope defaults can also be supplied through operator context or local harness fallback:

- `HOLACE_ATTORNEY_ID`
- `HOLACE_CASE_ID`
- `HOLACE_CLIENT_ID`
- `HOLACE_DOCUMENT_ID`
- `HOLACE_SETTLEMENT_ID`
- `HOLACE_CASE_TYPE`
- `HOLACE_STATUTE_STATE`

Local `HOLACE_*` environment variables are supported only as a development harness fallback. Operator service keys take precedence.

## Readiness

- Live reads: implemented, but not tenant-smoked in this repo.
- Writes: not advertised.
- Scaffold-only: false.
- Required live setup: `HOLACE_API_KEY` and `HOLACE_API_BASE_URL` from operator-controlled service keys.
