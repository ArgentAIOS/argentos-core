# aos-dart

Agent-native Dart project management connector for ArgentOS.

This connector follows the established `aos-*` pattern:

- `connector.json` manifest for the registry
- Python Click harness under `agent-harness/`
- truthful `capabilities`, `health`, `config show`, and `doctor`
- live reads and writes for dartboards, tasks, docs, comments, and properties

## Setup

Configure a Dart API key from your workspace settings.

Required:

- `DART_API_KEY`

Recommended scope pins:

- `DART_DARTBOARD_ID`
- `DART_TASK_ID`

## Implementation mode

The harness supports full read and write operations:

- `dartboard.list`, `dartboard.get` navigate dartboards
- `task.list`, `task.get`, `task.create`, `task.update`, `task.delete` manage tasks
- `doc.list`, `doc.get`, `doc.create` manage docs
- `comment.list`, `comment.create` manage task comments
- `property.list` reads custom workspace properties
