# aos-trello agent harness

Python CLI harness for the `aos-trello` connector.

This package exposes a live-read-first Trello surface with scaffolded writes for
card draft operations. The harness is intentionally small and mirrors the shape
used by the other vendored connectors:

- `cli_aos/trello/cli.py` wires the CLI surface.
- `cli_aos/trello/runtime.py` produces health, doctor, capabilities, and command payloads.
- `cli_aos/trello/client.py` talks to the Trello REST API.
- `cli_aos/trello/config.py` resolves and redacts runtime configuration.
- `cli_aos/trello/constants.py`, `errors.py`, and `output.py` keep the surface consistent.
