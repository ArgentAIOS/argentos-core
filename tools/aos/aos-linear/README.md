# aos-linear

`aos-linear` is an agent-native Linear connector.

It provides project and issue management actions backed by the Linear GraphQL API.
The connector resolves `LINEAR_API_KEY` from Argent Service Keys first, then falls back
to `process.env` for local development.

## Commands

- `list-projects`
- `list-issues`
- `create-issue`
- `update-issue`
- `search`
- `get-issue`
