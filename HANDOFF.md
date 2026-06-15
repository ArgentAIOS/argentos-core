# HANDOFF — argent-core session bridge

**From:** 2026-06-14 session 2 / evening (Opus 4.8). Supersedes the accumulated 2026-06-14 bridge (git history @ `743e17b5`'s parents).
**Branch:** **`dev` @ `743e17b5`** — pushed. **DEPLOYED to the live box this session** (see §Deploy). `tsc-since` baseline **189** (zero net-new added).
**Full narrative + vault:** `Obsidian Vault/Argent/Orchestration Handoffs/2026-06-14 - Evening - WR2 P4 deployed, approve-deny + resend live.md` (read it first if cold).
**Separate thread (don't chase):** Frontier Infra / The Machine → `~/code/frontier-infra/HANDOFF.md`.

---

## What's LIVE now (deployed + verified this session)

1. **Telegram Approve/Deny** — operators approve/deny `waiting_approval` runs from the phone. Was already built (#351); enabled via `agents.defaults.kernel.operatorNotifications` in `argent.json`, secured by the existing `allowlist` inline-button scope + `channels.telegram.allowFrom`. Verified live (keeper `2b992c2c` approved → resumed).
2. **Podcast email = Resend** — `workflow-runner.ts` default `sendgrid → resend` (ArgentOS never used SendGrid); `WORKFLOW_EMAIL_FROM=Argent@argentos.ai` in `service-keys.json`. **Confirm the 7 AM podcast actually sends.**
3. **WR2 P4 — COMPLETE (5/5)** + live-verified: D7 run-event log · telemetry cross-check (`report_telemetry_mismatch`) + late-report guard · D6 skip-reason log · D9 simulate `proposed_action` · Workforce Board read. Live proof: conductor run `9d42b3dd` persisted `claimed→spawned→heartbeat→report(done)` on the run record. Design + commit list: `ops/WORKER_RUNTIME_V2_DESIGN_2026-06-11.md` §P4.

## Deploy (READ THIS — non-obvious)

The running gateway/dashboard execute the **installed snapshot** `~/.argentos/lib/node_modules/argentos`, **NOT this repo**. Commits + `argent gateway restart` do NOT go live. To deploy code:

```
ARGENT_GIT_DIR=/Users/sem/code/argent-core SKIP_FETCH=1 SKIP_UPDATE=1 bash scripts/out-of-sync-patch.sh
```

(builds repo HEAD → atomic rsync into the package dir → gateway bounce; idempotent; failed build leaves install untouched). Verify with `grep` in `dist/` (tsdown code-splits — search all of `dist/`, not just `index.js`). Only `argent.json` / `service-keys.json` are read live (~200ms TTL).

## NEXT UP (priority order)

1. **D8 escalation ladder** — runner escalates primary → bigger model on no-progress/`no_report`; emit the `escalated` run-event (slot already wired by D7). Hooks the P3 attempt machinery. Cleanest WR2 continuation.
2. **D9-live proof** — conductor role grants no write tool, so `proposed_action` is unit-verified only; stand up a write-granting role + make the conductor demo a repeatable regression.
3. **Security** — push flags **154 Dependabot vulns (11 critical)** on the public repo. P1 bumps (baileys → protobufjs → hono → shell-quote) need Jason-awake WhatsApp-channel testing.
4. **LM Studio JIT loading** — Jason's manual durability toggle (Settings → Developer) so e2b/12B/31B loop-model routing survives reboot.

## Live-system facts

- Services (launchd): gateway · dashboard-api · dashboard-ui · redis · database-backup · failed-run-alerter. Gateway ws `ws://127.0.0.1:18789` (PROTOCOL_VERSION 3); dashboard-api `http://localhost:9242`; Postgres `postgres://localhost:5433/argentos`. LM Studio `http://192.168.100.90:1234` (e2b/12B/31B + embeddings loaded).
- `argent.json`: `executionWorker.model = openai-codex/gpt-5.5` (restored — was temporarily gemma-12b for the demo); model routing per the thermal work (heartbeat/memu→e2b, kernel/intentSim→12B, contemplation/sis→31B); `operatorNotifications` enabled. Config backups: `~/.argentos/*.bak-*-20260614`.
- Job runs are **PG-only** (`sqlite-adapter.completeRunForTask` is `unsupported`; dual-adapter routes to pg).

## Owned follow-ups (Obsidian closet `Follow-Ups & To-Dos.md`)

- `workflows.cancel` doesn't cascade-resolve its `workflow_approvals` row (323 orphans fixed by hand this session).
- 4 pre-existing env-dependent test failures (agent.delivery / agent.test telegram / overflow-compaction ×2) — identical on clean HEAD, NOT P4-caused; triage baseline-known vs rot.
- `failed-run-alerter` should dedup by run-ID (timestamp approach is fragile; the format-mismatch spam bug was fixed this session but the design is still brittle).
- Demo artifacts on the board: a **retired** "Ticket Triage Conductor" assignment + 6 `[TICKET]` tasks (harmless). `conductor-demo.mjs` ticket-seeding POSTs to a dead `/api/tasks` endpoint — stale script.

## Open decisions (carried)

- codex-cli doctor-vs-resync contradiction (doctor deletes `openai-codex:codex-cli`, but `external-cli-sync.ts` re-imports it on every store load).
- `work_report.need_input` routing (park vs page) · Evy Week-1 kickoff (evy-mini owns).

## Memory (this project)

`argentos-email-provider-resend`, `argentos-livebox-deploy-model` (+ index in `MEMORY.md`).
