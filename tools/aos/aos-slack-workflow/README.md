# aos-slack-workflow

Agent-native Slack workflow connector for post, react, and trigger operations.

## Generated From ArgentOS

- System: Slack
- Category: communication
- Backend: slack-web-api
- Target root: this workspace's `tools/aos` subtree

## Relationship to aos-slack

`aos-slack` is the basic channel driver (search, mention scan, read).
`aos-slack-workflow` is the workflow-level connector with full write operations
(post, update, delete, react, create channels, canvases, reminders, file uploads).

## Commands

- `capabilities` (readonly)
- `health` (readonly)
- `config.show` (readonly)
- `doctor` (readonly)
- `message.post` (write)
- `message.update` (write)
- `message.delete` (write)
- `reaction.add` (write)
- `channel.list` (readonly)
- `channel.create` (write)
- `channel.archive` (write)
- `thread.reply` (write)
- `canvas.create` (write)
- `canvas.update` (write)
- `user.list` (readonly)
- `reminder.create` (write)
- `file.upload` (write)

## Auth

- Kind: service-key
- Required: yes
- Service keys:
  - SLACK_BOT_TOKEN
- Required scopes: channels:read, channels:manage, chat:write, reactions:write, users:read, files:write, reminders:write, canvases:write

## Next Steps

1. Run `aos-slack-workflow --json health` and `aos-slack-workflow --json doctor` against a workspace token.
2. Verify `channel.list` and `user.list` with live scopes.
3. Test `message.post` and `thread.reply` in a sandbox channel.
4. Verify canvas and reminder actions with appropriate scopes.
