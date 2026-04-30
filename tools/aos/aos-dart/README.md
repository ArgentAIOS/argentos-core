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

- operator-controlled `DART_API_KEY` service key

Local harness fallback only:

- `DART_API_KEY` in `process.env` only when no operator-managed key is present

Scoped service-key entries must be injected by the operator runtime; the
standalone harness does not bypass scoped access policy with local env fallback.
Unreadable encrypted unscoped keys follow the core resolver fallback behavior.

Recommended scope pins:

- `DART_DARTBOARD_ID`
- `DART_TASK_ID`
- `DART_DOC_ID`

## Implementation mode

The harness supports live REST read and mode-gated write operations:

- `dartboard.list`, `dartboard.get` navigate dartboards
- `task.list`, `task.get`, `task.create`, `task.update`, `task.delete` manage tasks
- `doc.list`, `doc.get`, `doc.create` manage docs
- `comment.list`, `comment.create` manage task comments
- `property.list` reads custom workspace properties

The Click harness enforces `permissions.json`, prefers operator-controlled
service keys for auth, and uses local env values only as a harness fallback.
Write commands are consequential live mutations and are not marked as
live-smoked until tested against an operator Dart workspace.
