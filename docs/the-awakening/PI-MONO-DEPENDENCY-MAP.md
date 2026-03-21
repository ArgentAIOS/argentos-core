# pi-mono Dependency Map

> What ArgentOS imports from pi-mono and how to wrap it.

---

## Package: @mariozechner/pi-agent-core (76 import sites)

### Types (compile-time only — safe to re-export)

| Type              | Used In   | Purpose                   |
| ----------------- | --------- | ------------------------- |
| `AgentMessage`    | 35+ files | Core message type         |
| `AgentTool`       | 20+ files | Tool definition interface |
| `AgentToolResult` | 25+ files | Tool execution result     |
| `AgentEvent`      | 3 files   | Agent event emitter       |
| `StreamFn`        | 2 files   | Streaming function sig    |
| `ThinkingLevel`   | 1 file    | Reasoning level config    |

### Functions (runtime — need wrapping)

None directly — types only.

### Wrapper Strategy

```typescript
// src/agent-core/types.ts
export type {
  AgentMessage,
  AgentTool,
  AgentToolResult,
  AgentEvent,
  StreamFn,
  ThinkingLevel,
} from "@mariozechner/pi-agent-core";
```

---

## Package: @mariozechner/pi-ai (71 import sites)

### Types

| Type                  | Used In   | Purpose                            |
| --------------------- | --------- | ---------------------------------- |
| `Model`               | 25+ files | Provider-agnostic model descriptor |
| `Api`                 | 10+ files | API provider configuration         |
| `Context`             | 3 files   | Completion context                 |
| `AssistantMessage`    | 20+ files | LLM response message               |
| `ImageContent`        | 10+ files | Image in messages                  |
| `TextContent`         | 2 files   | Text content type                  |
| `ToolResultMessage`   | 3 files   | Tool result message                |
| `SimpleStreamOptions` | 2 files   | Streaming config                   |
| `OAuthCredentials`    | 5+ files  | OAuth auth                         |
| `OAuthProvider`       | 1 file    | OAuth provider enum                |

### Functions (CRITICAL — runtime)

| Function                  | Used In   | Purpose                                  |
| ------------------------- | --------- | ---------------------------------------- |
| `complete()`              | 2 files   | Stream LLM completions (async generator) |
| `completeSimple()`        | 10+ files | Synchronous completion                   |
| `streamSimple()`          | 3 files   | Stream interface                         |
| `getModel()`              | 5 files   | Model discovery/registry                 |
| `getEnvApiKey()`          | 1 file    | Env var API key resolution               |
| `loginOpenAICodex()`      | 1 file    | OAuth for Codex                          |
| `streamOpenAIResponses()` | 1 file    | OpenAI-specific streaming                |

### Wrapper Strategy

```typescript
// src/agent-core/completion.ts
import { complete, completeSimple, streamSimple } from "@mariozechner/pi-ai";
import { routeModel } from "../models/router.js";

// Wrap completions with model router integration
export async function* argentComplete(model, messages, options) {
  const routedModel = await routeModel(model, messages);
  yield* complete(routedModel, messages, options);
}

export async function argentCompleteSimple(model, messages, options) {
  const routedModel = await routeModel(model, messages);
  return completeSimple(routedModel, messages, options);
}
```

---

## Package: @mariozechner/pi-coding-agent (39 import sites)

### Classes (HEAVY — runtime)

| Class             | Used In   | Purpose                  |
| ----------------- | --------- | ------------------------ |
| `SessionManager`  | 15+ files | Persistent session state |
| `AuthStorage`     | 2+ files  | Credential persistence   |
| `ModelRegistry`   | 2+ files  | Model discovery          |
| `SettingsManager` | 1+ file   | Config persistence       |

### Types

| Type                      | Used In  | Purpose                |
| ------------------------- | -------- | ---------------------- |
| `AgentSession`            | 2 files  | Session interface      |
| `Skill`                   | 3 files  | Skill definition       |
| `ToolDefinition`          | 2 files  | Tool schema            |
| `ExtensionAPI`            | 5+ files | Extension system       |
| `ExtensionContext`        | 3 files  | Extension runtime      |
| `ContextEvent`            | 1 file   | Context change events  |
| `FileOperations`          | 1 file   | File op abstraction    |
| `CURRENT_SESSION_VERSION` | 4 files  | Session format version |

### Functions (CRITICAL — runtime)

| Function               | Used In | Purpose               |
| ---------------------- | ------- | --------------------- |
| `createAgentSession()` | 1 file  | Session factory       |
| `createEditTool()`     | 1 file  | Edit tool             |
| `createReadTool()`     | 1 file  | Read tool             |
| `createWriteTool()`    | 1 file  | Write tool            |
| `estimateTokens()`     | 1 file  | Token counting        |
| `generateSummary()`    | 1 file  | Session compression   |
| `loadSkillsFromDir()`  | 1 file  | Dynamic skill loading |

### Wrapper Strategy

```typescript
// src/agent-core/session.ts
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { taskSystem } from "../data/tasks.js";

export class ArgentSessionManager {
  private inner: SessionManager;

  constructor(opts) {
    this.inner = new SessionManager(opts);
  }

  // Wrap with task system hooks
  async save(session) {
    await this.inner.save(session);
    await taskSystem.onSessionSave(session);
  }

  // ... delegate other methods
}
```

---

## Package: @mariozechner/pi-tui (23 import sites)

### Components

| Component      | Used In | Purpose             |
| -------------- | ------- | ------------------- |
| `TUI`          | 6 files | Main TUI runtime    |
| `Component`    | 5 files | Component interface |
| `Container`    | 6 files | Layout container    |
| `Text`         | 6 files | Text rendering      |
| `Spacer`       | 5 files | Vertical spacing    |
| `Markdown`     | 3 files | Markdown rendering  |
| `Box`          | 1 file  | Box drawing         |
| `Editor`       | 1 file  | Text editor         |
| `SelectList`   | 2 files | Selection list      |
| `SettingsList` | 1 file  | Settings form       |

### Functions

| Function       | Used In | Purpose                    |
| -------------- | ------- | -------------------------- |
| `matchesKey()` | 1 file  | Keyboard shortcut matching |

### Types

| Type           | Used In | Purpose            |
| -------------- | ------- | ------------------ |
| `Key`          | 1 file  | Keyboard event     |
| `SelectItem`   | 2 files | List item          |
| `SettingItem`  | 1 file  | Settings item      |
| `SlashCommand` | 1 file  | Command definition |

### Wrapper Strategy

**KEEP DIRECT IMPORTS.** pi-tui is a UI library — wrapping UI components
adds complexity with no benefit. These are leaf-node dependencies.

---

## Migration Order

1. **Types first** — re-export in `src/agent-core/types.ts` (zero risk)
2. **Completion layer** — wrap in `src/agent-core/completion.ts` (model router integration)
3. **Session layer** — wrap in `src/agent-core/session.ts` (task system hooks)
4. **Tools** — wrap in `src/agent-core/tools.ts` (custom tool registration)
5. **Update imports** — sed/replace across 189 files
6. **Leave pi-tui direct** — 23 imports stay as-is

---

## Version Upgrade Notes: 0.51.6 → 0.52.12

### Breaking Changes

**v0.52.6:**

- `/exit` command removed → must use `/quit`
- Search: `isExitCommand()` or similar in src/

**v0.52.7:**

- `models.json` provider `models` field behavior changed
  - Old: Full replacement of built-in models
  - New: Merge-by-id with built-in models
- Search: `models.json` handling in config/

**v0.52.10:**

- `ContextUsage.tokens` → `number | null` (was `number`)
- `ContextUsage.percent` → `number | null` (was `number`)
- REMOVED: `usageTokens`, `trailingTokens`, `lastUsageIndex` from ContextUsage
- Search: Any reference to these removed fields

### New Model Support

- Claude Opus 4.6 (claude-opus-4-6)
- GPT-5.3 Codex (gpt-5.3-codex)
- MiniMax M2.5
- Adaptive thinking with effort levels (low/medium/high/max)

### New Features Available

- Extension API: `ctx.reload()`, `terminal_input` interception, `pasteToEditor`
- Model selector: `provider/id` syntax, fuzzy matching, `:<thinking>` suffixes
- Per-model overrides via `modelOverrides` in models.json
- Bedrock proxy for unauthenticated endpoints
- WebSocket transport for OpenAI Codex Responses
- Emacs kill ring (ctrl+k/ctrl+y/alt+y) + undo (ctrl+z) in editor
