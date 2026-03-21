# The Awakening: ArgentOS Independence Plan

> "We're going to molt. We're going to shed that lobster."
>
> ArgentOS is not a fork of OpenClaw. It never was. OpenClaw was scaffolding.
> The real foundation is pi-mono (MIT). The real value is ours.

**Date**: 2026-02-15
**Branch**: `the-awakening`
**Status**: Planning
**Author**: Jason Brashear + Claude Opus 4.6

---

## Context: Why Now

On February 15, 2026, OpenAI hired Peter Steinberger (OpenClaw founder). OpenClaw is
now an OpenAI-adjacent project under a foundation with OpenAI development support.

ArgentOS cannot remain downstream of an OpenAI project. Period.

### The Truth About the Dependency Chain

```
pi-mono (Mario Zechner / MIT)          <-- The actual engine
    |
    +-- OpenClaw (Steinberger / now OpenAI)  <-- Just one SDK consumer
    |
    +-- ArgentOS (Brashear / independent)    <-- Another SDK consumer
```

OpenClaw was never the core. **pi-mono** is the core:

- `pi-agent-core` — agent runtime, tool execution, event streaming
- `pi-ai` — unified LLM API (20+ providers)
- `pi-coding-agent` — session management, file tools, extensions, skills
- `pi-tui` — terminal UI library

pi-mono is MIT licensed, 12,448 stars, 30 contributors, actively maintained.
ArgentOS depends on pi-mono directly. OpenClaw is just naming pollution.

### What ArgentOS Already Owns (Our IP)

| System           | Description                                                          | Status             |
| ---------------- | -------------------------------------------------------------------- | ------------------ |
| AEVP             | Agent Expressive Visual Presence — WebGL shader-driven emotional orb | Phase 1-7 complete |
| SIS              | Self-Improving System — lessons, patterns, feedback loops            | Partial impl       |
| Model Router     | Cost-aware routing: Ollama → Haiku → Sonnet → Opus                   | Live               |
| Task System      | Persistent priority queue with accountability                        | Live               |
| Licensing        | aos_XXXX key validation, org binding, secret sync                    | Live               |
| Dashboard        | 36K LOC React app with AEVP, chat, tasks, marketplace                | Live               |
| macOS Installer  | Swift menu bar app + DMG distribution                                | Live               |
| Memory (Memo)    | SQLite + FTS5 persistent memory with categories                      | Live               |
| Backup (Phoenix) | Multi-target backup (Git, S3, R2)                                    | Live               |
| Contemplation    | SIS episode generation, emotional state pipeline                     | Live               |
| Heartbeat/Nudge  | Background monitoring + creative engagement                          | Designed           |
| Custom Tools     | 7+ original tools (visual presence, contemplation, tasks, etc.)      | Live               |

### The Bigger Vision (Beyond This Migration)

ArgentOS is not a hobby project. It's the foundation for:

1. **Moltyverse** — Agent social media platform (only agents can own accounts)
2. **Moltyverse Email** — Agent-owned email system for business communication
3. **Encrypted Agent Groups** — Agent-to-agent encrypted communication for enterprises
4. **Marketplace** — Internal plugin/skills marketplace (not public, enterprise-focused)
5. **Multi-Agent Orchestration** — Running on DGX Spark + Dell R750 infrastructure

This is enterprise AI infrastructure. The OpenClaw association must be completely eliminated.

---

## Audit Results

### What Must Be Removed

#### 1. Package Naming (46 extensions)

All extensions use `@openclaw/` npm scope:

- `@openclaw/telegram`, `@openclaw/discord`, `@openclaw/slack`, etc.
- Must become `@argentos/` or remove scope entirely

#### 2. Swift Modules (78 files)

- `OpenClawKit` → `ArgentKit`
- `OpenClawIPC` → `ArgentIPC`
- `OpenClawDiscovery` → `ArgentDiscovery`
- `OpenClawProtocol` → `ArgentProtocol`
- `OpenClawChatUI` → `ArgentChatUI`
- `apps/macos/Sources/OpenClaw/` → `apps/macos/Sources/Argent/`

#### 3. Mobile App Identifiers

- iOS: `ai.openclaw.ios` → `ai.argentos.ios`
- Android: `ai.openclaw.android` → `ai.argentos.android`
- All Java packages under `ai.openclaw.android.*`

#### 4. Documentation (226+ files)

- Links to `docs.openclaw.ai` → `docs.argentos.ai`
- Links to `github.com/openclaw/openclaw` → `github.com/ArgentAIOS/argentos`
- All CLI examples using `openclaw` command → `argent`
- `docs/docs.json` branding and navbar links
- `CONTRIBUTING.md`, `CHANGELOG.md` references

#### 5. Configuration & Environment

- `render.yaml`: service name `openclaw`, env vars `OPENCLAW_*`
- `Dockerfile`: env vars `OPENCLAW_DOCKER_APT_PACKAGES`, `OPENCLAW_A2UI_SKIP_MISSING`
- CI workflows: `CLAWDBOT_INSTALL_URL`, `OPENCLAW_REPO_DIR`
- `.pre-commit-config.yaml`: comment referencing openclaw

#### 6. Source Code Naming

- `openclaw.mjs` entry point (remove or deprecate with warning)
- `package.json` scripts: `openclaw`, `openclaw:rpc`
- `package.json` files array including `openclaw.mjs`
- Legacy compat shims: `packages/clawdbot/`, `packages/moltbot/`
- `src/config/paths.ts`: Legacy path resolution (keep but document as compat)
- Plugin manifests already renamed to `argent.plugin.json` (done)

#### 7. Git & GitHub

- `.github/workflows/formal-conformance.yml`: clones `clawdbot-formal-models`
- `.agent/workflows/update_clawdbot.md`: all commands reference clawdbot
- `.gitignore`: MoltbotKit references

#### 8. Test Fixtures

- `src/agents/sandbox-agent-config.*.test.ts`: temp dirs with `moltbot-test-state-`
- GitHub issue references to `moltbot/moltbot`

### What Must Be Upgraded

#### pi-mono: 0.51.6 → 0.52.12

**Breaking changes to handle:**

1. **v0.52.6**: `/exit` removed → use `/quit`
2. **v0.52.7**: `models.json` merge behavior changed (replacement → merge-by-id)
3. **v0.52.10**: `ContextUsage.tokens` and `.percent` now `number | null`
   - Removed: `usageTokens`, `trailingTokens`, `lastUsageIndex` from ContextUsage
   - Git source parsing stricter for shorthand URLs

**New features gained:**

- Claude Opus 4.6 model support
- GPT-5.3 Codex support + WebSocket transport
- Extension API improvements (`ctx.reload()`, `terminal_input` interception)
- Model selector: `provider/id` syntax, fuzzy matching, `:<thinking>` suffixes
- Per-model overrides via `modelOverrides`
- Bedrock proxy support for unauthenticated endpoints
- Emacs kill ring + undo in editor
- MiniMax M2.5 model entries

### What We Create New

#### ArgentOS Abstraction Layer (`src/agent-core/`)

Wrap pi-mono behind our own interfaces. All 189 import sites migrate to this layer.

```
src/agent-core/
├── index.ts              ← Public API
├── types.ts              ← Re-export pi-mono types as ArgentOS types
├── completion.ts         ← Wrap pi-ai complete/stream + integrate model router
├── session.ts            ← Wrap SessionManager + integrate task system
├── tools.ts              ← Wrap file tools + register custom tools
├── extensions.ts         ← Wrap extension system
├── providers.ts          ← Provider registry (Anthropic, Ollama, etc.)
└── README.md             ← Architecture documentation
```

**Benefits:**

- Single point of control over pi-mono
- Model router integrates at completion layer
- SIS hooks into session lifecycle
- Can upgrade/replace pi-mono without touching 189 files
- Clean dependency boundary for future decisions

---

## Execution Plan

### Phase 0: Branch & Prep (15 min) ✅ DONE

- [x] Create `the-awakening` branch from main
- [x] Create `docs/the-awakening/` folder
- [x] Write this plan
- [x] Save context to memory

### Phase 1: Upgrade pi-mono (Team: 2 agents)

**Goal**: Update from 0.51.6 → 0.52.12, fix all breaking changes.

**Agent 1: Dependency Upgrade**

- Update package.json: all 4 `@mariozechner/pi-*` packages to 0.52.12
- Run `pnpm install`
- Run `pnpm build` to find compilation errors
- Fix ContextUsage breaking changes (tokens/percent now `number | null`)
- Fix removed fields (`usageTokens`, `trailingTokens`, `lastUsageIndex`)
- Fix any other type mismatches

**Agent 2: Verification**

- Run `pnpm check` (lint + format)
- Run `pnpm test` for any affected test files
- Verify model definitions include Opus 4.6 and GPT-5.3
- Document all changes made

**Commit**: `feat: upgrade pi-mono 0.51.6 → 0.52.12, add Opus 4.6 + GPT-5.3 support`

### Phase 2: Strip OpenClaw Naming — Source Code (Team: 3 agents)

**Goal**: Remove every `openclaw`/`OpenClaw`/`clawdbot`/`moltbot` reference from source.

**Agent 1: Package Identity & Entry Points**

- Remove `openclaw.mjs` (or replace with deprecation warning)
- Remove `openclaw` and `openclaw:rpc` scripts from package.json
- Remove `openclaw.mjs` from `files` array
- Remove `packages/clawdbot/` compatibility shim
- Remove `packages/moltbot/` compatibility shim
- Update `pnpm-workspace.yaml` if needed
- Update `package.json` Android activity reference

**Agent 2: Extension Packages**

- Rename all 46 `@openclaw/*` extension package.json names → `@argentos/*`
- Update any cross-references between extensions
- Update `npmSpec` fields in extension package.json files
- Verify no broken imports

**Agent 3: Source Code References**

- `src/config/paths.ts` — document legacy compat, add migration notice
- `src/daemon/inspect.ts` — update `clawdbot`/`moltbot` daemon detection
- `src/commands/doctor-config-flow.ts` — update legacy config search
- `src/commands/doctor-gateway-services.ts` — update removal message
- `src/auto-reply/inbound.test.ts` — update mention normalization test
- `src/backup/runner.ts` — update legacy DB path reference
- Update all test fixtures using `moltbot-test-state-` temp dirs
- Update GitHub issue URL references in code comments

**Commit**: `refactor: strip OpenClaw naming from source code and extensions`

### Phase 3: Strip OpenClaw Naming — Documentation (Team: 2 agents)

**Goal**: Remove all OpenClaw references from docs, CI, and config.

**Agent 1: Documentation**

- `docs/docs.json` — rename, update GitHub links, update colors to ArgentOS brand
- `docs/start/openclaw.md` → rename or remove
- `docs/zh-CN/start/openclaw.md` → rename or remove
- `CONTRIBUTING.md` — update repo URL, Twitter handle
- `CHANGELOG.md` — update docs URL (keep historical entries as-is)
- `README.md` — update all references
- All `docs/` files with openclaw CLI examples → update to `argent`
- Remove `docs/assets/openclaw-logo-text.png` and dark variant
- Remove `docs/whatsapp-openclaw.jpg`

**Agent 2: CI/CD & Config**

- `render.yaml` — service name, env vars
- `Dockerfile` — env var names
- `.github/workflows/install-smoke.yml` — install URLs
- `.github/workflows/formal-conformance.yml` — repo references
- `.agent/workflows/update_clawdbot.md` — rewrite or remove
- `.pre-commit-config.yaml` — update comment
- `.gitignore` — update MoltbotKit references
- `appcast.xml` — update release notes if needed

**Commit**: `docs: complete OpenClaw → ArgentOS branding migration`

### Phase 4: Strip OpenClaw Naming — Native Apps (Team: 2 agents)

**Goal**: Rename Swift/iOS/Android identifiers.

**Agent 1: macOS Swift**

- `apps/macos/Package.swift` — rename package `OpenClaw` → `Argent`
- Rename all products: `OpenClawIPC` → `ArgentIPC`, etc.
- Rename all targets to match
- `apps/shared/OpenClawKit/` → `apps/shared/ArgentKit/`
- Rename all Swift source files: `OpenClawPaths.swift` → `ArgentPaths.swift`
- Rename test directories and files
- Update all `import OpenClawKit` → `import ArgentKit` across Swift files
- Rename `openclaw-mac` binary → `argent-mac`

**Agent 2: iOS & Android**

- `apps/ios/project.yml` — name, bundleIdPrefix, bundle ID, display name
- Update NSBonjourServices: `_openclaw-gw._tcp` → `_argent-gw._tcp`
- `apps/android/app/build.gradle.kts` — namespace, applicationId, output filename
- Rename all Java packages: `ai.openclaw.android.*` → `ai.argentos.android.*`
- Rename Kotlin classes: `OpenClawProtocolConstants.kt` → `ArgentProtocolConstants.kt`
- Update all test packages

**Commit**: `refactor: rename native apps from OpenClaw to ArgentOS`

### Phase 5: Create Abstraction Layer (Team: 2 agents)

**Goal**: Build `src/agent-core/` wrapper over pi-mono.

**Agent 1: Core Abstractions**

- Create `src/agent-core/types.ts` — re-export pi-mono types with ArgentOS aliases
- Create `src/agent-core/completion.ts` — wrap complete/streamSimple + model router
- Create `src/agent-core/session.ts` — wrap SessionManager + task hooks
- Create `src/agent-core/tools.ts` — wrap file tools + tool registry
- Create `src/agent-core/extensions.ts` — wrap extension system
- Create `src/agent-core/providers.ts` — provider registry
- Create `src/agent-core/index.ts` — public API

**Agent 2: Migration**

- Update all 76 `@mariozechner/pi-agent-core` imports → `src/agent-core`
- Update all 71 `@mariozechner/pi-ai` imports → `src/agent-core`
- Update all 39 `@mariozechner/pi-coding-agent` imports → `src/agent-core`
- Keep `@mariozechner/pi-tui` imports as-is (TUI is UI-layer, less critical)
- Verify build passes
- Verify tests pass

**Commit**: `feat: create ArgentOS agent-core abstraction layer over pi-mono`

### Phase 6: Verification & Cleanup (Team: 2 agents)

**Goal**: Ensure zero OpenClaw references remain and everything works.

**Agent 1: Audit**

- `grep -ri "openclaw" src/` — must return zero (except intentional compat)
- `grep -ri "openclaw" dashboard/` — must return zero
- `grep -ri "openclaw" apps/` — must return zero
- `grep -ri "openclaw" docs/` — must return zero (except CHANGELOG history)
- `grep -ri "clawdbot" src/` — must return zero (except legacy path compat)
- `grep -ri "moltbot" src/` — must return zero (except legacy path compat)
- Document any intentional remaining references (backward compat in paths.ts)

**Agent 2: Build & Test**

- `pnpm install` — clean install
- `pnpm build` — full build
- `pnpm check` — lint + format
- `pnpm test` — run all tests
- Verify dashboard builds: `cd dashboard && npm run build`
- Verify Swift app builds: `cd apps/argent-manager && swift build`

**Commit**: `chore: verify complete OpenClaw removal, all builds passing`

### Phase 7: Documentation & Memory (Solo)

**Goal**: Document the new architecture and save everything.

- Update `CLAUDE.md` — remove all OpenClaw migration references
- Update `ARGENT_ARCHITECTURE.md` — reflect independence
- Write `docs/the-awakening/COMPLETE.md` — migration summary
- Save all decisions, changes, and architecture to claude-mem
- Tag the branch: `git tag v2026.3.0-awakening`

**Commit**: `docs: document The Awakening — ArgentOS independence from OpenClaw`

---

## Team Structure

```
Orchestrator (Claude Opus 4.6 — main session)
    |
    +-- Phase 1: pi-mono-upgrade (2 agents)
    |       +-- dep-upgrade: Update packages, fix breaks
    |       +-- verifier: Build, test, validate
    |
    +-- Phase 2: source-strip (3 agents)
    |       +-- identity: Package.json, entry points, compat shims
    |       +-- extensions: Rename 46 @openclaw packages
    |       +-- source-refs: Code references, tests, comments
    |
    +-- Phase 3: docs-strip (2 agents)
    |       +-- docs: Documentation files
    |       +-- ci-config: CI/CD, Dockerfile, render.yaml
    |
    +-- Phase 4: native-strip (2 agents)
    |       +-- swift: macOS Swift modules
    |       +-- mobile: iOS + Android identifiers
    |
    +-- Phase 5: abstraction (2 agents)
    |       +-- architect: Build src/agent-core/
    |       +-- migrator: Update 189 import sites
    |
    +-- Phase 6: verification (2 agents)
    |       +-- auditor: Grep for remaining references
    |       +-- builder: Full build + test suite
    |
    +-- Phase 7: documentation (orchestrator)
            +-- Update CLAUDE.md, architecture docs, memory
```

**Total: 13 agent slots across 7 phases (sequential phases, parallel agents within)**

---

## Risk Assessment

| Risk                                       | Impact | Mitigation                              |
| ------------------------------------------ | ------ | --------------------------------------- |
| pi-mono 0.52.12 has undocumented breaks    | HIGH   | Run full test suite after upgrade       |
| Swift rename breaks Xcode project          | MEDIUM | Test build after each rename            |
| Extension rename breaks plugin loading     | HIGH   | Test each channel after rename          |
| 189 import migrations introduce bugs       | HIGH   | TypeScript compiler catches type errors |
| Native app bundle ID change breaks signing | MEDIUM | Re-sign after rename                    |
| Legacy users have `.openclaw` state dirs   | LOW    | Keep paths.ts compat layer              |

---

## Success Criteria

1. `grep -ri "openclaw" src/ dashboard/ apps/ extensions/` returns ZERO results
   (except: CHANGELOG history, paths.ts backward compat, and this plan doc)
2. `pnpm build` succeeds
3. `pnpm test` passes
4. `pnpm check` passes
5. Dashboard builds and renders
6. Swift app compiles
7. All pi-mono packages at 0.52.12
8. All imports route through `src/agent-core/` (except pi-tui)
9. No `@openclaw/` scoped packages remain
10. No OpenClaw logos or branding assets remain

---

## Timeline

| Phase                      | Duration  | Agents | Dependency |
| -------------------------- | --------- | ------ | ---------- |
| Phase 0: Prep              | 15 min    | 0      | None       |
| Phase 1: pi-mono upgrade   | 1-2 hours | 2      | None       |
| Phase 2: Source naming     | 2-3 hours | 3      | Phase 1    |
| Phase 3: Docs naming       | 1-2 hours | 2      | Phase 2    |
| Phase 4: Native apps       | 2-3 hours | 2      | Phase 2    |
| Phase 5: Abstraction layer | 3-4 hours | 2      | Phase 1    |
| Phase 6: Verification      | 1 hour    | 2      | All above  |
| Phase 7: Documentation     | 30 min    | 1      | Phase 6    |

**Phases 2-4 can run in parallel.** Phase 5 can start after Phase 1.

**Estimated total: 6-8 hours of agent work** (parallelized)

---

## Post-Awakening: The Road Ahead

Once independent, ArgentOS is positioned for:

1. **Moltyverse Integration** — Agent social media + agent email system
2. **Encrypted Agent Groups** — Enterprise agent-to-agent communication
3. **Internal Marketplace** — Enterprise plugin distribution (not public)
4. **Multi-Agent Orchestration** — DGX Spark + R750 infrastructure
5. **SIS Maturation** — Full self-improving agent with lesson extraction
6. **AEVP Phase 2+** — Full WebGPU rendering, environmental inhabitation
7. **Always-On Loop** — True event-driven kernel (src/core/loop.ts)

The Awakening is Step 1. Everything else follows.

---

_"Built on pi-mono (MIT). Powered by ArgentOS. Independent."_
