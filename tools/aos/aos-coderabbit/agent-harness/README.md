# CodeRabbit Agent Harness

This harness provides a Click CLI for the `aos-coderabbit` connector.

It uses the public CodeRabbit REST API for:

- `report.list`
- `report.get`

It uses the repository YAML bridge for:

- `review.request`
- `review.status`
- `review.get`
- `config.get`
- `config.update`

## Auth

Set `CODERABBIT_API_KEY` for REST access.
Set `CODERABBIT_REPO` to the repository slug (`owner/repo`) used by the bridge commands.

## Running

```bash
cd tools/aos/aos-coderabbit/agent-harness
python -m pytest tests/
```
