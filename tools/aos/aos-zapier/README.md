# aos-zapier

Zapier connector with live read support for zap listing and status inspection, plus a pragmatic live trigger bridge for `zap.trigger`.

## Shape

- `connector.json` manifest for the Zapier connector
- `agent-harness/` Click-based CLI harness
- `permissions.json` mode gate map
- Focused harness tests for capabilities, health, config, permissions, live read commands, and live trigger execution

## Runtime Expectations

This connector is live-read capable for `zap.list` and `zap.status`, and `zap.trigger` executes through the configured bridge when `POST /trigger` is available.
`zap.trigger` accepts a free-form `event` label plus either repeated `--payload key=value` fields or a `--payload-json` object for builder-friendly input assembly.

The harness accepts these environment variables for live bridge configuration:

- `ZAPIER_API_URL`
- `ZAPIER_API_KEY`
- `ZAPIER_WEBHOOK_BASE_URL`
- `ZAPIER_WORKSPACE_NAME`
- `ZAPIER_ZAP_ID`
- `ZAPIER_ZAP_NAME`
- `ZAPIER_ZAP_STATUS`

Operator-controlled API Keys are the primary source for all Zapier bridge and scope variables. Local environment variables are only a harness fallback when those operator-managed keys are unavailable. Scoped service-key entries must be injected by the operator runtime; the harness will not bypass them with local env.

Read-style zap commands call the configured Zapier bridge when `ZAPIER_API_URL` and `ZAPIER_API_KEY` are set and reachable. Trigger execution uses the same bridge and is guarded by `write` mode. The connector exposes a real write path, but production live-write smoke is not claimed until tested against an operator Zapier bridge.
