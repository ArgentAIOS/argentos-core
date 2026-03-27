# aos-connectwise agent harness

Python Click harness for the `aos-connectwise` connector.

The harness provides live read commands for ConnectWise Manage resources and keeps
the manifest-only write commands scaffolded and permission-gated.

## Runtime expectations

- `CW_COMPANY_ID_AUTH`, `CW_PUBLIC_KEY`, `CW_PRIVATE_KEY`
- `CW_SITE_URL`
- optional scope defaults:
  - `CW_BOARD_ID`
  - `CW_COMPANY_ID`
  - `CW_TICKET_ID`
  - `CW_CONTACT_ID`
  - `CW_PROJECT_ID`
  - `CW_CONFIGURATION_ID`

## Verification

```bash
cd tools/aos/aos-connectwise/agent-harness
python -m pytest tests/
```
