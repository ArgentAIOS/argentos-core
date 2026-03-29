import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ArgentConfig } from "../config/types.js";
import type { GatewayDaemonRuntime } from "./daemon-runtime.js";
import { formatCliCommand } from "../cli/command-format.js";
import { collectConfigEnvVars } from "../config/env-vars.js";
import { resolveGatewayLaunchAgentLabel } from "../daemon/constants.js";
import { resolveGatewayProgramArguments } from "../daemon/program-args.js";
import {
  renderSystemNodeWarning,
  resolvePreferredNodePath,
  resolveSystemNodeInfo,
} from "../daemon/runtime-paths.js";
import { buildServiceEnvironment } from "../daemon/service-env.js";

type WarnFn = (message: string, title?: string) => void;

export type GatewayInstallPlan = {
  programArguments: string[];
  workingDirectory?: string;
  environment: Record<string, string | undefined>;
};

export function resolveGatewayDevMode(argv: string[] = process.argv): boolean {
  const entry = argv[1];
  const normalizedEntry = entry?.replaceAll("\\", "/");
  return Boolean(normalizedEntry?.includes("/src/") && normalizedEntry.endsWith(".ts"));
}

/**
 * Resolve or generate dashboard API token for gateway-dashboard authentication.
 * Reads from multiple sources, generates new token if missing, writes to ~/.argentos/.env
 */
function resolveDashboardApiToken(env: Record<string, string | undefined>): string {
  // Check if already exists in environment
  const existing = env.DASHBOARD_API_TOKEN;
  if (existing && typeof existing === "string" && existing.length > 0) {
    return existing;
  }

  // Try to read from dashboard/.env (for existing setups)
  try {
    const dashboardEnvPath = path.join(process.cwd(), "dashboard", ".env");
    if (fs.existsSync(dashboardEnvPath)) {
      const dashboardEnvContent = fs.readFileSync(dashboardEnvPath, "utf-8");
      const match = dashboardEnvContent.match(/^DASHBOARD_API_TOKEN=(.+)$/m);
      if (match && match[1]) {
        const token = match[1].trim();
        // Persist to ~/.argentos/.env so gateway can find it
        try {
          const stateDir = env.ARGENT_STATE_DIR || path.join(env.HOME || "~", ".argentos");
          const envPath = path.join(stateDir, ".env");
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }
          const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
          if (!envContent.includes("DASHBOARD_API_TOKEN")) {
            const newLine = envContent.length > 0 && !envContent.endsWith("\n") ? "\n" : "";
            fs.appendFileSync(
              envPath,
              `${newLine}# Dashboard API authentication token (copied from dashboard/.env)\nDASHBOARD_API_TOKEN=${token}\n`,
            );
          }
        } catch (err) {
          console.warn(`[Install] Warning: Could not persist token to .env: ${err}`);
        }
        return token;
      }
    }
  } catch (err) {
    // Silently continue - not fatal
  }

  // Generate new token
  const newToken = crypto.randomBytes(24).toString("hex");

  // Persist to ~/.argentos/.env for future runs
  try {
    const stateDir = env.ARGENT_STATE_DIR || path.join(env.HOME || "~", ".argentos");
    const envPath = path.join(stateDir, ".env");

    // Ensure directory exists
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    // Append token to .env file (or create if doesn't exist)
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
    if (!envContent.includes("DASHBOARD_API_TOKEN")) {
      const newLine = envContent.length > 0 && !envContent.endsWith("\n") ? "\n" : "";
      fs.appendFileSync(
        envPath,
        `${newLine}# Dashboard API authentication token (generated during gateway install)\nDASHBOARD_API_TOKEN=${newToken}\n`,
      );
    }
  } catch (err) {
    // Warn but don't fail - token will still work for this session
    console.warn(`[Install] Warning: Could not persist DASHBOARD_API_TOKEN to .env: ${err}`);
  }

  return newToken;
}

export async function buildGatewayInstallPlan(params: {
  env: Record<string, string | undefined>;
  port: number;
  runtime: GatewayDaemonRuntime;
  token?: string;
  devMode?: boolean;
  nodePath?: string;
  warn?: WarnFn;
  /** Full config to extract env vars from (env vars + inline env keys). */
  config?: ArgentConfig;
}): Promise<GatewayInstallPlan> {
  const devMode = params.devMode ?? resolveGatewayDevMode();
  const nodePath =
    params.nodePath ??
    (await resolvePreferredNodePath({
      env: params.env,
      runtime: params.runtime,
    }));
  const { programArguments, workingDirectory } = await resolveGatewayProgramArguments({
    port: params.port,
    dev: devMode,
    runtime: params.runtime,
    nodePath,
  });
  if (params.runtime === "node") {
    const systemNode = await resolveSystemNodeInfo({ env: params.env });
    const warning = renderSystemNodeWarning(systemNode, programArguments[0]);
    if (warning) {
      params.warn?.(warning, "Gateway runtime");
    }
  }
  // Unify dashboard API auth with gateway auth: use the same token for both
  // so ?token= in the URL works for WebSocket AND REST API calls.
  // Fall back to a separate generated token only if no gateway token exists.
  const dashboardApiToken = params.token || resolveDashboardApiToken(params.env);
  const serviceEnvironment = buildServiceEnvironment({
    env: params.env,
    port: params.port,
    token: params.token,
    dashboardApiToken,
    launchdLabel:
      process.platform === "darwin"
        ? resolveGatewayLaunchAgentLabel(params.env.ARGENT_PROFILE)
        : undefined,
  });

  // Merge config env vars into the service environment (vars + inline env keys).
  // Config env vars are added first so service-specific vars take precedence.
  const environment: Record<string, string | undefined> = {
    ...collectConfigEnvVars(params.config),
  };
  Object.assign(environment, serviceEnvironment);

  return { programArguments, workingDirectory, environment };
}

export function gatewayInstallErrorHint(platform = process.platform): string {
  return platform === "win32"
    ? "Tip: rerun from an elevated PowerShell (Start → type PowerShell → right-click → Run as administrator) or skip service install."
    : `Tip: rerun \`${formatCliCommand("argent gateway install")}\` after fixing the error.`;
}
