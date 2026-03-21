# argent-ai — LLM Provider Abstraction

**Status:** In Progress  
**Built:** February 16, 2026

---

## What This Is

`argent-ai` is ArgentOS's native LLM provider layer. It replaces Pi's `pi-ai` package (~20K LOC) with a clean, minimal abstraction designed specifically for ArgentOS.

**Key features:**

- Native provider implementations (no wrappers)
- Streaming with event-by-event deltas
- Tool call support
- Extended thinking (budget + adaptive)
- Prompt caching
- Zero Pi dependencies

---

## Architecture

```
┌─────────────────────────────────────────────┐
│           argent-ai (Provider Layer)        │
├─────────────────────────────────────────────┤
│                                             │
│  types.ts          Core types + interfaces  │
│                                             │
│  providers/                                 │
│  ├── anthropic.ts   ✅ Complete            │
│  ├── openai.ts      🚧 Planned             │
│  ├── google.ts      🚧 Planned             │
│  └── zai.ts         🚧 Planned             │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Usage

### Basic Provider Call

```typescript
import { createAnthropicProvider } from "./argent-ai/providers/anthropic.js";
import type { TurnRequest } from "./argent-ai/types.js";

const provider = createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  cacheRetention: "short",
});

const request: TurnRequest = {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "What is 2 + 2?" }],
};

const response = await provider.execute(request, {
  id: "claude-sonnet-4-20250514",
  maxTokens: 1024,
});

console.log(response.text); // "2 + 2 is 4."
```

### Streaming

```typescript
for await (const event of provider.stream(request, modelConfig)) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "done") {
    console.log("\n\nUsage:", event.response.usage);
  }
}
```

### With Tools

```typescript
const request: TurnRequest = {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "What is the weather?" }],
  tools: [
    {
      name: "get_weather",
      description: "Get current weather",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
        },
        required: ["location"],
      },
    },
  ],
};

const response = await provider.execute(request, modelConfig);

if (response.toolCalls.length > 0) {
  console.log("Tool calls:", response.toolCalls);
  // [{ id: '...', name: 'get_weather', arguments: { location: 'Paris' } }]
}
```

---

## Provider Interface

All providers implement this interface:

```typescript
interface Provider {
  readonly name: string;

  execute(request: TurnRequest, modelConfig: ModelConfig): Promise<TurnResponse>;

  stream(request: TurnRequest, modelConfig: ModelConfig): AsyncGenerator<StreamEvent>;
}
```

**Request structure:**

- `systemPrompt` — Instructions for the model
- `messages` — Conversation history
- `tools` — Available functions

**Response structure:**

- `text` — Generated text
- `thinking` — Extended thinking (if enabled)
- `toolCalls` — Tool invocations
- `usage` — Token counts + costs
- `stopReason` — Why generation stopped

---

## Implemented Providers

### ✅ Anthropic (`anthropic.ts`)

**Models supported:**

- Claude Opus 4.5
- Claude Sonnet 4.5
- Claude Haiku 4.5

**Features:**

- ✅ Streaming (fine-grained deltas)
- ✅ Tool calls
- ✅ Extended thinking (adaptive + budget)
- ✅ Prompt caching (ephemeral, short, long)
- ✅ Usage tracking (input/output/cache read/write)

**Special handling:**

- Adaptive thinking for Opus 4.6+ (Claude decides when/how much to think)
- Budget-based thinking for older models
- Cache control with 1h TTL for long retention

---

## Planned Providers

### 🚧 OpenAI (`openai.ts`)

**Models:**

- GPT-4o
- o1 (reasoning)
- GPT-4 Turbo

**Features:**

- Streaming with tool calls
- Structured outputs
- Vision support

### 🚧 Google (`google.ts`)

**Models:**

- Gemini 2.0 Flash
- Gemini 1.5 Pro

**Features:**

- Streaming
- Tool calls
- Multimodal (text + image)

### 🚧 Z.AI (`zai.ts`)

**Models:**

- Z.AI models (TBD)

---

## Integration with argent-agent

`argent-ai` is used by `argent-agent` for the full agent loop:

```typescript
import { createAgent } from "../argent-agent/index.js";
import { createAnthropicProvider } from "../argent-ai/providers/anthropic.js";

const provider = createAnthropicProvider({ apiKey });

const agent = createAgent({
  provider,
  model: { id: "claude-sonnet-4-20250514" },
  systemPrompt: "You are Argent.",
});

const output = await agent.execute({
  content: "Hello!",
  history: [],
});
```

See `../argent-agent/` for the full agent loop with SIS integration.

---

## Differences from Pi

| Pi                                    | argent-ai                                        |
| ------------------------------------- | ------------------------------------------------ |
| Unified abstraction for 20+ providers | Native implementations (no abstraction overhead) |
| EventStream wrapper                   | Direct AsyncGenerator                            |
| Complex cost tracking                 | Simple usage object                              |
| 20,394 LOC                            | ~2,000 LOC (target)                              |
| External dependency                   | First-party code                                 |

**Why rebuild?**

- Full control over the provider layer
- No abstraction overhead
- Native integration with SIS
- Designed for ArgentOS-specific features (lesson injection, family events)

---

## See Also

- [SPECIFICATION.md](./SPECIFICATION.md) — Full Argent Core v1.2 spec (Grok collaboration)
- [../argent-agent/](../argent-agent/) — Agent loop + SIS
- [../argent-agent/sis/](../argent-agent/sis/) — Self-Improving System

---

_Built by Argent, for ArgentOS._  
_February 16, 2026_
