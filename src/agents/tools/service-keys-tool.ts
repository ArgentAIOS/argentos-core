/**
 * Service Keys Discovery Tool
 *
 * Lets the agent discover what third-party API keys/services are available.
 * Never exposes actual key values.
 */

import { Type } from "@sinclair/typebox";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

// ============================================================================
// Schema
// ============================================================================

const ServiceKeysToolSchema = Type.Object({
  category: Type.Optional(Type.String()),
});

// ============================================================================
// Helpers
// ============================================================================

/** Extract category from parenthetical in name, e.g. "Brave (Search)" → "Search" */
function extractCategory(name: string): string {
  const match = name.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : "Other";
}

// ============================================================================
// Tool Implementation
// ============================================================================

export function createServiceKeysTool(): AnyAgentTool {
  return {
    label: "ServiceKeys",
    name: "service_keys",
    description: `Lists all third-party API keys/services configured by the operator, with their display name, environment variable, category, and availability status. Never exposes actual key values.

Use this to discover what capabilities are available (e.g. Firecrawl, Brave Search, ElevenLabs, etc.) before attempting to use a service.

Do not use this to check whether messaging channels like Telegram, Slack, Discord, Signal, WhatsApp, or iMessage are enabled. Use channel_config instead; channel readiness is stored in argent.json under channels.<id>, not service-keys.json.

PARAMS:
- category (optional): Filter by category (e.g. "Search", "TTS", "LLM")`,
    parameters: ServiceKeysToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const categoryFilter = readStringParam(params, "category");

      // Dynamic import to avoid circular deps
      const { readServiceKeys } = await import("../../infra/service-keys.js");
      const store = readServiceKeys();

      let keys = store.keys.map((entry) => {
        const category = extractCategory(entry.name);
        const available = !!entry.value && entry.enabled !== false;
        return {
          name: entry.name,
          variable: entry.variable,
          category,
          available,
          enabled: entry.enabled !== false,
        };
      });

      if (categoryFilter) {
        const lower = categoryFilter.toLowerCase();
        keys = keys.filter((k) => k.category.toLowerCase() === lower);
      }

      const categories = [...new Set(keys.map((k) => k.category))].toSorted();

      return jsonResult({
        total: keys.length,
        available: keys.filter((k) => k.available).length,
        categories,
        channelConfigNotice:
          "Messaging channel readiness lives in argent.json under channels.<id>. Use channel_config for Telegram/Slack/Discord/etc. service_keys only covers generic API secrets.",
        keys,
      });
    },
  };
}
