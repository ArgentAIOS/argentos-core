# aos-slack agent harness

Python Click harness for Slack Web API reads and replies.

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

Set `SLACK_BOT_TOKEN` before running live reads.
`people.list` requires `users:read`.
`message.reply` also requires `chat:write`.
