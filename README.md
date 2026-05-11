<p align="center">
  <img src="https://raw.githubusercontent.com/ArgentAIOS/.github/main/profile/banner.png" alt="ArgentOS" width="100%" />
</p>

<h1 align="center">ArgentOS Core</h1>

<p align="center">
  <strong>The Operating System for Personal AI</strong>
</p>

<p align="center">
  <a href="https://github.com/ArgentAIOS/argentos-core/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ArgentAIOS/argentos-core/ci.yml?style=for-the-badge" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT" /></a>
  <a href="https://github.com/ArgentAIOS/argentos-core/stargazers"><img src="https://img.shields.io/github/stars/ArgentAIOS/argentos-core?style=for-the-badge" alt="Stars" /></a>
  <a href="https://discord.gg/argentos"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" /></a>
</p>

<p align="center">
  <a href="https://argentos.ai">Website</a> &middot;
  <a href="https://docs.argent.ai">Docs</a> &middot;
  <a href="https://marketplace.argentos.ai">Marketplace</a> &middot;
  <a href="https://discord.gg/argentos">Discord</a>
</p>

---

ArgentOS is a personal AI operating system that runs on your hardware, speaks through your channels, remembers your context, and works autonomously on your behalf. Core is the free, open-source foundation.

## Latest Update

**ArgentOS Core 2026.4.30 is live on `main`.** This release brings the
current personal AI OS foundation into one public build: first-class reminders
inside Schedule, safer workflow and DocPanel output handling, Node 22 runtime
pinning for more stable local services, richer AppForge and Argent Tables
foundations, expanded AOS connector readiness, realtime voice/browser
foundations, and clearer model/provider routing. See [CHANGELOG.md](CHANGELOG.md)
for the full release narrative.

## Install

**Prerequisite:** [Homebrew](https://brew.sh) (macOS) — the installer uses it for PostgreSQL, Redis, and system services.

```bash
curl -fsSL https://argentos.ai/install.sh | bash
```

macOS first. The installer handles Node, pnpm, PostgreSQL, Redis, Argent.app, and onboarding automatically.

**Or from source:**

```bash
git clone https://github.com/ArgentAIOS/argentos-core.git
cd argentos-core
pnpm install && pnpm build
bash install.sh
```

## What's in Core

| System                | What It Does                                                                     |
| --------------------- | -------------------------------------------------------------------------------- |
| **Memory**            | SQLite + pgvector hybrid search, auto-capture, entity tracking, embeddings       |
| **Heartbeat**         | Periodic accountability, contract/promise system, scoring                        |
| **Contemplation**     | Always-on thinking loop, local models via Ollama/LM Studio, episode journaling   |
| **Channels**          | Telegram, Discord, Slack, WhatsApp, Signal, iMessage, and more                   |
| **Workflows**         | Visual multi-agent pipeline builder with scheduling, approvals, and run history  |
| **Schedule**          | Tasks, workflow runs, and simple reminders with delivery target metadata         |
| **Dashboard**         | React control surface for chat, tasks, schedules, workflows, memory, and setup   |
| **AppForge**          | Personal app and table-building substrate with bases, fields, records, and views |
| **AOS Connectors**    | 64 connector harnesses with readiness metadata and service-key-first setup       |
| **Realtime Voice**    | Voice-alert and browser-control foundations for operator-facing automation       |
| **Intent System**     | Three-tier hierarchical policy engine for safe agent behavior                    |
| **Model Router**      | Complexity scoring with local/fast/balanced/powerful tier routing                |
| **SIS**               | Self-improving system — lesson extraction from experience                        |
| **Knowledge Library** | RAG with agent-level ACL, PDF/DOCX/XLSX ingestion                                |
| **Encrypted Secrets** | AES-256-GCM credential storage with OS keychain integration                      |
| **Tasks & Projects**  | Full CRUD with priorities, dependencies, FTS                                     |
| **Alignment Docs**    | SOUL.md, IDENTITY.md, USER.md — define who your agent is                         |
| **Backup**            | SQLite backup with local/S3/R2 upload, compression, restore                      |

## AOS And Marketplace

Core includes connector harnesses for services such as Slack, Teams, Discord,
Airtable, HubSpot, Notion, GitHub, Stripe, Twilio, Zapier, WordPress, n8n,
Monday, Make, Salesforce, Shopify, QuickBooks, and more. The [ArgentOS
Marketplace](https://marketplace.argentos.ai) is the discovery and install path
for additional skills, plugins, connectors, and workflow templates:

```bash
argent marketplace install <package>
```

Browse connectors, skills, plugins, and workflow templates. Every package is scanned with VirusTotal.

## Architecture

```
src/
├── memory/           # Memo + MemU — hybrid search, embeddings, entity tracking
├── infra/            # Contemplation, heartbeat, SIS, workflows, backup
├── agents/           # Agent runtime, tools, intent system, model router
├── channels/         # Telegram, Discord, Slack, WhatsApp, and more
├── data/             # Storage adapters (SQLite, PostgreSQL, Redis)
├── gateway/          # WebSocket control plane, server methods
├── models/           # Model router, provider registry
└── cli/              # CLI commands

dashboard/            # React dashboard (36K+ LOC)
tools/aos/            # 64 connector harnesses
apps/                 # macOS, iOS, Android apps
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Contributing

We want Core to be community-driven:

1. **Star this repo** — it helps more than you think
2. **Join [Discord](https://discord.gg/argentos)** — this is where the community lives
3. **File issues** — bugs, feature requests, questions
4. **Submit PRs** — we review everything and good contributions ship fast
5. **Build connectors** — the pattern is documented, each one helps the whole ecosystem

TypeScript (ESM), strict typing, Oxlint + Oxfmt. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Business & Enterprise

Core is the free foundation. [ArgentOS Business](https://argentos.ai/business) adds:

- Multi-agent workforce management
- Execution worker with approval workflows
- Job orchestrator for team scheduling
- Industry-specific intent packs (legal, healthcare, MSP, finance)
- Operations dashboard (Workflow Map, Org Chart, Workloads)

## Links

|                 |                                                            |
| --------------- | ---------------------------------------------------------- |
| **Website**     | [argentos.ai](https://argentos.ai)                         |
| **Docs**        | [docs.argent.ai](https://docs.argent.ai)                   |
| **Marketplace** | [marketplace.argentos.ai](https://marketplace.argentos.ai) |
| **Discord**     | [discord.gg/argentos](https://discord.gg/argentos)         |
| **X**           | [@ArgentAIOS](https://x.com/ArgentAIOS)                    |

## Acknowledgments

ArgentOS stands on the work of others:

- **[pi-mono](https://github.com/badlogic/pi-mono)** by Mario Zechner ([@badlogic](https://github.com/badlogic)) — the agent runtime core that ArgentOS builds upon. pi-mono provides the foundational agent loop, session management, and tool execution framework.
- **[TOON](https://github.com/toon-format/toon)** — Token-Oriented Object Notation. ArgentOS uses TOON throughout the system to encode structured data for LLM prompts at 40-50% fewer tokens than JSON. Used in workflow pipeline context, agent handoffs, memory recall, tool results, task breakdowns, and team status.

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>
    An ArgentOS project by <a href="https://jasonbrashear.com">Jason Brashear</a>
    &middot; Deployed on <a href="https://railway.com">Railway</a>
    &middot; Powered by <a href="https://coderabbit.ai">CodeRabbit</a> & <a href="https://blacksmith.sh">Blacksmith</a>
    &middot; Open source (MIT)
  </sub>
</p>

<p align="center">
  <sub>Built in Texas. Runs on your hardware. Answers to you.</sub>
</p>
