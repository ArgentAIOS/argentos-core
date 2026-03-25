# aos-make

Make connector for live reads of organizations, teams, scenarios, connections, and executions, with a live execution trigger bridge for `scenario.trigger` and `execution.run`.

## Shape

- `connector.json` manifest for the Make connector
- `agent-harness/` Click-based CLI harness
- `permissions.json` mode gate map
- Focused harness tests for capabilities, health, config, permissions, live read commands, and live execution triggers

## Runtime Expectations

This connector is live-read first. The harness uses a configured Make bridge for truthfulness rather than fabricating Make state locally.

The harness accepts these environment variables for live bridge configuration:

- `MAKE_API_URL`
- `MAKE_API_KEY`
- `MAKE_WEBHOOK_BASE_URL`
- `MAKE_ORGANIZATION_ID`
- `MAKE_ORGANIZATION_NAME`
- `MAKE_TEAM_ID`
- `MAKE_TEAM_NAME`
- `MAKE_SCENARIO_ID`
- `MAKE_SCENARIO_NAME`
- `MAKE_SCENARIO_STATUS`
- `MAKE_CONNECTION_ID`
- `MAKE_CONNECTION_NAME`
- `MAKE_EXECUTION_ID`
- `MAKE_RUN_ID`

Read-style commands call the configured Make bridge when `MAKE_API_URL` and `MAKE_API_KEY` are set and reachable.
`scenario.trigger` and `execution.run` post a live execution payload through the configured bridge and return normalized bridge metadata.
