# aos-monday

`aos-monday` is a live-read-first Monday.com connector scaffold for account,
workspace, board, item, and update surfaces.

Implemented today:

- `capabilities`
- `health`
- `config show`
- `doctor`
- `account.read`
- `workspace.list`
- `board.list`
- `board.read`
- `item.read`
- `update.list`

Write commands are present but scaffolded only:

- `item.create`
- `item.update`
- `update.create`

## Setup

1. Create or copy a monday.com personal API token from the Developer Center.
2. Set `MONDAY_TOKEN` in API Keys.
3. Optionally set `MONDAY_API_VERSION` to pin a stable API version. The harness
   defaults to the current stable release.
4. If you want a default workspace or board context for future automation, set
   `MONDAY_WORKSPACE_ID` or `MONDAY_BOARD_ID`.
5. Share the target boards and workspaces with the token owner before assigning
   the connector to a worker.

## Harness

```bash
cd tools/aos/aos-monday/agent-harness
python -m pip install -e .[dev]
aos-monday --json capabilities
aos-monday --json health
aos-monday --json config show
aos-monday --json doctor
```

## Notes

- `health` reports live-read readiness only after the token can successfully
  query `me` from the monday GraphQL API.
- `doctor` stays truthful about setup state and does not claim write support.
- Write commands are scaffolded intentionally until a live write bridge exists.
