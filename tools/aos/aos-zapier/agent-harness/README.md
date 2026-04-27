# aos-zapier agent harness

Click CLI harness for `aos-zapier`.

## Commands

- `capabilities`
- `health`
- `doctor`
- `config show`
- `zap list`
- `zap status`
- `zap trigger`

`zap.list` and `zap.status` use the configured bridge when `ZAPIER_API_URL` and `ZAPIER_API_KEY` are set and reachable. `zap.trigger` now executes through the configured bridge when the trigger endpoint is available.
`zap.trigger` accepts a free-form `event` label plus either repeated `--payload key=value` fields or a `--payload-json` object.

Operator-controlled API Keys are resolved first for all Zapier bridge and scope variables. Local environment variables are only used as a harness fallback when no unmanaged operator key is available. Scoped service-key entries must be injected by the operator runtime and are not bypassed with local env.

## Development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
pytest -q
```
