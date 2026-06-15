# Worker Runtime v2 — Design

**Date:** 2026-06-11 · **Status:** PROPOSED (awaiting Jason's review) · **Author:** Claude (design session)
**Supersedes:** nothing — v1 stays live until each phase lands. **Governs:** all worker-runtime work.
**Doctrine:** machine purrs first — every phase here is spine work (live jobs, clean local installs, fast turns), with a measured number as its exit criterion. No new operator-facing features.

---

## 1. Why v2 (evidence, not vibes)

v1 (`src/infra/execution-worker-runner-impl.ts`, 1493 lines, union-merged from Business on 2026-06-10) **works end-to-end** — the conductor demo proved cycle → pickup → simulate-enforcement → governance metadata on a real local LLM. What it proved equally well is where the architecture, not the code, is the limit:

| #   | Pain                                                                                                                                                                                  | Evidence                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Worker turns ship the **operator's whole world**: full 113-tool registry (~17k tokens of schema), operator session context, ~43k-token prompt total                                   | #442: LM Studio rejected with `n_keep 43019 vs n_ctx 4096`; #407 telemetry `tools=113` every turn                                                                                 |
| 2   | Local models **break format** under that load — textual pseudo-tool-calls, zero execution, auto-block                                                                                 | #442: gemma-4-12b + qwen3.6-35b both fail under the worker prompt but call tools fine on a plain turn. The #444 detector/nudge is a tripwire, not a fix                           |
| 3   | Tool policy is a **mutate-and-restore hack** on the shared session store (`withSessionToolPolicyOverride`, impl:721) — default-allow with a temporary deny coat, racy by construction | impl:721–773; violates the worker blank-slate law (workers get ONLY alignment + role contract + granted tools + granted knowledge, all else default-deny — incl. operator memory) |
| 4   | Progress is **inferred from board mutation** (`boardChanged` = updatedAt/status diff), which forced the "complete your own task row" SOP hack and gives weak acceptance               | #443: blanket "don't modify tasks" SOP blocked every run until step 5 was bent to mutate the worker's own row                                                                     |
| 5   | Lifecycle is **implicit**: no claim lease, no heartbeat, no alive-handshake, no hard kill; `runNow` silently no-ops while a blocked task gates the assignment                         | #445 (hit 3× in one evening); #425 (claim/heartbeat/halt missing); #423 items 3–5 (spawn-never-started, cancel timeout, board/worker state drift)                                 |

One sentence: **v1 runs workers as the operator wearing a costume; v2 runs workers as employees** — hired with a role contract, issued exactly the tools the role grants, leased a task, and judged on a filed report.

## 2. Design principles

1. **Blank-slate law is structural, not policy.** A worker session is _built up_ from nothing (alignment + role contract + grants), never _filtered down_ from the operator's session. If the law is enforced by subtraction, every new operator capability is a leak by default.
2. **Governance is the moat — keep it first-class.** simulate / limited-live / live enforcement, intent gating, review pipeline, relationship evaluation all survive v2 untouched. v2 changes _how a worker executes_, not _what it's allowed to do_.
3. **Small prompts are the product.** Client-site Mac minis with no cloud keys are the Titanium deployment story. A worker turn must fit a 12B local model comfortably. Every byte in the worker prompt must justify itself against the role.
4. **Every no-op surfaces a reason.** Silent success-that-did-nothing (#445) is banned at the design level: any skip, gate, or rejection writes a machine-readable reason to the run record.

## 3. v2 architecture

```
  Job template ──┐                       ┌──────────────────────────────┐
  (role contract,│   compile once,       │  ROLE PROFILE (cached)       │
   tool grants,  ├──────────────────────▶│  system prompt = alignment   │
   knowledge)    │   invalidate on edit  │   + role contract + mode SOP │
                 │                       │  tool registry = grants only │
  Assignment ────┘                       │   (+ work_report, always)    │
       │                                 └──────────────┬───────────────┘
       │  task created (orchestrator)                   │
       ▼                                                ▼
  ┌─────────┐  claim (CAS,   ┌─────────┐  ephemeral  ┌──────────────────┐
  │ queued  │───lease+TTL───▶│ claimed │──session───▶│ running          │
  └─────────┘                └─────────┘  per run    │  alive handshake │
       ▲                          │                  │  runner heartbeat│
       │  lease expiry            │ spawn fail       │  kill-flag checks│
       └──────────────────────────┴──────────────────└────────┬─────────┘
                                                              │ work_report
                                            ┌─────────────────┼─────────────┐
                                            ▼                 ▼             ▼
                                       completed         blocked(reason)  failed(reason)
                                            └──── review pipeline (unchanged) ────┘
```

Scheduler shape is **kept** from v1 (per-agent cadence, `dispatchNow`, `pause`/`resume`, no-progress auto-block) — it works. Everything between "task selected" and "outcome recorded" is rebuilt.

## 4. Decisions

### D1 — Workers run in ephemeral, role-scoped sessions, never the agent main session

Each run executes in a fresh session keyed `worker:<assignmentId>:<runId>`, constructed from the role profile (D2). No operator memory, no personal skills, no main-session history, no dashboard context. The session is discarded after the run; the run record is the durable artifact.

- **Seam:** the `sessions_spawn` machinery (`src/agents/tools/sessions-spawn-tool.ts`) already builds isolated sessions with explicit `toolsAllow`/`toolsDeny` grants — v2 reuses that path internally (runner-invoked, not tool-invoked) rather than inventing a second isolation mechanism.
- **Dies:** `withSessionToolPolicyOverride` (impl:721–773) and the whole save/mutate/restore dance on the shared session store.
- **Why not keep main-session + better filtering:** subtraction can't prove the law. Construction can — the worker session literally does not contain what wasn't granted.

### D2 — Role profile: compiled once per template, default-deny tool grants

A template compiles to a **role profile**: `{ systemPrompt, toolSchemas, knowledgePack }`.

- `systemPrompt` = company alignment block + rolePrompt + SOP + successDefinition + execution-mode directives + tool-use rules. Nothing else.
- `toolSchemas` = exactly `template.tools.grant[]`, resolved to native schemas, **plus `work_report` (D5), always**. Empty grant = worker can only file a report. There is no deny list because there is nothing to deny — default-deny is the resting state.
- `knowledgePack` = explicitly attached docs/skill content (granted knowledge). v2 ships with static attachments only; role-scoped memory is a later feature (purr first).
- Compiled profiles are **cached per template version** and invalidated on template edit — this also kills the per-turn registry rebuild cost (#406-class) for the worker lane.
- Asking for an ungranted tool returns a structured `tool_not_granted` error that lands in the run record as a governance signal — never a silent skip (#423 item 1's worker-lane analog).

**Measured target:** conductor-demo role = 3 schemas (`tasks`, `memory_recall`, `work_report`); worker turn prompt **≤ 8k tokens** (vs 43k today).

### D3 — Native tool-calling everywhere; prompted-text mode is an explicit, flagged fallback

The lmstudio/ollama/openai-compat provider path sends grants via the native `tools` API field (#442 ask 1). Prompted-tools text injection survives only as an explicit per-provider opt-in for servers that genuinely lack the field, and turns on a visible config flag. The #444 textual pseudo-call detector stays as **telemetry**: any hit on a native-tools provider is a provider-config bug, alerted as such.

### D4 — Lease-based claim / heartbeat / halt (resolves #425's layers 3–5, #423 items 4–5)

- **Claim:** atomic CAS `queued → claimed` setting `claimedBy=<runId>`, `claimTtl=now+TTL` (default 15 min). 0 rows updated = lost the race, pick next.
- **Heartbeat:** **the runner heartbeats, not the model** — TTL refresh every 60s while the provider call/tool loop is in flight. A wedged provider call stops the heartbeat naturally.
- **Alive handshake:** first token or tool call within N seconds (default 90s) else the run is marked `stalled` and surfaced — no more "spawned but zero messages" discovered by transcript archaeology.
- **Expiry:** lapsed lease → task returns to `queued`, attempt counter incremented (feeds the existing no-progress auto-block), reason `lease_expired` on the run record.
- **Halt:** cancel sets a kill flag checked between tool calls; after a grace period (default 30s) the session is terminated **without requiring worker ack**. Global kill switch: `workforce halt` = pause all agents + flag all in-flight runs.
- **Wakeup:** assignment/task-creation events fire `dispatchNow(agentId)` in-process (the orchestrator already sees these on its 5s poll); cadence remains the fallback. Assignment stops being "a row write that signals nothing" (#425 layer 3).

### D5 — `work_report` completion contract replaces boardChanged inference

Every worker ends its turn by calling `work_report({ outcome: done|blocked|need_input, summary, evidence[] })` — the one tool every role gets.

- **Acceptance** = report filed **and** consistent with observed telemetry (runner cross-checks: `done` on a live-mode write task with zero external tool executions → rejected with reason `report_telemetry_mismatch`).
- The **runner** updates the board from the report. Workers never mutate their own task row; the #443 "step 5: complete your own task" SOP hack is deleted, and read-only SOPs ("zero mutations to board") become honestly writable again.
- A turn ending with **no** report = no progress (existing counter), with reason `no_report` — strictly better signal than today's `boardChanged=false`.
- Small-local-model friendly: one well-known, trivially-schema'd call to finish, instead of "make the board look different."

### D6 — Explicit run state machine; every gate surfaces (resolves #445)

States: `queued → claimed → running → completed | blocked(reason) | failed(reason) | expired | stalled`, with `reviewStatus` orthogonal (unchanged).

- `runNow` on an assignment with an open blocked task **re-queues that blocked task as a fresh attempt by default** (operator intent is obviously "try again"), carries attempt history forward, and says so in its response. `runNow({ fresh: true })` abandons the blocked task (marked `superseded`) and cuts a new one. Silent OK-but-nothing is structurally impossible: the response names what it did.
- Every runner skip (agent busy, paused, gated, lease lost) appends `{ ts, gate, reason }` to the assignment's run log — the dashboard Workforce Board can render "why didn't this run" without log spelunking.

### D7 — Observability is part of the runtime, not a dashboard feature

Run record accrues lifecycle events: `claimed, spawned, alive, tool_call(name, granted|denied), heartbeat, report, killed, expired` — appended by the runner (single writer). `getStatus()` extends with per-run live state. This is the substrate #423's "diagnostic gap" items asked for; surfacing in the Workforce Board is a thin read.

### D8 — Model selection per role + runner-side escalation ladder _(added after Jason's first review pass, 2026-06-11)_

Today model choice is **per-agent** only: `agents.list[].executionWorker.model` (`provider/model` ref, impl:783–787, passed as `modelOverride` at impl:987). Templates have no say — every role an agent runs uses the same model.

v2 moves model choice into the **role profile** with a deterministic escalation ladder:

- `template.model?` — the role's primary model. Resolution order: `template.model` → agent `executionWorker.model` → gateway default. Narrow 3-schema roles point at local models (Mac mini gemma-class); wide or judgment-heavy roles point at DGX/cloud.
- `template.escalation?` — optional bigger fallback model. **The runner escalates, never the worker:** attempt 1 runs on the primary; if it ends in no-progress, `no_report`, or a textual pseudo-call detector hit, attempt 2 re-runs on the escalation model; then the existing auto-block. The escalation is a run event (`escalated: {from, to, reason}`) so cost is visible per run.
- Workers cannot choose or request models. Blank-slate law aside, a struggling 12B model is the worst available judge of its own inadequacy — the runner's no-progress signals are the honest trigger. This also keeps cost governance deterministic: an operator can read a template and know the worst-case model spend per attempt.
- Rule of thumb for routing (also a wizard hint): role grants ≤ ~8 tool schemas → local-model eligible; beyond that, primary should be DGX/cloud or the role should be split.

Phasing: profile `model` field rides P2 (role-profile compile); escalation ladder rides P3 (it hooks the attempt/lease machinery).

### What survives v1 unchanged

Scheduler/cadence + control API · simulate/limited-live enforcement · intent gate + system-prompt hint · review pipeline (`pending/approved/held/rolled-back`) · relationship evaluation · personal-skill candidate creation on completion · no-progress auto-block (now fed by lease attempts too).

### What dies

`withSessionToolPolicyOverride` · worker-on-main-session execution · boardChanged-as-progress · prompted-tools-by-default on openai-compat · the "complete your own task row" SOP requirement · default-allow tool posture for workers.

## 5. Data model deltas (additive only)

- `JobTemplate.tools: { grant: string[] }` (supersedes `toolsAllow`/`toolsDeny` for workers; old fields read as grants during migration), `JobTemplate.knowledge?: AttachmentRef[]`
- Task: `claimedBy?`, `claimTtl?`, `claimAcquiredAt?`, `attempt?`
- `JobRun`: `events: RunEvent[]`, `report?: WorkReport`, `gateReasons: GateReason[]`, state machine fields per D6
- New: compiled role-profile cache keyed `(templateId, templateVersion)`

## 6. Phasing — each independently shippable, conductor demo is the regression harness

| Phase                                                        | Contents                                                                                                                         | Exit criterion (measured)                                                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 (interim, ships now)**                                  | #445 band-aid: `runNow` response surfaces `blocked task <id> gates this assignment — retry or supersede it`. No behavior change. | Office-demo operator never sees silent-OK-nothing                                                                                        |
| **P1 — native tools + grant-only registry** (D2 partial, D3) | `tools` API field on openai-compat path; worker lane sends grants-only schemas; detector demoted to telemetry                    | Conductor demo on gemma-4-12b-QAT completes with **native** calls; worker prompt **43k → ≤8k tokens** (log `n_keep`); zero detector hits |

> **P1 MEASURED 2026-06-11 (sandbox gateway, lmstudio/gemma-4-12b-QAT):** worker system prompt **2,056 tokens** (8,222 chars; was ~40k) via `promptMode:"minimal"` on the worker lane; LM Studio-side prompt **~2.7–3.2k tokens** (was n_keep 43,019); grant filter live (`tool-schemas n=2`); request carries native `"tools"` field and gemma answered `finish_reason:"tool_calls"` with a correct `tasks list [TICKET] pending` call — **zero textual pseudo-call detector hits**; turn round-trip ~10–13s (was 114s). Root cause of #442 confirmed: pi's agent loop ships all tools as `customTools` (prompt text) and `context.tools` arrives EMPTY at the stream layer — fixed by routing lmstudio/ollama through the Argent OpenAI provider and merging the policy-filtered toolset into the stream context (attempt.ts). Residual gap: gemma triages via multi-turn tool loop but doesn't end by mutating its own task row, so v1's `boardChanged` contract auto-blocks the run — exactly the D5 `work_report` gap, lands in P4, not P1.
> | **P2 — blank-slate sessions** (D1, D2 full) | Ephemeral role-scoped sessions via the sessions_spawn seam; role-profile compile + cache; delete `withSessionToolPolicyOverride` | Law audit passes: worker transcript provably contains zero operator memory/tools beyond grants; profile cache hit on warm runs |
> | **P3 — lease lifecycle** (D4, D6) | Claim CAS + TTL + heartbeat + alive handshake + hard kill + event wakeup; full `runNow` semantics replace P0 band-aid | Kill a wedged run in ≤ grace period without ack; lease expiry returns task to queue; #445 + #425 closeable |
> | **P4 — work_report contract** (D5, D7) | `work_report` tool, runner-side board updates, telemetry cross-check, run-event log + Workforce Board read | Conductor demo SOP restored to honest "zero board mutations"; acceptance decisions cite report, not updatedAt diff |

> **P4 IN PROGRESS 2026-06-14 s2 (Opus 4.8), locked contract = full P4 (runner substrate + Workforce Board read):**
>
> - **D7 run-event log — DONE.** New `RunEvent` type + `JobRun.events` field (`src/data/types.ts`); pure helper `src/infra/run-event-log.ts` (+5 unit tests); persisted under `metadata.events` (no migration), lifted back via `pg-adapter.mapRun`. Runner (`execution-worker-runner-impl.ts`) is the single writer — appends `claimed/spawned/heartbeat/report/killed`, flushes onto the run record at every `completeRunForTask` site, and `getStatus()` now carries per-agent `liveRuns[]` with their live event log. `alive`≈`heartbeat` (folded); `expired` reserved for the lease-sweep path. tsc clean; 25 tests green across run-event-log/runner/gateway/work-report suites.
> - **Telemetry cross-check — DONE.** `src/infra/work-report-crosscheck.ts` (pure, +11 tests): `crossCheckWorkReport` rejects `done` on a **live write-capable** role with zero external tool executions → blocks with `report_telemetry_mismatch` (read-only roles like the conductor triage demo are never false-rejected — write-capability is derived from grants ∩ `EXTERNAL_ARTIFACT_TOOLS`, now exported from `tool-claim-validation.ts`). `isStaleWorkReport` is the late-report guard: a report only mutates the board when the runner still holds the claim and the task isn't cancelled — one invariant covering runNow-fresh supersede, cancel, and lease takeover (closes the closet late-report-completes-cancelled-task bug). Both wired at the runner's report-processing seam; rejections/staleness recorded as `report` run-events. tsc gate green (no net-new).
> - Remaining P4: D6 skip-reason log, D9 `proposed_action` recording, Workforce Board dashboard read.

Ordering rationale: P1 is the named biggest lever (#442/#407) and unblocks the client-site local-model story; P2 makes the law structural while the prompt work is hot; P3/P4 are execution-honesty and can follow without blocking demos (P0 covers the sharp edge today).

## 7. Non-goals (v2 explicitly does not)

- Cross-process / remote worker execution (in-process sessions are fine at current scale; the lease protocol is designed to survive that move later without change).
- Role-scoped worker memory (granted knowledge is static attachments in v2).
- Multi-worker collaboration / team topologies for jobs (conductor-as-a-role covers today's need).
- Any new operator-facing feature surface beyond reasons/state already owed to the dashboard.

## 8. Open questions for Jason

1. **`work_report.need_input` routing** — should it page the operator (voice/notification) or just park as `blocked(need_input)` for the review queue? Cheap either way; default in this design is park + review queue.
2. **Lease TTL / handshake defaults** (15 min / 90s / 30s grace) — tuned for local-model latency on the Mac minis, but worth a sanity check against DGX-hosted models.
   _Clarified 2026-06-11 after Jason's first pass:_
   - **Task profile:** v1 tasks are single `agentCommand` turns — tens of seconds on cloud, ~2 min on local 12B for a 2-tool turn (114s measured, #442), cycle hard-capped at `maxRunMinutes=12`. So 15 min is firmly "set-and-forget upper bound; heartbeat just verifies alive," not a per-task tuning knob.
   - **Heartbeat-miss semantics:** there is no optimistic/pessimistic dial because there is no network between runner and lease store — v2 is in-process. Where the runner _knows_ (provider-call timeout, kill flag), it acts immediately; where failure is only _inferred_ (a future cross-process observer), the design is optimistic by construction — nothing kills on a missed beat, the task simply becomes claimable again at TTL expiry. Single-process corollary: if the gateway dies, a **boot-time sweep reclaims all orphaned claims immediately** (any lease held by a runId with no live run is orphaned by definition), so crash recovery time = gateway restart time, not TTL. The 15 min TTL is the forward-compatible safety net; tune to ~3× heartbeat when multi-process arrives.
   - **30s grace is a hard cutoff,** scoped to halt/cancel only: kill flag at T=0 (cooperative interrupt between tool calls), unconditional session termination at T=30s, no ack required. No retry window — retries-on-ambiguity only make sense where failure is inferred, which in-process it never is.
3. **Migration of existing templates** — design reads old `toolsAllow` as `tools.grant`. OK to treat existing `toolsDeny` as dead (nothing to deny under default-deny), or does any live template depend on deny semantics?

> **D5 DELIVERED 2026-06-11 evening (P4-lite, pulled forward):** `work_report` tool + runner-side completion contract shipped and measured live — gemma-4-12b-QAT ran the conductor demo to **run status COMPLETED (review pending)** with a 2,934-char triage log stored on the run record, all six tickets untouched, zero worker board mutations, SOP step 5 de-hacked (#443 closed by design). Landing it surfaced the night's biggest find: **the embedded-runner session never registered custom tools for execution** (`createAgentSession` dropped `options.customTools`; `_tools` was empty) — every model tool call on the pi*only path returned "Tool X not found" while the request still \_declared* the tools natively. v1's `boardChanged` acceptance masked this class entirely (#423's silent-tool-skip, biggest instance). Fixed by registering customTools in the executable registry; gemma's triage now cites real board ids. The `tool lookup miss` diagnostic stays in as a permanent tripwire.

> **KERNEL INTERIM 2026-06-11 (late evening, post-LIMBIC):** Jason approved adopting `EVY-KERNEL-DESIGN.md` (LIMBIC/1) principles for argent-core's kernel; the first cut shipped same night as the deterministic salience gate (`perf/kernel-idle-zero-inference`): cognition only on operator-activity / board-delta / daily anchor, first-class `salience-skip` journaling, and background lanes zero-weighted for salience (the self-stimulation loop — cron workers and heartbeats were registering as operator activity). The FULL kernel rework (drives, wake gate, salience engine, supervisor) is a post-P2 design pass against LIMBIC/1. Idle-inference inventory of the other runners (NOT fixed, by contract): heartbeat default 30m and contemplation default 30m are each a full agent turn — ~96 inferences/day on an idle box — plus SIS dispatches; these are the remaining fan-spinners and the next candidates after P2.

## Addendum — Pi Conductor findings (2026-06-11, after reviewing the Titanium Help Desk Conductor)

Jason's Pi-based help-desk conductor (brief: `/Users/sem/code/evy-mini/CONDUCTOR-OVERVIEW-FOR-ARGENTOS.md`, console: `/Users/sem/code/conductor-console`) is a watered-down-but-**live** version of this design running against real Atera tickets. Four of its ideas are adopted here; it also forced one law refinement.

### D9 — Simulate mode records proposals, structurally (strengthens D2 + governance)

The Pi proves the right dry-run posture: not "block writes and note the violation" but "**make mutation structurally impossible while recording what would have happened**." v2 adopts the three-independent-layers lattice:

1. **Mode-aware profile compile:** in simulate, write-capable granted tools compile to **recording stubs** — same schema, but execution emits a `proposed_action {tool, args, target, draft}` artifact onto the run record instead of touching the world (the Pi's inert `atera_write.py` / `record_dry_run` pattern). The worker can't tell the difference; the operator gets a reviewable proposal, not a hole where work would be.
2. **Runner telemetry cross-check** (v1's existing external-tools-in-simulate check, kept as the tripwire).
3. **Gateway-level master switch** (`WRITES_ENABLED` analog): live execution requires master + assignment stage + per-role grant to all agree — fail-closed, like the Pi's `is_armed()`.

One lesson cuts the other way: the Pi's per-agent mode and tool-permission matrix are **config the engine doesn't read yet** (enforcement deferred; the inert connector is the real safety). v2 must not repeat that — the compiled profile IS the enforcement, from day one.

### D10 — Graded simulation + quantified promotion gate

v2's deployment stages (simulate → limited-live → live) currently have **no promotion criterion** — that's the gap the Pi's grading system fills. Adopted shapes (proven in operation):

- Every simulate-mode run's decisions and `proposed_action`s are **gradable**: `verdict ∈ correct | needs_change | wrong` + free-text feedback; **approve-all is one click and is feedback only — it never executes anything**; disagreement breaks out into per-component grades (per decision component, e.g. classification / assignee / draft).
- Grades are **append-only** (`GradeEvent { runId, component, verdict, feedback, grader, at }`) — audit trail first, stored alongside run events; scorecards roll up per-template and per-component.
- **Promotion gate: ≥95% correct over ≥50 graded decisions sustained 2 weeks** → that assignment is eligible for the next stage. Exact integer math. Operator flips the stage; the gate informs, never auto-promotes. **LOCKED 2026-06-11 (Jason): Pi gate numbers adopted as ArgentOS defaults** — he calibrated them in live operation.
- **Storage — LOCKED 2026-06-11 (Jason): PG-native.** GradeEvents land in an append-only Postgres table (same shape as the Pi's JSONL, queryable for scorecards); the run-event log remains the attestable audit trail. No JSONL sidecar.
- Granted-knowledge retrievals are gradable too (relevant / not-relevant), so simulation doubles as a retrieval-quality regression for the role's knowledge pack.

Phasing: `proposed_action` recording rides **P4** (it's the simulate face of `work_report` evidence). Grading store + scorecards + gate = **P5**, post-purr, dashboard-heavy — Jason sequences.

### D11 — Position ledger: worker agents accumulate, operators stay walled off _(law refinement, Jason's call 2026-06-11)_

Jason's directive: a **worker agent** (workforce) is not an ArgentOS agent — it should accumulate lessons, build/update its skills, and carry its own internal memory, like a twenty-year employee vs. a two-month hire. This _refines, not breaks_, the blank-slate law: blank slate is **with respect to the operator's world** (operator memory, operator tools, main-session context — still default-deny, unchanged). The worker's own **position ledger is granted knowledge that grows** — it belongs to the role, so granting it violates nothing.

- **Scoped to the position, not the instance:** the ledger keys on the template (the _position_), so it survives model swaps, escalations (D8), and session ephemerality (D1). The 20 years belong to the chair, not the butt in it.
- **Write path (cheap, rides P4):** `work_report.lessons[]` — append-only entries on the position ledger, attributed to run + grade outcome. Graded-`correct` runs make lessons trustworthy; graded-`wrong` runs make them cautionary.
- **Read path (P5/P6):** boring retrieval, exactly like the Pi KB — SQLite FTS5/BM25, no embeddings in v1 (the Pi's recall@3 was 10/10 with provenance-tagged Markdown; don't gold-plate). Top-K ledger hits join the role profile's knowledge pack at compile time, with a token budget so local-model viability (D2's ≤8k target) is never spent on memory.
- **Skill self-update (Hermes-style honing, P6):** a worker may _propose_ an SOP/skill amendment — the proposal is itself a gradable artifact through the D10 pipeline, review-gated, never self-applied. Same posture as everything else: workers propose, the operator promotes.
- **Sensitivity model** comes along from day one: ledger entries and knowledge-pack docs carry a sensitivity tag; customer-facing roles require `max_sensitivity: internal` at profile compile (the Pi's restricted-doc wall).

### Principle adopted — fat engine, thin skill

The Pi's most reusable contract, now binding on role-profile/SOP design: **anything deterministic is an engine/tool call; the model supplies judgment only** (scoring, classification, proposal prose). SOPs that ask the model to perform deterministic work (dedup, thresholding, routing) are design bugs — grant a purpose-built tool instead. This is also load-bearing for D2's small-prompt target: judgment-only prompts are the ones a 12B local model can hold.

## Related

#407 · #442 · #443 · #444 (PR) · #445 · #425 · #423 · worker blank-slate law (operator memory `project_worker_blank_slate_principle`) · conductor demo kit `scripts/demo/conductor-demo.mjs` (#441)
