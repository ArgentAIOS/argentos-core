# aos-clickup

Agent-native ClickUp connector scaffold.

This connector follows the established `aos-*` pattern:

- `connector.json` manifest for the registry
- Python Click harness under `agent-harness/`
- truthful `capabilities`, `health`, `config show`, and `doctor`
- live reads for workspace, space, folder, list, and task discovery
- scaffolded `task.create_draft` and `task.update_draft` write surfaces

## Setup

Configure a ClickUp personal API token or OAuth access token for the workspace this worker should use.

Required:

- `CLICKUP_API_TOKEN` or `CLICKUP_ACCESS_TOKEN`

Recommended scope pins:

- `CLICKUP_WORKSPACE_ID` or `CLICKUP_TEAM_ID`
- `CLICKUP_SPACE_ID`
- `CLICKUP_FOLDER_ID`
- `CLICKUP_LIST_ID`
- `CLICKUP_TASK_ID`

## Implementation mode

The harness is live-read-first:

- `workspace.list` reads authorized workspaces from ClickUp
- `workspace.read`, `space.list`, `space.read`, `folder.list`, `folder.read`, `list.list`, `list.read`, `task.list`, and `task.read` call the real API
- `task.create_draft` and `task.update_draft` return scaffold payloads until a write bridge is approved
