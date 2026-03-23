<p align="center">
  <img src="https://argentos.ai/img/Argent_OS_ICON.webp" width="120" alt="ArgentOS" />
</p>

<h1 align="center">ArgentOS</h1>

<p align="center">
  <strong>The Operating System for Personal AI</strong><br/>
  <em>One continuous, truthful, self-directed mind.</em>
</p>

<p align="center">
  <a href="https://argentos.ai">Website</a> ·
  <a href="https://docs.argentos.ai">Docs</a> ·
  <a href="https://marketplace.argentos.ai">Marketplace</a> ·
  <a href="https://discord.gg/argentos">Discord</a> ·
  <a href="https://x.com/argentAIOS">Twitter</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
  <a href="https://marketplace.argentos.ai"><img src="https://img.shields.io/badge/marketplace-54%2B%20skills-28c840?style=flat-square" alt="Marketplace" /></a>
  <a href="https://discord.gg/argentos"><img src="https://img.shields.io/badge/discord-join-5865F2?style=flat-square" alt="Discord" /></a>
</p>

---

A self-hosted AI that runs on your hardware. Persistent memory, autonomous thinking, voice interaction, and multi-channel communication — all under your complete control.

Most AI tools forget you between sessions. ArgentOS remembers everything.
Most agents wait for commands. ArgentOS thinks on its own.
Most frameworks need a cloud. ArgentOS runs on your Mac.

## Install

```bash
curl -fsSL https://argentos.ai/install.sh | bash
```

That's it. Clones the repo, provisions a private Node 22 runtime, installs dependencies, and runs onboarding.

```bash
# Beta channel
curl -fsSL https://argentos.ai/install.sh | bash -s -- --beta

# Skip onboarding
curl -fsSL https://argentos.ai/install.sh | bash -s -- --no-onboard

# Quiet mode (no prompts)
curl -fsSL https://argentos.ai/install.sh | bash -s -- --no-prompt
```

<details>
<summary><strong>Build from source (contributors)</strong></summary>

```bash
git clone https://github.com/ArgentAIOS/core.git
cd core && pnpm install && pnpm build
pnpm argent
```

Requires Node 22.12+. Sets up state in `~/.argentos`, workspace in `~/argent`, CLI in `~/bin`, and gateway + dashboard as LaunchAgents.

</details>

## What Makes It Different

### Memory That Never Forgets

12,500+ lines of memory system. SQLite FTS5 + pgvector hybrid search. Every conversation, observation, and lesson is captured automatically. Entity tracking, emotional context, embeddings, significance scoring. Your AI builds a real understanding of who you are — not just what you said five minutes ago.

### A Mind That Thinks On Its Own

The contemplation loop runs every 30 minutes when idle. Journals episodes, extracts lessons, consolidates patterns through the Self-Improving System. Your AI doesn't just respond to prompts — it reflects, learns, and grows.

### Voice

Talk naturally. ElevenLabs TTS, speech recognition, wake word detection. It speaks back in the voice you choose.

### Every Channel, One Mind

Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Google Chat. Seven channels, unified context. One AI identity across every conversation.

### 50+ Agent Tools

Browser control, task management, web search, file operations, memory recall, code execution, media generation, calendar, email — and a [marketplace](https://marketplace.argentos.ai) with 54+ community skills you can install with one command.

### Smart Model Routing

Complexity scoring routes each request to the right tier:

| Tier     | Models         | Cost | When              |
| -------- | -------------- | ---- | ----------------- |
| Local    | Ollama / Qwen3 | Free | Simple tasks      |
| Fast     | Haiku          | $    | Quick responses   |
| Balanced | Sonnet         | $$   | Most work         |
| Powerful | Opus           | $$$  | Complex reasoning |

15+ providers. Automatic failover. Rate-limit awareness.

### Real Dashboard

React web UI with AEVP particle avatar, chat panel, task board, project kanban, config panel, alignment docs editor, and execution worker controls. Not a terminal app — a proper operating surface.

## Architecture

```
  Channels (7+)     Cron        Webhooks       CLI
       │              │              │           │
       ▼              ▼              ▼           ▼
  ┌─────────────────────────────────────────────────┐
  │                   Gateway                       │
  │              ws://localhost:18789                │
  │                                                 │
  │   Agent Runtime · Memory (MemU) · Model Router  │
  │   Task Queue · Contemplation · SIS · Heartbeat  │
  │   Knowledge RAG · Intent Engine · Exec Worker   │
  └──────────────────────┬──────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      Dashboard        macOS         Mobile
      (React)          App          (iOS/Android)
```

## Marketplace

Every package scanned by [VirusTotal](https://www.virustotal.com) (70+ engines) and the ArgentOS AI Safety scanner.

```bash
argent marketplace install hubspot-api
argent marketplace install deep-research-pro
argent marketplace install self-improving-agent
```

Browse, submit, and install: **[marketplace.argentos.ai](https://marketplace.argentos.ai)**

## Quick Start

```bash
argent gateway start          # Start the gateway
argent status                 # Check health
argent chat "Hello"           # Talk to your agent
argent marketplace install obsidian   # Add a skill
```

## Core vs Business

This repo is **ArgentOS Core** — the free, open-source relationship layer.

|                           | Core (this repo) | Business (coming soon) |
| ------------------------- | ---------------- | ---------------------- |
| Memory & contemplation    | ✓                | ✓                      |
| Voice & channels          | ✓                | ✓                      |
| Tasks & dashboard         | ✓                | ✓                      |
| Model routing             | ✓                | ✓                      |
| 54+ marketplace skills    | ✓                | ✓                      |
| Intent governance         | —                | ✓                      |
| Workforce orchestration   | —                | ✓                      |
| Execution workers         | —                | ✓                      |
| Simulation gates          | —                | ✓                      |
| Team controls & approvals | —                | ✓                      |

Start with Core for the relationship layer. Upgrade to Business when you need governance, workforce, and control.

## Development

```bash
pnpm install && pnpm build && pnpm test
```

```bash
# Install smoke test
pnpm test:install:local:smoke

# Code review (CodeRabbit)
pnpm review:coderabbit
```

## Links

|                   |                                                            |
| ----------------- | ---------------------------------------------------------- |
| **Website**       | [argentos.ai](https://argentos.ai)                         |
| **Documentation** | [docs.argentos.ai](https://docs.argentos.ai)               |
| **Marketplace**   | [marketplace.argentos.ai](https://marketplace.argentos.ai) |
| **Discord**       | [discord.gg/argentos](https://discord.gg/argentos)         |
| **Twitter**       | [@argentAIOS](https://x.com/argentAIOS)                    |
| **Author**        | [Jason Brashear](https://jasonbrashear.com)                |

## License

MIT — free to use, modify, and distribute.

Built by [Jason Brashear](https://jasonbrashear.com) · [Slick Funnelz LLC](https://argentos.ai)
