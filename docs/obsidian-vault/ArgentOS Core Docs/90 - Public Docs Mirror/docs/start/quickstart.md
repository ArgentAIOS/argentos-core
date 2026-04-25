---
summary: "Install ArgentOS, onboard the Gateway, and pair your first channel."
read_when:
  - You want the fastest path from install to a working Gateway
title: "Quick start"
---

<Note>
ArgentOS requires Node 22 or newer.
</Note>

## Install

### macOS (recommended)

1. Download the latest **Argent.app** from [GitHub Releases](https://github.com/ArgentAIOS/argentos/releases).
2. Launch `Argent.app`.
3. Complete onboarding and permissions.

The app is the preferred macOS operator surface. It manages the local gateway and can install the CLI for terminal workflows.

### CLI (cross-platform)

```bash
curl -fsSL https://argentos.ai/install.sh | bash
```

The executable is `argent`. The hosted installer sets up the wrapper plus the supported git checkout used by `argent update`.

## Onboard and run the Gateway

<Steps>
  <Step title="Onboard and install the service">
    ```bash
    argent onboard --install-daemon
    ```
  </Step>
  <Step title="Pair WhatsApp">
    ```bash
    argent channels login
    ```
  </Step>
  <Step title="Start the Gateway">
    ```bash
    argent gateway --port 18789
    ```
  </Step>
</Steps>

After onboarding, the Gateway runs via the user service. You can still run it manually with `argent gateway`.

<Info>
Switching between npm and git installs later is easy. Install the other flavor and run
`argent doctor` to update the gateway service entrypoint.
</Info>

## From source (development)

```bash
git clone https://github.com/ArgentAIOS/argentos.git
cd argentos
pnpm install
pnpm ui:build # auto-installs UI deps on first run
pnpm build
argent onboard --install-daemon
```

If you do not have `argent` on PATH yet, run onboarding via `pnpm argent ...` from the repo.

## Multi instance quickstart (optional)

```bash
ARGENTOS_CONFIG_PATH=~/.argentos/a.json \
ARGENTOS_STATE_DIR=~/.argentos-a \
argent gateway --port 19001
```

## Send a test message

Requires a running Gateway.

```bash
argent message send --target +15555550123 --message "Hello from ArgentOS"
```
