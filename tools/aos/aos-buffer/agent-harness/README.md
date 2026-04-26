# Buffer agent harness

This harness provides the Buffer connector CLI for ArgentOS.

Live reads are implemented against Buffer's public GraphQL API for:

- account and organization discovery
- channel discovery and direct channel reads
- post discovery within accessible organizations

The `profile.*` commands are legacy aliases over the same live channel data.

Draft and schedule writes are intentionally absent until a live write bridge and
approval policy are implemented.
