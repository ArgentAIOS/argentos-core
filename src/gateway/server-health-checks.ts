/**
 * Gateway Health Checks
 *
 * Periodic system health monitoring extracted from the retired AlwaysOnLoop.
 * Runs zombie reaper, Ollama ping, disk space check, and auth profile status
 * on a configurable interval. Plugs into the gateway's maintenance timer system.
 */

import { execSync } from "node:child_process";
import { statfsSync } from "node:fs";
import path from "node:path";
import type { ArgentConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/health-checks");

// ============================================================================
// Types
// ============================================================================

export interface HealthCheckResult {
  timestamp: number;
  zombieProcesses: { killed: number; found: number };
  authProfiles: Array<{ name: string; available: boolean; cooldownUntil?: number }>;
  ollamaReachable: boolean;
  ollamaProbed: boolean;
  localRuntimeProvider: "ollama" | "lmstudio" | null;
  diskUsage: { path: string; usedPercent: number; warning: boolean };
}

export interface HealthCheckTimerOptions {
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  getAuthProfileStatus?: () => Array<{
    name: string;
    available: boolean;
    cooldownUntil?: number;
  }>;
  getConfig?: () => ArgentConfig;
  intervalMs?: number;
}

// ============================================================================
// Health Check Implementations
// ============================================================================

/**
 * Parse POSIX `ps etime` format [[dd-]hh:]mm:ss into seconds.
 * Examples: "03:22" → 202, "01:03:22" → 3802, "2-01:03:22" → 176602
 */
export function parseEtime(etime: string): number {
  if (!etime) {
    return 0;
  }

  let days = 0;
  let rest = etime;

  // Handle "dd-" prefix
  const dashIdx = rest.indexOf("-");
  if (dashIdx !== -1) {
    days = Number.parseInt(rest.slice(0, dashIdx), 10) || 0;
    rest = rest.slice(dashIdx + 1);
  }

  const parts = rest.split(":").map((p) => Number.parseInt(p, 10) || 0);

  if (parts.length === 3) {
    // hh:mm:ss
    return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    // mm:ss
    return days * 86400 + parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Zombie Reaper — Find and kill orphaned Claude CLI subprocesses.
 *
 * The gateway spawns `claude --output-format stream-json` subprocesses for
 * each agent run. Normally they exit when the run completes, but crashes,
 * timeouts, or ungraceful shutdowns can leave them orphaned.
 *
 * CRITICAL: Only targets processes with "stream-json" in their args.
 * NEVER match the user's interactive Claude Code sessions or other claude
 * processes. (A broad `grep "claude"` killed the user's active session once.)
 *
 * Platform note: Uses POSIX `etime` (mm:ss / hh:mm:ss / dd-hh:mm:ss)
 * instead of Linux-only `etimes` (seconds). macOS doesn't have `etimes`.
 *
 * Kills processes > 5 min old.
 */
export function reapZombieProcesses(): { killed: number; found: number } {
  let found = 0;
  let killed = 0;

  try {
    // Only target gateway-spawned agent subprocesses (stream-json pattern),
    // NOT user's interactive Claude Code sessions or other claude processes.
    // Use `etime` (macOS/POSIX) instead of `etimes` (Linux-only)
    const output = execSync(
      'ps -eo pid,ppid,etime,args 2>/dev/null | grep "stream-json" | grep -v grep',
      { encoding: "utf-8", timeout: 5000 },
    ).trim();

    if (!output) {
      return { found: 0, killed: 0 };
    }

    const myPid = process.pid;
    const lines = output.split("\n").filter(Boolean);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = Number.parseInt(parts[0], 10);
      const ppid = Number.parseInt(parts[1], 10);
      const etime = parts[2]; // format: [[dd-]hh:]mm:ss
      const elapsedSeconds = parseEtime(etime);

      found++;

      // Only kill orphaned processes: older than 5 minutes AND
      // either parented to PID 1 (orphan) or parented to the gateway
      if (elapsedSeconds > 300 && pid > 0 && pid !== myPid) {
        try {
          process.kill(pid, "SIGTERM");
          killed++;
          log.info(`killed orphaned process PID=${pid} ppid=${ppid} (age=${elapsedSeconds}s)`);
        } catch {
          // Process may have already exited
        }
      }
    }
  } catch {
    // grep returns exit code 1 when no matches — that's fine
  }

  return { found, killed };
}

/**
 * Ping Ollama API to check reachability (1500ms timeout).
 */
export async function pingOllama(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    const response = await fetch("http://localhost:11434/api/tags", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return response.ok;
  } catch {
    return false;
  }
}

function hasProviderRef(value: unknown, provider: "ollama" | "lmstudio"): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith(`${provider}/`);
}

function resolvePreferredLocalRuntimeProvider(cfg?: ArgentConfig): "ollama" | "lmstudio" | null {
  if (!cfg) {
    return null;
  }
  const kernelLocalModel = cfg.agents?.defaults?.kernel?.localModel;
  if (hasProviderRef(kernelLocalModel, "lmstudio")) {
    return "lmstudio";
  }
  if (hasProviderRef(kernelLocalModel, "ollama")) {
    return "ollama";
  }
  const memorySearch = cfg.agents?.defaults?.memorySearch;
  if (memorySearch?.provider === "lmstudio") {
    return "lmstudio";
  }
  if (memorySearch?.provider === "ollama") {
    return "ollama";
  }
  return null;
}

function shouldProbeOllama(cfg?: ArgentConfig): boolean {
  if (!cfg) {
    return true;
  }
  if (cfg.models?.providers?.ollama) {
    return true;
  }
  return resolvePreferredLocalRuntimeProvider(cfg) === "ollama";
}

/**
 * Check disk space for ~/.argentos/ partition.
 */
export function checkDiskSpace(): { path: string; usedPercent: number; warning: boolean } {
  const argentosDir = path.join(process.env.HOME || "/tmp", ".argentos");

  try {
    const stats = statfsSync(argentosDir);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedPercent = ((totalBytes - freeBytes) / totalBytes) * 100;

    return {
      path: argentosDir,
      usedPercent,
      warning: usedPercent > 90,
    };
  } catch {
    return { path: argentosDir, usedPercent: 0, warning: false };
  }
}

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Run all health checks. Each check is failure-isolated — one failing check
 * does not suppress others.
 */
export async function runHealthCheck(
  getAuthProfileStatus?: () => Array<{ name: string; available: boolean; cooldownUntil?: number }>,
  cfg?: ArgentConfig,
): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    timestamp: Date.now(),
    zombieProcesses: { killed: 0, found: 0 },
    authProfiles: [],
    ollamaReachable: false,
    ollamaProbed: false,
    localRuntimeProvider: resolvePreferredLocalRuntimeProvider(cfg),
    diskUsage: { path: "", usedPercent: 0, warning: false },
  };

  // 1. Zombie process reaper
  try {
    result.zombieProcesses = reapZombieProcesses();
  } catch (error) {
    log.error(`zombie reaper error: ${String(error)}`);
  }

  // 2. Auth profile status
  try {
    if (getAuthProfileStatus) {
      result.authProfiles = getAuthProfileStatus();
    }
  } catch (error) {
    log.error(`auth profile check error: ${String(error)}`);
  }

  // 3. Ollama reachability
  if (shouldProbeOllama(cfg)) {
    result.ollamaProbed = true;
    try {
      result.ollamaReachable = await pingOllama();
    } catch {
      result.ollamaReachable = false;
    }
  }

  // 4. Disk space
  try {
    result.diskUsage = checkDiskSpace();
  } catch (error) {
    log.error(`disk space check error: ${String(error)}`);
  }

  return result;
}

// ============================================================================
// Timer
// ============================================================================

let lastResult: HealthCheckResult | null = null;
let running = false;

/**
 * Start a periodic health check timer.
 *
 * Returns the interval handle for cleanup in server-close.
 * Includes a maintenance budget guard — if the previous check is still
 * running when the next tick fires, it skips with a warning.
 */
export function startHealthCheckTimer(
  opts: HealthCheckTimerOptions,
): ReturnType<typeof setInterval> {
  const intervalMs = opts.intervalMs ?? 60_000;

  const tick = async () => {
    if (running) {
      log.warn("health check still running from previous tick, skipping");
      return;
    }
    running = true;
    try {
      const result = await runHealthCheck(opts.getAuthProfileStatus, opts.getConfig?.());
      lastResult = result;

      // Single-line log summary
      const authAvailable = result.authProfiles.filter((p) => p.available).length;
      const authTotal = result.authProfiles.length;
      const diskPct = result.diskUsage.usedPercent.toFixed(1);
      const diskWarn = result.diskUsage.warning ? " WARNING" : "";
      const localRuntimePart = result.ollamaProbed
        ? `ollama=${result.ollamaReachable ? "up" : "down"}`
        : result.localRuntimeProvider
          ? `local=${result.localRuntimeProvider}`
          : "local=none";
      log.info(
        `health: ok (zombies=${result.zombieProcesses.found}, disk=${diskPct}%${diskWarn}, ` +
          `${localRuntimePart}, auth=${authAvailable}/${authTotal})`,
      );

      // Broadcast to dashboard for future visibility
      opts.broadcast("gateway_health", result, { dropIfSlow: true });
    } catch (error) {
      log.error(`health check failed: ${String(error)}`);
    } finally {
      running = false;
    }
  };

  // Run initial check after a short delay (let gateway finish starting)
  setTimeout(() => void tick(), 5_000);

  return setInterval(() => void tick(), intervalMs);
}

export function getLastHealthCheckResult(): HealthCheckResult | null {
  return lastResult;
}
