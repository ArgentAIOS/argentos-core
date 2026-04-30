# aos-callscrub

Agent-native CallScrub connector for sales call analysis and coaching.

This connector is a true AOS CLI app with a live-read HTTP bridge, focused tests, and an agent harness. It intentionally exposes read-only commands only. The prior stub advertised call upload, analysis, coaching generation, and report generation writes, but no verified write bridge or tenant smoke evidence exists in this repo.

## Read Commands

- `call.list` and `call.get`
- `transcript.get` and `transcript.search`
- `coaching.list` and `coaching.get`
- `agent.list`, `agent.stats`, and `agent.scorecard`
- `team.list` and `team.stats`
- `report.list`
- `capabilities`, `config.show`, `health`, and `doctor`

## Operator Service Keys

Configure these values in operator-controlled service keys before linking CallScrub to another system:

- `CALLSCRUB_API_KEY` (required)
- `CALLSCRUB_API_BASE_URL` (required; the connector does not assume a public default API host)

Optional scope defaults can also be supplied through operator context or local harness fallback:

- `CALLSCRUB_TEAM_ID`
- `CALLSCRUB_AGENT_NAME`
- `CALLSCRUB_CALL_ID`
- `CALLSCRUB_COACHING_ID`
- `CALLSCRUB_DATE_RANGE`
- `CALLSCRUB_SEARCH_QUERY`
- `CALLSCRUB_REPORT_TYPE`

Local `CALLSCRUB_*` environment variables are supported only as a development harness fallback. Operator service keys take precedence.

## Readiness

- Live reads: implemented, but not tenant-smoked in this repo.
- Writes: not advertised.
- Scaffold-only: false.
- Required live setup: `CALLSCRUB_API_KEY` and `CALLSCRUB_API_BASE_URL` from operator-controlled service keys.
