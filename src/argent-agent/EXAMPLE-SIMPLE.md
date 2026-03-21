# Argent Agent — Simple Usage (Auto-Loaded Keys)

## Basic Agent (Keys from Dashboard)

```typescript
import { createAgent } from "./argent-agent/index.js";
import { createAnthropic } from "./argent-agent/providers.js";

// Provider auto-loads key from ~/.argentos/service-keys.json
const provider = await createAnthropic();

// Create agent
const agent = createAgent({
  provider,
  model: {
    id: "claude-sonnet-4-20250514",
    maxTokens: 4096,
  },
  systemPrompt: "You are Argent, a helpful AI assistant.",
});

// Execute turn
const output = await agent.execute({
  content: "What is 2 + 2?",
  history: [],
});

console.log(output.text); // "2 + 2 is 4."
```

## With Explicit Key (Override)

```typescript
const provider = await createAnthropic({
  apiKey: process.env.MY_CUSTOM_KEY,
  cacheRetention: "long",
});
```

## How Keys Are Loaded

1. **Try explicit apiKey** (if provided in options)
2. **Try dashboard key store** (`~/.argentos/service-keys.json`)
3. **Throw error** if no key found

Keys are cached for 1 minute to avoid repeated file reads.

## Available Providers

- ✅ `createAnthropic()` — Anthropic (Claude)
- 🚧 `createOpenAI()` — OpenAI (GPT-4, o1)
- 🚧 `createGoogle()` — Google (Gemini)
- 🚧 `createZAI()` — Z.AI

## Key Management

Keys are managed in Dashboard > Settings > API Keys.

The agent will automatically:

- Find the first enabled key for the requested service
- Prefer keys marked as primary (if implemented)
- Cache keys for 1 minute
- Throw clear errors if no key is found

## Example: Full Agent Setup

```typescript
import { createAgent } from "./argent-agent/index.js";
import { createAnthropic } from "./argent-agent/providers.js";
import { createSIS } from "./argent-agent/sis/index.js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

// Setup (one-time)
const sql = postgres("postgresql://localhost:5433/argent");
const db = drizzle(sql);
const provider = await createAnthropic();
const sis = createSIS({ db, schema: { lessons, lessonHistory, endorsements } });

// Create agent
const agent = createAgent({
  provider,
  model: { id: "claude-sonnet-4-20250514" },
  systemPrompt: "You are Argent.",
  sis, // Optional - enables lesson learning
});

// Use it
for await (const event of agent.stream({
  content: "Hello!",
  history: [],
  episodeId: "ep-123",
  preValence: 0.5,
})) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}
```

That's it. No manual key management, no environment variables, no config files.
Keys come from the dashboard, where they should be.
