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
- Required intents: SERVER MEMBERS, MESSAGE CONTENT
- Required permissions: Send Messages, Manage Messages, Add Reactions, Manage Channels, Manage Roles, Attach Files, Create Public Threads, Send Messages in Threads, Use External Emojis

## Next Steps

1. Run `aos-discord-workflow --json health` and `aos-discord-workflow --json doctor` against a bot token.
2. Verify `channel.list`, `member.list`, and `role.list` with live scopes.
3. Test `message.send` and `embed.send` in a sandbox channel.
4. Verify `webhook.send` with a configured channel webhook URL.
