# aos-monday agent harness

Python Click wrapper for the `aos-monday` connector.

The harness provides truthful setup, health, config, and doctor commands plus
live reads and writes for account, workspace, board, item, and update surfaces.

Credentials and linked context should come from operator-controlled service keys:
`MONDAY_TOKEN` is required, while `MONDAY_API_URL`, `MONDAY_API_VERSION`,
`MONDAY_WORKSPACE_ID`, `MONDAY_BOARD_ID`, `MONDAY_ITEM_ID`, and
`MONDAY_COLUMN_ID` are optional. Local `MONDAY_*` environment variables are a
development fallback only.

Write commands execute live monday GraphQL mutations in `write` mode or higher.
