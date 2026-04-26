# aos-discord-workflow

Agent-native Discord workflow connector for message, embed, role, and webhook operations.

## Generated From ArgentOS

- System: Discord
- Category: communication
- Backend: discord-bot-api
- Target root: this workspace's `tools/aos` subtree

## Commands

- `capabilities` (readonly)
- `health` (readonly)
- `config.show` (readonly)
- `doctor` (readonly)
- `message.send` (write)
- `message.edit` (write)
- `message.delete` (write)
- `reaction.add` (write)
- `channel.list` (readonly)
- `channel.create` (write)
- `thread.create` (write)
- `embed.send` (write)
- `role.list` (readonly)
- `role.assign` (write)
- `member.list` (readonly)
- `webhook.send` (write)

## Auth

- Kind: service-key
- Required: yes
- Service keys:
  - DISCORD_BOT_TOKEN
- Optional operator linking keys:
  - DISCORD_WEBHOOK_URL
  - DISCORD_GUILD_ID
  - DISCORD_CHANNEL_ID
  - DISCORD_MESSAGE_ID
  - DISCORD_ROLE_ID
  - DISCORD_MEMBER_ID
- Required intents: SERVER MEMBERS, MESSAGE CONTENT
- Required permissions: Send Messages, Manage Messages, Add Reactions, Manage Channels, Manage Roles, Attach Files, Create Public Threads, Send Messages in Threads, Use External Emojis
- Operator-controlled service keys are resolved before local environment variables.
- `webhook.send` can run from `DISCORD_WEBHOOK_URL` without a bot token; the rest of the live read/write commands require `DISCORD_BOT_TOKEN`.

## Next Steps

1. Add `DISCORD_BOT_TOKEN` and any scoped IDs as operator-controlled service keys; use local env only as the harness fallback.
2. Run `aos-discord-workflow --json health` and `aos-discord-workflow --json doctor` to confirm bot-backed readiness and webhook-only partial readiness.
3. Verify `channel.list`, `member.list`, and `role.list` against a sandbox guild before enabling write mode.
4. Test `message.send`, `thread.create`, and `embed.send` in a sandbox channel, then verify `webhook.send` with a dedicated webhook URL.
