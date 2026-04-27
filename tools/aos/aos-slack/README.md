# aos-slack

Agent-native Slack workspace connector with truthful live reads plus a single
permission-gated live reply path.

## Generated From ArgentOS

- System: Slack
- Category: general
- Backend: slack-web-api
- Target root: this workspace's `tools/aos` subtree

## Commands

- `capabilities` (readonly)
- `health` (readonly)
- `config.show` (readonly)
- `doctor` (readonly)
- `message.search` (readonly)
- `message.reply` (write, live `chat.postMessage`)
- `channel.list` (readonly)
- `mention.scan` (readonly)
- `people.list` (readonly)
- `reaction.list` (readonly)

## Auth

- Kind: service-key
- Required: yes
- Service keys:
  - SLACK_BOT_TOKEN
- Optional service keys:
  - SLACK_APP_TOKEN
  - SLACK_WORKSPACE
  - SLACK_TEAM_ID
  - SLACK_CHANNEL_ID
  - SLACK_THREAD_TS
  - SLACK_USER_ID

The harness resolves operator-controlled service keys first for Slack auth and
stable scope defaults, then falls back to local environment variables only for
local harness runs.
Scoped repo service keys are not bypassed with env fallback. `live_write_smoke_tested`
remains false until a real operator Slack workspace write smoke is run.

## Truthful Surface

- Live reads: `message.search`, `channel.list`, `mention.scan`, `people.list`, `reaction.list`
- Live write: `message.reply` only
- Not exposed: fake post scheduling, fake event ingestion, or pretend Slack write bridges beyond `message.reply`

## Next Steps

1. Run `aos-slack --json health` and `aos-slack --json doctor` against a workspace token.
2. Verify `message.search`, `channel.list`, `mention.scan`, `people.list`, `reaction.list`, and `message.reply` with live scopes.
3. Add integration coverage for a real Slack workspace fixture when available.
4. Create a venv and install with `pip install -e '.[dev]'`.
5. Verify `capabilities`, `health`, `config show`, and `doctor` before assigning the connector to a worker.
