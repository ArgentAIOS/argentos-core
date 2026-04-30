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
- Optional service-key scope defaults:
  - SLACK_APP_TOKEN
  - SLACK_BASE_URL
  - SLACK_CHANNEL_ID
  - SLACK_THREAD_TS
  - SLACK_TEXT
  - SLACK_EMOJI
  - SLACK_USER_ID
  - SLACK_CHANNEL_NAME
  - SLACK_CANVAS_ID
  - SLACK_CANVAS_TITLE
  - SLACK_CANVAS_CONTENT
  - SLACK_CANVAS_CHANGES
  - SLACK_FILE_PATH
  - SLACK_FILE_TITLE
  - SLACK_REMINDER_TEXT
  - SLACK_REMINDER_TIME
  - SLACK_REMINDER_USER
- Required scopes: channels:read, channels:manage, chat:write, reactions:write, users:read, files:write, reminders:write, canvases:write
- Operator-controlled service keys are preferred over local environment variables.
  Local environment variables are only an unmanaged fallback, and scoped repo
  service keys cannot be bypassed with local env.
- Live write commands are implemented but `live_write_smoke_tested=false` until
  a real operator Slack workspace smoke test verifies them.

## Next Steps

1. Bind `SLACK_BOT_TOKEN` as an operator service key, then run `aos-slack-workflow --json health` and `aos-slack-workflow --json doctor` against a workspace token.
2. Verify `channel.list` and `user.list` with live scopes.
3. Test `message.post` and `thread.reply` in a sandbox channel.
4. Verify canvas and reminder actions with appropriate scopes.
