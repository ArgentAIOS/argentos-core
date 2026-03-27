# aos-canva agent harness

Python Click harness for the `aos-canva` connector.

It uses Canva Connect APIs directly for live read flows and the write flows that have documented endpoints.

## Supported areas

- designs
- templates
- brand templates
- assets
- folders
- export jobs
- autofill jobs

## Runtime

The harness expects `CANVA_API_KEY` to be set.

Optional defaults:

- `CANVA_FOLDER_ID`
- `CANVA_DESIGN_ID`
- `CANVA_TEMPLATE_ID`
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
```
