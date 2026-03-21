/**
 * Identity System — Shared LLM Helper
 *
 * Runs short LLM prompts via embedded Pi agent for identity-related tasks
 * (entity extraction, profile generation, reflection, self-model).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import {
  resolveDefaultAgentId,
  resolveAgentWorkspaceDir,
  resolveAgentDir,
} from "../../agents/agent-scope.js";
import { FailoverError } from "../../agents/failover-error.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import { CommandLane } from "../../process/lanes.js";
import { buildMemuLlmRunAttempts } from "../llm-config.js";

// ── Circuit breaker ──
// When the LLM provider enters cooldown, skip further calls for CIRCUIT_COOLDOWN_MS
// instead of hammering the dead provider with rapid-fire FailoverErrors.
let circuitOpen = false;
let circuitResetAt = 0;
const CIRCUIT_COOLDOWN_MS = 30_000;

/**
 * Call LLM for identity-related tasks using embedded Pi agent.
 * Short-lived, no tools, 20s timeout. Ideal for extraction/classification.
 *
 * Includes a circuit breaker: after a FailoverError (provider in cooldown),
 * subsequent calls return empty for 30s to avoid rapid-fire error spam.
 */
export async function callIdentityLlm(
  prompt: string,
  purpose: string,
  config: ArgentConfig,
): Promise<string> {
  // Circuit breaker: skip during cooldown
  if (circuitOpen) {
    if (Date.now() < circuitResetAt) {
      return "";
    }
    circuitOpen = false;
  }

  const agentId = resolveDefaultAgentId(config);
  const workspaceDir = resolveAgentWorkspaceDir(config, agentId);
  const agentDir = resolveAgentDir(config, agentId);
  const llmAttempts = buildMemuLlmRunAttempts(config, { timeoutMs: 20_000 });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `identity-${purpose}-`));
  const sessionFile = path.join(tempDir, "session.jsonl");

  try {
    let lastError: unknown;
    for (const llm of llmAttempts) {
      try {
        const result = await runEmbeddedPiAgent({
          sessionId: `identity-${purpose}-${Date.now()}`,
          sessionKey: `temp:identity:${purpose}`,
          sessionFile,
          workspaceDir,
          agentDir,
          config,
          prompt,
          disableTools: true,
          provider: llm.provider,
          model: llm.model,
          respectProvidedModel: llm.respectProvidedModel,
          thinkLevel: llm.thinkLevel,
          timeoutMs: llm.timeoutMs,
          runId: `identity-${purpose}-${Date.now()}`,
          lane: CommandLane.Background,
        });

        return result.payloads?.[0]?.text ?? "";
      } catch (err) {
        lastError = err;
        if (llm.label === "primary") {
          console.warn(
            `[Identity] Primary ${purpose} model failed, retrying with Ollama fallback: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    throw lastError;
  } catch (err) {
    if (err instanceof FailoverError) {
      circuitOpen = true;
      circuitResetAt = Date.now() + CIRCUIT_COOLDOWN_MS;
      console.warn(
        `[Identity] Circuit breaker opened for ${CIRCUIT_COOLDOWN_MS / 1000}s after FailoverError (${purpose})`,
      );
    }
    throw err;
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
