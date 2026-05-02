# Argent Core Lane Lock

THIS REPO IS ARGENTOS-CORE.

Core foundation, gateway, workflow runtime, agent tooling, AppForge substrate, dashboard core platform, installer/update-path, and `argent update` work belongs in `ArgentAIOS/argentos-core` unless Threadmaster explicitly marks the task as business/licensing-layer work.

Do not move core foundation work to `ArgentAIOS/argentos`.

Business, commercial packaging, private licensing-server behavior, and private product contracts belong outside core and must not be assumed in this repository.

Before any push, PR, merge, or handoff, verify:

```sh
git remote get-url origin
pwd
git rev-parse --abbrev-ref HEAD
pnpm check:repo-lane
```

Expected lane:

- Repo: `ArgentAIOS/argentos-core`
- Local path: `/Users/sem/code/argent-core`
- Target branch: `dev`
- Install channel: `dev`
- Forbidden repo for core foundation work: `ArgentAIOS/argentos`

## Dev Version Contract

Every successful push to `origin/dev` must carry a unique dev version in the root `package.json`.

Version format:

```text
YYYY.M.D-dev.N
```

Display/tag form may be prefixed with `v`, for example `v2026.4.28-dev.0`; the `package.json` field stores it without `v`.

Rules:

- Use the current America/Chicago calendar date for `YYYY.M.D`.
- Start each new day at `YYYY.M.D-dev.0`.
- Increment `N` by one for every subsequent push to `origin/dev` on that same date: `dev.0`, `dev.1`, `dev.2`, and so on.
- Before pushing to `origin/dev`, inspect the current root `package.json` version on latest `origin/dev`, choose the next daily version, and include that bump in the same commit or merge packet being pushed.
- If the date changed since the last dev version, reset the suffix to `dev.0` for the new date.
- Threadmaster merge/coordination-only pushes are not exempt. They still need a fresh dev version so `argent update` and operator reports have a known build id.
- If a push is rejected because another lane landed first, fetch/rebase/merge, recompute the next dev version, and update it before retrying.

## Dev Checkpoint Cadence Contract

Prefer small, verified checkpoints to `origin/dev` over large multi-lane batch merges.

Rules:

- Land a slice when it is clean, rebased on latest `origin/dev`, verified, truth-labeled, and safe for `argent update`.
- Do not hold READY packets in custody waiting for unrelated product areas to finish.
- Keep checkpoint scope narrow: one lane, one behavior/proof slice, or one contained custody packet.
- Every checkpoint must state what is enabled, what is still dry-run/shadow/deferred, and what is explicitly not live.
- Risky systems must advance through honest gates:
  - Rust Gateway/Kernel may land shadow/no-live evidence slices, but no authority switch without separate canary, rollback, duplicate-prevention, token/auth, and operator approval gates.
  - Workflows may land dry-run, run-detail, canary-readiness, and UI visibility slices, but no live connector, podcast, or channel side effects without explicit approval.
  - AppForge/TableForge may land focused UI/storage/browser-smoke slices, but no fake/demo code or unverified persistence claims.
  - Agent Persona may land diagnosis, tests, and enforceable receipt guardrails, but no broad harness rewrite without proof.
- If a lane is stale or blocked, keep other clean READY packets moving to `dev`; open a rescue task for the stalled lane instead of freezing all progress.
- If a checkpoint breaks `argent update`, fixing the update path becomes the next highest-priority dev checkpoint.

Every AppForge/Workflow handoff must start with:

```text
LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: pure core foundation work
```

## Threadmaster Coordination

Active core threadmasters must use `ops/THREADMASTER_COORDINATION.md` as the shared coordination board.

Before touching overlap zones, rebasing, committing, pushing, or handing off, read the board and update your lane entry or message section when your work changes shared contracts.

Use the threadmaster bus for targeted lane-to-lane messages:

```sh
pnpm threadmaster:post --from workflows --to appforge --subject "Need event contract" --body "Confirm payload fields before changing workflow resume logic."
pnpm threadmaster:list --lane workflows --unacked
pnpm threadmaster:ack --lane workflows --id <message-id>
pnpm threadmaster:task-add --from master --owner appforge --title "Next task" --body "Concrete next step."
pnpm threadmaster:task-list --lane appforge
pnpm threadmaster:status
```

Overlap zones include:

- Workflow runtime/canvas files
- AppForge model/adapter/gateway/UI files
- AOU/AOS connector manifests and capability surfaces
- Data schema or migration files
- Any `ops/**` report that creates cross-lane implementation work

Do not rely on the operator to relay routine lane status between active threadmasters. Put durable status in the coordination board, then reference deeper handoff docs when needed.
