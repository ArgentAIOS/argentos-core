/**
 * Concurrency-Safe Agent State Broadcaster
 *
 * Replaces the AlwaysOnLoop's state broadcasting with a simple active-counter
 * model that handles overlapping agentCommand() calls correctly.
 *
 * When multiple agent commands run concurrently (retries, webhooks, internal
 * triggers), the counter prevents state flapping — we only transition to
 * "idle" when ALL commands have finished.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/agent-state");

// ============================================================================
// Types
// ============================================================================

export type AgentState = "idle" | "processing" | "cooldown";

export type ActivityStateName = "idle" | "thinking" | "working" | "speaking" | "listening";

export interface AgentStateBroadcaster {
  /** Call when an agentCommand() starts. Increments active counter, broadcasts "processing". */
  markProcessing(reason?: string): void;
  /** Call when an agentCommand() finishes. Decrements active counter, broadcasts "idle" when all done. */
  markDone(): void;
  /** Emit a finer-grained AEVP activity state for dashboard renderers. */
  markActivity(state: ActivityStateName, tool?: string): void;
  /** Get current state. */
  getState(): AgentState;
}

// ============================================================================
// Implementation
// ============================================================================

export function createAgentStateBroadcaster(
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void,
): AgentStateBroadcaster {
  let active = 0;
  let currentState: AgentState = "idle";

  function transitionTo(newState: AgentState, reason?: string): void {
    if (currentState === newState) return;
    const from = currentState;
    currentState = newState;
    const payload = {
      type: "agent_state",
      state: newState,
      from,
      timestamp: Date.now(),
      reason,
    };
    log.debug(`state: ${from} → ${newState}${reason ? ` (${reason})` : ""}`);
    broadcast("agent_state", payload, { dropIfSlow: true });
  }

  return {
    markProcessing(reason?: string): void {
      active++;
      if (active === 1) {
        transitionTo("processing", reason ?? "agent:command");
      }
    },

    markDone(): void {
      if (active > 0) {
        active--;
      }
      if (active === 0) {
        transitionTo("idle");
        log.info("[AEVP] activity → idle");
        broadcast(
          "aevp_activity",
          {
            type: "activity_state",
            state: "idle",
            timestamp: Date.now(),
          },
          { dropIfSlow: true },
        );
      }
    },

    markActivity(state: ActivityStateName, tool?: string): void {
      log.info(`[AEVP] activity → ${state}${tool ? ` (${tool})` : ""}`);
      broadcast(
        "aevp_activity",
        {
          type: "activity_state",
          state,
          tool,
          timestamp: Date.now(),
        },
        { dropIfSlow: true },
      );
    },

    getState(): AgentState {
      return currentState;
    },
  };
}
