# aos-neon

Agent-native Neon serverless Postgres connector for SQL queries and branch management.

This connector provides live read and write access to Neon projects:

- `sql.query` runs read-only SQL queries against the database.
- `sql.execute` runs DDL/DML statements (CREATE, INSERT, UPDATE, DELETE, etc.).
- `branch.list` lists all branches in the Neon project.
- `branch.create` creates a new branch (instant copy-on-write from parent).
- `branch.delete` deletes a branch.
- `project.info` reads project metadata from the Neon API.

## Auth

The connector uses two credentials:

- `NEON_CONNECTION_STRING` — the full postgres:// connection string for SQL operations.
- `NEON_API_KEY` — the Neon API key for branch and project management.

Required for branch operations:

- `NEON_PROJECT_ID` — the Neon project ID.

Optional scope hints:

- `NEON_BRANCH` — default branch name for SQL operations.

## Live Reads

The harness uses the Neon connection string for SQL queries (via `psycopg2` or stdlib `urllib` to the Neon serverless HTTP endpoint). Branch and project operations use the Neon REST API at `https://console.neon.tech/api/v2`.

## Writes

SQL write commands (`sql.execute`) and branch mutations (`branch.create`, `branch.delete`) perform live operations when mode is `write` or higher. Use `readonly` mode for safe exploration.
