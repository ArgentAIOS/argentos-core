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
- `TEAMS_USER_ID` for `meeting.list`

Local process environment variables remain a harness fallback only when operator service keys are unavailable.

`channel.create` and `meeting.create` use live Microsoft Graph writes in `write` mode or higher. The harness does not expose `message.send`, `message.reply`, `chat.send`, `file.upload`, or `adaptive_card.send` because those flows require delegated auth, bot installation, migration-only permissions, or real file payload handling that this connector does not currently support.
