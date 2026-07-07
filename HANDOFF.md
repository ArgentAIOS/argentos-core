# HANDOFF — argent-core session bridge

**From:** 2026-07-02 evening → 2026-07-04 session (Fable 5, auto-switched to Opus 4.8 mid-session
after a dual-use safeguard false-positive on dense security-ops context — benign; a `/clear`
lets Fable resume). Covered: Rust canary + delegation seam + P1 daemon auth, a two-day SIS/kernel
spam firefight, a claude-mem version war, and a laptop thermal cooldown.

Full narrative: Obsidian vault `argenos-core/` (01 - Current State, Daily Updates 2026-07-03/04,
Orchestration Handoffs, Decisions Log, Known Gotchas). Backlog: `Follow-Ups & To-Dos.md` closet.

---

## ⚠️ SYSTEM IS PARKED — read before doing anything

Everything autonomous is deliberately OFF (thermal + stability). Nothing is broken.

| System                       | State                                       | Bring back                                                                                                                      |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Argent gateway**           | **STOPPED** (operator asked)                | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.argent.gateway.plist`                                               |
| Kernel / contemplation / SIS | disabled in `argent.json`                   | flip the flags + gateway restart — **but do the prompt diet FIRST**                                                             |
| Workforce worker             | `globalPaused=true`                         | `argent gateway call execution.worker.resume` — **NOTE: a gateway restart resets this to unpaused; re-pause after any restart** |
| subctl evy                   | paused (file `~/.config/subctl/evy/PAUSED`) | `subctl evy resume` (survives restart)                                                                                          |
| LM Studio models             | 0 resident (GPU idle)                       | model-pin LaunchAgent `ai.argent.lmstudio-context-pin` is STOPPED                                                               |

## Shipped this session (all merged to `dev`, tip `188b6cf9`)

| PR   | What                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| #468 | argentd ws canary — `rustGateway.canaryReceipts.status`/`.generateLocalProof`, live-verified read-only-ready   |
| #469 | Authority delegation seam DESIGN (`rust/AUTHORITY_DELEGATION_SEAM.md`), locked after 3-lens adversarial review |
| #470 | P1 daemon auth — fail-closed token auth on argentd + argent-execd                                              |

(Earlier same-session: #461 unit-suite+CI, #462 approval integrity, #463 Workforce P5,
#464–467 operator-reality waves + D9 fix.)

Deploy path (gateway runs the INSTALLED snapshot, not the repo): `~/argentos` ff to
`origin/dev` → `SKIP_FETCH=1 bash scripts/out-of-sync-patch.sh` → gateway bounce. Trunk is `dev`.

## The main forward thread: kernel prompt diet (🔴 do this next)

**Root cause fully mapped.** The kernel's own reflection tick is tiny (~2-3k, safe). The 90k
comes from the kernel's executive dispatch → contemplation:
`consciousness-kernel.ts:1583` `maybeRunManagedContemplation` → `contemplation-runner.ts:994`
`agentCommand(...)` with **no narrowing** → the full agent pipeline. Itemized:

- **skills snapshot ~20.2k tok** — all 229 `SKILL.md` (`buildWorkspaceSkillSnapshot`), passed
  because contemplation never sets `promptMode: minimal/subagent`.
- **tool schemas ~15-25k tok** — full 30+ registry (`attempt.ts:1050`).
- **bootstrap `ctx:*` dump ~7.5-12.5k tok** — incl. `RECENT_CONTEMPLATION.md` feeding its own
  history back. Persistent `:contemplation` session grows unbounded.
- contemplation-runner **never reads `contemplation.model`** (only `modelFallbacksOverride`,
  default `openai-codex/gpt-5.3-codex`), so the configured 31B (113k, would fit) was ignored and
  the turn hit the 12B (81920) → overflow.

**FIX (one call site):** at `contemplation-runner.ts:994` pass `promptMode:"subagent"` + a
narrowed `tools` array → cuts ~40-50k → fits even a modest local model. **NOT done autonomously:**
the one judgment call (which tools contemplation actually keeps) wants Fable + operator to verify.
Then re-enable kernel/contemplation with a **supervised** verify — **never re-enable autonomously**
(it spammed Telegram 3× over two days). Add a give-up/backoff too (below).

## Other open items (backlog in the closet)

- **Arm the installed execd auth token** (Task #12) when #470 deploys: drop plist
  `ARGENT_EXECD_ALLOW_NO_AUTH=1`, set `ARGENT_EXECD_AUTH_TOKEN` (staged at
  `~/.argentos/rust-execd/auth-token`), bounce the LaunchAgent.
- **Kernel give-up/backoff** — after N unresolved escalations of the same signature, mark the
  executive item abandoned + stop re-escalating (would have capped the spam regardless of model).
- **Rust delegation seam P2–P5** (P1 shipped #470): shared contract literals, second-source the
  fail-closed signal, fsync policy, read-only PG role. Then R2 on `workflows.list`.
- **Workforce grading** — grade Ticket Triage Conductor runs (clean run `dab1e586`) toward the
  ≥95%/≥50/14d gate. Design idea: risk-scaled gate tiers.
- **claude-mem structural fix** — semver version selection + version-pin guard (all profiles are
  on 13.9.3 now; the war recurs on the next per-profile update).
- **runNow re-queue orphan bug** — loses task↔assignment linkage.

## Operating doctrine (through 2026-07-07)

Operator loses Fable access after **2026-07-07**. Use Fable **sparingly** — only judgment,
synthesis, architecture, hardest verification. Delegate everything else to **Sonnet** workers
(mechanical/search/verify) via Workflow/Agent; **Opus** for the occasional hard pass. Bank durable
progress + handoff-ready specs before the cutoff. Memory: `feedback-lean-orchestration-budget`.
