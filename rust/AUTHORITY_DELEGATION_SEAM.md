# Authority Delegation Seam — Node → Rust read-only adoption

**Status:** LOCKED 2026-07-02 (adversarially reviewed: 3-lens fleet, 14 findings raised,
8 confirmed and applied — including one blocking first-surface correction; see §11)
**Scope:** the design for _controlled read-only adoption_ — the next rung named by
`rust/argent-execd/PROMOTION_CHECKLIST.md` ("okay to begin designing a controlled
read-only adoption path"). This document designs how Node begins _consuming and then
serving_ Rust-computed **reads**, with evidence, receipts, and rollback at every step.
**Non-goals:** any write delegation, any authority switch, any scheduler/workflow/channel/
session/run cutover. Those are rungs R4+ and are _named but not designed_ here.

Companion evidence: canary receipt machinery (PR #468, live-verified 2026-07-02),
parity report 19/0 promotionReady, both daemons installed as KeepAlive LaunchAgents.

---

## 1. Vocabulary

- **Authority** — the right to _mutate_ a domain (gateway, scheduler, workflows,
  channels, sessions, runs). Node holds all of it, enforced at the TypeScript type
  level (`GatewayAuthoritySnapshot`, `src/commands/gateway-authority-status.ts:90`,
  pins every field to a single literal).
- **Visibility** — Node _displaying_ Rust self-reported state with no behavioral
  dependence (today's `argent status` rows).
- **Compared read** — Node serves its own answer AND computes the Rust-side answer,
  recording match/divergence. Zero behavioral dependence.
- **Adopted read** — Node _serves_ the Rust-computed answer for a surface, with
  synchronous fallback to its own computation. Behavioral dependence begins here,
  reads only.
- **Rung** — a discrete trust level with an entry gate, receipts, and a rollback
  proof. Ascent is always an explicit operator action; descent is always available
  and always cheaper than ascent.
- **The seam layer** — the ONLY place comparison and adoption may hook: the gateway
  ws method-dispatch layer (`GatewayRequestHandlers`,
  `src/gateway/server-methods.ts:579`). Internal service calls (e.g.
  `context.cron.list()` from workflow reconciliation,
  `src/gateway/server-methods/workflows.ts:1123,1184,3149`) are **never** compared
  and **never** adopted — they always use the Node-native path. This keeps every
  internal mutation flow independent of delegation (I1) by construction.

## 2. Ground truth this design stands on (mapped + reviewed 2026-07-02)

Facts a reviewer should check before trusting the rest:

1. **No durable authority record exists.** `authorityRecord: 'missing'` is a
   hardcoded literal documented as expected
   (`src/commands/status.rust-gateway-scheduler-authority.ts:38,48`). There is no
   persistence layer to extend — R3 must introduce it.
2. **The no-delegation invariant is compile-time.** Authority fields are TS
   string-literal types, not config (`workflows.ts` `schedulerAuthority: "node"`,
   `authoritySwitchAllowed: false`). Adoption states must be added as _new literals_
   so the compiler forces every consumer to handle them. Delegation can never be a
   config toggle.
3. **Sources of truth differ per domain — this decides which surfaces qualify:**
   - `workflows` / `workflow_runs` live in **Postgres** (`SELECT * FROM workflows`,
     `src/gateway/server-methods/workflows.ts:656,1168`; per-job connections in
     `src/cron/service/timer.ts:462-527` read these same tables).
   - **Cron scheduler state is NOT in Postgres.** The job store is a JSON5 file at
     `CONFIG_DIR/cron/jobs.json` (`src/cron/store.ts:8-9`, atomic tmp+rename), and
     `cron.status` fields like `nextRunAtMs`/`nextWakeAtMs` are Node **in-memory
     timer state** no external process can recompute from any store. `cron.*`
     therefore fails I4 today and is disqualified as an early surface.
4. **Rust's gateway read surface is mostly fixtures.** argentd's `cron.list`,
   `workflows.list`, `workflows.backendStatus`, TTS, terminal are hardcoded or
   bookkeeping-only payloads (`rust/argentd/src/http.rs:622-661,989-1067`;
   `terminal.rs:60` echoes input, no PTY). Only **hub presence** and **canary
   receipts** are genuinely live state (`rust/argentd/src/hub.rs`), and both are
   memory-only, reset on restart.
5. **Parity ≠ truth.** The 19/0 parity report proves _schema compatibility_ of
   replayed read-only fixtures between isolated instances
   (`src/infra/rust-gateway-parity-runner.ts:156`), never content truth against
   live stores. The 3 skips are the unsafe surfaces, hard-blocked by
   `assertNoUnsafeRustGatewayReplayFixtures` (`rust-gateway-parity-fixtures.ts:390`).
6. **`__shadowReplay` has no producer.** The argentd trace marker
   (`rust/argentd/src/ws.rs:147-152`) is dead instrumentation; nothing in the repo
   emits it. No cron/workflow decision comparison exists anywhere today. R2 is
   greenfield, not wiring.
7. **argent-execd's control surface is unauthenticated, and argentd's token check
   is fail-open.** execd's `build_response()` dispatches on (method, path) with no
   token check (`rust/argent-execd/src/server.rs:98`) — including `POST /v1/lanes/*`,
   `/v1/executive/tick`, `/v1/executive/shutdown`. argentd checks a connect token
   **only when `ARGENTD_AUTH_TOKEN` is non-empty**
   (`rust/argentd/src/server.rs:102-104`, `ws.rs:184`
   `!expected_token.is_empty() && …`) — started without the env var, it accepts any
   token. Neither daemon fails closed on missing credentials today.
8. **The three "fail-closed" flags are one boolean.** kernel / production-daemon /
   readiness fail-closed in `argent status` all derive from one GET
   `/v1/executive/readiness` and one function
   (`executiveShadowReadinessFailsClosed`, `src/infra/executive-shadow-contract.ts:348`).
   There is no redundancy to lean on.
9. **execd asserts Node's authority, it does not verify it.** The readiness payload's
   `currentAuthority` map is hardcoded in `rust/argent-execd/src/runtime.rs:482-489`.
10. **Durability is honest but thin.** execd journal appends `flush()` without fsync
    (`journal.rs:96`); snapshots use atomic rename. argentd receipts/presence are
    memory-only by design (documented in `hub.rs`).
11. **Existing templates to reuse:** the live `:18799/health` probe
    (`status.rust-gateway-shadow.ts:42`), the freshness-gated parity file read
    (24h window, `status.rust-gateway-parity-report.ts:106`), the authenticated
    canary RPC proof with completeness grading (`collectGatewayAuthorityInstalledStatus`),
    and the proof-command shape every authority CLI uses:
    `{ typed status, proof: string[], blockers: string[], nextCommands: string[] }`.
    The smoke-loopback harness spawns a **Node-only** disposable gateway
    (`gateway-authority-status.ts:~1030`) — the drill in §7 requires a Rust-side
    disposable component that does **not** exist yet and must be built.

## 3. Invariants — hold at every rung, forever

I1. **Node is sole write authority for all six domains.** Nothing in this document
changes that. Comparison/adoption exist only at the seam layer (§1); internal
service calls never touch the Rust path, so no mutation flow ever depends on a
Rust-computed value at any rung in this document.
I2. **Ascent is operator-only; descent may be automatic but is always durable.**
Ascent (R2→R3, enabling comparison, adopting a surface) requires an explicit
operator command with `--reason` and a confirm flag, recorded in the authority
record (§6). Automatic demotion (R3→R2 on divergence/fallback triggers) is
system-initiated and MUST be durably appended to the same record with
`actor:"system"` before taking effect in memory — a demotion that exists only
in process memory is forbidden (a restart would silently re-ascend).
**Absence of a valid record means R1 semantics.** Fail toward less adoption.
I3. **Delegation may never surface an error the operator wouldn't otherwise see.**
Rust unreachable / slow / divergent ⇒ Node serves its own answer and records a
fallback receipt. Budget: the Rust path gets a hard timeout (default 300ms) and
one attempt; no retries in the request path.
I4. **No fixture-backed or irreproducible surface may be compared or adopted.**
A surface qualifies only when the Rust side computes it from the same durable
source of truth Node uses (ground truth #3, #4, #5). Schema parity alone never
qualifies a surface; in-memory-derived fields disqualify a surface until they
are either removed from the compared projection or made derivable.
I5. **Type-pinned authority stays type-pinned.** New states (`compared`,
`read-adopted`) enter as new TS literals + generated-contract entries, replacing
the hand-mirrored copies (Node `workflows.ts` vs Rust `http.rs:642` are
maintained by comment discipline today — that pattern is banned for new states).
I6. **No unauthenticated or fail-open daemon surface.** Precondition P1 (§4) blocks
R2 entry for both daemons.
I7. **Receipts are durable and Node-side.** Daemon-memory receipts prove daemon
behavior (canary); _seam_ evidence lives in the Node-side store
(`src/infra/rust-gateway-receipt-store.ts` pattern: JSONL, 0600, redacted).
I8. **One kill switch reverts everything.** `argent gateway authority rollback-node`
becomes a real operation at R3 (§7): it appends explicit revert entries for every
adopted surface (and archives + re-baselines the record if it is corrupt), proven
by a drill, not by comparing two identical literals
(today's noop: `gateway-authority-status.ts:395-396`).
I9. **Evidence freshness gates ascent.** Parity report fresh (<24h), divergence
stats fresh, soak windows met — stale evidence blocks ascent exactly like a
failed check (staleness machinery already exists; reuse it).
I10. **Every rung is independently reversible** without touching the rung below.

## 4. Prerequisite hardening (before any R2 work)

P1. **Fail-closed token auth on BOTH daemons.**
(a) argent-execd: token check on every route, mirroring argentd's connect gate;
POST control routes additionally require an explicit opt-in env AND the token.
(b) BOTH daemons: when the expected token is missing/empty at startup in
installed mode, **refuse to start** (or refuse all connects) rather than
accepting anything — closing argentd's current fail-open hole (ground truth #7).
P2. **Shared contract artifact for boundary literals.** Generate the
blockers/authority literals for both sides from one source (the
`protocol:gen` pipeline already generates execd schemas; extend it), killing
the hand-mirrored copies. (Ground truth #2, I5.)
P3. **Second-source the fail-closed signal.** Count the kernel-inspector cross-check
(`executive-shadow-kernel-inspector.ts:22`) as an independent signal in
`argent status`, or explicitly label the three flags as single-sourced.
(Ground truth #8.)
P4. **Durability policy for seam-critical appends.** execd journal: `sync_all()` on
append or a documented loss-window statement in the readiness payload. The
authority record and Node-side seam receipts (§6, I7): fsync on append,
single-line O_APPEND writes. Read-only adoption can live with execd's window;
the record cannot have one.
P5. **Read-only PG role for the Rust side:** a dedicated Postgres role with
`SELECT`-only grants on exactly `workflows` (and later `workflow_runs`),
injected via env, same conventions as the daemons' existing bind/token config.
This role is sufficient for the nominated first surface _because_ that surface
is PG-backed (ground truth #3) — it deliberately buys nothing for `cron.*`.

## 5. The rung ladder

### R0 — Shadow-only (today, done)

Both daemons run as services; parity 19/0; canary receipts provable end-to-end
(status-installed → read-only-ready, smoke-local → passed, 2026-07-02).
**Authority:** Node everything. **Receipts:** canary (denial, duplicate-prevention).

### R1 — Trusted visibility (today, formalized + gap-closed)

Node displays Rust self-reported state: health probe, parity file, executive
readiness. Display-only; no value changes Node behavior.
**Entry gate:** none (already live). **Exit criteria (to allow R2):** P1–P3 done.
**Receipts:** none required (no behavioral dependence).
**Banned:** any Node code path branching on a Rust-reported value.

### R2 — Compared reads (divergence recorder)

For ONE nominated surface, Node serves its own answer and _also_ computes the
Rust-side answer out-of-band, recording match/divergence receipts. Zero behavioral
change; the entire value is the divergence rate.

- **First surface: `workflows.list`.** Chosen because it is genuinely PG-backed
  (`SELECT * FROM workflows`, ground truth #3) — the Rust read-model can SELECT the
  same table with the P5 role and both sides compute from one durable store.
  `cron.list`/`cron.status` are **disqualified** under I4: the cron store is a
  Node-local JSON5 file and `next*Ms` fields are in-memory timer state (ground
  truth #3). They become candidates only after a file-based read model or a
  derivability fix is designed — separately.
- **Seam layer only:** comparison hooks the `GatewayRequestHandlers` dispatch for
  `workflows.list` (§1). Internal `context.workflows.*`/reconciliation callers are
  excluded — they see only Node-native results, at every rung.
- **Build shape:** a Rust read-model (argentd module or small crate) that SELECTs
  `workflows` with the P5 role and serves `scheduler.readModel.workflowsList` over
  the existing authenticated ws dialect; a Node comparer at the seam layer that
  samples (default: every Nth dispatch of the surface, N=10) and appends receipts
  post-response (fire-and-forget; the comparer may never delay or block the answer).
- **Comparison semantics:** canonicalize per an explicit **per-surface projection
  spec** written when the surface is nominated: sort keys and arrays by stable
  stored IDs; **stored identifiers are always kept** (a UUID assigned at creation
  and persisted is identity, not noise); strip or tolerance-band only _computed_
  volatile fields, each listed by name in the spec (for `workflows.list`:
  timestamps within ±2s tolerance; nothing else stripped without a spec change).
  Then hash. Divergence receipts store the _redacted field-path diff_, never raw
  payloads.
- **Receipts:** `RUST_READ_COMPARED_MATCH` / `RUST_READ_COMPARED_DIVERGED`
  `{surface, sampleBasis, fieldPaths?, latencyMs(rust, node)}` in the Node-side
  store (I7).
- **Entry gate:** P1–P3 merged; parity fresh; operator command
  `argent gateway authority compare-reads enable workflows.list --reason … --confirm-read-only`.
- **Exit criteria (to allow R3):** divergence rate < **0.1%** over a **7-day** soak
  with ≥ **1,000** samples (defaults; Q2), plus rust-path p99 latency within budget.
- **Rollback:** disable command; receipts stop; provably zero behavior change.
- **Banned:** comparing fixture surfaces or I4-disqualified surfaces; hooking below
  the seam layer; the comparer blocking or delaying the Node answer.

### R3 — Adopted reads (flagged, fallback-guarded, recorded)

For an R2-proven surface, Node serves the Rust-computed answer — at the seam layer
only; internal callers keep Node-native results.

- **Mechanism:** new typed state `read-adopted` on the surface's authority literal
  (I5); request path = Rust call with 300ms budget → on any error/timeout/schema
  mismatch, Node computes and serves its own answer + `RUST_READ_FALLBACK_NODE`
  receipt (all fallbacks receipted at 1:1). Sampled `RUST_READ_ADOPTED_SERVED`
  receipts (default 1:100).
- **Requires the durable authority record** (§6) — this rung introduces it.
- **Entry gate:** R2 exit criteria + **rollback drill** (§7) passed + operator
  command `argent gateway authority adopt-read workflows.list --reason … --confirm-read-only`.
- **Continuous demotion (automatic, durable):** fallback rate > 1% over 1h, or any
  divergence detected by the R2 comparer (which _keeps running_ at reduced sample
  rate under R3) ⇒ the gateway appends an `actor:"system"` demotion entry to the
  record (I2), _then_ reverts to R2 in memory, receipts it, and notifies the
  operator. Restart re-folds the record and lands on R2 — never silently re-ascends.
  Automatic _descent_ is safe by construction; ascent is never automatic.
- **Rollback:** `rollback-read <surface>` (instant, record-backed) and the global
  `rollback-node` kill switch (I8).

### R4/R5 — Write canary / authority transfer (NOT THIS DOCUMENT)

Named so the ladder is honest about where it leads: R4 = a single idempotent,
receipt-proven, instantly-reversible write surface; R5 = domain authority transfer.
Each requires its own design doc, review, and operator sign-off. Nothing in R0–R3
creates code paths that make R4 easier to reach accidentally (the seam-layer rule
in §1 is what enforces this: no internal mutation flow can acquire a Rust
dependence as a side effect).

## 6. The durable authority record (new at R3)

Append-only JSONL at `~/.argentos/authority/record.jsonl` (0700/0600, same policy
shape as the receipt store), one entry per state change:

```json
{
  "version": "authority-record-v1",
  "seq": 7,
  "action": "adopt-read",
  "surface": "workflows.list",
  "state": "read-adopted",
  "actor": "operator",
  "reason": "…",
  "confirmedReadOnly": true,
  "prevSeq": 6,
  "createdAtMs": 0
}
```

- **Writers:** the CLI commands (operator ascent/descent) and the gateway process
  itself for `actor:"system"` demotion entries ONLY (I2). Never for ascent.
- **Write discipline:** single-line O_APPEND writes, fsync on append (P4). `seq` is
  derived from the fold at write time; on a `seq`/`prevSeq` conflict (CLI racing a
  system demotion) the fold resolves toward the **least adoption** among the
  conflicting entries, and the conflict itself is surfaced as a status blocker.
- **Fold rules:** current state = fold of the log. **Any unparseable line
  invalidates the entire record** ⇒ R1 semantics (nothing adopted — which is the
  safe state, so a corrupt record can never leave a Rust path serving) ⇒ a
  loud blocker in `argent status`. `rollback-node` on a corrupt record archives it
  (`record.jsonl.corrupt-<ts>`) and writes a fresh baseline entry, restoring a
  valid empty record.
- **Gateway caching:** fold cached with invalidation on (mtime, size, content
  hash) AND a hard TTL of **5 seconds** — bounded staleness regardless of mtime
  granularity or same-second rewrites. System demotions bypass the cache (the
  gateway wrote the entry; it updates its own fold synchronously).
- Every fold result is surfaced in `argent status`
  (`authority record: 3 entries · workflows.list read-adopted` replaces today's
  hardcoded `missing`).
- The record is _not_ trusted by the Rust side for anything; it gates Node's
  serving path only. Rust daemons remain shadow-posture permanently until an R5
  design says otherwise.

## 7. Rollback drills (proof, not prose)

Today's `rollback-node` proof compares two identical hardcoded snapshots
(ground truth: `gateway-authority-status.ts:395-396`) — acceptable while there is
nothing to roll back, meaningless at R3. Required drill, run _before_ each ascent
and recorded as receipts:

1. Spin up the disposable pair: the existing Node loopback harness (temp HOME,
   random port/token — exists today) **plus a disposable Rust read-model daemon**
   (temp state dir, random port/token, P5 role against a disposable PG database —
   this component must be BUILT; it does not exist, ground truth #11). **Stubs are
   banned:** a drill that fakes the Rust endpoint proves nothing about the adopted
   path and does not satisfy the gate.
2. Write an adopt-read record entry in the temp HOME; serve N=100 requests through
   the real seam; verify `RUST_READ_ADOPTED_SERVED` receipts and at least one
   forced-timeout fallback receipt (kill the Rust daemon mid-drill).
3. Issue rollback; verify next request serves the Node-computed answer; verify
   record entry + `ROLLBACK_DRILL_PASSED` receipt.
4. Drill receipt freshness (<7 days) is part of the R3 entry gate.

## 8. CLI surface (follows the existing proof-command shape)

```
argent gateway authority read-adoption status                     # rungs, records, rates
argent gateway authority compare-reads enable|disable <surface>   # R2
argent gateway authority adopt-read <surface> --confirm-read-only # R3 ascent
argent gateway authority rollback-read <surface>                  # R3 descent
argent gateway authority rollback-node                            # global kill (made real)
```

All return `{ typed status, proof: [], blockers: [], nextCommands: [] }` and print
no secret material, matching `gateway-authority-status.ts` conventions.

## 9. Open questions for the operator

- **Q1 — RESOLVED by review:** the Rust read path to truth is the read-only PG role
  (P5) _because_ the first surface is PG-backed. File-backed stores (cron) need a
  separately designed read model before they can ever qualify (I4).
- **Q2 — Soak defaults:** 7 days / <0.1% divergence / ≥1,000 samples for R2→R3 —
  tighten or loosen?
- **Q3 — Second surface after `workflows.list`:** `workflow_runs`-backed reads
  (same PG role, natural extension) or `sessions.list` (check its store first —
  the cron lesson says verify the source of truth before nominating)?
- **Q4 — Should R3 remain per-operator opt-in indefinitely** (my recommendation:
  yes until R4 is even drafted), or graduate to default-on after a sustained window?

## 10. Review checklist for this document

- [x] Every ground-truth claim in §2 spot-checked against the cited file:line
      (fleet fact-check lens; cron/PG claim corrected, argentd fail-open corrected)
- [x] Invariants I1–I10 individually attacked (demotion/record contradiction found
      and fixed via system-writer rule; corruption fold rules pinned)
- [x] P1 confirmed as R2-blocking, extended to fail-closed startup on both daemons
- [x] Receipt schemas cover every behavioral branch (adopted, fallback, diverged)
- [x] Rollback drill executable — Rust-side disposable component identified as a
      BUILD item, stubs banned
- [x] No rung creates latent write-path code (seam-layer rule; internal callers
      excluded from comparison and adoption)

## 11. Review record (2026-07-02)

3-lens adversarial fleet (fact-check, invariant-attack, operability), each finding
independently verified against code. Confirmed and applied:

1. **[blocking]** R2 first surface unbuildable: cron state is a JSON5 file + in-memory
   timer state, not PG → surface switched to `workflows.list`; cron disqualified
   under I4; Q1/Q3 reframed.
2. Automatic demotion contradicted the record's operator-only writer rule (silent
   re-ascent on restart) → I2 amended: durable `actor:"system"` descent entries.
3. mtime-only cache invalidation unbounded staleness → (mtime, size, hash) + 5s TTL.
4. Canonicalization "strip generated IDs" would mask real divergence (stored UUIDs
   are identity) → per-surface projection specs; stored IDs always kept.
5. "argentd enforces a connect token" overstated — fail-open when env empty → ground
   truth #7 corrected; P1 extended to fail-closed startup.
6. Record corruption semantics unspecified (and corrupt-record kill switch was a
   no-op) → fold rules pinned; rollback-node archives + re-baselines.
7. Drill harness "already exists" false — Node-only today → Rust-side disposable
   component specified as a build item; stubbed drills banned.
8. Seam layer unpinned (service-layer hook would route internal mutation flows
   through Rust reads) → seam-layer rule added to §1, enforced in R2/R3/R4 text.

Rejected (verified not defects): 4 findings — citation-drift nitpicks and an
experimental-writes naming complaint; see session record for reasoning.

---

_Drafted and locked 2026-07-02 (Fable 5) from a 4-reader subsystem map and a
3-lens adversarial review fleet. Map citations in the session record._
