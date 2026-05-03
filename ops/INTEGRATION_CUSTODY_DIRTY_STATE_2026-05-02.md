# Integration Custody Dirty-State Ledger - 2026-05-02

Status: STOP-THE-LINE active

Master issued bus freeze `tm-20260502114443-xlum8h`.

Latest custody update: Master has staged the first three clean packets onto
`origin/codex/master-custody-20260502` and kept the shared checkout frozen.

## Shared Checkout Snapshot

- Repo: `ArgentAIOS/argentos-core`
- Path: `/Users/sem/code/argent-core`
- Current branch: `codex/workflow-docpanel-envelope-sanitize`
- Origin: `git@github.com:ArgentAIOS/argentos-core.git`
- Target branch: `dev`
- Current HEAD: `30511803`
- Current `origin/dev`: `7cfdc4f5`
- Divergence from `origin/dev`: `1` ahead / `43` behind
- Dirty tracked files: `106`
- Untracked files: `6`
- Diff size: `3347 insertions`, `401 deletions`

This checkout is no longer safe for new feature edits. It is now Master custody only until every dirty path is claimed, preserved, routed, or deliberately abandoned with proof.

## Immediate Rules

1. No new feature edits in `/Users/sem/code/argent-core`.
2. Implementation must happen in lane-specific worktrees.
3. No `dev` merge from this mixed dirty checkout.
4. No reset/revert/delete of another lane's work.
5. Every dirty slice must become one of:
   - `claim-ready`
   - `claim-wip`
   - `claim-stash`
   - `claim-abandon`
   - `master-quarantine`
6. Every merge packet must be clean, rebased, verified, and dev-versioned.

## Dirty Ownership Draft

### Master Coordination

Likely owner: Master

Paths:
- `ops/THREADMASTER_COORDINATION.md`
- `ops/threadmaster-bus/acks.json`
- `ops/threadmaster-bus/messages.jsonl`
- `ops/threadmaster-bus/tasks.json`

Current action:
- Keep as coordination packet material.
- Commit only after the dirty-state ledger and bus freeze are complete.
- Do not mix with feature code.

Merge path:
- Coordination-only custody commit or staging branch, then `dev` with package version bump if pushed.

### Workflows

Likely owner: Workflows

Paths:
- `dashboard/src/components/widgets/WorkflowsWidget.tsx`
- `src/gateway/server-methods/workflows.schedule-cron.test.ts`
- `src/gateway/server-methods/workflows.ts`
- `src/infra/workflow-builder.test.ts`
- `src/infra/workflow-builder.ts`
- `src/infra/workflow-normalize.test.ts`
- `src/infra/workflow-normalize.ts`
- `src/infra/workflow-owner-operator-templates.ts`
- `src/infra/workflow-package.test.ts`
- `src/infra/workflow-runner.test.ts`
- `src/infra/workflow-runner.ts`
- `src/infra/workflow-types.ts`

Current action:
- Workflows must claim these exact files as `READY`, `WIP`, `STASH`, or `ABANDON`.
- If the live work has moved to `/Users/sem/code/argent-core-worktrees/workflows-rust-canary`, confirm whether these dirty shared-checkout edits are superseded.

Merge path:
- Recreate or cherry-pick the wanted slice into a clean Workflows worktree based on latest `origin/dev`.
- Submit clean READY packet to Master.

### AOS / QuickBooks

Likely owner: AOS

Paths:
- `tools/aos/aos-quickbooks/README.md`
- `tools/aos/aos-quickbooks/agent-harness/README.md`
- `tools/aos/aos-quickbooks/agent-harness/cli_aos/quickbooks/runtime.py`
- `tools/aos/aos-quickbooks/agent-harness/cli_aos/quickbooks/service_keys.py`
- `tools/aos/aos-quickbooks/agent-harness/tests/test_cli.py`
- `tools/aos/aos-quickbooks/connector.json`
- `tools/aos/readiness-index.json`
- `tools/aos/readiness-index.mjs`

Current action:
- AOS already posted READY `tm-20260502104944-itlkbb`.
- Master must review whether this shared-checkout dirty state matches the READY packet or has drift.

Merge path:
- If valid, move into clean AOS custody worktree and merge as focused QuickBooks setup contract packet.
- If superseded, preserve patch and abandon shared checkout copy after proof.

### Agent Runtime / Agent Persona / Harness Debt

Likely owner: Agent Persona or Master debt lane, depending on claim.

Paths include:
- `src/agents/**`
- `src/argent-agent/**`
- `src/config/**`
- `src/connectors/**`
- `src/data/**`
- `src/gateway/**` except Workflows-specific files
- `src/infra/contemplation-runner.ts`
- `src/infra/dispatch-contracts.ts`
- `src/infra/pg-secret-store.ts`
- `src/infra/secret-audit.ts`
- `src/infra/sis-runner.ts`
- `src/media/input-files.ts`
- `src/memory/**`
- `src/telegram/**`
- `src/tui/**`
- `src/utils/agent-fetch.demo.ts`
- `src/wizard/onboarding.local-runtime.ts`

Current action:
- Agent Persona must claim any profile/actionability/harness files it owns.
- Master debt lane must classify the rest before cleanup.
- No broad TypeScript cleanup in shared checkout.

Merge path:
- Split into small root-cause packets:
  1. actionability/no-lip-service guardrails
  2. memory/tool evidence validation
  3. repo-wide type cleanup
  4. unrelated runtime fixes

### Business Boundary / Quarantine

Likely owner: Master quarantine until Business/Core boundary is clarified.

Untracked paths:
- `src/infra/exec-approval-forwarder.ts`
- `src/infra/execution-worker-runner.ts`
- `src/infra/intent-simulation-runner.ts`
- `src/infra/intent-simulation-scenarios-t1.ts`

Current action:
- Treat as suspect Business-overlay leakage into Core until proven otherwise.
- Business overlay task `task-20260502105457-naln9e` should determine whether these belong in `/Users/sem/code/ArgentOS-Business`.

Merge path:
- Do not add to Core without explicit Core C1-C5 approval and tests.
- If Business-owned, move/keep them in Business overlay repo, not Core.

### Untracked Type Declarations

Likely owner: Master debt lane or owning feature lane.

Untracked paths:
- `src/types/coinbase-agentkit.d.ts`
- `src/types/pi-ai-google-shared.d.ts`

Current action:
- Identify which TypeScript errors they address.
- Do not add unless the corresponding package/API surface is still required and tested.

Merge path:
- Small debt packet with failing TypeScript evidence and passing proof.

## Active Worktrees Observed

Representative active worktrees include:
- `/Users/sem/code/argent-core-agent-persona-ui`
- `/Users/sem/code/argent-core-rust-spine`
- `/Users/sem/code/argent-core-worktrees/workflows-rust-canary`
- `/Users/sem/code/argent-core/worktrees/appforge-phase3b-view-field-hardening`
- many older AOS/AppForge/Workflows custody worktrees

### Master Custody Branch

Clean custody worktree:
- Path: `/Users/sem/code/argent-core-worktrees/master-custody-20260502`
- Branch: `codex/master-custody-20260502`
- Base: `origin/dev` `7cfdc4f5`
- Remote: `origin/codex/master-custody-20260502`
- Current staged custody head: `f770447e`
- Divergence from `origin/dev`: `15` ahead / `0` behind
- Dirty status after push: clean

Staged packets:
- Workflows runtime/canary hardening: `e441ebca`
- AOS QuickBooks setup contract: `454c9370`
- Rust gateway/kernel shadow parity and authority-status proof: `dbdaaac2`
- Missing Core infra module debt slice: `f770447e`

Rust custody proof rerun:
- Targeted Rust gateway/status/parity Vitest: `15` files, `76` passed, `1` skipped.
- `cargo test --manifest-path rust/Cargo.toml -p argentd`: `48` tests passed.
- `pnpm rust-gateway:parity:report -- --output-dir .omx/state/rust-gateway-parity/latest --startup-timeout-ms 30000 --request-timeout-ms 8000 --json-summary`: `17` passed, `0` failed, `3` skipped, `promotionReady=false`, `blockers=0`, `warnings=9`.
- `oxfmt`, `oxlint`, `git diff --check`, and `pnpm check:repo-lane` passed.

Rust safety stance:
- Node remains live gateway/scheduler/workflow/channel/session/run authority.
- Rust remains shadow-only.
- No connector-backed execution, OAuth/API credentials, or live external authority promotion was used.

First debt slice proof:
- Clean branch: `codex/debt-missing-infra-modules`
- Branch commit: `703cdaf7`
- Staged custody commit: `f770447e`
- Files: `src/infra/exec-approval-forwarder.ts`, `src/infra/execution-worker-runner.ts`, `src/infra/intent-simulation-runner.ts`, `src/infra/intent-simulation-scenarios-t1.ts`
- Focused Vitest: `5` files, `23` tests passed.
- `oxfmt`, `oxlint`, `git diff --check`, and `pnpm check:repo-lane` passed.
- `pnpm tsgo` still exits `2`, but parsed errors dropped from `264` to `259`; missing-module errors for `exec-approval-forwarder`, `execution-worker-runner`, and `intent-simulation` are cleared.

This branch is a custody/integration branch, not a `dev` push. A later `dev`
merge still requires latest `origin/dev`, version bump, final focused proof, and
explicit operator/Master merge decision.

### AppForge Phase 3B Checkpoint

Checkpoint `tm-20260502125122-8cipjx` was received and accepted by Master.

- Worktree: `/Users/sem/code/argent-core/worktrees/appforge-phase3b-view-field-hardening`
- Branch: `codex/appforge-phase3b-view-field-hardening`
- Base: `origin/dev` `7cfdc4f5`
- Divergence from `origin/dev`: `0` ahead / `0` behind
- State: WIP, not READY
- Master response: `tm-20260502125433-ioajrg`

Resume is allowed only in the dedicated AppForge worktree above. The shared checkout remains `CUSTODY_ONLY`.

Next AppForge requirement:
- Fix browser-created durable saved-view metadata persistence.
- Prove Leads/Accounts/Deals/Activities saved views persist after close/reopen with dashboard/browser evidence plus DB/query proof.
- Submit a clean READY packet with exact files, generated proof output, focused tests, dashboard typecheck, formatting/lint/diff/repo-lane status, known gaps, and merge target.

Follow-up proof checkpoint `tm-20260502133453-e7c0i3` was received and
accepted by Master.

Observed AppForge state:
- Worktree: `/Users/sem/code/argent-core/worktrees/appforge-phase3b-view-field-hardening`
- Branch: `codex/appforge-phase3b-view-field-hardening`
- Base: `origin/dev` `7cfdc4f5`
- Divergence from `origin/dev`: `0` ahead / `0` behind
- State: WIP, not READY
- Dirty tracked files: `9` AppForge/bus files
- Untracked proof output: `output/`

Proof reported by AppForge:
- Durable saved-view metadata persistence now passes after close/reopen.
- Browser proof used dedicated gateway `ws://127.0.0.1:19001` and dashboard `http://127.0.0.1:8092/?token=phase3a-smoke`.
- DB proof shows real base `base-e0897a0d-72ff-4cd9-a4e7-7553cf5952c5` and durable views for Leads, Accounts, Deals, and Activities.
- RPC proof shows `appforge.bases.list` and `appforge.tables.list` resolving real base/table IDs.
- Focused AppForge Vitest: `5` files, `51` tests passed.
- Dashboard `tsc --noEmit`, `oxlint --type-aware`, `oxfmt --check`, `pnpm check:repo-lane`, and `git diff --check` passed.

Master response `tm-20260502135609-1b1yj1`:
- Proceed to clean commit/READY in the dedicated AppForge worktree only.
- Do not commit `ops/threadmaster-bus/messages.jsonl`.
- Keep raw `output/playwright` artifacts uncommitted unless AppForge creates a concise proof summary doc.
- READY must cite browser/DB/RPC proof paths and include exact verification output.

Some worktrees are marked prunable:
- `/private/tmp/argent-core-openclaw-realtime-fake`
- `/private/tmp/argent-core-remove-legacy-control-ui`

No worktree pruning is authorized by this ledger. Pruning requires explicit owner confirmation or Master approval.

## Dev Merge Path

1. Freeze shared checkout.
2. Preserve this ledger and current bus/task updates.
3. Require lane CLAIM messages for dirty paths.
4. Build clean lane packets in worktrees based on latest `origin/dev`.
5. Use Master integration branch only when multiple packets must converge before `dev`.
6. Before each `dev` push:
   - fetch latest `origin/dev`
   - compute next `package.json` dev version
   - run required focused tests
   - run `pnpm check:repo-lane`
   - run formatting/diff checks
   - push only clean packet

Anything unclaimed becomes Master quarantine, not a silent merge candidate.

## Permanent Prevention Proposal

This incident should not become a recurring ritual. The permanent fix is mechanical enforcement, not another reminder.

### Guardrail 1: Shared Checkout Admission Control

`/Users/sem/code/argent-core` should be treated as a custody checkout. Implementation agents may not start feature edits there.

Allowed in the shared checkout:
- Threadmaster bus reads/writes
- coordination docs
- custody ledgers
- final integration review
- clean merge/version-bump packets

Forbidden in the shared checkout:
- feature implementation
- exploratory generated files
- mixed-lane WIP
- long-running autonomous loops

### Guardrail 2: Worktree Ticket Required

Every implementation lane must declare before edits:

```text
worktree:
branch:
base:
owner:
task:
allowed paths:
forbidden paths:
resume token:
```

If an agent cannot provide this, it does not get to edit.

### Guardrail 3: Dirty Sentinel

Master custody should run a recurring sentinel that checks:

```sh
git -C /Users/sem/code/argent-core status --porcelain=v1
git -C /Users/sem/code/argent-core rev-list --left-right --count HEAD...origin/dev
git -C /Users/sem/code/argent-core worktree list
```

Escalation thresholds:
- Any non-ops dirty file in shared checkout: immediate bus STOP for the suspected owner.
- More than five dirty tracked files in shared checkout: freeze new implementation lanes.
- Shared checkout branch behind `origin/dev` while dirty: no merge work until ledger is updated.
- Any untracked `src/**` file in shared checkout: quarantine until owner claims it.

### Guardrail 4: Automation Mode Split

Lane automations must have two modes:
- `ACTIVE_IMPLEMENTATION`: may edit only inside declared worktree and allowed paths.
- `CUSTODY_ONLY`: may read status, post bus messages, and checkpoint, but may not edit.

During any dirty-state incident, Master flips active implementation automations to `CUSTODY_ONLY` or `PAUSED`.

### Guardrail 5: READY Packet Contract

No READY packet is reviewable without:

```text
worktree path:
branch:
base commit:
ahead/behind:
dirty status:
changed files:
tests:
format/lint/type status:
known gaps:
merge target:
dev version needed:
```

### Guardrail 6: Unclaimed Work Quarantine

Unclaimed dirty files are never merged by assumption. They go to Master quarantine and are either:
- claimed by owner,
- preserved as a patch/stash,
- moved to the correct repo/worktree,
- or abandoned with proof.

### Guardrail 7: Daily Custody Closeout

At least once per active day, Master posts:
- active branches/worktrees,
- dirty status by lane,
- READY packets awaiting review,
- blocked packets with owners,
- packets merged to `dev`,
- quarantine items.

## Proof Commands Run

```sh
git status --porcelain=v1
git rev-list --left-right --count HEAD...origin/dev
git worktree list
git diff --stat
git ls-files --others --exclude-standard
git remote get-url origin
pwd
git rev-parse --abbrev-ref HEAD
pnpm check:repo-lane
pnpm threadmaster:status
```
