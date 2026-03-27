# aos-claude-code agent harness

Python Click harness for the `aos-claude-code` connector.

This wrapper talks to the local `claude` CLI rather than a REST API. It exposes:

- prompt send and stream
- session list and resume
- hook list and create
- config get and set
- MCP server list and tool call

## Runtime expectations

- `claude` must be installed and on `PATH`
- auth can come from `ANTHROPIC_API_KEY` or an existing `claude login`
- optional defaults can be supplied through:
  - `CLAUDE_CODE_PROJECT_DIR`
  - `CLAUDE_CODE_MODEL`
  - `CLAUDE_CODE_SESSION_ID`

## Verification

```bash
cd tools/aos/aos-claude-code/agent-harness
python -m pytest tests/
```
