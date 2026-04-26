# aos-connectwise agent harness

Python Click harness for the `aos-connectwise` connector.

The harness provides live read commands for ConnectWise Manage resources plus
explicit-payload live writes for `ticket create`, `company create`,
`contact create`, and `time-entry create`.

`ticket update` remains scaffolded and permission-gated because the ConnectWise
PATCH payload contract has not been verified for this harness yet.

## Runtime expectations

- `CW_SITE_URL`, `CW_COMPANY_ID_AUTH`, `CW_PUBLIC_KEY`, `CW_PRIVATE_KEY`
- optional scope defaults:
  - `CW_BOARD_ID`
  - `CW_COMPANY_ID`
  - `CW_TICKET_ID`
  - `CW_CONTACT_ID`
  - `CW_PROJECT_ID`
  - `CW_CONFIGURATION_ID`

The connector resolves the auth keys above through operator-controlled service
keys first, then falls back to local environment variables only inside the
service-key helper.

## Write commands

- `aos-connectwise --json --mode write ticket create --payload-json '{"summary":"Email down","board":{"id":1}}'`
- `aos-connectwise --json --mode write company create --payload name=Acme identifier=ACME`
- `aos-connectwise --json --mode write contact create --payload-json '{"firstName":"Ada","lastName":"Lovelace"}'`
- `aos-connectwise --json --mode write time-entry create 12345 --payload-json '{"hoursDeduct":1.0,"notes":"Initial triage"}'`

Each live write requires an explicit payload. `ticket update` is intentionally
not advertised as live.

## Verification

```bash
cd tools/aos/aos-connectwise/agent-harness
python -m pytest tests/
```
