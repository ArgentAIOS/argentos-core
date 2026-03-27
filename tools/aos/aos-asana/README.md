# aos-asana

Agent-native Asana project management connector for ArgentOS.

This connector follows the established `aos-*` pattern:

- `connector.json` manifest for the registry
- Python Click harness under `agent-harness/`
- truthful `capabilities`, `health`, `config show`, and `doctor`
- live reads and writes for projects, tasks, sections, comments, portfolios, and search

## Setup

Configure an Asana personal access token from the Asana developer console.

Required:

- `ASANA_ACCESS_TOKEN`
- `ASANA_WORKSPACE_GID`

Recommended scope pins:

- `ASANA_PROJECT_GID`
- `ASANA_TASK_GID`

## Implementation mode

The harness supports full read and write operations:

- `project.list`, `project.get`, `project.sections` navigate projects
- `section.list`, `section.tasks` navigate project sections
- `task.list`, `task.get`, `task.create`, `task.update` manage tasks
- `comment.list`, `comment.create` manage task stories/comments
- `portfolio.list`, `portfolio.get` read workspace portfolios
- `search.tasks` searches tasks across a workspace
