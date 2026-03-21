# Key Vault — Secure API Key Management

> **Status**: Planned (Phase 2)
> **Priority**: Medium — functional but insecure current approach
> **Created**: 2026-02-07

## Problem

API keys are currently stored in plaintext in two places:

1. `~/.argentos/argent.json` under `env.vars` (57 keys)
2. `~/Library/LaunchAgents/ai.argent.gateway.plist` — baked in by `argent gateway install`

The plist is readable by any process running as the user. Keys should never be in service config files.

## Current Flow

```
argent.json (env.vars) → gateway install → plist (EnvironmentVariables) → process.env
```

## Target Flow

```
Dashboard UI → encrypted credential store → gateway startup loader → process.env
```

## Architecture

### 1. Credential Store (`~/.argent/credentials/`)

- **Format**: JSON encrypted with AES-256-GCM
- **Key derivation**: Machine-specific (hostname + user + salt) via PBKDF2
- **File**: `~/.argent/credentials/vault.enc`
- **Permissions**: `chmod 600`
- **API**: `src/credentials/vault.ts`
  - `getKey(name: string): string | undefined`
  - `setKey(name: string, value: string): void`
  - `deleteKey(name: string): void`
  - `listKeys(): string[]` (names only, no values)
  - `exportForEnv(): Record<string, string>` (gateway startup use)

### 2. Gateway Startup Loader

- On startup, gateway calls `vault.exportForEnv()` and injects into `process.env`
- Plist only contains `ARGENT_*` service vars + `HOME` + `PATH`
- No API keys in plist ever

### 3. Dashboard API Endpoints

- `GET /api/keys` — list key names (no values)
- `POST /api/keys` — add/update a key `{ name, value }`
- `DELETE /api/keys/:name` — remove a key
- `GET /api/keys/:name/exists` — check if key is set (boolean)

### 4. Dashboard UI (ConfigPanel → API Keys tab)

- List of configured keys with masked values (`sk-ant-***...***df2029`)
- Add new key (name + value input)
- Edit existing key (shows masked, click to reveal/edit)
- Delete key with confirmation
- Import from environment (one-time migration from argent.json)
- Categories: AI Providers, Search, Media, Infrastructure, Other

### 5. Agent Access Control

- Agent sees `process.env.ANTHROPIC_API_KEY` — can use it in API calls
- Agent system prompt includes: "Never log, display, or share API key values"
- Keys are never included in conversation history or tool results
- Dashboard never sends raw key values over WebSocket

## Migration Path

1. Build credential store + API endpoints
2. Build dashboard UI
3. Add "Import from config" button (reads argent.json env.vars → vault)
4. Update gateway startup to load from vault
5. Update `argent gateway install` to stop putting keys in plist
6. Clean existing plist of keys on next install

## Files to Create/Modify

| File                                       | Action                                          |
| ------------------------------------------ | ----------------------------------------------- |
| `src/credentials/vault.ts`                 | NEW — encrypted credential store                |
| `src/credentials/index.ts`                 | NEW — public API                                |
| `src/gateway/server-methods/keys.ts`       | NEW — API endpoints                             |
| `src/daemon/service-env.ts`                | MODIFY — stop including config env vars         |
| `src/commands/daemon-install-helpers.ts`   | MODIFY — remove collectConfigEnvVars from plist |
| `dashboard/src/components/ConfigPanel.tsx` | MODIFY — flesh out API Keys tab                 |
| `dashboard/api-server.cjs`                 | MODIFY — add /api/keys proxy routes             |

## Security Notes

- Encryption at rest protects against casual file access
- Not a replacement for macOS Keychain (no hardware-backed security)
- Sufficient for a personal AI workstation
- Keys are still in process memory at runtime (unavoidable)
