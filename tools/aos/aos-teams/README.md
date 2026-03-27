# aos-teams

Agent-native Microsoft Teams workflow connector for messaging, meetings, and Adaptive Cards.

## Generated From ArgentOS

- System: Microsoft Teams
- Category: communication
- Backend: microsoft-graph
- Target root: this workspace's `tools/aos` subtree

## Relationship to aos-m365

`aos-m365` covers the full Microsoft 365 suite (mail, calendar, files, Excel, Teams basics).
`aos-teams` is a dedicated Teams workflow connector with deeper coverage: meetings, 1:1 chats,
Adaptive Cards, and channel management beyond what the M365 connector provides.

## Commands

- `capabilities` (readonly)
- `health` (readonly)
- `config.show` (readonly)
- `doctor` (readonly)
- `message.send` (write)
- `message.reply` (write)
- `channel.list` (readonly)
- `channel.create` (write)
- `chat.send` (write)
- `meeting.create` (write)
- `meeting.list` (readonly)
- `team.list` (readonly)
- `file.upload` (write)
- `adaptive_card.send` (write)

## Auth

- Kind: oauth-service-key
- Required: yes
- Service keys:
  - TEAMS_TENANT_ID
  - TEAMS_CLIENT_ID
  - TEAMS_CLIENT_SECRET
- Required Graph permissions: ChannelMessage.Send, Channel.ReadBasic.All, Team.ReadBasic.All, Chat.ReadWrite, OnlineMeetings.ReadWrite, Files.ReadWrite.All

## Next Steps

1. Run `aos-teams --json health` and `aos-teams --json doctor` against configured credentials.
2. Verify `team.list` and `channel.list` with live Graph permissions.
3. Test `message.send` and `chat.send` in a sandbox team.
4. Verify `meeting.create` and `adaptive_card.send` with appropriate permissions.
