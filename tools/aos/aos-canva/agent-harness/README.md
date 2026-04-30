# aos-canva agent harness

Python Click harness for the `aos-canva` connector.

The harness resolves Canva credentials and scope defaults from operator-managed
service keys first, then falls back to local process env for development.

## Auth

- primary: `CANVA_ACCESS_TOKEN`
- legacy fallback: `CANVA_API_KEY`

The value must be a Canva Connect OAuth access token that can act on behalf of
the target user.

## Supported live areas

- designs: list, get, create
- brand templates: list, get, create-design via autofill job
- assets: list, upload
- folders: list, get, create
- exports: start, status, download
- autofill jobs

## Not exposed as live connector commands

- generic template catalog commands
- design clone

## Optional defaults

- `CANVA_FOLDER_ID`
- `CANVA_DESIGN_ID`
- `CANVA_BRAND_TEMPLATE_ID`
- `CANVA_EXPORT_FORMAT`
- `CANVA_EXPORT_JOB_ID`
- `CANVA_ASSET_FILE`
- `CANVA_ASSET_URL`
- `CANVA_ASSET_NAME`
- `CANVA_AUTOFILL_DATA`

## Verification

```bash
cd tools/aos/aos-canva/agent-harness
python -m pytest tests/
python -m compileall cli_aos tests
```
