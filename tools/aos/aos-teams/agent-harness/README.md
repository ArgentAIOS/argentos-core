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

Required environment:

- `TEAMS_TENANT_ID`
- `TEAMS_CLIENT_ID`
- `TEAMS_CLIENT_SECRET`

Optional read scopes:

- `TEAMS_TEAM_ID` for `channel.list`
- `TEAMS_USER_ID` for `meeting.list`

`channel.create` and `meeting.create` use live Microsoft Graph writes in `write` mode or higher. `message.send`, `message.reply`, `chat.send`, `file.upload`, and `adaptive_card.send` remain disabled with `NOT_IMPLEMENTED` because they require delegated, bot, migration-only, or file-payload flows outside this operator service-key connector.
