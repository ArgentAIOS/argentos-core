# aos-monday

`aos-monday` is a live Monday.com connector for account, workspace, board,
item, and update surfaces.

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
- `item.create`
- `item.update`
- `update.create`

## Setup

1. Create or copy a monday.com personal API token from the Developer Center.
2. Set `MONDAY_TOKEN` in operator-controlled service keys.
3. Optionally set `MONDAY_API_URL` and `MONDAY_API_VERSION` in operator-controlled
   service keys. The harness defaults to the current stable release and the
   standard monday GraphQL endpoint.
4. If you want default context for future automation, set `MONDAY_WORKSPACE_ID`,
   `MONDAY_BOARD_ID`, `MONDAY_ITEM_ID`, or `MONDAY_COLUMN_ID` in operator-controlled
   service keys.
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

- Local `MONDAY_*` environment variables are a development harness fallback only.
- `health` reports live-read readiness only after the token can successfully
  query `me` from the monday GraphQL API.
- `doctor` stays truthful about setup state and write readiness; it does not
  claim full tenant smoke for every command family.
- `item.create`, `item.update`, and `update.create` execute live monday GraphQL
  mutations in `write` mode or higher.
