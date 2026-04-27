# aos-slack-workflow agent harness

Python CLI harness for the `aos-slack-workflow` connector.

Credentials are resolved from operator-controlled service keys first, then
unscoped repo service keys, then local environment fallback. Scoped repo service
keys intentionally block local environment fallback because the operator runtime
must inject those values.

Required service key:

- `SLACK_BOT_TOKEN`

Optional service-key scope defaults:

- `SLACK_APP_TOKEN`
- `SLACK_BASE_URL`
- `SLACK_CHANNEL_ID`
- `SLACK_THREAD_TS`
- `SLACK_TEXT`
- `SLACK_EMOJI`
- `SLACK_USER_ID`
- `SLACK_CHANNEL_NAME`
- `SLACK_CANVAS_ID`
- `SLACK_CANVAS_TITLE`
- `SLACK_CANVAS_CONTENT`
- `SLACK_CANVAS_CHANGES`
- `SLACK_FILE_PATH`
- `SLACK_FILE_TITLE`
- `SLACK_REMINDER_TEXT`
- `SLACK_REMINDER_TIME`
- `SLACK_REMINDER_USER`

The live write commands are real Slack Web API calls, but
`live_write_smoke_tested=false` until a real operator workspace smoke test runs.
