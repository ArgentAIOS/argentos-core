# @argentos/feishu

Feishu/Lark channel plugin for ArgentOS (WebSocket bot events).

## Install (local checkout)

```bash
argent plugins install ./extensions/feishu
```

## Install (npm)

```bash
argent plugins install @argentos/feishu
```

Onboarding: select Feishu/Lark and confirm the install prompt to fetch the plugin automatically.

## Config

```json5
{
  channels: {
    feishu: {
      accounts: {
        default: {
          appId: "cli_xxx",
          appSecret: "xxx",
          domain: "feishu",
          enabled: true,
        },
      },
      dmPolicy: "pairing",
      groupPolicy: "open",
      blockStreaming: true,
    },
  },
}
```

Lark (global) tenants should set `domain: "lark"` (or a full https:// domain).

Restart the gateway after config changes.

## Docs

https://docs.argentos.ai/channels/feishu
