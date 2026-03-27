# aos-lion-report agent harness

Click-based harness for the `aos-lion-report` connector.

It uses stdlib `urllib` and wraps the documented LION Report API:

- `GET /api/v1/reports`
- `GET /api/v1/reports/{report_id}`
- `POST /api/v1/reports/generate`
- `GET` and `POST /api/v1/journal/entries`
- `GET /api/v1/users`
- `GET /api/v1/training`

## Auth

Set `LION_REPORT_API_KEY`. Optional defaults:

- `LION_REPORT_BASE_URL`
- `LION_REPORT_ID`
- `LION_REPORT_TYPE`
- `LION_DATA_SOURCE`
- `LION_TEMPLATE_ID`

## Verification

```bash
cd tools/aos/aos-lion-report/agent-harness
python -m pytest tests/
```
