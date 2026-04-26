# aos-trello

Trello connector for the `aos-trello` CLI surface.

This connector is live-read-first:

- `account.read` confirms the connected Trello identity.
- `member.list` and `member.read` expose member scope for worker pickers.
- `board.list` and `board.read` expose board scope.
- `list.list` and `list.read` expose list scope.
- `card.list` and `card.read` expose card scope.
- `card.create_draft` and `card.update_draft` keep their legacy command IDs but now execute live Trello card writes in `write` mode.

The connector uses the Trello REST API and keeps setup, health, config, doctor,
and capabilities outputs truthful about what is live.
