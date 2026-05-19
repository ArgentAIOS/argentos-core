# dashboard/src/dev-fixtures

Standalone Vite fixtures for visual smoke-checking individual dashboard
components without booting the full ArgentOS auth / onboarding stack.

Each fixture pairs a TSX entry in this directory with an HTML loader in
`dashboard/public/dev-fixtures/`. Tailwind 4's content scanner picks up
utility classes from the TSX entries because they live inside `src/`.

## How to use

From the `dashboard/` directory:

```sh
pnpm dev    # starts vite on :8080
```

Then open the fixture URL directly:

| Fixture                 | URL                                                 | What it shows                                                                                                        |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `gantt-smoke-entry.tsx` | http://localhost:8080/dev-fixtures/gantt-smoke.html | `GanttView` rendered with 5 mock records across 3 swimlanes — confirms bars-on-axis + lane grouping render correctly |

## When to update

Treat these as throwaway diagnostic harnesses, not real tests. The
durable test surface lives in `dashboard/src/components/app-forge/*.test.ts`.
Update or remove a fixture once its diagnostic value has been captured
in a real test or once the feature has stabilised.
