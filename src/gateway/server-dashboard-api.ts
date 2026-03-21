/**
 * Dashboard API Sidecar
 *
 * Spawns the dashboard api-server.cjs as a child process alongside the gateway.
 * Lifecycle is tied to the gateway — when the gateway shuts down, so does the API server.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveArgentPackageRootSync } from "../infra/argent-root.js";

let apiProcess: ChildProcess | null = null;

export function startDashboardApiServer(opts: {
  log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}): boolean {
  const packageRoot = resolveArgentPackageRootSync({ moduleUrl: import.meta.url });
  if (!packageRoot) {
    opts.log.warn("could not resolve package root — skipping dashboard API server");
    return false;
  }

  const apiServerPath = path.join(packageRoot, "dashboard", "api-server.cjs");
  if (!fs.existsSync(apiServerPath)) {
    opts.log.warn(`dashboard api-server.cjs not found at ${apiServerPath} — skipping`);
    return false;
  }

  // Use the same node binary that's running the gateway
  const nodeBin = process.execPath;

  apiProcess = spawn(nodeBin, [apiServerPath], {
    cwd: path.join(packageRoot, "dashboard"),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // Inherit SENTRY_DSN, DASHBOARD_API_TOKEN, etc. from gateway env
    },
    detached: false,
  });

  apiProcess.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      opts.log.info(`[api] ${line}`);
    }
  });

  apiProcess.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      opts.log.error(`[api] ${line}`);
    }
  });

  apiProcess.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      opts.log.warn(`dashboard API server exited with code ${code}`);
    } else if (signal) {
      opts.log.info(`dashboard API server killed by ${signal}`);
    }
    apiProcess = null;
  });

  opts.log.info(`dashboard API server started (pid ${apiProcess.pid})`);
  return true;
}

export function stopDashboardApiServer(): void {
  if (apiProcess) {
    apiProcess.kill("SIGTERM");
    apiProcess = null;
  }
}

export function isDashboardApiRunning(): boolean {
  return apiProcess !== null && !apiProcess.killed;
}
