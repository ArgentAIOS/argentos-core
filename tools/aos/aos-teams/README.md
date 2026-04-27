# aos-teams

Agent-native Microsoft Teams workflow connector for team discovery, channel management, and online meetings.

## Generated From ArgentOS

- System: Microsoft Teams
- Category: communication
- Backend: microsoft-graph
- Target root: this workspace's `tools/aos` subtree

## Relationship to aos-m365

`aos-m365` covers the full Microsoft 365 suite (mail, calendar, files, Excel, Teams basics).
`aos-teams` is the dedicated Teams slice for live team discovery, channel management, online
calendar-event reads, and online-meeting creation without pretending that delegated
chat/card/file flows are available through the same app-only harness.

## Commands

- `capabilities` (readonly)
- `health` (readonly)
- `config.show` (readonly)
- `doctor` (readonly)
- `team.list` (readonly)
- `channel.list` (readonly)
- `channel.create` (write)
- `meeting.list` (readonly online calendar events for the scoped user)
- `meeting.create` (write)

## Auth

- Kind: oauth-service-key
- Required: yes
- Service keys:
  - TEAMS_TENANT_ID
  - TEAMS_CLIENT_ID
  - TEAMS_CLIENT_SECRET
- Operator linking keys:
  - TEAMS_TEAM_ID
  - TEAMS_USER_ID
- Optional service-key defaults:
  - TEAMS_CHANNEL_ID
  - TEAMS_CHAT_ID
  - TEAMS_GRAPH_BASE_URL
  - TEAMS_TOKEN_URL
  - TEAMS_HTTP_TIMEOUT_SECONDS
  - TEAMS_MEETING_SUBJECT
  - TEAMS_START_TIME
  - TEAMS_END_TIME
- Operator-controlled service keys are preferred over local environment variables.
  Local environment variables are only an unmanaged fallback, and scoped repo
  service keys cannot be bypassed with local env.
- Live write commands are implemented, but `live_write_smoke_tested=false` until
  a real operator Microsoft Teams tenant smoke test verifies them.
- Required Graph permissions depend on the surfaced commands:
  - `team.list`: `GroupMember.Read.All` (or broader group read permission)
  - `channel.list`: `ChannelSettings.Read.Group` or `Channel.ReadBasic.All`
  - `channel.create`: `Channel.Create.Group` or `Channel.Create`
  - `meeting.list`: `Calendars.ReadBasic` or `Calendars.Read`; reads online calendar events and does not claim a future-only or Teams-provider-only filter
  - `meeting.create`: `OnlineMeetings.ReadWrite.All` plus an application access policy for `TEAMS_USER_ID`

## Next Steps

1. Bind `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID`, and `TEAMS_CLIENT_SECRET` as operator service keys, then run `aos-teams --json health` and `aos-teams --json doctor`.
2. Verify `team.list` and `channel.list` with live Graph permissions.
3. Set `TEAMS_TEAM_ID` before using `channel.create` without an explicit team ID argument.
4. Set `TEAMS_USER_ID` and verify the application access policy before using `meeting.list` or `meeting.create`.
