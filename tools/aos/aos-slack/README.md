# aos-slack

Agent-native Slack workspace connector.

## Generated From ArgentOS

- System: Slack
- Category: general
- Backend: slack-web-api
- Target root: this workspace's `tools/aos` subtree

## Commands

- `capabilities` (readonly)
- `health` (readonly)
- `config.show` (readonly)
- `doctor` (readonly)
- `message.search` (readonly)
- `message.reply` (write)
- `channel.list` (readonly)
- `mention.scan` (readonly)
- `people.list` (readonly)
- `reaction.list` (readonly)

## Auth

- Kind: service-key
- Required: yes
- Service keys:
  - SLACK_BOT_TOKEN
- Interactive setup:
  - Create or install a Slack app for the target workspace.
  - Add SLACK_BOT_TOKEN in API Keys.
  - Grant the bot `channels:read`, `search:read`, `users:read`, and `reactions:read`.
  - Add `chat:write` if you plan to use `message.reply`.
  - Optional: add SLACK_APP_TOKEN only if you later wire Socket Mode or event ingestion.

## Next Steps

1. Run `aos-slack --json health` and `aos-slack --json doctor` against a workspace token.
2. Verify `message.search`, `channel.list`, `mention.scan`, `people.list`, and `reaction.list` with live scopes.
3. Add integration coverage for a real Slack workspace fixture when available.
4. Create a venv and install with `pip install -e '.[dev]'`.
5. Verify `capabilities`, `health`, `config show`, and `doctor` before assigning the connector to a worker.
