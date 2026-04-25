---
summary: "Use Z.AI (GLM models) with ArgentOS"
read_when:
  - You want Z.AI / GLM models in ArgentOS
  - You need a simple ZAI_API_KEY setup
title: "Z.AI"
---

# Z.AI

Z.AI is the API platform for **GLM** models. It provides REST APIs for GLM and uses API keys
for authentication. Create your API key in the Z.AI console. ArgentOS uses the `zai` provider
with a Z.AI API key.

## CLI setup

```bash
argent onboard --auth-choice zai-api-key
# or non-interactive
argent onboard --zai-api-key "$ZAI_API_KEY"
```

## Config snippet

```json5
{
  env: { ZAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "zai/glm-4.7" } } },
}
```

If your Z.AI key belongs to a Coding subscription, select the Coding API lane with a provider
base URL override:

```json5
{
  models: {
    mode: "merge",
    providers: {
      zai: {
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
        api: "openai-completions",
        models: [],
      },
    },
  },
}
```

Use `https://api.z.ai/api/paas/v4` for a General/API subscription. ArgentOS appends
`/chat/completions` automatically when needed.

## Notes

- GLM models are available as `zai/<model>` (example: `zai/glm-4.7`).
- See [/providers/glm](/providers/glm) for the model family overview.
- Z.AI uses Bearer auth with your API key.
