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
