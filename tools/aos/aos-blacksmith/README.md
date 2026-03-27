# aos-blacksmith

Agent-native Blacksmith CI connector for fast GitHub Actions-compatible runners.

Blacksmith provides high-performance CI/CD runners with aggressive caching, giving agents visibility into build status, runner health, cache efficiency, and compute usage.

- `runner.list` and `runner.status` expose runner fleet state.
- `build.list`, `build.get`, and `build.logs` expose CI build history and log retrieval.
- `cache.list` and `cache.stats` expose artifact cache inventory and hit/miss rates.
- `usage.summary` and `usage.billing` expose compute minutes and cost breakdown.

## Auth

The connector expects a Blacksmith API key via `BLACKSMITH_API_KEY`.

Optional scope hints:

- `BLACKSMITH_REPO` to set a default repository for build and cache queries.
- `BLACKSMITH_RUN_ID` to pin a specific build run for log retrieval.

## Live Reads

The harness uses Blacksmith's API for runner, build, cache, and usage queries. If the API key is present but the backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

No write operations are available. Blacksmith builds are triggered via GitHub Actions workflows, not through the API connector.
