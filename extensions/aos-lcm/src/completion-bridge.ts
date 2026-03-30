/**
 * aos-lcm — Completion Bridge
 *
 * Bridges LCM summarization calls to ArgentOS's model router via
 * runEmbeddedPiAgent (same pattern as the llm-task extension).
 *
 * Summarization runs as a short-lived, tool-disabled agent session
 * routed to the FAST tier (Haiku-class) by default.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArgentPluginApi } from "../../../src/plugins/types.js";
import type { CompleteFn } from "./summarize.js";

type RunEmbeddedPiAgentFn = (params: Record<string, unknown>) => Promise<unknown>;

/**
 * Dynamically load runEmbeddedPiAgent — works in both source checkout
 * and built distribution (same approach as llm-task extension).
 */
async function loadRunEmbeddedPiAgent(): Promise<RunEmbeddedPiAgentFn> {
  // Source checkout (tests/dev)
  try {
    const mod = await import("../../../src/agents/pi-embedded-runner.js");
    // oxlint-disable-next-line typescript/no-explicit-any
    if (typeof (mod as any).runEmbeddedPiAgent === "function") {
      // oxlint-disable-next-line typescript/no-explicit-any
      return (mod as any).runEmbeddedPiAgent;
    }
  } catch {
    // ignore — try built path
  }

  // Built distribution
  const mod = await import("../../../agents/pi-embedded-runner.js");
  if (typeof mod.runEmbeddedPiAgent !== "function") {
    throw new Error("aos-lcm: runEmbeddedPiAgent not available");
  }
  return mod.runEmbeddedPiAgent;
}

function collectText(payloads: Array<{ text?: string; isError?: boolean }> | undefined): string {
  return (payloads ?? [])
    .filter((p) => !p.isError && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
}

/**
 * Create a CompleteFn that routes through ArgentOS's agent infrastructure.
 *
 * Each summarization call spawns a short-lived embedded agent session with:
 * - disableTools: true (no agent tools, pure LLM completion)
 * - FAST-tier model by default (Haiku-class for cost efficiency)
 * - 30s timeout
 * - Temp directory cleaned up after each call
 */
export function createCompletionBridge(api: ArgentPluginApi): CompleteFn {
  // Resolve model from config — "auto" means use the agent's primary model
  const summaryModel = (api.pluginConfig as Record<string, unknown>)?.summaryModel as
    | string
    | undefined;

  // Resolve provider/model from config or fall back to agent primary
  const primary = api.config?.agents?.defaults?.model?.primary;
  let provider: string | undefined;
  let model: string | undefined;

  if (summaryModel && summaryModel !== "auto") {
    // Explicit model override: "provider/model" format
    const parts = summaryModel.split("/");
    provider = parts[0];
    model = parts.slice(1).join("/");
  } else if (typeof primary === "string") {
    // Use agent's primary model
    provider = primary.split("/")[0];
    model = primary.split("/").slice(1).join("/");
  }

  let runAgent: RunEmbeddedPiAgentFn | null = null;

  return async (opts) => {
    // Lazy-load the embedded agent runner
    if (!runAgent) {
      runAgent = await loadRunEmbeddedPiAgent();
    }

    const tmpDir = await mkdtemp(join(tmpdir(), "aos-lcm-summary-"));
    try {
      const sessionId = `lcm-summary-${Date.now()}`;
      const result = await runAgent({
        sessionId,
        sessionFile: join(tmpDir, "session.json"),
        workspaceDir: api.config?.agents?.defaults?.workspace ?? process.cwd(),
        config: api.config,
        prompt: opts.prompt,
        timeoutMs: 30_000,
        runId: `lcm-summary-${Date.now()}`,
        provider,
        model,
        disableTools: true,
        streamParams: {
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
        },
      });

      // oxlint-disable-next-line typescript/no-explicit-any
      const text = collectText((result as any).payloads);
      if (!text) {
        throw new Error("aos-lcm: summarization returned empty output");
      }

      return text;
    } finally {
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        // cleanup failure is non-fatal
      }
    }
  };
}
