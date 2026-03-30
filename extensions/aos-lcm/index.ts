/**
 * aos-lcm — ArgentOS Plugin Entry Point
 *
 * Lossless Context Management: DAG-based context compression that
 * never loses a message. Adapted from Voltropy PBC / Martian Engineering's
 * LCM architecture (MIT license).
 *
 * Hooks into ArgentOS via:
 * - before_agent_start: initialize session + inject assembled summary context
 * - agent_end: ingest messages + run compaction
 * - gateway_stop: close database
 *
 * Registers tools: aos_lcm_grep, aos_lcm_describe, aos_lcm_expand_query
 */

import type { ArgentPluginApi } from "../../src/plugins/types.js";
import type { LcmConfig } from "./src/types.js";
import { createCompletionBridge } from "./src/completion-bridge.js";
import { getDb, closeDb } from "./src/db/connection.js";
import { LcmContextEngine } from "./src/engine.js";
import { ingestFromAgentEnd } from "./src/ingestion.js";
import { createLcmDescribeTool } from "./src/tools/lcm-describe-tool.js";
import { createLcmExpandQueryTool } from "./src/tools/lcm-expand-query-tool.js";
import { createLcmGrepTool } from "./src/tools/lcm-grep-tool.js";
import { LCM_DEFAULTS } from "./src/types.js";

let engine: LcmContextEngine | null = null;

export default function register(api: ArgentPluginApi) {
  const pluginConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
  const config: LcmConfig = {
    ...LCM_DEFAULTS,
    ...pluginConfig,
    databasePath: (pluginConfig.databasePath as string) || LCM_DEFAULTS.databasePath,
  };

  if (!config.enabled) {
    api.logger.info("[aos-lcm] Disabled by configuration");
    return;
  }

  // ---- Database ----
  const db = getDb(config.databasePath || undefined);
  api.logger.info(`[aos-lcm] Database opened at ${db.name}`);

  // ---- Completion bridge ----
  // Routes summarization calls through runEmbeddedPiAgent (same pattern as llm-task).
  // Uses FAST tier by default for cost efficiency.
  const complete = createCompletionBridge(api);

  // ---- Engine ----
  engine = new LcmContextEngine(db, config, complete);

  // ---- Hooks ----

  // Before agent start: initialize session from context + inject compressed history.
  // NOTE: session_start hook is defined in the type system but never fired by the
  // gateway. We derive session ID from the hook context (sessionKey) instead.
  api.on("before_agent_start", (_event, ctx) => {
    if (!engine) return;

    // Initialize session if not already set (or if session changed)
    const sessionKey = (ctx as Record<string, unknown>)?.sessionKey as string | undefined;
    const sessionId = sessionKey ?? `session-${Date.now()}`;
    if (engine.sessionId !== sessionId) {
      engine.setSession(sessionId);
      api.logger.info(`[aos-lcm] Session initialized: ${sessionId}`);
    }

    // Inject compressed history into context
    const assembled = engine.assembleContext();
    if (assembled) {
      return { prependContext: assembled };
    }
  });

  // Agent end: ingest new messages + run compaction
  // This is the main ingestion point — we get the full message history
  // and diff against what we've already captured.
  api.on("agent_end", async (event, ctx) => {
    if (!engine) return;

    // Ensure session is set (in case before_agent_start didn't fire)
    const sessionKey = (ctx as Record<string, unknown>)?.sessionKey as string | undefined;
    if (!engine.sessionId && sessionKey) {
      engine.setSession(sessionKey);
      api.logger.info(`[aos-lcm] Session initialized from agent_end: ${sessionKey}`);
    }
    if (!engine.sessionId) return;

    const messages = (event as Record<string, unknown>).messages as unknown[];
    if (!Array.isArray(messages)) return;

    try {
      const ingested = await ingestFromAgentEnd(engine, messages, config);
      if (ingested > 0) {
        api.logger.info(`[aos-lcm] Ingested ${ingested} new messages`);
      }

      // Run compaction if threshold exceeded
      const maxTokens = (api.config?.agents?.defaults?.model?.contextWindow as number) ?? 128_000;
      const result = await engine.compactIfNeeded(maxTokens);
      if (result) {
        api.logger.info(
          `[aos-lcm] Compacted: ${result.messagesCompacted} msgs → ${result.summariesCreated} summaries ` +
            `(${result.tokensBefore} → ${result.tokensAfter} tokens, depth ${result.depth}, level ${result.level})`,
        );
      }
    } catch (err) {
      api.logger.error(`[aos-lcm] Ingestion/compaction error: ${String(err)}`);
    }
  });

  // Gateway stop: close database
  api.on("gateway_stop", () => {
    closeDb();
    engine = null;
    api.logger.info("[aos-lcm] Database closed");
  });

  // ---- Tools ----
  const getSessionId = () => engine?.sessionId ?? "";

  api.registerTool(createLcmGrepTool(engine.conversationStore, getSessionId), { optional: true });

  api.registerTool(
    createLcmDescribeTool(engine.conversationStore, engine.summaryStore, getSessionId),
    { optional: true },
  );

  api.registerTool(createLcmExpandQueryTool(engine.summaryStore, getSessionId), { optional: true });

  api.logger.info("[aos-lcm] Registered — DAG context compression active");
}
