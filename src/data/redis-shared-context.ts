import type Redis from "ioredis";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { getRedisClient } from "./redis-client.js";
import { resolveRedisConfig } from "./storage-resolver.js";

const log = createSubsystemLogger("data/redis-shared-context");

const STREAM_MAX_LEN = 50;
const STREAM_TTL_SECONDS = 24 * 60 * 60;
const REDIS_OP_TIMEOUT_MS = 200;
const SHARED_CONTEXT_PREFIX = "agent:shared_context:";
const CROSS_CHANNEL_STREAM_PREFIX = "agent:cross_channel_log:";

export interface CrossChannelContextEvent {
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  runId?: string;
  channel?: string;
  summary: string;
  timestampMs: number;
}

function sharedContextKey(agentId: string): string {
  return `${SHARED_CONTEXT_PREFIX}${normalizeAgentId(agentId)}`;
}

function crossChannelStreamKey(agentId: string): string {
  return `${CROSS_CHANNEL_STREAM_PREFIX}${normalizeAgentId(agentId)}`;
}

function resolveSharedContextRedisClient(): Redis | null {
  const redisConfig = resolveRedisConfig();
  if (!redisConfig) {
    return null;
  }
  try {
    return getRedisClient(redisConfig);
  } catch (err) {
    log.debug("shared context: redis unavailable", { error: String(err) });
    return null;
  }
}

function parseStreamFields(fields: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (typeof key === "string" && typeof value === "string") {
      parsed[key] = value;
    }
  }
  return parsed;
}

function withTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMs = REDIS_OP_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

export async function appendCrossChannelContextEvent(params: {
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  runId?: string;
  channel?: string;
  summary: string;
  timestampMs?: number;
}): Promise<boolean> {
  const redis = resolveSharedContextRedisClient();
  if (!redis) {
    return false;
  }
  const summary = params.summary.trim();
  if (!summary) {
    return false;
  }

  const agentId = normalizeAgentId(params.agentId);
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return false;
  }

  const timestampMs = params.timestampMs ?? Date.now();
  const sharedKey = sharedContextKey(agentId);
  const streamKey = crossChannelStreamKey(agentId);

  try {
    const tx = redis.multi();
    tx.xadd(
      streamKey,
      "MAXLEN",
      "~",
      String(STREAM_MAX_LEN),
      "*",
      "agentId",
      agentId,
      "sessionKey",
      sessionKey,
      "sessionId",
      params.sessionId ?? "",
      "runId",
      params.runId ?? "",
      "channel",
      params.channel ?? "",
      "summary",
      summary,
      "timestampMs",
      String(timestampMs),
    );
    tx.expire(streamKey, STREAM_TTL_SECONDS);
    tx.hset(sharedKey, {
      lastSessionKey: sessionKey,
      lastChannel: params.channel ?? "",
      lastSummary: summary,
      lastEventAt: String(timestampMs),
      sessionId: params.sessionId ?? "",
      runId: params.runId ?? "",
    });
    tx.expire(sharedKey, STREAM_TTL_SECONDS);
    await withTimeout(tx.exec(), null);
    return true;
  } catch (err) {
    log.debug("shared context: append failed", { error: String(err), agentId, sessionKey });
    return false;
  }
}

export async function readCrossChannelContextEvents(params: {
  agentId: string;
  limit?: number;
  excludeSessionKey?: string;
}): Promise<CrossChannelContextEvent[]> {
  const redis = resolveSharedContextRedisClient();
  if (!redis) {
    return [];
  }

  const agentId = normalizeAgentId(params.agentId);
  const limit = Math.max(1, Math.min(25, params.limit ?? 10));
  const excludeSessionKey = params.excludeSessionKey?.trim();
  const streamKey = crossChannelStreamKey(agentId);

  try {
    const rows = await withTimeout(
      redis.xrevrange(streamKey, "+", "-", "COUNT", String(limit * 3)),
      [] as Array<[string, string[]]>,
    );
    const events: CrossChannelContextEvent[] = [];
    for (const [, fields] of rows) {
      const parsed = parseStreamFields(fields);
      const sessionKey = parsed.sessionKey?.trim();
      const summary = parsed.summary?.trim();
      if (!sessionKey || !summary) {
        continue;
      }
      if (excludeSessionKey && sessionKey === excludeSessionKey) {
        continue;
      }
      events.push({
        agentId: parsed.agentId?.trim() || agentId,
        sessionKey,
        sessionId: parsed.sessionId?.trim() || undefined,
        runId: parsed.runId?.trim() || undefined,
        channel: parsed.channel?.trim() || undefined,
        summary,
        timestampMs: Number(parsed.timestampMs || "0") || 0,
      });
      if (events.length >= limit) {
        break;
      }
    }

    return events.sort((a, b) => a.timestampMs - b.timestampMs);
  } catch (err) {
    log.debug("shared context: read failed", { error: String(err), agentId });
    return [];
  }
}
