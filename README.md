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

## Install

```bash
curl -fsSL https://argentos.ai/install.sh | bash
```

The hosted installer supports both macOS and Linux, but the shell script does different work on each platform.

### macOS

**Prerequisite:** [Homebrew](https://brew.sh)

The installer uses Homebrew and LaunchAgents to provision:

- private Node 22 runtime
- `pnpm`
- PostgreSQL 17 on port `5433`
- Redis on port `6380`
- local dashboard runtime
- browser handoff and `Argent.app` install/launch

### Linux

**Supported target:** Ubuntu/Debian-style systems with `apt` and user `systemd`

The installer uses shell tooling plus `apt`/user services to provision:

- private Node 22 runtime
- `pnpm`
- local gateway as a user `systemd` service
- dashboard API/runtime
- PostgreSQL/Redis topology intended for:
  - PostgreSQL on `5433`
  - Redis on `6380`

Key differences from macOS:

- there is no `Argent.app` install step on Linux
- Linux uses user `systemd` services instead of macOS LaunchAgents
- the Linux flow assumes it can stand up dedicated local services for Argent on the non-default ports above

Important caveat:

- on Linux hosts that already have PostgreSQL or Redis running for other workloads, you may need to finish the dedicated `5433` / `6380` service topology manually after install instead of letting the script reuse the host defaults

Recommended post-install checks on Linux:

```bash
argent health
argent gateway status
pg_lsclusters
systemctl --user status argent-redis.service
```

Expected Linux ports:

- gateway: `127.0.0.1:18789`
- dashboard API: `:9242`
- PostgreSQL: `127.0.0.1:5433`
- Redis: `127.0.0.1:6380`

**Or from source:**

```bash
git clone https://github.com/ArgentAIOS/argentos-core.git
cd argentos-core
pnpm install && pnpm build
bash install.sh
```

## What's in Core

| System                | What It Does                                                                   |
| --------------------- | ------------------------------------------------------------------------------ |
| **Memory**            | SQLite + pgvector hybrid search, auto-capture, entity tracking, embeddings     |
| **Heartbeat**         | Periodic accountability, contract/promise system, scoring                      |
| **Contemplation**     | Always-on thinking loop, local models via Ollama/LM Studio, episode journaling |
| **Channels**          | Telegram, Discord, Slack, WhatsApp, Signal, iMessage, and more                 |
| **Workflows**         | Visual multi-agent pipeline builder with 62 connector integrations             |
| **Dashboard**         | React + WebGL avatar, chat, task board, alignment docs editor                  |
| **62 Connectors**     | Stripe, HubSpot, GitHub, Notion, Salesforce, Jira, Twilio, and dozens more     |
| **Intent System**     | Three-tier hierarchical policy engine for safe agent behavior                  |
| **Model Router**      | Complexity scoring with local/fast/balanced/powerful tier routing              |
| **SIS**               | Self-improving system — lesson extraction from experience                      |
| **Knowledge Library** | RAG with agent-level ACL, PDF/DOCX/XLSX ingestion                              |
| **Encrypted Secrets** | AES-256-GCM credential storage with OS keychain integration                    |
| **Tasks & Projects**  | Full CRUD with priorities, dependencies, FTS                                   |
| **Alignment Docs**    | SOUL.md, IDENTITY.md, USER.md — define who your agent is                       |
| **Backup**            | SQLite backup with local/S3/R2 upload, compression, restore                    |

## Marketplace

The [ArgentOS Marketplace](https://marketplace.argentos.ai) has 116+ packages:

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
tools/aos/            # 62 connector harnesses
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
- **[OpenClaw](https://openclaw.ai/)** by [Peter Steinberger](https://steipete.me/) — the original fork that gave ArgentOS its launching pad. OpenClaw's architecture informed early design decisions for the gateway, plugin system, and channel infrastructure.
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
