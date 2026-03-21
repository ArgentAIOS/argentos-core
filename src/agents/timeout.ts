import type { ArgentConfig } from "../config/config.js";

const DEFAULT_AGENT_TIMEOUT_SECONDS = 600;
// Node timers use signed 32-bit integers for delay values.
export const MAX_NODE_TIMEOUT_MS = 2 ** 31 - 1;
const NO_TIMEOUT_MS = MAX_NODE_TIMEOUT_MS - 60_000;

const normalizeNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;

const clampTimeoutMs = (timeoutMs: number, minMs: number) => {
  const boundedMinMs = Math.max(1, Math.min(minMs, MAX_NODE_TIMEOUT_MS));
  const boundedTimeoutMs = Math.min(Math.max(1, timeoutMs), MAX_NODE_TIMEOUT_MS);
  return Math.max(boundedTimeoutMs, boundedMinMs);
};

export function resolveAgentTimeoutSeconds(cfg?: ArgentConfig): number {
  const raw = normalizeNumber(cfg?.agents?.defaults?.timeoutSeconds);
  const seconds = raw ?? DEFAULT_AGENT_TIMEOUT_SECONDS;
  return Math.max(seconds, 1);
}

export function resolveAgentTimeoutMs(opts: {
  cfg?: ArgentConfig;
  overrideMs?: number | null;
  overrideSeconds?: number | null;
  minMs?: number;
}): number {
  const minMs = Math.max(normalizeNumber(opts.minMs) ?? 1, 1);
  const defaultMs = resolveAgentTimeoutSeconds(opts.cfg) * 1000;
  const overrideMs = normalizeNumber(opts.overrideMs);
  if (overrideMs !== undefined) {
    if (overrideMs === 0) {
      return clampTimeoutMs(NO_TIMEOUT_MS, minMs);
    }
    if (overrideMs < 0) {
      return clampTimeoutMs(defaultMs, minMs);
    }
    return clampTimeoutMs(overrideMs, minMs);
  }
  const overrideSeconds = normalizeNumber(opts.overrideSeconds);
  if (overrideSeconds !== undefined) {
    if (overrideSeconds === 0) {
      return clampTimeoutMs(NO_TIMEOUT_MS, minMs);
    }
    if (overrideSeconds < 0) {
      return clampTimeoutMs(defaultMs, minMs);
    }
    return clampTimeoutMs(overrideSeconds * 1000, minMs);
  }
  return clampTimeoutMs(defaultMs, minMs);
}
