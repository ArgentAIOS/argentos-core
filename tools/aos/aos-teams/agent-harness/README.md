# aos-teams agent harness

Python Click harness for Microsoft Teams.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
aos-teams --json capabilities
aos-teams --json health
aos-teams --json config show
aos-teams --json doctor
```

## Runtime

Required operator service keys:

- `TEAMS_TENANT_ID`
- `TEAMS_CLIENT_ID`
- `TEAMS_CLIENT_SECRET`

Optional operator linking keys:

- `TEAMS_TEAM_ID` for `channel.list`
- `TEAMS_USER_ID` for `meeting.list` online calendar-event reads
- `TEAMS_CHANNEL_ID`
- `TEAMS_CHAT_ID`
- `TEAMS_GRAPH_BASE_URL`
- `TEAMS_TOKEN_URL`
- `TEAMS_HTTP_TIMEOUT_SECONDS`
- `TEAMS_MEETING_SUBJECT`
- `TEAMS_START_TIME`
- `TEAMS_END_TIME`

Local process environment variables remain a harness fallback only when operator service keys are unavailable. Scoped repo service keys block local env fallback because the operator runtime must inject those values.

`meeting.list` reads online calendar events for the scoped user and does not claim a future-only or Teams-provider-only filter.

`channel.create` and `meeting.create` use live Microsoft Graph writes in `write` mode or higher. The harness does not expose `message.send`, `message.reply`, `chat.send`, `file.upload`, or `adaptive_card.send` because those flows require delegated auth, bot installation, migration-only permissions, or real file payload handling that this connector does not currently support.

`live_write_smoke_tested=false` until a real operator Microsoft Teams tenant smoke test verifies `channel.create` or `meeting.create`.
