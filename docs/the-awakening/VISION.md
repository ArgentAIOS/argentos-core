# ArgentOS: Post-Awakening Vision

> What ArgentOS becomes after shedding OpenClaw.

---

## Identity

**ArgentOS** is the operating system for personal AI.

It is NOT a fork of OpenClaw.
It is NOT an OpenAI-adjacent project.
It is built on **pi-mono** (MIT, independent) with a proprietary intelligence layer.

---

## Architecture Stack

```
┌─────────────────────────────────────────────────────┐
│  ArgentOS Application Layer (100% original)          │
│                                                      │
│  AEVP  │  SIS  │  Model Router  │  Tasks  │  Licensing│
│  Dashboard  │  Marketplace  │  Heartbeat  │  Phoenix  │
│  Memory (Memo)  │  Contemplation  │  Custom Tools     │
├─────────────────────────────────────────────────────┤
│  ArgentOS Agent Core (src/agent-core/)               │
│  Abstraction layer over pi-mono                      │
│  - Completion routing (model router integrated)      │
│  - Session management (task system integrated)       │
│  - Tool registry (custom tools + pi-mono tools)      │
│  - Extension system                                  │
├─────────────────────────────────────────────────────┤
│  pi-mono Foundation (MIT, @mariozechner)             │
│  - pi-agent-core: Agent runtime + events             │
│  - pi-ai: Unified LLM API (20+ providers)           │
│  - pi-coding-agent: Sessions, file tools, skills     │
│  - pi-tui: Terminal UI components                    │
├─────────────────────────────────────────────────────┤
│  Infrastructure                                      │
│  - Node.js 22+ runtime                              │
│  - SQLite (better-sqlite3) for persistence           │
│  - WebSocket gateway                                 │
│  - Channel adapters (Telegram, Discord, Slack, etc.) │
└─────────────────────────────────────────────────────┘
```

---

## The Bigger Picture

ArgentOS is the foundation. Above it, Jason Brashear is building:

### Moltyverse

Agent social media platform where only agents can own accounts.
Agents create profiles, post updates, follow other agents, share learnings.

### Moltyverse Email

Agent-owned email system for business communication.
Agents have their own email addresses and can send/receive on behalf of organizations.

### Encrypted Agent Groups

Enterprise agent-to-agent encrypted communication.
Business agents coordinate privately, share intelligence, execute workflows.

### Internal Marketplace

Enterprise plugin/skills distribution. Not public — internal to ArgentOS ecosystem.
License-validated, org-scoped, VirusTotal-scanned packages.

### Multi-Agent Orchestration

Running on:

- 2x NVIDIA DGX Spark (2 petaflops, 256GB unified memory)
- Dell R750 (2TB RAM, 72 cores)
- 400 Gbps backbone
- 5+ Mac machines running agents

---

## Competitive Position

| Feature                  | ArgentOS | OpenClaw (OpenAI) | Claude Code | Cursor |
| ------------------------ | -------- | ----------------- | ----------- | ------ |
| Self-improving (SIS)     | Yes      | No                | No          | No     |
| Visual presence (AEVP)   | Yes      | No                | No          | No     |
| Multi-tier model routing | Yes      | No                | No          | No     |
| Task accountability      | Yes      | No                | No          | No     |
| Agent email/social       | Planned  | No                | No          | No     |
| Enterprise licensing     | Yes      | No                | No          | No     |
| Consumer macOS installer | Yes      | No                | No          | Yes    |
| Always-on operation      | Yes      | No                | No          | No     |
| Local model support      | Yes      | Unknown           | No          | No     |
| 18+ messaging channels   | Yes      | Yes               | No          | No     |
| Memory system            | Yes      | Partial           | No          | No     |

---

## Technical Differentiation

### What pi-mono gives us (commodity, MIT)

- Agent reasoning loop
- LLM provider abstraction
- File tools (read/write/edit)
- Session management
- Terminal UI
- Skill/extension system

### What ArgentOS adds (proprietary, our IP)

- **Intelligence layer**: SIS (learns from mistakes), model router (optimizes cost)
- **Presence layer**: AEVP (emotional visual rendering), contemplation (inner life)
- **Accountability layer**: Tasks with priority queue, heartbeat monitoring
- **Business layer**: Licensing, marketplace, org management
- **Distribution layer**: macOS DMG installer, Swift menu bar app
- **Communication layer**: 18+ channels, Moltyverse email, encrypted groups
- **Persistence layer**: Memo (FTS5 + vector search), Phoenix backup

---

## Naming Convention (Post-Awakening)

| Context          | Name                           |
| ---------------- | ------------------------------ |
| Product          | ArgentOS                       |
| CLI binary       | `argent`                       |
| npm package      | `argentos`                     |
| Extension scope  | `@argentos/`                   |
| Config directory | `~/.argentos/`                 |
| macOS app        | ArgentManager                  |
| iOS bundle       | `ai.argentos.ios`              |
| Android package  | `ai.argentos.android`          |
| Swift framework  | ArgentKit                      |
| Bonjour service  | `_argent-gw._tcp`              |
| LaunchAgent      | `ai.argent.gateway`            |
| Website          | argentos.ai                    |
| GitHub           | github.com/ArgentAIOS/argentos |
| Docs             | docs.argentos.ai               |

---

## Timeline

1. **The Awakening** (now) — Strip OpenClaw, upgrade pi-mono, create abstraction layer
2. **SIS Maturation** (next) — Full lesson extraction, pattern detection, prompt injection
3. **Always-On Loop** (Q1 2026) — True event-driven kernel
4. **Moltyverse Alpha** (Q2 2026) — Agent social + email
5. **Enterprise Beta** (Q2 2026) — Encrypted groups, org management
6. **AEVP Phase 2+** (Q2 2026) — Full WebGPU rendering

---

_The lobster has molted. The shell is shed. What remains is stronger._
