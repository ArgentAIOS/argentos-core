/**
 * ArgentOS Command Center CLI
 *
 * Launches the Argent Dashboard - the visual interface for ArgentOS
 * with Live2D avatar, task board, canvas workspace, and chat.
 *
 * Supports both foreground spawning and LaunchAgent-managed services.
 */

import type { Command } from "commander";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DASHBOARD_UI_LAUNCH_AGENT_LABEL,
  DASHBOARD_API_LAUNCH_AGENT_LABEL,
} from "../daemon/constants.js";
import {
  findDashboardDir,
  resolveDashboardUiService,
  resolveDashboardApiService,
  buildDashboardServiceEnvironment,
} from "../daemon/dashboard-service.js";
import { VERSION } from "../version.js";

/** Check if dependencies are installed */
function hasDependencies(dir: string): boolean {
  return fs.existsSync(path.join(dir, "node_modules"));
}

function resolveStaticServerEntrypoint(dir: string): string | null {
  const direct = path.join(dir, "static-server.cjs");
  return fs.existsSync(direct) ? direct : null;
}

/** Install dependencies */
function installDependencies(dir: string): void {
  console.log("Installing dashboard dependencies...");
  execSync("npm install", { cwd: dir, stdio: "inherit" });
}

/** Check if Dashboard LaunchAgents are installed */
async function areLaunchAgentsInstalled(): Promise<{
  ui: boolean;
  api: boolean;
}> {
  const uiService = resolveDashboardUiService();
  const apiService = resolveDashboardApiService();
  const env = process.env as Record<string, string | undefined>;
  const [ui, api] = await Promise.all([uiService.isLoaded({ env }), apiService.isLoaded({ env })]);
  return { ui, api };
}

/** Install Dashboard LaunchAgents */
async function installDashboardServices(options: {
  port?: number;
  apiPort?: number;
}): Promise<void> {
  const dashboardDir = findDashboardDir();
  if (!dashboardDir) {
    console.error("ERROR: Dashboard not found. Expected at:");
    console.error("  - <package>/dashboard/");
    console.error("  - ~/.argentos/dashboard/");
    process.exit(1);
  }

  // Auto-install dependencies if missing (fresh tarball extract)
  if (!hasDependencies(dashboardDir)) {
    console.log("Dashboard node_modules not found — running npm install (this takes ~1 min)...");
    try {
      execSync("npm install --production", { cwd: dashboardDir, stdio: "inherit" });
      execSync("npm rebuild", { cwd: dashboardDir, stdio: "inherit" });
    } catch (err) {
      console.error("ERROR: npm install failed:", (err as Error).message);
      console.error("Fix: ensure npm/node is available and retry 'argent cs install'");
      process.exit(1);
    }
  }

  const staticServerEntrypoint = resolveStaticServerEntrypoint(dashboardDir);
  if (!staticServerEntrypoint) {
    console.error(
      `ERROR: dashboard static server not found at ${path.join(dashboardDir, "static-server.cjs")}`,
    );
    process.exit(1);
  }

  const nodePath = process.execPath;
  const uiPort = String(options.port || 8080);
  const apiPort = String(options.apiPort || 9242);
  const env = process.env as Record<string, string | undefined>;

  const uiService = resolveDashboardUiService();
  const apiService = resolveDashboardApiService();

  // Install UI LaunchAgent
  console.log("Installing Dashboard UI LaunchAgent...");
  const uiEnv = buildDashboardServiceEnvironment({ env, kind: "ui" });
  await uiService.install({
    env,
    stdout: process.stdout,
    programArguments: [nodePath, staticServerEntrypoint],
    workingDirectory: dashboardDir,
    environment: {
      ...uiEnv,
      PORT: uiPort,
      API_PORT: apiPort,
    },
    description: `ArgentOS Dashboard UI (v${VERSION})`,
  });

  // Install API LaunchAgent
  console.log("Installing Dashboard API LaunchAgent...");
  const apiEnv = buildDashboardServiceEnvironment({ env, kind: "api" });
  await apiService.install({
    env,
    stdout: process.stdout,
    programArguments: [nodePath, path.join(dashboardDir, "api-server.cjs")],
    workingDirectory: dashboardDir,
    environment: {
      ...apiEnv,
      API_PORT: apiPort,
    },
    description: `ArgentOS Dashboard API (v${VERSION})`,
  });

  console.log("Dashboard LaunchAgents installed successfully.");
  console.log(`  UI:  http://localhost:${uiPort}`);
  console.log(`  API: http://localhost:${apiPort}`);
}

/** Uninstall Dashboard LaunchAgents */
async function uninstallDashboardServices(): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  const uiService = resolveDashboardUiService();
  const apiService = resolveDashboardApiService();

  console.log("Uninstalling Dashboard LaunchAgents...");
  await uiService.uninstall({ env, stdout: process.stdout });
  await apiService.uninstall({ env, stdout: process.stdout });
  console.log("Dashboard LaunchAgents removed.");
}

/** Stop Dashboard via LaunchAgents */
async function stopDashboardServices(): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  const uiService = resolveDashboardUiService();
  const apiService = resolveDashboardApiService();

  await uiService.stop({ env, stdout: process.stdout });
  await apiService.stop({ env, stdout: process.stdout });
}

/** Restart Dashboard via LaunchAgents */
async function restartDashboardServices(): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  const uiService = resolveDashboardUiService();
  const apiService = resolveDashboardApiService();

  await uiService.restart({ env, stdout: process.stdout });
  await apiService.restart({ env, stdout: process.stdout });
}

/** Start the Command Center (foreground mode) */
async function startCommandCenter(options: {
  apiOnly?: boolean;
  uiOnly?: boolean;
  port?: number;
  apiPort?: number;
  install?: boolean;
}): Promise<void> {
  const dashboardDir = findDashboardDir();

  if (!dashboardDir) {
    console.error("Dashboard not found. Expected at:");
    console.error("  - <package>/dashboard/");
    console.error("  - ~/.argentos/dashboard/");
    process.exit(1);
  }

  console.log(`Command Center: ${dashboardDir}`);

  // Install dependencies if needed
  if (options.install || !hasDependencies(dashboardDir)) {
    installDependencies(dashboardDir);
  }

  // Ensure we use the same node version that's running this script
  const nodePath = process.execPath;
  const nodeDir = path.dirname(nodePath);

  const env = {
    ...process.env,
    // Put current node's directory first in PATH to avoid version mismatches
    PATH: `${nodeDir}:${process.env.PATH || ""}`,
    VITE_PORT: String(options.port || 8080),
    API_PORT: String(options.apiPort || 9242),
  };

  if (options.apiOnly) {
    // Start only API server
    console.log(`Starting API server on port ${env.API_PORT}...`);
    const api = spawn("node", ["api-server.cjs"], {
      cwd: dashboardDir,
      stdio: "inherit",
      env,
    });
    api.on("close", (code) => process.exit(code || 0));
  } else if (options.uiOnly) {
    // Start only Vite UI
    console.log(`Starting UI on port ${env.VITE_PORT}...`);
    const ui = spawn("npm", ["run", "dev"], {
      cwd: dashboardDir,
      stdio: "inherit",
      env,
      shell: true,
    });
    ui.on("close", (code) => process.exit(code || 0));
  } else {
    // Start both
    console.log(`Starting Command Center...`);
    console.log(`  UI:  http://localhost:${env.VITE_PORT}`);
    console.log(`  API: http://localhost:${env.API_PORT}`);
    console.log("");

    // Start API server
    const api = spawn("node", ["api-server.cjs"], {
      cwd: dashboardDir,
      stdio: "inherit",
      env,
    });

    // Start Vite dev server
    const ui = spawn("npm", ["run", "dev"], {
      cwd: dashboardDir,
      stdio: "inherit",
      env,
      shell: true,
    });

    // Handle exit
    const cleanup = () => {
      api.kill();
      ui.kill();
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    api.on("close", () => {
      ui.kill();
      process.exit(0);
    });

    ui.on("close", () => {
      api.kill();
      process.exit(0);
    });
  }
}

/** Build the Command Center for production */
async function buildCommandCenter(): Promise<void> {
  const dashboardDir = findDashboardDir();

  if (!dashboardDir) {
    console.error("Dashboard not found.");
    process.exit(1);
  }

  console.log("Building Command Center...");
  execSync("npm run build", { cwd: dashboardDir, stdio: "inherit" });
  console.log("Build complete!");
}

export function registerCsCli(program: Command): void {
  const cs = program
    .command("cs")
    .description("Command Center - ArgentOS visual interface")
    .addHelpText(
      "after",
      `
Examples:
  argentos cs              Start Command Center (UI + API)
  argentos cs --api-only   Start only the API server
  argentos cs --ui-only    Start only the UI
  argentos cs install      Install as LaunchAgent (auto-start on login)
  argentos cs uninstall    Remove LaunchAgent
  argentos cs build        Build for production
`,
    );

  cs.command("start", { isDefault: true })
    .description("Start the Command Center")
    .option("--api-only", "Start only the API server")
    .option("--ui-only", "Start only the UI server")
    .option("-p, --port <port>", "UI port", "8080")
    .option("--api-port <port>", "API server port", "9242")
    .option("--install", "Force reinstall dependencies")
    .action(async (opts) => {
      // Check if LaunchAgents are installed — if so, use them
      const agents = await areLaunchAgentsInstalled();
      if (agents.ui || agents.api) {
        console.log("LaunchAgents detected, starting via launchctl...");
        await restartDashboardServices();
        console.log("Command Center started via LaunchAgents.");
        console.log(`  UI:  http://localhost:${opts.port || 8080}`);
        console.log(`  API: http://localhost:${opts.apiPort || 9242}`);
        return;
      }

      // Foreground mode
      await startCommandCenter({
        apiOnly: opts.apiOnly,
        uiOnly: opts.uiOnly,
        port: parseInt(opts.port, 10),
        apiPort: parseInt(opts.apiPort, 10),
        install: opts.install,
      });
    });

  cs.command("install")
    .description("Install Command Center as LaunchAgent (auto-start on login)")
    .option("-p, --port <port>", "UI port", "8080")
    .option("--api-port <port>", "API server port", "9242")
    .action(async (opts) => {
      await installDashboardServices({
        port: parseInt(opts.port, 10),
        apiPort: parseInt(opts.apiPort, 10),
      });
    });

  cs.command("uninstall")
    .description("Remove Command Center LaunchAgents")
    .action(async () => {
      await uninstallDashboardServices();
    });

  cs.command("build")
    .description("Build Command Center for production")
    .action(async () => {
      await buildCommandCenter();
    });

  cs.command("status")
    .description("Check Command Center status")
    .action(async () => {
      const dashboardDir = findDashboardDir();
      if (!dashboardDir) {
        console.log("Dashboard: Not found");
        return;
      }

      console.log(`Dashboard: ${dashboardDir}`);
      console.log(`Dependencies: ${hasDependencies(dashboardDir) ? "Installed" : "Not installed"}`);

      // Check LaunchAgent status
      const agents = await areLaunchAgentsInstalled();
      console.log(
        `LaunchAgent (UI):  ${agents.ui ? "Installed & loaded" : "Not installed"}  [${DASHBOARD_UI_LAUNCH_AGENT_LABEL}]`,
      );
      console.log(
        `LaunchAgent (API): ${agents.api ? "Installed & loaded" : "Not installed"}  [${DASHBOARD_API_LAUNCH_AGENT_LABEL}]`,
      );

      // Check if services are running via health checks
      try {
        const response = await fetch("http://localhost:9242/api/health");
        if (response.ok) {
          const data = (await response.json()) as { uptimeFormatted?: string };
          console.log(`API Server: Running (uptime: ${data.uptimeFormatted})`);
        }
      } catch {
        console.log("API Server: Not running");
      }

      try {
        const response = await fetch("http://localhost:8080");
        if (response.ok) {
          console.log("UI Server: Running");
        }
      } catch {
        console.log("UI Server: Not running");
      }
    });

  cs.command("stop")
    .description("Stop Command Center services")
    .action(async () => {
      // Try LaunchAgent stop first
      const agents = await areLaunchAgentsInstalled();
      if (agents.ui || agents.api) {
        console.log("Stopping via LaunchAgents...");
        await stopDashboardServices();
        return;
      }

      // Fallback: kill by port
      console.log("Stopping Command Center services...");
      try {
        execSync("lsof -ti:9242 | xargs kill -9 2>/dev/null || true", { stdio: "pipe" });
        execSync("lsof -ti:8080 | xargs kill -9 2>/dev/null || true", { stdio: "pipe" });
        console.log("Services stopped");
      } catch {
        console.log("Services may already be stopped");
      }
    });

  cs.command("restart")
    .description("Restart Command Center services")
    .action(async () => {
      // Try LaunchAgent restart first
      const agents = await areLaunchAgentsInstalled();
      if (agents.ui || agents.api) {
        console.log("Restarting via LaunchAgents...");
        await restartDashboardServices();
        console.log("Command Center restarted.");
        return;
      }

      // Fallback: kill and respawn foreground
      console.log("Restarting Command Center...");
      try {
        execSync("lsof -ti:9242 | xargs kill -9 2>/dev/null || true", { stdio: "pipe" });
        execSync("lsof -ti:8080 | xargs kill -9 2>/dev/null || true", { stdio: "pipe" });
      } catch {
        // Ignore errors
      }
      await new Promise((r) => setTimeout(r, 500));
      await startCommandCenter({
        port: 8080,
        apiPort: 9242,
      });
    });
}
