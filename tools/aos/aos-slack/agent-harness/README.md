# aos-slack agent harness

Python Click harness for truthful Slack Web API reads plus a single live reply
write path.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
aos-slack --json capabilities
aos-slack --json health
aos-slack --json config show
aos-slack --json doctor
```

## Notes

The harness resolves `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_WORKSPACE`,
`SLACK_TEAM_ID`, `SLACK_CHANNEL_ID`, `SLACK_THREAD_TS`, and `SLACK_USER_ID`
through operator-controlled service keys first, then falls back to local
environment variables only for local harness runs.

`people.list` requires `users:read`.
`message.reply` requires `chat:write`.
No Socket Mode or event-ingestion commands are advertised here yet.
