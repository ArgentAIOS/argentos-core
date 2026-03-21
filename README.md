# ArgentOS Core

<p align="center">
  <strong>Self-hosted personal AI operating system surface</strong>
</p>

<p align="center">
  <a href="https://github.com/ArgentAIOS/argentos-core/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ArgentAIOS/argentos-core/ci.yml?style=for-the-badge" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**ArgentOS Core** is the self-hosted Core surface of ArgentOS: persistent chat, memory, tasks, docs/canvas, browser-assisted work, model routing, and companion apps, without the business-only operator layers.

This repo is intended to hold the public Core product boundary. Business and enterprise surfaces are intentionally excluded.

## What Core Includes

- persistent chat and session flow
- memory recall and timeline
- tasks and projects
- doc panel / canvas interaction
- browser and web research tools
- local and hosted model routing
- basic knowledge/library access
- macOS, iOS, and Android app surfaces

## What Core Does Not Include

- workforce / worker-admin surfaces
- org licensing and business gating
- enterprise-only onboarding / workforce setup layers
- mixed admin controls that have not been cleanly separated yet

## Current Install Status

The currently validated install path in this repo is:

- **macOS from a built checkout**

That path is exercised by:

```bash
pnpm test:install:local:smoke
```

Hosted one-liner installers and update distribution are separate release rails and are still being hardened alongside this repo.

## Install From Source (macOS)

Runtime requirement:

- Node 22+

```bash
git clone https://github.com/ArgentAIOS/argentos-core.git
cd argentos-core

pnpm install
pnpm build
bash install.sh
```

That installer sets up:

- state in `~/.argentos`
- workspace in `~/argent`
- CLI wrappers in `~/bin`
- gateway + dashboard LaunchAgents

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Useful checks:

```bash
pnpm test:install:local:smoke
pnpm test:install:smoke
```

Pre-push review:

```bash
# Interactive review for the latest commit/diff
pnpm review:coderabbit

# Prompt-only output for AI-agent loops or CI handoff
pnpm review:coderabbit:prompt
```

## Public-Core Boundary

This repo is exported from the private source repo using a packaging boundary contract.

The source-of-truth boundary artifacts live in the private repo and drive export into this repo:

- `docs/argent/public-core-denylist.json`
- `docs/argent/public-core-surface-contract.json`
- `scripts/export-public-core.ts`

The Core README is also generated from that boundary workflow so it can stay product-correct across exports.

## License

MIT
