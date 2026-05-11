# The "verified" Definition

A slice is "verified" when ALL of the following pass:

1. `pnpm test:slice` (exit 0) — focused tests for files touched in this slice
2. `pnpm check:repo-lane` (exit 0) — sentinel passes
3. `pnpm tsc:since` (exit 0) — zero NET-NEW TS errors vs. the snapshot
4. Browser smoke (only if dashboard/ files changed)

"verified" does NOT mean:

- Full-repo tsgo green (the baseline has known unrelated errors)
- Full Vitest run across all packages
- All lint warnings resolved (only lint errors are blocking)

The full-repo signal is preserved in `ops/known-failing.json` as a baseline
snapshot. Future tooling (`pnpm tsc:since`) checks NET-NEW only.
