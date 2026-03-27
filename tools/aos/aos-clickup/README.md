# aos-clickup

Agent-native ClickUp connector for ArgentOS.

This connector follows the established `aos-*` pattern:

- `connector.json` manifest for the registry
- Python Click harness under `agent-harness/`
- truthful `capabilities`, `health`, `config show`, and `doctor`
- live reads and writes for workspaces, spaces, lists, tasks, comments, docs, time tracking, and goals

## Setup

Configure a ClickUp personal API token or OAuth access token for the target workspace.

Required:

- `CLICKUP_API_TOKEN` or `CLICKUP_ACCESS_TOKEN`
- `CLICKUP_WORKSPACE_ID`

Recommended scope pins:

- `CLICKUP_SPACE_ID`
- `CLICKUP_LIST_ID`
- `CLICKUP_TASK_ID`

## Implementation mode

The harness supports full read and write operations:

- `workspace.list` reads authorized workspaces from ClickUp
- `space.list`, `space.get` navigate workspace spaces
- `list.list`, `list.get`, `list.create` manage lists
- `task.list`, `task.get`, `task.create`, `task.update`, `task.delete` manage tasks
- `comment.list`, `comment.create` manage task comments
- `doc.list`, `doc.get`, `doc.create` manage ClickUp docs
- `time_tracking.list`, `time_tracking.create` manage time entries
- `goal.list`, `goal.get` read workspace goals
