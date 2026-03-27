# aos-claude-code

Agent-native Claude Code CLI connector for AI-powered code assistance.

Claude Code is Anthropic's CLI tool for interactive coding sessions with Claude. This connector gives agents programmatic access to prompts, sessions, hooks, configuration, and MCP server integration.

- `prompt.send` and `prompt.stream` dispatch prompts to Claude Code with optional model and project context.
- `session.list` and `session.resume` manage persistent coding sessions.
- `hook.list` and `hook.create` manage event-driven hooks (pre-commit, post-tool, etc.).
- `config.get` and `config.set` read and write Claude Code settings.
- `mcp.list` and `mcp.call` interact with connected MCP servers.

## Auth

The connector uses `ANTHROPIC_API_KEY` for SDK-based access. Alternatively, Claude Code CLI can authenticate via `claude login` for interactive use.

Optional scope hints:

- `CLAUDE_CODE_PROJECT_DIR` to set a default project directory for sessions.
- `CLAUDE_CODE_MODEL` to override the default model (e.g., `claude-sonnet-4-6`).
- `CLAUDE_CODE_SESSION_ID` to pin a specific session for resume operations.

## Live Reads

The harness uses the Claude Code CLI and SDK for session listing, hook inspection, config reads, and MCP server discovery. If authentication is missing or the CLI is not installed, `health` and `doctor` report the issue instead of pretending the connector is ready.

## Writes

Write operations are available for sending prompts, resuming sessions, creating hooks, updating config, and calling MCP tools. All write operations go through the Claude Code CLI or SDK.
