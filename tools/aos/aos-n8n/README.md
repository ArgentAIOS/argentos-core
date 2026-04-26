# aos-n8n

n8n connector for live workflow reads and a live workflow trigger bridge.

## Shape

- `connector.json` manifest for the n8n connector
- `agent-harness/` Click-based CLI harness
- `permissions.json` mode gate map
- Focused harness tests for capabilities, health, config, permissions, live workflow reads, and live trigger commands

## Runtime Expectations

This connector has a live read path for workflows and a live workflow.trigger bridge.

The harness resolves operator-controlled service keys first, then falls back to
local environment variables for harness-only development.

The runtime accepts these variables for setup tracking and bridge wiring:

- `N8N_API_URL`
- `N8N_API_KEY`
- `N8N_WEBHOOK_BASE_URL`
- `N8N_WORKSPACE_NAME`
- `N8N_WORKFLOW_ID`
- `N8N_WORKFLOW_NAME`
- `N8N_WORKFLOW_STATUS`

`workflow.list` and `workflow.status` call the configured live n8n API using
`N8N_API_URL` and `N8N_API_KEY`.
`workflow.trigger` advertises local builder hints:

- Event labels: `manual`, `webhook`, `schedule`, `replay`, `custom`
- Payload shape: flat `key=value` fields merged into the JSON body
- Response normalization: `ok`, `status_code`, `response_kind`, `execution_id`, `response_status`, `summary`

`workflow.trigger` posts a live webhook payload through
`N8N_WEBHOOK_BASE_URL` and does not fake execution results.
