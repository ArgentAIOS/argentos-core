---
summary: "CLI reference for `argent onboard` (interactive onboarding wizard)"
read_when:
  - You want guided setup for gateway, workspace, auth, channels, and skills
title: "onboard"
---

# `argent onboard`

Interactive onboarding wizard (local or remote Gateway setup).

Local onboarding now starts with the runtime question first:

- `Ollama`
- `LM Studio`
- `Cloud / API providers`

That means the default guided path establishes Argent's local brain before
optional cloud fallbacks, channels, and UI steps.

Related:

- Wizard guide: [Onboarding](/start/onboarding)

## Examples

```bash
argent onboard
argent onboard --flow quickstart
argent onboard --flow manual
argent onboard --mode remote --remote-url ws://gateway-host:18789
argent onboard --non-interactive --accept-risk --local-runtime ollama
argent onboard --non-interactive --accept-risk --local-runtime lmstudio --local-text-model qwen3-32b --local-embedding-model nomic-embed-text
```

Flow notes:

- `quickstart`: minimal prompts, auto-generates a gateway token.
- `manual`: full prompts for port/bind/auth (alias of `advanced`).
- Fastest first chat: `argent dashboard` (Control UI, no channel setup).
- Local-first onboarding expects a Qwen text model plus Nomic embeddings on
  Ollama or LM Studio.

## Non-interactive local runtime flags

- `--local-runtime ollama|lmstudio`
- `--local-text-model <model>`
- `--local-embedding-model <model>`

When you combine local runtime flags with cloud auth flags, the local runtime
stays primary and the cloud provider is added as an optional fallback/auth path.
