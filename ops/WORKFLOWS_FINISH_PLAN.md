# Workflows — Finish-Line Plan

**Author:** workflows-finish-audit (read-only audit, no source changes)
**Date:** 2026-05-11
**Branch:** `orchestrator-master-2026-05-06` (HEAD `d922ef9c`)
**Scope:** Workflows subsystem — inventory, gap analysis, recommended next 1–3 PRs.

## TL;DR

Workflows is **further along than it feels** — the TS implementation is mature
(27 gateway methods, 48-test runner suite, 24 owner-operator templates, full
CRUD/run/approval surface, dashboard widget at 11k lines wiring 26 of those
methods). The "not finished" feeling traces to three real gaps that **are**
shipping-blockers:

1. **Live-readiness is intentionally locked closed for every template.** No
   template currently has `okForLive: true`. Jason cannot, today, click "Run
   live" on Morning Brief and have it deliver. This is by design (credentials +
   canary proof required) but the _path off the gate_ is undocumented.
2. **Rust shadow is one method deep.** Current branch has only
   `workflows.list` in `rust/argentd/src/ws.rs`. The `backendStatus`, `dryRun`,
   `templates.list`, `templates.get` ports exist on **unmerged** dev branches
   (`0c9ceabb`, `d2102f88`) — they descend from HEAD, not the other way
   around. So "Rust shadow → authority" is not 3 PRs away, it's ~20.
3. **No browser-rendered E2E.** The Morning Brief proof
   (`docs/workflows/morning-brief-e2e-proof-2026-05-02.md`) explicitly defers
   "canvas screenshot, run history, DocPanel artifact, Telegram receipt" to a
   Playwright pass that has never landed. Programmatic dry-run is green; the
   "Jason actually builds and runs from the dashboard" path is unproven.

**Recommended sequencing:** finish the user-visible path first (PR-1, PR-2),
then a single targeted Rust-shadow batch (PR-3). Rust → authority is a
multi-month arc not appropriate for this finish-line slice.

---

## 1. Inventory

### 1.1 Gateway-exposed methods (`src/gateway/server-methods/workflows.ts`)

27 handlers registered under `workflowsHandlers`:

| Method                        | TS impl | Dashboard uses           | Test file                                        | Rust shadow                              |
| ----------------------------- | ------- | ------------------------ | ------------------------------------------------ | ---------------------------------------- |
| `workflows.backendStatus`     | ✅      | —                        | `workflows.backend-status.test.ts`               | shadow (unmerged `0c9ceabb`)             |
| `workflows.templates.list`    | ✅      | ✅                       | — (covered via `workflow-package.test.ts`)       | shadow (unmerged `d2102f88`)             |
| `workflows.templates.get`     | ✅      | ✅                       | —                                                | shadow (unmerged `d2102f88`)             |
| `workflows.importPreview`     | ✅      | ✅                       | `workflows.import.test.ts`                       | TS-only                                  |
| `workflows.create`            | ✅      | ✅                       | `workflows.list.test.ts` (coverage)              | TS-only                                  |
| `workflows.update`            | ✅      | ✅                       | covered indirectly                               | TS-only                                  |
| `workflows.get`               | ✅      | ✅                       | `workflows.resolve.test.ts`                      | TS-only                                  |
| `workflows.list`              | ✅      | ✅                       | `workflows.list.test.ts`                         | **SHIPPED shadow** (`workflows.list` ✅) |
| `workflows.delete`            | ✅      | ✅                       | —                                                | TS-only                                  |
| `workflows.duplicate`         | ✅      | ✅                       | —                                                | TS-only                                  |
| `workflows.versions.list`     | ✅      | ✅                       | —                                                | TS-only                                  |
| `workflows.versions.restore`  | ✅      | ✅                       | —                                                | TS-only                                  |
| `workflows.validate`          | ✅      | —                        | covered via runner tests                         | TS-only                                  |
| `workflows.dryRun`            | ✅      | (indirect via templates) | `workflows.dry-run.test.ts`                      | shadow (unmerged `d2102f88`)             |
| `workflows.draft`             | ✅      | ✅                       | —                                                | TS-only                                  |
| `workflows.cancel`            | ✅      | —                        | —                                                | TS-only                                  |
| `workflows.resume`            | ✅      | —                        | —                                                | TS-only                                  |
| `workflows.run`               | ✅      | ✅                       | `workflows.run-detail.test.ts`                   | TS-only                                  |
| `workflows.runs.list`         | ✅      | ✅                       | —                                                | TS-only                                  |
| `workflows.runs.get`          | ✅      | ✅                       | `workflows.run-detail.test.ts`                   | TS-only                                  |
| `workflows.connectors`        | ✅      | ✅                       | `workflows.output-channels.test.ts`              | TS-only                                  |
| `workflows.capabilities`      | ✅      | —                        | covered                                          | TS-only                                  |
| `workflows.subscribe`         | ✅      | ✅                       | —                                                | TS-only                                  |
| `workflows.emitEvent`         | ✅      | —                        | `workflows.appforge-events.test.ts`              | TS-only                                  |
| `workflows.emitAppForgeEvent` | ✅      | —                        | `workflows.appforge-events.test.ts`              | TS-only                                  |
| `workflows.approve`           | ✅      | ✅                       | `workflows.approve.test.ts` (in approvals suite) | TS-only                                  |
| `workflows.deny`              | ✅      | ✅                       | covered in approvals                             | TS-only                                  |
| `workflows.pendingApprovals`  | ✅      | —                        | covered                                          | TS-only                                  |
| `workflows.manifest`          | ✅      | —                        | —                                                | TS-only                                  |
| `workflows.connectorCommand`  | ✅      | —                        | `workflows.connector-command.test.ts`            | TS-only                                  |

**Net status:** **all 27 methods SHIPPED in TS.** **1 method SHIPPED in Rust shadow on this branch** (`workflows.list`). 4 more ported in unmerged commits.

### 1.2 Core implementation files

| File                                                      | Lines | Purpose                                                              |
| --------------------------------------------------------- | ----- | -------------------------------------------------------------------- |
| `src/infra/workflow-runner.ts`                            | 4200  | DAG runner, retries, gates, approvals, podcast/agent/output dispatch |
| `src/infra/workflow-runner.test.ts`                       | —     | **48 unit tests, all passing**                                       |
| `src/infra/workflow-execution-service.ts`                 | 1291  | Run lifecycle, persistence, telemetry aggregation                    |
| `src/infra/workflow-builder.ts`                           | 806   | AI-draft canvas → executable graph                                   |
| `src/infra/workflow-types.ts`                             | 654   | Node/edge/run/status types                                           |
| `src/infra/workflow-package.ts`                           | —     | Template package + `auditWorkflowPackageLiveReadiness`               |
| `src/infra/workflow-owner-operator-templates.ts`          | 1364  | **24 built-in templates**                                            |
| `src/infra/workflow-approvals.ts`                         | —     | Approval queue, notifier                                             |
| `src/infra/workflow-rust-canary-fixtures.ts`              | 490   | Shadow-parity fixture contract                                       |
| `src/gateway/server-methods/workflows.ts`                 | 4358  | All 27 handlers + helpers                                            |
| `src/gateway/server-methods/workflows.dry-run-recipes.ts` | 77    | `buildMorningBriefDryRunRecipe()`                                    |
| `src/security/audit-workflows.ts`                         | —     | RBAC/owner audit                                                     |

### 1.3 Dashboard UI

| File                                                        | Lines     | Wires                                                          |
| ----------------------------------------------------------- | --------- | -------------------------------------------------------------- |
| `dashboard/src/components/widgets/WorkflowsWidget.tsx`      | **11062** | 26 of 27 workflows.\* methods + version-restore + approve/deny |
| `dashboard/src/components/widgets/WorkflowMapCanvas.tsx`    | 1112      | Live Workflow Map widget (read-only)                           |
| `dashboard/src/components/workflows/ConnectorNodePanel.tsx` | 1034      | Per-node connector binding                                     |
| `dashboard/src/components/workflows/ExpressionEditor.tsx`   | 587       | Conditional expressions                                        |
| `dashboard/src/components/workflows/DynamicPicker.tsx`      | 561       | Live-binding picker                                            |
| `dashboard/src/components/workflows/CredentialSelector.tsx` | 481       | Credentials wiring                                             |
| `dashboard/src/components/workflows/IOPreviewPanel.tsx`     | 417       | Step IO inspection                                             |
| `dashboard/src/components/workflows/SafetyPanel.tsx`        | 327       | Live-readiness display                                         |

Mounted into `dashboard/src/App.tsx` under Operations → Workflows tab; also
mountable via `?widget=workflows-widget` deep-link (`8c715a88`).

### 1.4 Templates

24 owner-operator template packages in `workflow-owner-operator-templates.ts`:
`ai-morning-brief-podcast`, `daily-marketing-brief`, `social-post-generator`,
`newsletter-builder`, `lead-magnet-follow-up`, `vip-email-alert`,
`content-repurposing`, `crm-lead-scoring`, `sales-follow-up-reminder`,
`invoice-follow-up`, `client-onboarding`, `candidate-intake`, `interview-prep`,
`employee-onboarding`, `support-triage`, `review-request`,
`monthly-owner-report`, `operations-cleanup`, `abandoned-cart-recovery`,
`job-offer-draft`, `webinar-follow-up`, and 3 more.

All templates default to `okForLive: false` + `status: "dry_run_only"` until
credentials are bound and a canary proof is captured.

### 1.5 Tests (workflow-touching)

- `workflow-runner.test.ts` (48 tests, runner DAG + gates + retries + DocPanel envelope)
- `workflow-execution-service.test.ts` + `.operator-alert.test.ts`
- `workflow-builder.test.ts`
- `workflow-package.test.ts` (template + live-readiness + Morning Brief)
- `workflow-approvals.test.ts`
- `workflow-action-capabilities.test.ts`
- `workflow-context.test.ts`
- `workflow-rust-canary-fixtures.test.ts` (shadow contract)
- `workflow-types.test.ts`, `workflow-normalize.test.ts`
- 14 `src/gateway/server-methods/workflows.*.test.ts` handler tests
- `audit-workflows.test.ts`
- Rust: `rust/argentd/tests/ws_parity.rs` (asserts `workflows.list` echoes the no-live-data snapshot fixture)
- **No Playwright/browser test for any workflow path.**

### 1.6 Rust shadow surface (current HEAD)

`rust/argentd/src/ws.rs` line 556:

```rust
"workflows.list" => { send_text_frame(... workflows_list_payload_json() ...) }
```

That's it. `http.rs::workflows_list_payload_json()` returns one shadow row +
the `snapshot.authority: "node-live-rust-shadow"` parity envelope. The
capabilities advertisement on `/status` correctly reports
`"workflowAuthority": false, "schedulerAuthority": false`.

The `backendStatus`, `dryRun`, `templates.list`, `templates.get` ports
authored by Codex on May 6 (commits `0c9ceabb`, `d2102f88`) are on
`bump-dev11`/`bump-dev16` and related dev-bump branches and have **not** been
merged into this orchestrator branch. `git merge-base --is-ancestor` confirms
they descend from HEAD, not the inverse.

---

## 2. Gap Analysis

### 2.1 Finish-line gaps (user-visible)

1. **Live-run path is locked for all templates.** `okForLive=false` everywhere.
   Two blockers compound:
   - Required live bindings (e.g., ElevenLabs + Telegram for Morning Brief) gated
   - "Required canary proof before live promotion" — there's no documented operator step
     that produces this proof or flips the gate to `true`.
2. **No "build from scratch in the dashboard, save, run, see output" smoke.**
   The widget supports it (`workflows.create` → `workflows.update` → `workflows.run`
   → `workflows.runs.get`) but no test or proof artifact exercises that path.
3. **Schedule cron firing is unit-tested but not end-to-end.** Tests assert cron
   _jobs are added/updated/removed_, not that "cron fires → workflow run starts → step
   ledger records output." That's the operator's mental model of "scheduled
   workflow works."
4. **Approval gate UI works, but no proof a denied/approved run actually resumes
   step execution end-to-end in the browser.** Runner unit test covers it; UI does not.
5. **Manifest + connectorCommand handlers exist but no dashboard surface.**
   Likely operator-only / API consumer — confirm with Jason if any UI is needed.

### 2.2 Rust-shadow gaps (promotion path)

1. **26 of 27 methods are TS-only in the current branch.** Even after the
   unmerged dev-bump batch lands, that's 22 still TS-only — and they include the
   write methods (`create`, `update`, `delete`, `run`, `approve`) that gate
   authority promotion.
2. **No mutation parity proof.** `rust-gateway-parity-report.ts` lists
   `workflows.list` as `readOnlyUnproven`. Write methods aren't even on the
   parity tracker yet.
3. **No shadow-runs-mutated proof.** Rust would need to replay a real workflow
   run against a fixture and produce an identical step ledger envelope to TS.
   `buildWorkflowRustShadowFixturePack()` defines 7 fixture cases but only `list`
   is wired through a Rust handler.

**Promotion realistically requires:** port read methods (~8 more), port write
methods with idempotency proofs (~10), wire scheduler-lease handoff (the
`workflows-rust-spine-scheduler-lease-20260503` worktree explored this),
parity-prove every run-state transition. Multi-month arc — **not** in the
finish-line slice.

### 2.3 Half-shipped / ambiguous

- **`workflows.manifest`** — handler exists, no dashboard consumer, no test
  file. Either prove a consumer or back it out.
- **`workflows.connectorCommand`** — handler exists, test exists, no dashboard
  consumer. Decide: ship as documented API, or hide.
- **Workflow Map widget vs Workflows widget** — both mounted, partially
  overlapping. Workflow Map is read-only; Workflows is the editor. Document
  this so operators know which to use.
- **Dry-run autosave** (`codex/workflow-dry-run-autosave-repair` branch
  unmerged) — unclear if this is needed for finish line.

---

## 3. Recommended Next 1–3 PRs

### PR-1 — Workflows browser E2E smoke (Playwright)

**Scope:** Add a Playwright spec that proves "Jason can build, save, and
dry-run a workflow from the dashboard end-to-end." Covers the operator
mental model the current programmatic-only proof does not.

**Files:**

- New `dashboard/tests/e2e/workflows-build-and-run.spec.ts` (Playwright)
- New `scripts/e2e/workflows-build-and-run.sh` (CI hook)
- New `docs/workflows/build-and-run-e2e-proof-2026-05-XX.md` (artifact)
- Capture: canvas screenshot, run history row, DocPanel artifact, fixture
  output for Morning Brief and one minimal Trigger→Agent→Output.

**Tests:**

- Mount `?widget=workflows-widget`, click New, import Morning Brief template,
  click Run fixture, assert all 12 nodes ledger green.
- Build a 3-node Trigger→Agent→DocPanel from scratch, save, run fixture, assert
  DocPanel output rendered.

**DOD:** Both flows green in CI on dev. Browser screenshot artifacts persisted.
The "deferred" section of `morning-brief-e2e-proof-2026-05-02.md` resolved.

**Depends on:** Nothing (TS + dashboard already supports both flows).

**Why first:** Closes the most expensive perception gap. Jason will _see_
workflows finished after this PR.

---

### PR-2 — Live-readiness operator path (one template, one canary)

**Scope:** Document and ship the operator path that flips one template
(`vip-email-alert` — fewest blockers, single Telegram connector) from
`okForLive=false` to live-run-ready, with a captured canary receipt.

**Files:**

- `src/infra/workflow-package.ts` — surface the **specific** missing-binding
  list per template via `liveReadiness.requiredBindings[]` (likely already
  partially present — promote to explicit operator contract)
- `dashboard/src/components/workflows/SafetyPanel.tsx` — render the binding
  checklist as actionable rows ("Bind Telegram credential →") instead of an
  opaque "live blocked" message
- New `scripts/workflows/canary-proof-capture.ts` — operator-runnable script
  that runs a workflow against a pinned-canary connector and stores the proof
  receipt
- New `docs/workflows/live-promotion-operator-runbook.md` — step-by-step
  ("bind → canary → promote")
- New test `src/gateway/server-methods/workflows.live-promotion.test.ts`

**Tests:** Assert that with a valid Telegram credential bound and a captured
canary receipt, `evaluateWorkflowLiveRunGate()` returns `okForLive: true` for
`vip-email-alert`.

**DOD:** One template end-to-end live-runnable. Runbook documents the path so
the other 23 templates can follow without re-deriving it.

**Depends on:** Nothing (`evaluateWorkflowLiveRunGate` and credential model
both exist).

**Why second:** This is the answer to "Jason can trust a workflow end-to-end."
Without this, every template is a museum piece.

---

### PR-3 — Rust shadow batch land + parity-tracker promotion

**Scope:** Merge the unmerged Rust shadow ports (`0c9ceabb`, `d2102f88`) into
the main lane and add them to the parity tracker.

**Files:**

- Cherry-pick / re-author into a clean PR off `dev`:
  - `rust/argentd/src/ws.rs` — add `workflows.backendStatus`,
    `workflows.dryRun`, `workflows.templates.list`, `workflows.templates.get`
  - `rust/argentd/src/http.rs` — payload JSON helpers
  - `rust/argentd/tests/ws_parity.rs` — black-box parity tests for each
- `src/infra/rust-gateway-parity-fixtures.test.ts` — add the four methods to
  the supported list
- `src/infra/rust-gateway-parity-report.test.ts` — move from `unsupported` to
  `readOnlyUnproven`/`readOnlyProven` as appropriate

**Tests:** Black-box ws_parity (Rust) + parity-report tracker (TS).

**DOD:** Rust shadow honestly handles 5 workflows.\* read methods. Parity
report reflects reality.

**Depends on:** Nothing (commits already authored; just need merge + parity
tracker update).

**Why third:** Lowest user-visible value; clears a misleading status (the
commits exist but aren't on the trunk this branch reads as authoritative). Do
not block PR-1 or PR-2 on this.

---

## 4. Risks

1. **Playwright dependency footprint.** PR-1 introduces a browser harness if
   one isn't already established in `dashboard/tests/`. Check
   `dashboard/tests/` (`api-server.test.cjs` etc. — currently CJS, no
   Playwright). Adding Playwright is a meaningful infra commitment.
2. **Canary-proof storage contract not yet defined.** PR-2 needs to decide
   where canary receipts live (DocPanel? `workflow_runs` metadata? dedicated
   table?). Resolve before coding.
3. **Rust shadow drift.** With ~20 worktrees containing partial shadow ports,
   PR-3 needs to confirm the merged batch is the canonical one and the others
   can be deleted. Don't accumulate more shadow-batch branches.
4. **Live promotion side-effect risk.** PR-2 ships the path to _actually send
   Telegram messages from a live workflow run._ Jason needs to explicitly
   sign off on the canary connector identity + a kill-switch path before this
   merges.

---

## 5. Open Questions for Jason

1. **PR-2 template choice.** `vip-email-alert` is the simplest. Acceptable, or
   prefer Morning Brief (more blockers, bigger demo)?
2. **Canary receipt storage** — DocPanel-only is simplest. Acceptable, or do
   you want a dedicated `workflow_canary_proofs` table?
3. **Manifest + connectorCommand handlers** — keep, document, or remove? They
   have no dashboard surface today.
4. **Rust authority promotion timeline** — confirm this is _not_ part of the
   finish-line slice. The audit recommends shipping read-shadow parity (PR-3)
   and explicitly deferring authority promotion to a separate multi-month arc.
5. **Are the `bump-dev11`/`bump-dev16` branches (containing the Rust shadow
   ports) abandoned, or is there a release-train PR that's supposed to land
   them?** PR #212 (dev→main 11 days of work) is open — confirm the shadow
   ports are inside that train.

---

## 6. Flagged Follow-ups (for contract A)

- [ ] **GH issue:** "Workflows: 20+ stale `codex/workflow-*` and
      `workflows-*` worktrees / branches — audit and prune." Examples:
      `workflow-dry-run-autosave-repair`, `workflow-jsonb-persistence-repair`,
      `workflow-manage-modal`, `workflow-modal-telegram-target-repair`, etc.
      These are either landed-and-stale or abandoned.
- [ ] **GH issue:** "Workflow Map widget vs Workflows widget — document the
      split or merge." Operators currently have two ops surfaces with overlapping
      intent.
- [ ] **GH issue:** "Rust shadow ports for `workflows.{backendStatus,dryRun,
templates.list,templates.get}` exist on unmerged dev-bump branches —
      consolidate into one shadow-batch PR." (PR-3 above resolves this; the
      follow-up is to delete the dead branches.)
- [ ] **GH issue:** "Document operator path to flip `okForLive=true` for any
      template — currently no runbook." (PR-2 above resolves; follow-up is to
      generalize beyond `vip-email-alert`.)
- [ ] **GH issue:** "Add Playwright harness to `dashboard/tests/` — currently
      CJS unit-only." (Needed for PR-1; broader value beyond workflows.)
