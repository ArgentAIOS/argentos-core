# aos-monday agent harness

Python Click wrapper for the `aos-monday` connector.

The harness provides truthful setup, health, config, and doctor commands plus
live reads and writes for account, workspace, board, item, and update surfaces.

Write commands execute live monday GraphQL mutations in `write` mode or higher.
