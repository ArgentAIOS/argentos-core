import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayService, GatewayServiceInstallArgs } from "./service.js";
import { resolveUserPath } from "../utils.js";
import { VERSION } from "../version.js";
import {
  DASHBOARD_UI_SERVICE_KIND,
  DASHBOARD_API_SERVICE_KIND,
  DASHBOARD_SERVICE_MARKER,
  resolveDashboardUiLaunchAgentLabel,
  resolveDashboardApiLaunchAgentLabel,
} from "./constants.js";
import { buildMinimalServicePath } from "./service-env.js";
import { resolveGatewayService } from "./service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function findDashboardDir(): string | null {
  const candidates = [
    path.resolve(__dirname, "../dashboard"),
    path.resolve(__dirname, "../../dashboard"),
    resolveUserPath("~/.argentos/dashboard"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  return null;
}

function withDashboardUiServiceEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    ARGENT_LAUNCHD_LABEL: resolveDashboardUiLaunchAgentLabel(),
    ARGENT_LOG_PREFIX: "dashboard-ui",
    ARGENT_SERVICE_MARKER: DASHBOARD_SERVICE_MARKER,
    ARGENT_SERVICE_KIND: DASHBOARD_UI_SERVICE_KIND,
  };
}

function withDashboardApiServiceEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    ARGENT_LAUNCHD_LABEL: resolveDashboardApiLaunchAgentLabel(),
    ARGENT_LOG_PREFIX: "dashboard-api",
    ARGENT_SERVICE_MARKER: DASHBOARD_SERVICE_MARKER,
    ARGENT_SERVICE_KIND: DASHBOARD_API_SERVICE_KIND,
  };
}

function withDashboardUiInstallEnv(args: GatewayServiceInstallArgs): GatewayServiceInstallArgs {
  return {
    ...args,
    env: withDashboardUiServiceEnv(args.env),
    environment: {
      ...args.environment,
      ARGENT_LAUNCHD_LABEL: resolveDashboardUiLaunchAgentLabel(),
      ARGENT_LOG_PREFIX: "dashboard-ui",
      ARGENT_SERVICE_MARKER: DASHBOARD_SERVICE_MARKER,
      ARGENT_SERVICE_KIND: DASHBOARD_UI_SERVICE_KIND,
    },
  };
}

function withDashboardApiInstallEnv(args: GatewayServiceInstallArgs): GatewayServiceInstallArgs {
  return {
    ...args,
    env: withDashboardApiServiceEnv(args.env),
    environment: {
      ...args.environment,
      ARGENT_LAUNCHD_LABEL: resolveDashboardApiLaunchAgentLabel(),
      ARGENT_LOG_PREFIX: "dashboard-api",
      ARGENT_SERVICE_MARKER: DASHBOARD_SERVICE_MARKER,
      ARGENT_SERVICE_KIND: DASHBOARD_API_SERVICE_KIND,
    },
  };
}

export function buildDashboardServiceEnvironment(params: {
  env: Record<string, string | undefined>;
  kind: "ui" | "api";
}): Record<string, string | undefined> {
  const { env, kind } = params;
  const stateDir = env.ARGENT_STATE_DIR;
  const configPath = env.ARGENT_CONFIG_PATH;

  const isUi = kind === "ui";
  return {
    HOME: env.HOME,
    PATH: buildMinimalServicePath({ env }),
    ARGENT_STATE_DIR: stateDir,
    ARGENT_CONFIG_PATH: configPath,
    ARGENT_LAUNCHD_LABEL: isUi
      ? resolveDashboardUiLaunchAgentLabel()
      : resolveDashboardApiLaunchAgentLabel(),
    ARGENT_LOG_PREFIX: isUi ? "dashboard-ui" : "dashboard-api",
    ARGENT_SERVICE_MARKER: DASHBOARD_SERVICE_MARKER,
    ARGENT_SERVICE_KIND: isUi ? DASHBOARD_UI_SERVICE_KIND : DASHBOARD_API_SERVICE_KIND,
    ARGENT_SERVICE_VERSION: VERSION,
  };
}

export function resolveDashboardUiService(): GatewayService {
  const base = resolveGatewayService();
  return {
    ...base,
    install: async (args) => {
      return base.install(withDashboardUiInstallEnv(args));
    },
    uninstall: async (args) => {
      return base.uninstall({ ...args, env: withDashboardUiServiceEnv(args.env) });
    },
    stop: async (args) => {
      return base.stop({ ...args, env: withDashboardUiServiceEnv(args.env ?? {}) });
    },
    restart: async (args) => {
      return base.restart({ ...args, env: withDashboardUiServiceEnv(args.env ?? {}) });
    },
    isLoaded: async (args) => {
      return base.isLoaded({ env: withDashboardUiServiceEnv(args.env ?? {}) });
    },
    readCommand: (env) => base.readCommand(withDashboardUiServiceEnv(env)),
    readRuntime: (env) => base.readRuntime(withDashboardUiServiceEnv(env)),
  };
}

export function resolveDashboardApiService(): GatewayService {
  const base = resolveGatewayService();
  return {
    ...base,
    install: async (args) => {
      return base.install(withDashboardApiInstallEnv(args));
    },
    uninstall: async (args) => {
      return base.uninstall({ ...args, env: withDashboardApiServiceEnv(args.env) });
    },
    stop: async (args) => {
      return base.stop({ ...args, env: withDashboardApiServiceEnv(args.env ?? {}) });
    },
    restart: async (args) => {
      return base.restart({ ...args, env: withDashboardApiServiceEnv(args.env ?? {}) });
    },
    isLoaded: async (args) => {
      return base.isLoaded({ env: withDashboardApiServiceEnv(args.env ?? {}) });
    },
    readCommand: (env) => base.readCommand(withDashboardApiServiceEnv(env)),
    readRuntime: (env) => base.readRuntime(withDashboardApiServiceEnv(env)),
  };
}
