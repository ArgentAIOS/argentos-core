/**
 * Redis Client — ioredis connection singleton.
 *
 * Provides hot agent state, presence TTLs, inter-agent Streams,
 * session cache, and dashboard pub/sub.
 */

import Redis from "ioredis";
import type { RedisConfig } from "./storage-config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("data/redis");

let _redis: Redis | null = null;

/**
 * Get or create the Redis connection.
 * ioredis handles reconnection automatically.
 */
export function getRedisClient(config: RedisConfig): Redis {
  if (_redis) return _redis;

  // ArgentOS uses port 6380 (not default 6379) to avoid conflicts
  _redis = new Redis({
    host: config.host,
    port: config.port, // Default: 6380 (see ARGENT_REDIS_PORT)
    password: config.password,
    db: config.db ?? 0,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
      // Exponential backoff: 100ms, 200ms, 400ms, ... max 5s
      const delay = Math.min(times * 100, 5000);
      return delay;
    },
  });

  _redis.on("connect", () => {
    log.info("redis: connected", { host: config.host, port: config.port });
  });

  _redis.on("error", (err) => {
    log.error("redis: connection error", { error: err.message });
  });

  _redis.on("close", () => {
    log.debug("redis: connection closed");
  });

  return _redis;
}

/**
 * Close the Redis connection.
 * Call during graceful shutdown.
 */
export async function closeRedisClient(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
    log.info("redis: connection closed");
  }
}

// ── Agent State ───────────────────────────────────────────────────────────

const AGENT_STATE_PREFIX = "agent:state:";
const AGENT_PRESENCE_PREFIX = "agent:presence:";
const PRESENCE_TTL_SECONDS = 30;

export interface AgentState {
  status: "idle" | "processing" | "contemplating" | "offline";
  lastActivity: string;
  currentMood?: string;
  currentValence?: number;
  currentArousal?: number;
  heartbeatAt?: string;
  sessionKey?: string;
}

/** Set agent state hash */
export async function setAgentState(
  redis: Redis,
  agentId: string,
  state: Partial<AgentState>,
): Promise<void> {
  const key = `${AGENT_STATE_PREFIX}${agentId}`;
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(state)) {
    if (v !== undefined && v !== null) flat[k] = String(v);
  }
  if (Object.keys(flat).length > 0) {
    await redis.hmset(key, flat);
  }
}

/** Get agent state hash */
export async function getAgentState(redis: Redis, agentId: string): Promise<AgentState | null> {
  const key = `${AGENT_STATE_PREFIX}${agentId}`;
  const data = await redis.hgetall(key);
  if (!data || Object.keys(data).length === 0) return null;
  return {
    status: (data.status as AgentState["status"]) ?? "offline",
    lastActivity: data.lastActivity ?? "",
    currentMood: data.currentMood,
    currentValence: data.currentValence ? Number(data.currentValence) : undefined,
    currentArousal: data.currentArousal ? Number(data.currentArousal) : undefined,
    heartbeatAt: data.heartbeatAt,
    sessionKey: data.sessionKey,
  };
}

/** Refresh agent presence TTL (call from heartbeat) */
export async function refreshPresence(redis: Redis, agentId: string): Promise<void> {
  const key = `${AGENT_PRESENCE_PREFIX}${agentId}`;
  await redis.set(key, "1", "EX", PRESENCE_TTL_SECONDS);
}

/** Check if an agent is alive (presence key exists) */
export async function isAgentAlive(redis: Redis, agentId: string): Promise<boolean> {
  const key = `${AGENT_PRESENCE_PREFIX}${agentId}`;
  return (await redis.exists(key)) === 1;
}

/** Get all alive agent IDs */
export async function getAliveAgents(redis: Redis): Promise<string[]> {
  const keys = await redis.keys(`${AGENT_PRESENCE_PREFIX}*`);
  return keys.map((k) => k.slice(AGENT_PRESENCE_PREFIX.length));
}

// ── Inter-Agent Streams ───────────────────────────────────────────────────

const FAMILY_STREAM = "stream:family";

export interface StreamMessage {
  sender: string;
  type:
    | "lesson_shared"
    | "task_handoff"
    | "observation"
    | "alert"
    | "specforge_progress"
    | "specforge_task_assigned";
  recipient?: string;
  payload: string;
}

/** Send a message to the family stream */
export async function sendFamilyMessage(redis: Redis, msg: StreamMessage): Promise<string> {
  return redis.xadd(
    FAMILY_STREAM,
    "*",
    "sender",
    msg.sender,
    "type",
    msg.type,
    "recipient",
    msg.recipient ?? "*",
    "payload",
    msg.payload,
  );
}

/** Read pending messages for an agent from the family stream */
export async function readFamilyMessages(
  redis: Redis,
  agentId: string,
  count = 10,
): Promise<Array<{ id: string; message: StreamMessage }>> {
  const groupName = `agent:${agentId}`;

  // Ensure consumer group exists
  try {
    await redis.xgroup("CREATE", FAMILY_STREAM, groupName, "0", "MKSTREAM");
  } catch {
    // Group already exists — fine
  }

  const results = await redis.xreadgroup(
    "GROUP",
    groupName,
    agentId,
    "COUNT",
    String(count),
    "STREAMS",
    FAMILY_STREAM,
    ">",
  );

  if (!results) return [];

  const messages: Array<{ id: string; message: StreamMessage }> = [];
  for (const [, entries] of results) {
    for (const [id, fields] of entries) {
      const msg: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        msg[fields[i]] = fields[i + 1];
      }
      messages.push({
        id,
        message: {
          sender: msg.sender ?? "",
          type: (msg.type as StreamMessage["type"]) ?? "observation",
          recipient: msg.recipient === "*" ? undefined : msg.recipient,
          payload: msg.payload ?? "{}",
        },
      });
    }
  }

  return messages;
}

/** Acknowledge processed messages in a consumer group */
export async function ackFamilyMessages(
  redis: Redis,
  agentId: string,
  messageIds: string[],
): Promise<number> {
  if (messageIds.length === 0) return 0;
  const groupName = `agent:${agentId}`;
  return redis.xack(FAMILY_STREAM, groupName, ...messageIds);
}

// ── Dashboard Pub/Sub ─────────────────────────────────────────────────────

const DASHBOARD_CHANNEL = "channel:dashboard";

export interface DashboardEvent {
  type: "task_update" | "mood_change" | "agent_status" | "memory_stored";
  agentId: string;
  data: Record<string, unknown>;
}

/** Publish an event to the dashboard channel */
export async function publishDashboardEvent(redis: Redis, event: DashboardEvent): Promise<void> {
  await redis.publish(DASHBOARD_CHANNEL, JSON.stringify(event));
}
