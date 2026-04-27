# aos-make agent harness

Click CLI harness for `aos-make`.

The harness resolves `MAKE_API_URL`, `MAKE_API_KEY`, and optional `MAKE_*`
scope defaults from operator-controlled service keys first, then falls back to
local environment variables for harness development. Scoped service-key entries
must be injected by the operator runtime and are not bypassed with local env.
Production live-write smoke is not claimed until tested against an operator
Make bridge.

## Commands

- `capabilities`
- `health`
- `doctor`
- `config show`
- `organization list`
- `team list`
- `scenario list`
- `scenario status`
- `scenario trigger`
- `connection list`
- `execution list`
- `execution status`
- `execution run`

`organization.list`, `team.list`, `scenario.list`, `scenario.status`, `connection.list`, `execution.list`, and `execution.status` use the configured live Make bridge. `scenario.trigger` and `execution.run` post live execution payloads through the configured bridge and return normalized bridge metadata for local builders.

Trigger affordances:

- Event hints: `manual`, `webhook`, `scheduled`, `replay`, `custom`
- Payload shape: repeated `--payload key=value` flags become a flat JSON map
- JSON payload: `--payload-json '{"source":"agent"}'` is merged before repeated flags
- Response normalization: `ok`, `status_code`, `response_kind`, `execution_id`, `response_status`, `summary`

## Development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
pytest -q
```
