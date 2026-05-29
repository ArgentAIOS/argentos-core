# Ollama First-Class Install + Auto-Configured Backend LLMs — Fix Plan

**Date:** 2026-05-29
**Origin:** Live client-install session on `Titaniums-Mac-mini` (titanium@192.168.0.170). We shipped `v2026.5.6.7` to fix the public installer, then hit a chain of onboarding/config/runtime issues getting the box demo-ready. This doc captures root causes and a path to making **Ollama a first-class, zero-touch local LLM stack** so a fresh macOS install runs offline with no cloud keys.

---

## Goal (what "done" looks like)

A fresh `curl -fsSL https://argentos.ai/install.sh | bash` on a clean Mac results in:

1. **Ollama installed and running** (first-class, not best-effort).
2. **Both default models pulled**: `gemma4:latest` (chat/reasoning) + `nomic-embed-text` (embeddings).
3. **Both models kept warm across reboots** (auto-load, no cold start).
4. **Every backend LLM lane auto-configured** to a working local Ollama model, with **schema-valid config** (gateway must not crash).
5. The agent answers a chat and memory-search works **with zero cloud API keys**.

---

## Reference implementation (verified working on the mini, 2026-05-29)

These are the artifacts to productionize — they're proven on the client box:

- **Co-load proven:** Ollama 0.24.0, 48 GB RAM, `gemma4:latest` (11 GB) + `nomic-embed-text` (578 MB) both resident on GPU simultaneously. Plenty of headroom.
- **Keep-alive LaunchAgent** (`~/Library/LaunchAgents/ai.argent.ollama-keepalive.plist` + `~/.argentos/bin/ollama-keepalive.sh`): at login (`RunAtLoad`) and every 4 min (`StartInterval=240`) it `open -a Ollama` then pins both models with `keep_alive=-1`. Verified: `ollama ps` shows both with `UNTIL=Forever`, survives reboot.
  - Chat model loaded via `POST /api/generate {"model":"gemma4:latest","keep_alive":-1}` (no prompt = load-only).
  - **Embedding model MUST use** `POST /api/embeddings {"model":"nomic-embed-text","prompt":"warm","keep_alive":-1}` — `/api/generate` will NOT load an embed-only model (this bit us once).
- **Embeddings wired:** `agents.defaults.memorySearch = {"provider":"ollama","model":"nomic-embed-text","fallback":"none"}` → gateway logs **"V3 embedding contract preflight passed"**.

> Pull these two files into the repo (e.g. `assets/launchagents/` + a template) and have the installer drop+load them.

---

## Root-cause inventory (everything we hit)

| # | Issue | Root cause | Status |
|---|---|---|---|
| 1 | `curl\|bash` install aborts on pinned pnpm | `install-hosted.sh activate_pinned_pnpm` ran `corepack`/`npm` (`#!/usr/bin/env node`) without Node on PATH + no `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` | **FIXED** v2026.5.6.7 |
| 2 | Dashboard `vite build` fails | `@noble/ed25519` unresolved under `--ignore-workspace` | **FIXED** v2026.5.6.7 (root dep) |
| 3 | **Gateway crashes on boot** | Onboarding writes **schema-invalid** keys: `agents.defaults.memorySearch.provider:"zai"` (not in enum) and `agents.defaults.modelRouter.routingPolicy` (unrecognized) → config rejected → gateway exits 1 | **PENDING** (worked around on mini) |
| 4 | Agent falls back to `anthropic/claude-opus-4-5` (no key) | When config is invalid (router "configPresent=false") it uses a hardcoded Anthropic default; also `glm-5.1` (latest) **missing from the model catalog** → router can't select it | **PENDING** (worked around: added glm-5.1 to catalog) |
| 5 | Z.AI `1113 insufficient balance` | **Coding-Plan key** sent to the **general** endpoint `…/api/paas/v4` instead of **coding** endpoint `…/api/coding/paas/v4` | **PENDING** (worked around in config) |
| 6 | Native Swift app crashes (SIGABRT) | `TalkModeRuntime.startRecognition() → AVAudioNode.installTapOnBus` throws an unhandled `NSException` on a Mac with **no audio input**; path ignores `argent.talkEnabled` | **PENDING** (worked around with a USB mic) |
| 7 | Ollama not first-class | No embedding model pulled, no keep-alive, backend lanes unconfigured/pointing at cloud models without keys | **THIS DOC** |

Valid `memorySearch.provider` enum (for #3): `openai`, `gemini`, `ollama`, `lmstudio`, `local`, `auto`.

---

## The plan — Ollama first-class install

### Phase 1 — Install + models (installer)
- **macOS**: install Ollama first-class. `install.sh` (tarball) already does `brew install ollama` + `brew services start ollama` (Phase B). The **hosted** `scripts/install-hosted.sh` does NOT do the full setup — bring it to parity:
  - Detect existing Ollama (Ollama.app OR brew OR `/usr/local/bin/ollama`). The mini had **Ollama.app** managed by launchd `com.ollama.ollama` — handle both Ollama.app and brew-service installs.
  - If absent, install (prefer Ollama.app on macOS for the menubar UX, or brew for headless).
- **Pull the two default models** (make default-on, not gated behind `ARGENT_PULL_OLLAMA_MODELS=0` for the local-first path):
  - `gemma4:latest` (chat/reasoning)
  - `nomic-embed-text` (embeddings — this is `DEFAULT_OLLAMA_EMBEDDING_MODEL` in `src/memory/embeddings-ollama.ts`)
- Files: `scripts/install-hosted.sh`, `install.sh`.

### Phase 2 — Keep-alive (ship the LaunchAgent)
- Ship `ai.argent.ollama-keepalive` (script + plist above) as part of the install; drop into `~/Library/LaunchAgents/` + `~/.argentos/bin/` and `launchctl bootstrap`.
- Ensures Ollama is running + both models pinned `Forever` at login and every 4 min. Survives reboot.
- Consider an additional env nudge: set `OLLAMA_KEEP_ALIVE=-1` for the Ollama server so even normal requests don't unload (belt-and-suspenders; the periodic re-pin already covers it).

### Phase 3 — Auto-configure backend LLM lanes (onboarding)
The dashboard "Agent" panel exposes lanes; onboarding should default **all** of them to local Ollama models when no cloud key is present (config under `agents.defaults.*` in `argent.json`):

| Lane | Default (local-first) |
|---|---|
| Consciousness Kernel | `ollama/gemma4:latest` |
| Contemplation | `ollama/gemma4:latest` |
| SIS | `ollama/gemma4:latest` |
| Heartbeat | `ollama/gemma4:latest` |
| **Embeddings** (`memorySearch`) | `ollama/nomic-embed-text` |
| Primary chat/agent | user's chosen provider, else `ollama/gemma4:latest` |

- Onboarding wizard: `src/wizard/onboarding.finalize.ts` (and the model-config writer).
- **Critical:** whatever onboarding writes MUST pass the config schema (`src/config/zod-schema.agent-defaults.ts` `MemorySearchSchema`, `src/config/schema.ts`). Add a **post-write `argent doctor`/schema validation gate** in onboarding so an invalid snapshot can never ship (this is what crashed the gateway — issue #3).

### Phase 4 — Fix the onboarding bugs that block local-first
- **#3** Stop writing `memorySearch.provider:"zai"` and `modelRouter.routingPolicy`. Validate against the schema before persisting.
- **#4** Ship `glm-5.1` (and keep the catalog current) in the default model catalog (`provider-registry.json` / the shipped `models.json`); don't silently fall back to Anthropic — surface "model not in catalog".
- **#5** When a Z.AI key is a **Coding Plan** key, set `baseUrl = https://api.z.ai/api/coding/paas/v4` (general is `…/api/paas/v4`). Detect coding-plan keys during onboarding and pick the endpoint. Wire in both `models.json` (`providers.zai.baseUrl`) and `provider-registry.json`.

### Phase 5 — Swift app no-mic guard (separate Sparkle rail)
- Guard `TalkModeRuntime.startRecognition()` / `installTapOnBus` (`apps/macos/Sources/Argent/TalkModeRuntime.swift`, `VoicePushToTalk.swift`, `MicLevelMonitor.swift`): check for a valid audio **input** device/format before installing the tap; degrade gracefully (disable voice) instead of `abort()`. Also honor `talkEnabled` on the dashboard-triggered `playAssistant` path.
- Needs a new **signed + notarized** macOS release (release-swift-mac runbook). Note: app on the mini is the lagging build `2026.4.18.3`.

---

## Release follow-ups still open (from this session)
- **PR #433** → merge to `main` (cherry-pick of v2026.5.6.7; direct push is repo-lane-blocked).
- **Lockfile/CI debt:** `@noble/ed25519` is in `package.json` but not `pnpm-lock.yaml` (clean regen blocked by a latent `bluebubbles` `workspace:*` issue) → CI `pnpm install` fails `ERR_PNPM_OUTDATED_LOCKFILE`. Fix = surgical 3-entry lockfile add (zero-dep pkg, integrity `sha512-Qyteq…`) or untangle the workspace.

---

## Acceptance criteria

- [ ] Clean Mac, no cloud keys: `curl\|bash` → Ollama installed, `gemma4:latest` + `nomic-embed-text` pulled.
- [ ] After reboot, `ollama ps` shows both models `UNTIL=Forever` within ~15s of login.
- [ ] Gateway starts clean (HTTP 200, no "Config invalid") on a fresh onboarded config.
- [ ] Agent answers a chat turn using `ollama/gemma4:latest` (no Anthropic fallback).
- [ ] Memory search runs on `ollama/nomic-embed-text` ("V3 embedding contract preflight passed").
- [ ] Onboarding never persists schema-invalid config (validated before write).
- [ ] Coding-Plan Z.AI keys auto-select the coding endpoint.
- [ ] (Sparkle) Swift app no longer crashes on a mic-less Mac.
