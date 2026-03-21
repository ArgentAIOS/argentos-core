# OpenClaw Reference Inventory

> Complete inventory of every OpenClaw/ClawdBot/MoltBot reference in the ArgentOS codebase.
> Agents should use this as their work manifest.

---

## 1. Package Identity & Entry Points

### package.json (root)

- Line 20: `"openclaw.mjs"` in files array → REMOVE
- Line 35: `ai.openclaw.android/.MainActivity` → `ai.argentos.android/.MainActivity`
- Line 69: `"openclaw"` script → REMOVE
- Line 70: `"openclaw:rpc"` script → REMOVE

### Entry Points

- `/openclaw.mjs` → REMOVE (or replace with deprecation warning)

### Compatibility Shims

- `packages/clawdbot/` → REMOVE entire directory
- `packages/moltbot/` → REMOVE entire directory
- Update `pnpm-workspace.yaml` to remove these from workspace

---

## 2. Extension Packages (@openclaw/ → @argentos/)

All 46 extensions in `extensions/` need package.json name changes:

```
extensions/bluebubbles/     @openclaw/bluebubbles     → @argentos/bluebubbles
extensions/copilot-proxy/   @openclaw/copilot-proxy   → @argentos/copilot-proxy
extensions/diagnostics-otel/@openclaw/diagnostics-otel→ @argentos/diagnostics-otel
extensions/discord/         @openclaw/discord          → @argentos/discord
extensions/feishu/          @openclaw/feishu           → @argentos/feishu
extensions/google-antigravity-auth/  @openclaw/...     → @argentos/...
extensions/google-chat/     @openclaw/google-chat      → @argentos/google-chat
extensions/google-gemini-cli-auth/   @openclaw/...     → @argentos/...
extensions/imessage/        @openclaw/imessage         → @argentos/imessage
extensions/line/            @openclaw/line             → @argentos/line
extensions/llm-task/        @openclaw/llm-task         → @argentos/llm-task
extensions/lobster/         @openclaw/lobster          → @argentos/lobster
extensions/matrix/          @openclaw/matrix           → @argentos/matrix
extensions/mattermost/      @openclaw/mattermost       → @argentos/mattermost
extensions/memory-core/     @openclaw/memory-core      → @argentos/memory-core
extensions/memory-lancedb/  @openclaw/memory-lancedb   → @argentos/memory-lancedb
extensions/minimax-portal-auth/ @openclaw/...          → @argentos/...
extensions/nextcloud-talk/  @openclaw/nextcloud-talk   → @argentos/nextcloud-talk
extensions/nostr/           @openclaw/nostr            → @argentos/nostr
extensions/open-prose/      @openclaw/open-prose       → @argentos/open-prose
extensions/qwen-portal-auth/@openclaw/qwen-portal-auth→ @argentos/qwen-portal-auth
extensions/signal/          @openclaw/signal           → @argentos/signal
extensions/slack/           @openclaw/slack            → @argentos/slack
extensions/teams/           @openclaw/teams            → @argentos/teams
extensions/telegram/        @openclaw/telegram         → @argentos/telegram
extensions/tlon/            @openclaw/tlon             → @argentos/tlon
extensions/twitch/          @openclaw/twitch           → @argentos/twitch
extensions/voice-call/      @openclaw/voice-call       → @argentos/voice-call
extensions/whatsapp/        @openclaw/whatsapp         → @argentos/whatsapp
extensions/zalo/            @openclaw/zalo             → @argentos/zalo
(+ any others discovered during execution)
```

Also update `npmSpec` fields and any cross-references between extensions.

---

## 3. Swift / macOS Native (78+ files)

### Package.swift (apps/macos/)

- Line 2: Comment "Package manifest for the OpenClaw macOS companion" → "ArgentOS"
- Line 7: `name: "OpenClaw"` → `name: "Argent"`
- Lines 12-15: Products `OpenClawIPC`, `OpenClawDiscovery`, `OpenClaw`, `openclaw-mac`
  → `ArgentIPC`, `ArgentDiscovery`, `Argent`, `argent-mac`
- Lines 28-90: All target names

### Shared Framework

- `apps/shared/OpenClawKit/` → `apps/shared/ArgentKit/`
  - `Sources/OpenClawKit/` → `Sources/ArgentKit/`
  - `Sources/OpenClawProtocol/` → `Sources/ArgentProtocol/`
  - `Sources/OpenClawChatUI/` → `Sources/ArgentChatUI/`
  - `Tests/OpenClawKitTests/` → `Tests/ArgentKitTests/`

### macOS Sources

- `apps/macos/Sources/OpenClaw/` → `apps/macos/Sources/Argent/`
  - All files: `OpenClawPaths.swift`, `OpenClawConfigFile.swift`, `OpenClawLogging.swift`, etc.
- `apps/macos/Sources/OpenClawMacCLI/` → `apps/macos/Sources/ArgentMacCLI/`
- `apps/macos/Tests/OpenClawIPCTests/` → `apps/macos/Tests/ArgentIPCTests/`

### All Swift imports

- `import OpenClawKit` → `import ArgentKit` (across all Swift files)
- `import OpenClawProtocol` → `import ArgentProtocol`
- `import OpenClawChatUI` → `import ArgentChatUI`
- `import OpenClawIPC` → `import ArgentIPC`
- `import OpenClawDiscovery` → `import ArgentDiscovery`

---

## 4. iOS App

### project.yml

- Line 1: `name: OpenClaw` → `name: ArgentOS`
- Line 3: `bundleIdPrefix: ai.openclaw` → `bundleIdPrefix: ai.argentos`
- Line 74: Bundle ID `ai.openclaw.ios` → `ai.argentos.ios`
- Line 82: Display name `OpenClaw` → `ArgentOS`
- Line 91: NSLocalNetworkUsageDescription mentions "OpenClaw" → "ArgentOS"
- Line 95: NSBonjourServices `_openclaw-gw._tcp` → `_argent-gw._tcp`
- Lines 13-14, 23, 35-40: Package references `OpenClawKit` → `ArgentKit`

---

## 5. Android App

### build.gradle.kts

- namespace: `ai.openclaw.android` → `ai.argentos.android`
- applicationId: `ai.openclaw.android` → `ai.argentos.android`
- Output filename: `openclaw-${versionName}` → `argentos-${versionName}`

### Java/Kotlin Sources

- All packages under `ai.openclaw.android.*` → `ai.argentos.android.*`
- Classes: `OpenClawProtocolConstants.kt` → `ArgentProtocolConstants.kt`
- `OpenClawCanvasA2UIAction.kt` → `ArgentCanvasA2UIAction.kt`
- `OpenClawTheme.kt` → `ArgentTheme.kt`
- 20+ test files under `ai/openclaw/android/`

---

## 6. Documentation

### docs/docs.json

- `"name": "OpenClaw"` → `"name": "ArgentOS"`
- GitHub link: `github.com/openclaw/openclaw` → `github.com/ArgentAIOS/argentos`
- Releases link: same
- Colors: update to ArgentOS brand

### Key docs files

- `docs/start/openclaw.md` → rename to `docs/start/argentos.md` or remove
- `docs/zh-CN/start/openclaw.md` → same
- `CONTRIBUTING.md` line 7: repo URL, line 9: Twitter handle
- `CHANGELOG.md` line 3: docs URL (keep historical entries)
- `README.md`: all references
- `docs/acp.md`: CLI examples using `openclaw acp` → `argent acp`
- `docs/plugin.md`: references to `openclaw plugins list`, `@openclaw/`, etc.

### Assets to remove

- `docs/assets/openclaw-logo-text.png`
- `docs/assets/openclaw-logo-text-dark.png`
- `docs/whatsapp-openclaw.jpg`

---

## 7. CI/CD & Deployment

### .github/workflows/

- `install-smoke.yml` lines 35-36: `CLAWDBOT_INSTALL_URL`, `CLAWDBOT_INSTALL_CLI_URL`
- `formal-conformance.yml`: clones `vignesh07/clawdbot-formal-models`, `OPENCLAW_REPO_DIR`

### Deployment

- `render.yaml` line 3: `name: openclaw` → `name: argentos`
- `render.yaml` lines 12-16: `OPENCLAW_STATE_DIR`, `OPENCLAW_WORKSPACE_DIR`, `OPENCLAW_GATEWAY_TOKEN`
  → `ARGENT_STATE_DIR`, `ARGENT_WORKSPACE_DIR`, `ARGENT_GATEWAY_TOKEN`
- `Dockerfile` line 11: `OPENCLAW_DOCKER_APT_PACKAGES` → `ARGENT_DOCKER_APT_PACKAGES`
- `Dockerfile` line 27: `OPENCLAW_A2UI_SKIP_MISSING` → `ARGENT_A2UI_SKIP_MISSING`
- `Dockerfile` line 29: `OPENCLAW_PREFER_PNPM` → `ARGENT_PREFER_PNPM`

### Other

- `.pre-commit-config.yaml` line 1: comment `# Pre-commit hooks for openclaw`
- `.agent/workflows/update_clawdbot.md`: entire file uses clawdbot commands
- `.gitignore`: `apps/shared/MoltbotKit/.build/`, `bin/clawdbot-mac`, `apps/shared/MoltbotKit/.swiftpm/`

---

## 8. Source Code References

### Active code

- `src/daemon/inspect.ts` lines 18, 26, 138, 180: `"clawdbot" | "moltbot"` daemon markers
- `src/commands/doctor-config-flow.ts` lines 166-167: legacy config file search
- `src/commands/doctor-gateway-services.ts` line 232: removal message for legacy services
- `src/backup/runner.ts`: `~/.openclaw-mem/memory.db` legacy path

### Config (backward compat — KEEP but document)

- `src/config/paths.ts` lines 19-22: `LEGACY_STATE_DIRNAMES`, `LEGACY_CONFIG_FILENAMES`
- `src/config/paths.ts` lines 53, 175, 181: `CLAWDBOT_STATE_DIR`, `CLAWDBOT_CONFIG_PATH`, `CLAWDBOT_GATEWAY_PORT`
  → These are INTENTIONAL backward compat. Keep but add clear comments.

### Tests

- `src/agents/sandbox-agent-config.*.test.ts`: `moltbot-test-state-` temp dir prefix
- `src/auto-reply/inbound.test.ts`: mention normalization for `openclaw`
- `src/gateway/server-methods/chat.ts` line 469: GitHub issue `moltbot/moltbot/issues/3658`
- `src/agents/system-prompt.test.ts` lines 203-218: GitHub issue references

---

## 9. Package.json Environment Variables (in scripts)

- Lines 54-55, 94-97, 101, 240: `CLAWDBOT_SKIP_CHANNELS`, `CLAWDBOT_E2E_MODELS`
  → Update to `ARGENT_SKIP_CHANNELS`, `ARGENT_E2E_MODELS`

---

## Summary Count

| Category          | Items    | Impact   |
| ----------------- | -------- | -------- |
| Package identity  | ~12      | Critical |
| Extension renames | ~46      | Critical |
| Swift modules     | ~78      | High     |
| iOS config        | ~10      | High     |
| Android packages  | ~25      | High     |
| Documentation     | ~226     | Medium   |
| CI/CD config      | ~8       | Medium   |
| Source code       | ~15      | Medium   |
| Test fixtures     | ~8       | Low      |
| Git/GitHub        | ~5       | Low      |
| **TOTAL**         | **~433** |          |
