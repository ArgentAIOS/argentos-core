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
