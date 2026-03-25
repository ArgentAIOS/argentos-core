# ArgentOS - The Operating System for Personal AI

<p align="center">
  <strong>https://argentos.ai</strong>
</p>

<p align="center">
  <a href="https://github.com/ArgentAIOS/argentos/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/ArgentAIOS/argentos/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/ArgentAIOS/argentos/releases"><img src="https://img.shields.io/github/v/release/ArgentAIOS/argentos?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**ArgentOS** is an always-on personal AI operating system. It manages your AI agent the way an OS manages processes: persistent memory, scheduled tasks, model routing, self-improving behavior, and a visual dashboard — all running locally on your hardware.

Built on the [pi-mono](https://github.com/badlogic/pi-mono) agent toolkit with 20+ messaging channels, it adds the layers that turn a chat assistant into a true AI operating system.

## The OS Metaphor

| OS Concept    | ArgentOS                                                                   |
| ------------- | -------------------------------------------------------------------------- |
| **Kernel**    | Always-On Loop — event queue with state machine                            |
| **Memory**    | Memo — SQLite + FTS5, auto-capture, semantic search                        |
| **Scheduler** | Task System — priority queue with projects & accountability                |
| **Drivers**   | Channels — Telegram, Discord, Slack, Signal, WhatsApp, iMessage, + 14 more |
| **Resources** | Model Router — local Llama, Haiku, Sonnet, Opus (cost-aware)               |
| **Learning**  | SIS — lessons, patterns, feedback loops                                    |
| **Backup**    | Phoenix — local, Git, S3, R2                                               |
| **Shell**     | Dashboard — React + Live2D avatar + doc panel                              |

## Architecture

```
  Channels        Schedule       Webhooks
  (20+ platforms)  (cron)        (HTTP)
       │              │              │
       ▼              ▼              ▼
  ┌──────────────────────────────────────┐
  │              Gateway                 │
  │         ws://127.0.0.1:18789         │
  │                                      │
  │  ┌────────┐  ┌──────┐  ┌─────────┐  │
  │  │ Agent  │  │ Task │  │  Model  │  │
  │  │Runtime │  │Queue │  │ Router  │  │
  │  └───┬────┘  └──┬───┘  └────┬────┘  │
  │      │          │           │        │
  │  ┌───┴──────────┴───────────┴────┐   │
  │  │         Memo (Memory)         │   │
  │  │     SQLite + FTS5 search      │   │
  │  └──────────────────────────────-┘   │
  └──────────────┬───────────────────────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
 Dashboard    CLI         Companion
 (React +     (argent)    Apps (macOS,
  Live2D)                  iOS, Android)
```

## What's Built

### Core Systems

- **Persistent Memory (Memo)** — Every conversation, observation, and lesson stored in SQLite with FTS5 full-text search. Auto-capture from agent events. Semantic search across all history.

- **Task System + Projects** — Full task lifecycle (pending, in_progress, blocked, completed, failed). Projects group related tasks with progress tracking. Agent creates, manages, and completes tasks autonomously. Dashboard shows real-time progress.

- **Phoenix Backup** — Automated backup of agent state to local, Git, S3, or R2 targets. Scheduled via cron. Self-maintaining.

- **Dashboard** — React web UI with Live2D avatar, chat panel, task board, projects tab, doc panel (slide-out documents), calendar, cron job management, and ElevenLabs TTS with voice selection.

- **20+ Messaging Channels** — WhatsApp, Telegram, Slack, Discord, Signal, iMessage (BlueBubbles), Google Chat, Microsoft Teams, Matrix, WebChat, and more. Group routing, mention gating, DM pairing security.

### Agent Capabilities

- **Browser Control** — Dedicated Chrome/Chromium with CDP, snapshots, actions, uploads
- **Voice Wake + Talk Mode** — Always-on speech for macOS/iOS/Android with ElevenLabs
- **Live Canvas** — Agent-driven visual workspace on device screens
- **Cron + Webhooks** — Scheduled tasks, Gmail Pub/Sub, HTTP triggers
- **Skills Platform** — Bundled, managed, and workspace skills with install gating
- **Doc Panel** — Agent writes reports, guides, and code to a slide-out panel in the dashboard

### Model Support

- **Anthropic** — Claude Opus, Sonnet, Haiku (recommended)
- **Ollama** — Local models (Llama 3.2, DeepSeek, etc.) — auto-discovered
- **OpenAI** — GPT-4, o1, etc.
- **12+ Providers** — Google Gemini, AWS Bedrock, GitHub Copilot, MiniMax, Moonshot, Venice, Qwen, Xiaomi, Cloudflare
- **Model Fallback** — Automatic retry with rate-limit awareness and profile cooldowns

## Install

Runtime: **Node 22+**

```bash
# Hosted installer (default rail: git checkout + private Node fallback when needed)
curl -fsSL https://argentos.ai/install.sh | bash
```

The wizard walks through gateway, workspace, channels, and skills. Installs the Gateway daemon (launchd/systemd) so it stays running. Use `--no-onboard` to skip, or run `argent onboard --install-daemon` manually later.

Manual npm install remains available when the package is published and resolvable:

```bash
npm install -g argentos@latest
# or: pnpm add -g argentos@latest
```

### From Source

```bash
git clone https://github.com/ArgentAIOS/argentos.git
cd argentos

pnpm install
pnpm build

pnpm argent onboard --install-daemon

# Dev loop (auto-reload on TS changes)
pnpm gateway:watch
```

### Dashboard

```bash
cd dashboard
npm install
npm run dev
# Opens at http://localhost:8080
```

## Quick Start

```bash
# Start the gateway
argent gateway --port 18789 --verbose

# Start the dashboard
cd dashboard && npm run dev

# Send a message
argent message send --to +1234567890 --message "Hello from ArgentOS"

# Talk to the agent
argent agent --message "Create a project for website redesign" --thinking high

# Start the Command Center TUI
argentos cs
```

## Configuration

Main config: `~/.argentos/argent.json`

```
~/.argentos/
├── argent.json        # Main configuration
├── data/
│   └── dashboard.db   # Tasks, projects, canvas docs
├── extensions/        # Custom plugins
├── memory/            # Memo database
└── backup/            # Phoenix snapshots
```

## Security

ArgentOS connects to real messaging surfaces. Inbound DMs are **untrusted input**.

- **DM pairing** (default) — Unknown senders receive a pairing code. Approve with `argent pairing approve <channel> <code>`.
- **Open DMs** — Explicit opt-in with `dmPolicy="open"` and allowlist.
- Run `argent doctor` to check for risky configurations.

Full guide: [Security](https://docs.argentos.ai/gateway/security)

## Migration Status

| Phase                    | Description                              | Status      |
| ------------------------ | ---------------------------------------- | ----------- |
| 1. Fork & Restructure    | Git reset, org created, rename           | Done        |
| 2. Memory (Memo)         | Persistent memory with SQLite + FTS5     | Done        |
| 3. Backup (Phoenix)      | Automated backup system                  | Done        |
| 4. Dashboard             | React UI with Live2D, tasks, chat        | Done        |
| 5. Task System           | Tasks, projects, agent tools             | Done        |
| 6. Model Router          | Complexity-based routing (local to Opus) | In Progress |
| 7. Always-On Loop        | Event queue, state machine, heartbeat    | Planned     |
| 8. Self-Improving System | Lessons, patterns, feedback loops        | Planned     |

## Documentation

- [Architecture](ARGENT_ARCHITECTURE.md) — Full vision, always-on loop, model router design
- [SIS Architecture](docs/argent/SIS_ARCHITECTURE.md) — Self-Improving System design
- [Migration Guide](docs/argent/MIGRATION.md) — OpenClaw to ArgentOS migration
- [Documentation Index](docs/argent/INDEX.md) — Complete doc reference
- [ArgentOS Docs](https://docs.argentos.ai) — Channel setup, tools, gateway

## Key Subsystems

| Subsystem | Docs                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway   | [Architecture](https://docs.argentos.ai/gateway), [Configuration](https://docs.argentos.ai/gateway/configuration)                                                 |
| Channels  | [All channels](https://docs.argentos.ai/channels), [Troubleshooting](https://docs.argentos.ai/channels/troubleshooting)                                           |
| Models    | [Config](https://docs.argentos.ai/concepts/models), [Failover](https://docs.argentos.ai/concepts/model-failover)                                                  |
| Tools     | [Browser](https://docs.argentos.ai/tools/browser), [Canvas](https://docs.argentos.ai/platforms/mac/canvas), [Cron](https://docs.argentos.ai/automation/cron-jobs) |
| Voice     | [Voice Wake](https://docs.argentos.ai/nodes/voicewake), [Talk Mode](https://docs.argentos.ai/nodes/talk)                                                          |
| Apps      | [macOS](https://docs.argentos.ai/platforms/macos), [iOS](https://docs.argentos.ai/platforms/ios), [Android](https://docs.argentos.ai/platforms/android)           |
| Nodes     | [Devices](https://docs.argentos.ai/nodes), [Camera](https://docs.argentos.ai/nodes/images), [Location](https://docs.argentos.ai/nodes/location-command)           |

## License

MIT
