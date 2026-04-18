---
summary: "End-to-end guide to building ArgentOS plugins — tools, hooks, service keys, config persistence"
read_when:
  - You want to build a new ArgentOS plugin
  - You need to integrate an external API as a plugin
  - You want to understand service keys, config persistence, or lifecycle hooks
title: "Building Plugins"
---

# Building Plugins

This guide walks through building a complete ArgentOS plugin from scratch — registering
tools, reading service keys, persisting config, and wiring lifecycle hooks. It uses a
real-world MSP integration (Atera) as the running example.

## Plugin Structure

```
~/.argentos/extensions/my-plugin/
├── argent.plugin.json    # Manifest (required)
└── index.ts              # Plugin entry point
```

Plugins are discovered from two locations:

- **Global**: `~/.argentos/extensions/<plugin-id>/`
- **Workspace**: `.argent/extensions/<plugin-id>/` (project-local)

The entry point (`index.ts` or `index.js`) receives a registration API and is loaded
by Jiti (TypeScript JIT), so `.ts` files work without a build step.

## Manifest (`argent.plugin.json`)

Every plugin needs a manifest for discovery and config validation:

```json
{
  "id": "atera",
  "name": "Atera MSP Integration",
  "description": "Atera ticketing, device management, and monitoring alerts",
  "version": "1.0.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "apiKey": {
        "type": "string",
        "description": "Atera API key (prefer service-keys.json)"
      },
      "technicianId": {
        "type": "number",
        "description": "Linked technician ID for ticket filtering"
      },
      "technicianName": {
        "type": "string",
        "description": "Operator name for technician auto-detection"
      }
    }
  },
  "uiHints": {
    "apiKey": { "sensitive": true, "label": "API Key" },
    "technicianId": { "label": "Technician ID" }
  }
}
```

### Key Manifest Fields

| Field          | Required | Description                                                 |
| -------------- | -------- | ----------------------------------------------------------- |
| `id`           | Yes      | Unique plugin identifier                                    |
| `configSchema` | Yes      | JSON Schema for plugin config (even if empty)               |
| `name`         | No       | Display name                                                |
| `description`  | No       | Short summary                                               |
| `version`      | No       | Semver version                                              |
| `uiHints`      | No       | UI rendering hints (sensitive fields, labels, placeholders) |
| `kind`         | No       | Plugin kind (e.g., `"memory"`)                              |
| `channels`     | No       | Channel IDs this plugin registers                           |
| `providers`    | No       | Provider IDs this plugin registers                          |
| `skills`       | No       | Skill directories to load                                   |

## Entry Point

The entry point exports a default function that receives the plugin registration API:

```ts
export default function register(api: any) {
  // Register tools
  api.registerTool({ ... });

  // Register lifecycle hooks
  api.on("before_agent_start", async (ctx: any) => { ... });
}
```

### Important: No Core Imports

Plugins in `~/.argentos/extensions/` do **not** have access to core `node_modules`.
You cannot import `@sinclair/typebox` or other core dependencies. Use plain JSON
Schema objects for tool parameter schemas:

```ts
// DON'T: import { Type } from "@sinclair/typebox"
// DO: use plain JSON Schema
const schema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const, description: "Search query" },
    limit: { type: "number" as const, description: "Max results" },
  },
  required: ["query"] as const,
};
```

## Registering Tools

```ts
api.registerTool({
  name: "my_tickets",
  description: "List support tickets from the ticketing system",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["open", "pending", "resolved", "closed"],
        description: "Filter by ticket status",
      },
      limit: { type: "number", description: "Max results (default 25)" },
    },
  },
  async execute(_id: string, params: any) {
    const data = await fetchTickets(params);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
});
```

For opt-in tools that require credentials or have side effects:

```ts
api.registerTool({ name: "dangerous_tool" /* ... */ }, { optional: true });
```

## Service Keys

ArgentOS has a centralized service key store at `~/.argentos/service-keys.json`,
managed through the dashboard UI (Settings > API Keys). Plugins should read keys
from this store rather than requiring separate configuration.

### Reading Service Keys

```ts
function resolveApiKey(variableName: string): string | undefined {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const keysPath = path.join(process.env.HOME ?? "/tmp", ".argentos", "service-keys.json");
    const raw = fs.readFileSync(keysPath, "utf-8");
    const store = JSON.parse(raw);
    const entry = (store.keys ?? []).find(
      (k: any) => k.variable === variableName && k.enabled !== false,
    );
    if (entry?.value) return entry.value;
  } catch {
    // File doesn't exist or is unreadable
  }
  // Fallback to environment variable
  return process.env[variableName];
}
```

### How It Works

1. User adds the key through Dashboard > Settings > API Keys
2. Dashboard writes to `~/.argentos/service-keys.json`
3. Plugin reads the key at runtime via the pattern above
4. Falls back to `process.env` for CI/server deployments

### Service Keys JSON Format

```json
{
  "keys": [
    {
      "variable": "ATERA_API_KEY",
      "value": "sk-...",
      "enabled": true,
      "label": "Atera",
      "category": "other",
      "scope": "Titanium Computing"
    }
  ]
}
```

The `variable` field is used for lookup. The `enabled` flag allows temporarily
disabling a key without deleting it.

## Config Persistence

Plugins can persist configuration back to `~/.argentos/argent.json` under
`plugins.entries.<plugin-id>.config`:

```ts
function updatePluginConfig(pluginId: string, key: string, value: any): boolean {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const configPath = path.join(process.env.HOME ?? "/tmp", ".argentos", "argent.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    if (!config.plugins) config.plugins = {};
    if (!config.plugins.entries) config.plugins.entries = {};
    if (!config.plugins.entries[pluginId]) config.plugins.entries[pluginId] = { enabled: true };
    if (!config.plugins.entries[pluginId].config) config.plugins.entries[pluginId] = {};
    config.plugins.entries[pluginId].config[key] = value;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}
```

This is useful for self-service setup flows where the agent discovers and saves
configuration (e.g., linking a technician ID by traversing API data).

### Config in argent.json

```json
{
  "plugins": {
    "allow": ["atera"],
    "entries": {
      "atera": {
        "enabled": true,
        "config": {
          "technicianName": "Jason Brashear",
          "technicianId": 12345
        }
      }
    }
  }
}
```

## Plugin Allowlist

If `plugins.allow[]` in `argent.json` contains any entries, only plugins in that
list are enabled. Non-bundled plugins default to enabled when the allowlist is empty.

```json
{
  "plugins": {
    "allow": ["atera", "canvas-docs-enforcer"]
  }
}
```

If your plugin isn't loading, check whether an allowlist exists and add your
plugin ID to it.

## Lifecycle Hooks

### `before_agent_start`

Fires before each agent run. Use it to inject context or nudge the agent:

```ts
api.on("before_agent_start", async (ctx: any) => {
  const apiKey = resolveApiKey("MY_API_KEY");
  if (!apiKey) return; // Plugin not configured, skip silently

  // Fetch contextual data
  const summary = await fetchDashboardSummary(apiKey);

  // Inject into system prompt
  ctx.systemPromptSuffix = `
## My Integration Context
${summary}
  `.trim();
});
```

The `systemPromptSuffix` is appended to the agent's system prompt for that run.
This is ideal for:

- Showing open ticket counts or alerts
- Nudging the agent when setup is incomplete
- Injecting operator-specific context

## Complete Example: MSP Integration Plugin

Here's the skeleton of a complete MSP integration plugin:

```ts
// ~/.argentos/extensions/msp-integration/index.ts

function resolveApiKey(): string | undefined {
  // ... (service keys pattern from above)
}

async function apiFetch(endpoint: string, apiKey: string) {
  const res = await fetch(`https://api.example.com/v3${endpoint}`, {
    headers: { "X-API-KEY": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export default function register(api: any) {
  // Tool: List tickets
  api.registerTool({
    name: "msp_tickets",
    description: "List support tickets",
    parameters: {
      type: "object",
      properties: {
        /* ... */
      },
    },
    async execute(_id: string, params: any) {
      const apiKey = resolveApiKey();
      if (!apiKey) return { content: [{ type: "text", text: "API key not configured." }] };
      const data = await apiFetch("/tickets", apiKey);
      return { content: [{ type: "text", text: formatTickets(data) }] };
    },
  });

  // Tool: Self-service setup
  api.registerTool({
    name: "msp_setup",
    description: "Link operator identity and configure the integration",
    parameters: {
      /* ... */
    },
    async execute(_id: string, params: any) {
      // Auto-detect technician ID by traversing tickets
      // Save to config via updatePluginConfig()
    },
  });

  // Hook: Inject context before each agent run
  api.on("before_agent_start", async (ctx: any) => {
    const apiKey = resolveApiKey();
    if (!apiKey) return;

    const config = getPluginConfig();
    if (!config?.technicianId) {
      ctx.systemPromptSuffix = `
## MSP Integration
The MSP plugin is installed but the operator hasn't linked their technician ID yet.
Use msp_setup to help them find and link their identity.
      `.trim();
      return;
    }

    // Inject open ticket count, alerts, etc.
    const summary = await fetchSummary(apiKey, config.technicianId);
    ctx.systemPromptSuffix = `## MSP Context\n${summary}`;
  });
}
```

## Tips

- **No build step needed**: Jiti handles TypeScript directly
- **Keep tools focused**: One tool per concern (tickets, devices, alerts — not one mega-tool)
- **Fail gracefully**: If the API key is missing, return a helpful message, don't throw
- **Use `AbortSignal.timeout()`**: Prevent hung API calls from blocking the agent
- **Prefer service keys over env vars**: Users manage keys through the dashboard UI
- **Self-service setup**: Let the agent discover configuration rather than requiring manual entry
- **Paginated APIs**: Fetch all pages when building reports, use reasonable defaults for listings
