# HANDOFF — argent-core session bridge

**From:** 2026-06-14 session 2 (Opus 4.8). Supersedes the 2026-06-14 s1 bridge (git history @ `8a2ef2dc`).
**Branch:** `dev` — **code shipped this session**: `src/infra/workflow-runner.ts` email-provider default `sendgrid → resend` (see §0).
**Scope note:** this session **closed NEXT-UP #1 (Telegram Approve/Deny)** and, via the live test, **root-caused + fixed why the podcast pipeline never sent email**. Frontier-infra / The Machine remains its own thread → `~/code/frontier-infra/HANDOFF.md`.

---

## 0. What shipped 2026-06-14 s2 (the live-box approval loop is now real)

### Telegram Approve/Deny — DONE (it was already built; the task was enablement, not a build)

- The feature shipped long ago in **#351** (`workflow-approval-notifier.ts` emits ✅/❌ inline buttons; `bot-handlers.ts:426` parses `wf_app:`/`wf_dny:`, resolves the approval, resumes the run). It was **dormant** behind one unset config key — that's why 319/324 pending approvals had `notification_status='disabled'`.
- **Enabled** `agents.defaults.kernel.operatorNotifications = { enabled:true, targets:[{channel:"telegram", to:"8693117634"}] }` in `~/.argentos/argent.json` (backup: `argent.json.bak-pre-approvals-notif-20260614`). Live within the 200ms config-cache TTL.
- **Security is already enforced** by existing config — `inlineButtonsScope` defaults to `allowlist` + `channels.telegram.allowFrom=['8693117634']` ⇒ only Jason's chat can press. No extra guard needed. **No second bot, no new daemon** (the same @ArgentAiBot is the single legitimate getUpdates consumer — a separate poller would 409-conflict).
- **VERIFIED LIVE**: Jason pressed Approve on keeper `2b992c2c` → approval `approved` by `@JasonBrashear` → run resumed. (It then failed downstream — see the resend fix below; that failure is what exposed the real bug.)
- **`failed-run-alerter.py` deduped to `failed`-only** (the in-app notifier now owns `waiting_approval` with actionable buttons; the plain-text ping was a redundant double-notify). launchd reloaded.

### Podcast email pipeline — root-caused + fixed (this is why nothing ever sent)

- The approval test resumed, then died: **`No sender address configured … (sendgrid)`**. ArgentOS **never used SendGrid** — `workflow-runner.ts` hardcoded `sendgrid` as the email-provider default in **3 spots** (`sendWorkflowEmail` default param, the `send_email` action fallback, and the `case "email"` node), overriding the email tool's own `resend` default.
- **Fixed** all 3 → `resend` (typechecks clean; `workflow-runner` tests 50/50 green; no test pinned sendgrid). `sendgrid` stays a valid _explicit_ option in the type union.
- **Added** `WORKFLOW_EMAIL_FROM = Argent@argentos.ai` to `~/.argentos/service-keys.json` (backup: `service-keys.json.bak-pre-emailfrom-20260614`). Resend API key was already present + enabled.
- **VERIFIED**: standalone `send_resend` test → Resend `accepted:true`, msg id `877eac8f-…` (sender domain verified, key works). **Gateway restarted** to load the code fix; telegram channel back to `running/polling`.
- **Backlog cleanup** (Jason-approved): **323 stale `waiting_approval` runs** (MSP Podcast / SaaS Radar / Forward Observer drafts, 2026-05-06 → 06-14, residue of the dup-loop + the dead send path) bulk-cancelled via `workflows.cancel`. **Confirmed: 0 waiting_approval runs, 0 pending approvals** (the 323 orphaned approval rows — `workflows.cancel` doesn't cascade-resolve them — were marked `cancelled` directly). _Note for later: `workflows.cancel` leaving its approval row `pending` is a latent gap worth a cascade fix._

---

## What happened 2026-06-14 (ArgentOS)

### 1. Thermal incident → root-caused + fixed

A runaway pushed the Mac's GPU to ~95 °C. Causes + fixes (all in `~/.argentos/argent.json`):

- **`gemma-4-e4b` was a typo** (no such model) — silently broke **memory extraction (memu)** for 5+ weeks. → fixed to `gemma-4-e2b-it-mlx` (memu, `tiers.local`, contemplation override).
- **Autonomic-loop model routing — FINAL (2026-06-14).** The loops had been pinned to the heavy 12B and were hammering it. The thermal-rush fix moved them ALL to the tiny e2b — a capability over-correction (a 2B can't do the kernel's reasoning). Since the **salience gate** (#451/#454: idle = zero inference), not model size, is what actually controls heat, they were re-split by **frequency × depth**: **heartbeat + memu → e2b** (2B, light/frequent); **kernel + intentSimulation(agent/judge) → 12B** (`google/gemma-4-12b-qat`, medium-cadence reasoning); **contemplation + sis → 31B** (`google/gemma-4-31b-qat`, rare ~120m deep reasoning). All three route-tested OK. Backup: `~/.argentos/argent.json.bak-pre-12b-reroute-20260614`. Effective on next loop fire (config read per-request).
- `executionWorker` → `openai-codex/gpt-5.5`; `agents.defaults.model.primary` → `zai/glm-5.2`.
- **131 duplicate podcast workflows** had accumulated (an ungoverned loop) → collapsed; cron store pruned to **7 jobs / 4 podcast crons** via the gateway `cron.remove` method (direct `jobs.json` edits get clobbered by the in-memory store).
- **⚠️ GOTCHA — the model re-route only took effect after LOADING e2b in LM Studio (verified 2026-06-14).** The config change alone did nothing: LM Studio (JIT loading **off**) ignored the requested `gemma-4-e2b-it-mlx` and served every request with the loaded `google/gemma-4-12b-qat` — so memu + the loops kept hitting the heavy 12B. Proof: requesting e2b returned `"model": "google/gemma-4-12b-qat"`. **Fixed:** `lms load gemma-4-e2b-it-mlx` + `lms unload google/gemma-4-12b-qat` (freed ~7 GB); requests now verifiably `served by: gemma-4-e2b-it-mlx`. **Durability:** this load is lost on reboot/LM-Studio restart → **enable LM Studio JIT loading** (Settings → Developer → Just-In-Time Model Loading) so the loop models auto-load — **all three (e2b · 12B · 31B) must stay available**, else requests fall back to whatever single model is loaded.
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

1. ~~**Telegram inline Approve/Deny buttons.**~~ **DONE 2026-06-14 s2** — see §0. Was already built (#351); enabled via config + verified live. Secured to Jason's chat by the existing `allowlist` scope.
2. ~~**WR2 P4.**~~ **DONE 2026-06-14 s2 (5/5)** — full `work_report` honesty: D7 run-event log (`49a66567`), telemetry cross-check + late-report guard `report_telemetry_mismatch` (`20d9e414`), D6 skip-reason log (`eed360be`), D9 simulate `proposed_action` structural recording (`26e49c71`), Workforce Board read (`9e0ac585`). Built test-first; tsc-since green throughout (189 baseline, zero net-new); P3/P2/P1/D5 had landed prior. Exit criterion met (acceptance cites report×telemetry + run-events, not `boardChanged`). Detail in `ops/WORKER_RUNTIME_V2_DESIGN_2026-06-11.md` §P4. **NEXT P4-adjacent:** D8 escalation ladder (closet); full conductor-demo live regression run (needs a loaded local model); the 4 pre-existing env-dependent agent/overflow-compaction test failures (closet).
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
