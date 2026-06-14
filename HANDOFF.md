# HANDOFF — argent-core session bridge

**From:** 2026-06-14 session (Opus 4.8). Supersedes the 2026-06-13 bridge (in git history @ `b1cc5283`).
**Branch:** `dev` @ `b1cc5283` = **v2026.6.12-dev.3** — unchanged this session (no argent-core _code_ shipped; the work was operational + cross-project).
**Scope note:** this session was mostly **operational ArgentOS** (a thermal incident → a locked podcast-pipeline contract) plus a large **frontier-infra / The Machine** arc that has **SPLIT INTO ITS OWN THREAD** → `~/code/frontier-infra/HANDOFF.md`. _This_ file is the **ArgentOS / live-box** thread.

---

## What happened 2026-06-14 (ArgentOS)

### 1. Thermal incident → root-caused + fixed

A runaway pushed the Mac's GPU to ~95 °C. Causes + fixes (all in `~/.argentos/argent.json`):

- **`gemma-4-e4b` was a typo** (no such model) — silently broke **memory extraction (memu)** for 5+ weeks. → fixed to `gemma-4-e2b-it-mlx` (memu, `tiers.local`, contemplation override).
- **All autonomic loops were pinned to a heavy local 12B** (`lmstudio/google/gemma-4-12b-qat`) — heartbeat / contemplation / sis / kernel.localModel / intentSimulation. → re-routed to **`lmstudio/gemma-4-e2b-it-mlx`** (light).
- `executionWorker` → `openai-codex/gpt-5.5`; `agents.defaults.model.primary` → `zai/glm-5.2`.
- **131 duplicate podcast workflows** had accumulated (an ungoverned loop) → collapsed; cron store pruned to **7 jobs / 4 podcast crons** via the gateway `cron.remove` method (direct `jobs.json` edits get clobbered by the in-memory store).
- **⚠️ GOTCHA — the model re-route only took effect after LOADING e2b in LM Studio (verified 2026-06-14).** The config change alone did nothing: LM Studio (JIT loading **off**) ignored the requested `gemma-4-e2b-it-mlx` and served every request with the loaded `google/gemma-4-12b-qat` — so memu + the loops kept hitting the heavy 12B. Proof: requesting e2b returned `"model": "google/gemma-4-12b-qat"`. **Fixed:** `lms load gemma-4-e2b-it-mlx` + `lms unload google/gemma-4-12b-qat` (freed ~7 GB); requests now verifiably `served by: gemma-4-e2b-it-mlx`. **Durability:** this load is lost on reboot/LM-Studio restart → **enable LM Studio JIT loading** (Settings → Developer → Just-In-Time Model Loading) or set e2b to auto-load, else it reverts to the 12B-fallback.
- This incident is the seed of The Machine's ops obligations (idempotency / quarantine / cost-governor / alert) — captured in frontier-infra.

### 2. Podcast pipeline — LOCKED CONTRACT A1–A5, all DONE + verified on Jason's phone

- **A1** workspace git HEAD repaired + commit `6abb7e0`.
- **A2** `doc_panel` token valid → 200.
- **A3** **failure → operator alert**: new `~/.argentos/bin/failed-run-alerter.py` (launchd `ai.argent.failed-run-alerter`, polls `workflow_runs` for `failed` / `waiting_approval`, Telegrams Jason). 🔴 FAILED + ⏳ NEEDS-APPROVAL pings both confirmed delivered. **Now live** (launchd loaded).
- **A4** cron store pruned (above).
- **A5** keeper run `2b992c2c` ran end-to-end → `waiting_approval` → ⏳ Telegram ping delivered.
- Telegram creds added to `~/.argentos/service-keys.json` (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`).

### What SPLIT off to its own thread (don't chase from here)

- **The Machine / machine-driver / Conductor / frontier-infra** → `~/code/frontier-infra/HANDOFF.md`. The Jun-13 "make the driver live" item became `machine-driver`, now **published public** at `github.com/frontier-infra/machine-driver`.
- **goal-contract harness** → done + documented (`Obsidian Vault/Systems/Claude Code Harness/`); `/disarm` escape hatch added; all profiles unified to canonical `~/.claude` + an audit script.

---

## NEXT UP (ArgentOS — priority order)

1. **Telegram inline Approve/Deny buttons** _(logged to the Follow-Ups closet)._ A3 now _alerts_ on `waiting_approval`; let Jason approve/deny from the phone via Telegram `callback_query` → the gateway approve / cancel-run methods (the human-in-the-loop-anywhere feature). Secure it to Jason's chat ID only — the button press is an irreversible operator action.
2. **WR2 P4** _(the main pre-tangent build thread — where Fable left off)._ Landed already: **P1** (native tools + grant-only registry — worker prompt 43k→~2k tokens, native calls), **P2** (blank-slate ephemeral sessions, #452), **P3** (lease lifecycle, #453), **D5** (`work_report` contract). **P4 is the stop:** `work_report` _full_ — runner-side board updates, telemetry cross-check, run-event log + Workforce Board read, + **D9** proposed*action recording. Exit criterion (already written): conductor demo SOP back to honest "zero board mutations"; acceptance cites the report, not an `updatedAt` diff. Design: `ops/WORKER_RUNTIME_V2_DESIGN_2026-06-11.md`. *(Conductor was WR2's live regression harness — the same repo now contained private in frontier-infra.)\_
3. **D8 escalation ladder** — primary → bigger model on no-progress.
4. **Dependabot P1 bumps** (baileys → protobufjs → hono → shell-quote; needs Jason-awake WhatsApp-channel testing).
5. **Enable LM Studio JIT loading (durability).** e2b is loaded + routing correctly NOW and the 12B is unloaded (verified 2026-06-14) — but a reboot loses it unless JIT loading is on (Settings → Developer) or e2b auto-loads. See §1 gotcha.

## Live-system facts

- argent-core: `dev` @ `b1cc5283` (dev.3) — no code shipped this session. Suite baseline **42 files / 134 tests**; tsc gate `ops/known-failing.json` = **189**.
- Running (launchd): gateway · dashboard-api · dashboard-ui · redis · database-backup · **failed-run-alerter**. Gateway ws `ws://127.0.0.1:18789` (PROTOCOL_VERSION 3); dashboard-api `http://localhost:9242`; Postgres `postgres://localhost:5433/argentos`.
- Config `~/.argentos/argent.json`: model routing per §1; `gateway.auth.token` present. Providers: lmstudio (local MLX), `openai-codex/gpt-5.5`, `zai/glm-5.2`.

## Open decisions (awaiting Jason) — carried from 06-13

- **codex-cli doctor-vs-resync contradiction:** doctor deletes `openai-codex:codex-cli`, but `external-cli-sync.ts` re-imports it from `~/.codex` on every store load — deletion can't stick while Codex CLI is installed. Suspect in the gpt-5.5 context-overflow mystery.
- `work_report.need_input` routing (park vs page) · whether `toolsDeny` dies in the grant-only migration · Evy Week-1 kickoff (evy-mini owns).

## Pointers

- Other thread: `~/code/frontier-infra/HANDOFF.md` · vault `Obsidian Vault/Frontier Infra/`.
- This session's vault: `Obsidian Vault/Argent/Daily Updates/2026-06-14 - machine-driver published to frontier-infra, conformance locked, profiles audited.md`.
- Memory: `project_the_machine_one_loop`, `project_frontier_infra_org`, `feedback_goal_contract_workflow`, `feedback_cost_discipline`.
