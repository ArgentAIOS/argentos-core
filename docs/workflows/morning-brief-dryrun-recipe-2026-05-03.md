# Morning Brief Local Dry-Run Recipe

This recipe gives operators a local, no-PostgreSQL payload for the real `ai-morning-brief-podcast` workflow package.

Run from the repo checkout:

```sh
params=$(pnpm exec tsx scripts/workflows/morning-brief-dryrun-params.ts)
argent gateway call workflows.dryRun --params "$params" --json
```

For inspection:

```sh
pnpm exec tsx scripts/workflows/morning-brief-dryrun-params.ts --pretty
```

Expected proof:

- `ok: true`
- graph step includes all 12 Morning Brief nodes
- scout, synthesis, DocPane brief, podcast plan, approval, podcast generate, delivery status, and run ledger nodes are structurally reachable
- no PostgreSQL connection is required
- no live connector execution, customer data read/write, podcast generation, Telegram delivery, service control, or authority switch occurs

Known gaps:

- saved workflow create/list/run still require PostgreSQL
- this does not prove rendered dashboard UI
- this does not prove live installed gateway RPC health or live connector delivery
