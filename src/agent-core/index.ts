/**
 * ArgentOS Agent Core — abstraction layer backed by argent-ai + argent-agent.
 *
 * Import from here instead of provider packages directly.
 * TUI imports (pi-tui) are the one exception — import those directly.
 */
export * from "./core.js";
export * from "./ai.js";
export * from "./coding.js";
export * from "./runtime-policy.js";
export * from "./diagnostics.js";

/**
 * Argent-native provider factories.
 * These create providers with auto-loaded API keys from the dashboard.
 */
export {
  createAnthropic,
  createOpenAI,
  createOpenAICodex,
  createInception,
  createGoogle,
  createXAI,
  createMiniMax,
  createZAI,
} from "../argent-agent/providers.js";
