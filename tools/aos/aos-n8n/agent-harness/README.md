# aos-n8n agent harness

Click CLI harness for `aos-n8n`.

The harness resolves `N8N_API_URL`, `N8N_API_KEY`, and
`N8N_WEBHOOK_BASE_URL` from operator-controlled service keys first, then falls
back to local environment variables for harness development.

## Commands

- `capabilities`
- `health`
- `doctor`
- `config show`
- `workflow list`
- `workflow status`
- `workflow trigger`

`workflow.list` and `workflow.status` call the configured n8n API read path. `workflow.trigger` posts a live webhook payload through the configured bridge and returns normalized bridge metadata for local builders.

Trigger affordances:

- Event hints: `manual`, `webhook`, `schedule`, `replay`, `custom`
- Payload shape: repeated `--payload key=value` flags become a flat JSON map
- Response normalization: `ok`, `status_code`, `response_kind`, `execution_id`, `response_status`, `summary`

## Development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
pytest -q
```
