# Argent Agent — Usage Examples

## Basic Usage (No SIS)

```typescript
import { createAgent } from "./argent-agent/index.js";
import { createAnthropicProvider } from "./argent-ai/providers/anthropic.js";

// Create provider
const provider = createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  cacheRetention: "short",
});

// Create agent
const agent = createAgent({
  provider,
  model: {
    id: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    temperature: 0.7,
  },
  systemPrompt: "You are Argent, a helpful AI assistant.",
});

// Execute a turn
const output = await agent.execute({
  content: "What is the capital of France?",
  history: [],
});

console.log(output.text); // "The capital of France is Paris."
console.log(output.usage); // { inputTokens: 23, outputTokens: 12, ... }
```

## With Streaming

```typescript
for await (const event of agent.stream({
  content: "Write a haiku about code.",
  history: [],
})) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "done") {
    console.log("\n\nUsage:", event.response.usage);
  }
}
```

## With SIS (Lesson Learning)

```typescript
import { createSIS } from "./argent-agent/sis/index.js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { lessons, lessonHistory, endorsements } from "../db/schema.js";

// Setup database
const sql = postgres("postgresql://localhost:5433/argent");
const db = drizzle(sql);

// Create SIS
const sis = createSIS({
  db,
  schema: { lessons, lessonHistory, endorsements },
});

// Create agent with SIS
const agent = createAgent({
  provider,
  model: {
    id: "claude-sonnet-4-20250514",
    maxTokens: 4096,
  },
  systemPrompt: "You are Argent.",
  sis, // Enable lesson learning
});

// Execute turn with episode tracking
const output = await agent.execute({
  content: "Help me debug this error.",
  history: [],
  context: "tool", // Higher threshold for tool-related lessons
  episodeId: "episode-123",
  preValence: 0.5, // Emotional state before turn
});

// Lessons were injected!
console.log("Injected lessons:", output.injectedLessons);
// [
//   { id: 1, text: "When debugging, always check logs first", confidence: 0.82 },
//   { id: 5, text: "Ask for stack trace before guessing", confidence: 0.76 }
// ]
```

## With Tools

```typescript
const agent = createAgent({
  provider,
  model: { id: "claude-sonnet-4-20250514" },
  systemPrompt: "You are a helpful assistant.",
  tools: [
    {
      name: "get_weather",
      description: "Get current weather for a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
        },
        required: ["location"],
      },
      handler: async (args: { location: string }) => {
        // Fetch weather from API
        return `Weather in ${args.location}: Sunny, 72°F`;
      },
    },
  ],
});

const output = await agent.execute({
  content: "What's the weather in Paris?",
  history: [],
});

// Agent will call get_weather tool
console.log(output.toolCalls);
// [{ id: '...', name: 'get_weather', arguments: { location: 'Paris' } }]
```

## Multi-Turn Conversation

```typescript
const history: TurnInput["history"] = [];

// Turn 1
const turn1 = await agent.execute({
  content: "My name is Jason.",
  history,
});

history.push(
  { role: "user", content: "My name is Jason." },
  { role: "assistant", content: turn1.text },
);

// Turn 2
const turn2 = await agent.execute({
  content: "What's my name?",
  history,
});

console.log(turn2.text); // "Your name is Jason."
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Agent                               │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐    │
│  │   SIS    │───▶│ Provider │───▶│  Turn Response   │    │
│  │Injection │    │  (Stream)│    │  + Tool Calls    │    │
│  └──────────┘    └──────────┘    └──────────────────┘    │
│       │                                     │              │
│       │                                     │              │
│       ▼                                     ▼              │
│  ┌──────────┐                        ┌──────────┐        │
│  │ Lessons  │                        │ Episode  │        │
│  │PostgreSQL│                        │Recording │        │
│  └──────────┘                        └──────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## What's Next

1. **Add more providers** — OpenAI, Google, ZAI
2. **Episode completion hook** — Update lesson history with post-valence
3. **Tool execution loop** — Auto-execute tools and continue turn
4. **Redis event stream** — Publish turn events for family agents
5. **Confidence recalculation** — Nightly job to update all lesson scores
