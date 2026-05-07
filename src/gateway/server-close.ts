import type { Server as HttpServer } from "node:http";
import type { WebSocketServer } from "ws";
import type { CanvasHostHandler, CanvasHostServer } from "../canvas-host/server.js";
import type { ConsciousnessKernelRunner } from "../infra/consciousness-kernel.js";
import type { ContemplationRunner } from "../infra/contemplation-runner.js";
import type { ExecutionWorkerRunner } from "../infra/execution-worker-runner.js";
import type { HeartbeatRunner } from "../infra/heartbeat-runner.js";
import type { SisRunner } from "../infra/sis-runner.js";
import type { PluginServicesHandle } from "../plugins/services.js";
import type { JobOrchestratorRunner } from "./job-orchestrator-bridge.js";
import { type ChannelId, listChannelPlugins } from "../channels/plugins/index.js";
import { closeStorageAdapter } from "../data/storage-factory.js";
import { stopGmailWatcher } from "../hooks/gmail-watcher.js";
import { closeMemuStore } from "../memory/memu-store.js";
import { stopDashboardApiServer } from "./server-dashboard-api.js";

export function createGatewayCloseHandler(params: {
  bonjourStop: (() => Promise<void>) | null;
  tailscaleCleanup: (() => Promise<void>) | null;
  canvasHost: CanvasHostHandler | null;
  canvasHostServer: CanvasHostServer | null;
  stopChannel: (name: ChannelId, accountId?: string) => Promise<void>;
  pluginServices: PluginServicesHandle | null;
  cron?: { stop?: () => void } | null;
  heartbeatRunner?: HeartbeatRunner | null;
  contemplationRunner?: ContemplationRunner | null;
  executionWorkerRunner?: ExecutionWorkerRunner | null;
  jobOrchestratorRunner?: JobOrchestratorRunner | null;
  sisRunner?: SisRunner | null;
  consciousnessKernelRunner?: ConsciousnessKernelRunner | null;
  healthCheckInterval?: ReturnType<typeof setInterval>;
  nodePresenceTimers: Map<string, ReturnType<typeof setInterval>>;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  tickInterval: ReturnType<typeof setInterval>;
  healthInterval: ReturnType<typeof setInterval>;
  dedupeCleanup: ReturnType<typeof setInterval>;
  agentUnsub: (() => void) | null;
  heartbeatUnsub: (() => void) | null;
  chatRunState: { clear: () => void };
  clients: Set<{ socket: { close: (code: number, reason: string) => void } }>;
  configReloader: { stop: () => Promise<void> };
  browserControl: { stop: () => Promise<void> } | null;
  wss: WebSocketServer;
  httpServer: HttpServer;
  httpServers?: HttpServer[];
}) {
  const stopSyncHandle = (handle: { stop?: () => void } | null | undefined) => {
    try {
      handle?.stop?.();
    } catch {
      /* ignore */
    }
  };

  return async (opts?: { reason?: string; restartExpectedMs?: number | null }) => {
    const reasonRaw = typeof opts?.reason === "string" ? opts.reason.trim() : "";
    const reason = reasonRaw || "gateway stopping";
    const restartExpectedMs =
      typeof opts?.restartExpectedMs === "number" && Number.isFinite(opts.restartExpectedMs)
        ? Math.max(0, Math.floor(opts.restartExpectedMs))
        : null;
    // Stop channels FIRST. Channels (especially Telegram) hold external
    // long-poll locks against third-party APIs; if we leave the abort
    // until after bonjour/tailscale/canvas teardown, the run-loop's 5s
    // graceful-shutdown deadline can fire while the legacy poller is
    // still asleep on Telegram.getUpdates — which directly causes the
    // 409 Conflict cascade against the next gateway instance.
    //
    // Aborting the channel runtimes here releases those external locks
    // as quickly as possible. Promise.all also fires the abort on every
    // channel synchronously instead of serially, so multi-channel
    // tenants don't pay an extra long-poll's worth of latency per
    // additional channel.
    const channelStops = listChannelPlugins().map((plugin) =>
      params.stopChannel(plugin.id).catch(() => {
        /* per-channel stop errors must not block sibling channels or the rest of shutdown */
      }),
    );
    await Promise.all(channelStops);
    if (params.bonjourStop) {
      try {
        await params.bonjourStop();
      } catch {
        /* ignore */
      }
    }
    if (params.tailscaleCleanup) {
      await params.tailscaleCleanup();
    }
    if (params.canvasHost) {
      try {
        await params.canvasHost.close();
      } catch {
        /* ignore */
      }
    }
    if (params.canvasHostServer) {
      try {
        await params.canvasHostServer.close();
      } catch {
        /* ignore */
      }
    }
    if (params.pluginServices) {
      await params.pluginServices.stop().catch(() => {});
    }
    await stopGmailWatcher();
    stopDashboardApiServer();
    stopSyncHandle(params.cron);
    stopSyncHandle(params.heartbeatRunner);
    stopSyncHandle(params.contemplationRunner);
    stopSyncHandle(params.executionWorkerRunner);
    stopSyncHandle(params.jobOrchestratorRunner);
    stopSyncHandle(params.sisRunner);
    stopSyncHandle(params.consciousnessKernelRunner);
    // Close Redis connection (if initialized)
    try {
      const { closeRedisClient } = await import("../data/redis-client.js");
      await closeRedisClient();
    } catch {
      /* Redis may not have been initialized */
    }
    // Close PG/Redis StorageAdapter (if initialized)
    await closeStorageAdapter().catch(() => {});
    // Checkpoint and close the MemU SQLite database to prevent WAL corruption
    closeMemuStore();
    if (params.healthCheckInterval) {
      clearInterval(params.healthCheckInterval);
    }
    for (const timer of params.nodePresenceTimers.values()) {
      clearInterval(timer);
    }
    params.nodePresenceTimers.clear();
    params.broadcast("shutdown", {
      reason,
      restartExpectedMs,
    });
    clearInterval(params.tickInterval);
    clearInterval(params.healthInterval);
    clearInterval(params.dedupeCleanup);
    if (params.agentUnsub) {
      try {
        params.agentUnsub();
      } catch {
        /* ignore */
      }
    }
    if (params.heartbeatUnsub) {
      try {
        params.heartbeatUnsub();
      } catch {
        /* ignore */
      }
    }
    params.chatRunState.clear();
    for (const c of params.clients) {
      try {
        c.socket.close(1012, "service restart");
      } catch {
        /* ignore */
      }
    }
    params.clients.clear();
    await params.configReloader.stop().catch(() => {});
    if (params.browserControl) {
      await params.browserControl.stop().catch(() => {});
    }
    await new Promise<void>((resolve) => params.wss.close(() => resolve()));
    const servers =
      params.httpServers && params.httpServers.length > 0
        ? params.httpServers
        : [params.httpServer];
    for (const server of servers) {
      const httpServer = server as HttpServer & {
        closeIdleConnections?: () => void;
      };
      if (typeof httpServer.closeIdleConnections === "function") {
        httpServer.closeIdleConnections();
      }
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
    }
  };
}
