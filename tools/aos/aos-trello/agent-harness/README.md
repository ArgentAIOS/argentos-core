# aos-trello agent harness

Python CLI harness for the `aos-trello` connector.

This package exposes a live Trello surface for account, member, board, list, and
card commands. The harness is intentionally small and mirrors the shape
used by the other vendored connectors:

- `cli_aos/trello/cli.py` wires the CLI surface.
- `cli_aos/trello/runtime.py` produces health, doctor, capabilities, and command payloads.
- `cli_aos/trello/client.py` talks to the Trello REST API.
- `cli_aos/trello/config.py` resolves and redacts runtime configuration.
- `cli_aos/trello/constants.py`, `errors.py`, and `output.py` keep the surface consistent.

`card.create_draft` and `card.update_draft` keep their compatibility command IDs, but both execute live Trello card writes in `write` mode.
