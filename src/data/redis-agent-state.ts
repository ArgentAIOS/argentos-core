/**
 * Redis Agent State Bridge — Publishes agent state changes to Redis.
 *
 * Connects the heartbeat/contemplation/SIS runners to Redis without
 * modifying their core logic. Each runner calls these functions at key
 * event points; failures are logged but never thrown.
 *
 * State published:
 *   - agent:{agentId}:state    — HASH with status, mood, valence, arousal
 *   - agent:{agentId}:presence — KEY with 30s TTL (heartbeat refreshes)
 *   - channel:dashboard        — PUB/SUB for real-time dashboard updates
 *   - stream:family            — STREAM for inter-agent messaging
 */

import type Redis from "ioredis";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  setAgentState,
  refreshPresence,
  publishDashboardEvent,
  sendFamilyMessage,
} from "./redis-client.js";

const log = createSubsystemLogger("data/redis-state");

let _redis: Redis | null = null;
let _agentId = "argent";

/**
 * Initialize the Redis agent state bridge.
 * Call once at gateway startup after Redis is connected.
 */
export function initRedisAgentState(redis: Redis, agentId: string): void {
  _redis = redis;
  _agentId = agentId;
  log.info("redis agent state bridge initialized", { agentId });
}

/**
 * Check if the Redis bridge is active.
 */
export function isRedisAgentStateActive(): boolean {
  return _redis !== null;
}

// ── Heartbeat Events ────────────────────────────────────────────────────

/**
 * Called when a heartbeat cycle completes verification.
 * Updates agent state with score and refreshes presence.
 */
export async function onHeartbeatCycleComplete(data: {
  verified: number;
  failed: number;
  unclear: number;
  score: number;
  pointsDelta: number;
  trend: "up" | "down" | "flat";
}): Promise<void> {
  if (!_redis) return;
  try {
    await setAgentState(_redis, _agentId, {
      status: "idle",
      lastActivity: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    });

    await refreshPresence(_redis, _agentId);

    await publishDashboardEvent(_redis, {
      type: "agent_status",
      agentId: _agentId,
      data: {
        event: "heartbeat_complete",
        verified: data.verified,
        failed: data.failed,
        unclear: data.unclear,
        score: data.score,
        pointsDelta: data.pointsDelta,
        trend: data.trend,
      },
    });
  } catch (err) {
    log.warn("redis heartbeat publish failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Contemplation Events ────────────────────────────────────────────────

/**
 * Called when a contemplation cycle starts.
 * Updates agent status to "contemplating".
 */
export async function onContemplationStart(): Promise<void> {
  if (!_redis) return;
  try {
    await setAgentState(_redis, _agentId, {
      status: "contemplating",
      lastActivity: new Date().toISOString(),
    });
    await refreshPresence(_redis, _agentId);
  } catch (err) {
    log.warn("redis contemplation-start publish failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Called when a contemplation episode is captured and stored.
 * Updates mood/valence/arousal and publishes to dashboard.
 */
export async function onContemplationEpisode(episode: {
  id: string;
  type: string;
  mood: { state: string; energy?: string };
  valence: number;
  arousal: number;
  lesson?: string;
}): Promise<void> {
  if (!_redis) return;
  try {
    await setAgentState(_redis, _agentId, {
      status: "idle",
      lastActivity: new Date().toISOString(),
      currentMood: episode.mood.state,
      currentValence: episode.valence,
      currentArousal: episode.arousal,
    });

    await refreshPresence(_redis, _agentId);

    await publishDashboardEvent(_redis, {
      type: "mood_change",
      agentId: _agentId,
      data: {
        event: "contemplation_episode",
        episodeId: episode.id,
        episodeType: episode.type,
        mood: episode.mood.state,
        valence: episode.valence,
        arousal: episode.arousal,
        hasLesson: Boolean(episode.lesson),
      },
    });

    // If a lesson was extracted with high significance, share it via family stream
    if (episode.lesson) {
      await sendFamilyMessage(_redis, {
        sender: _agentId,
        type: "lesson_shared",
        payload: JSON.stringify({
          episodeId: episode.id,
          lesson: episode.lesson,
          mood: episode.mood.state,
          valence: episode.valence,
        }),
      });
    }
  } catch (err) {
    log.warn("redis episode publish failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Called when a contemplation cycle completes (even without episode).
 * Ensures status returns to idle.
 */
export async function onContemplationComplete(): Promise<void> {
  if (!_redis) return;
  try {
    await setAgentState(_redis, _agentId, {
      status: "idle",
      lastActivity: new Date().toISOString(),
    });
  } catch (err) {
    log.warn("redis contemplation-complete publish failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── SIS Events ──────────────────────────────────────────────────────────

/**
 * Called when SIS extracts lessons from consolidated episodes.
 */
export async function onSisLessonsExtracted(data: {
  lessonCount: number;
  reflectionId?: string;
}): Promise<void> {
  if (!_redis) return;
  try {
    await publishDashboardEvent(_redis, {
      type: "agent_status",
      agentId: _agentId,
      data: {
        event: "sis_consolidation",
        lessonCount: data.lessonCount,
        reflectionId: data.reflectionId,
      },
    });
  } catch (err) {
    log.warn("redis sis publish failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Memory Events ───────────────────────────────────────────────────────

/**
 * Called when a memory item is stored (from any source).
 * Publishes to dashboard for real-time memory activity indicators.
 */
export async function onMemoryStored(data: {
  itemId: string;
  memoryType: string;
  significance?: string;
}): Promise<void> {
  if (!_redis) return;
  try {
    await publishDashboardEvent(_redis, {
      type: "memory_stored",
      agentId: _agentId,
      data: {
        itemId: data.itemId,
        memoryType: data.memoryType,
        significance: data.significance,
      },
    });
  } catch (err) {
    log.warn("redis memory-stored publish failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
