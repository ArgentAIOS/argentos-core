/**
 * Idempotent install for the dashboard LaunchAgents (`ai.argent.dashboard-ui`
 * and `ai.argent.dashboard-api`).
 *
 * Background: `argent update` refreshes the dist/ artifacts but historically did
 * not reinstall the dashboard LaunchAgent plists. When a previous install path
 * was decommissioned (e.g. legacy `/Users/sem/argentos/`) and the corresponding
 * plists were archived, the new install at `~/.argentos/` ended up with no
 * canonical LaunchAgents — silently breaking the dashboard until the operator
 * hand-rolled a plist. See ArgentAIOS/argentos-core#175.
 *
 * The helper here computes the canonical plist content for each dashboard
 * service and only writes / reloads when the on-disk plist is missing or
 * differs. That keeps `argent update` cheap on the common no-op path while
 * making sure the dashboard is always managed by launchd after an update.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { VERSION } from "../version.js";
import { DASHBOARD_API_LAUNCH_AGENT_LABEL, DASHBOARD_UI_LAUNCH_AGENT_LABEL } from "./constants.js";
import { findDashboardDir } from "./dashboard-service.js";
import { buildLaunchAgentPlist } from "./launchd-plist.js";
import { installLaunchAgent, resolveGatewayLogPaths } from "./launchd.js";
import { resolveHomeDir } from "./paths.js";
import { buildMinimalServicePath } from "./service-env.js";

export type DashboardLaunchAgentKind = "ui" | "api";

export type DashboardLaunchAgentPlan = {
  kind: DashboardLaunchAgentKind;
  label: string;
  plistPath: string;
  plistContent: string;
  programArguments: string[];
  workingDirectory: string;
  environment: Record<string, string>;
  description: string;
  stdoutPath: string;
  stderrPath: string;
};

export type EnsureDashboardLaunchAgentsResult = {
  /** Plists that did not exist on disk before this call. */
  installed: string[];
  /** Plists whose on-disk content differed from canonical and were rewritten. */
  updated: string[];
  /** Plists whose on-disk content already matched canonical (no write/reload). */
  unchanged: string[];
  /** Plists we couldn't compute a plan for (e.g. dashboard dir not found). */
  skipped: string[];
  /** Reason for skipping (informational). */
  reason?: string;
};

export type PlanInstaller = (
  plan: DashboardLaunchAgentPlan,
  context: {
    env: Record<string, string | undefined>;
    stdout: NodeJS.WritableStream;
  },
) => Promise<void>;

const DEFAULT_UI_PORT = 8080;
const DEFAULT_API_PORT = 9242;

function logPathsForKind(
  env: Record<string, string | undefined>,
  kind: DashboardLaunchAgentKind,
): { stdoutPath: string; stderrPath: string; logDir: string } {
  return resolveGatewayLogPaths({
    ...env,
    ARGENT_LOG_PREFIX: kind === "ui" ? "dashboard-ui" : "dashboard-api",
  });
}

/**
 * Build the canonical plist plans for the dashboard UI + API services.
 *
 * The plist content here is the reference: anything different on disk is
 * considered stale and gets rewritten by {@link ensureDashboardLaunchAgents}.
 */
export function buildDashboardLaunchAgentPlans(opts: {
  env: Record<string, string | undefined>;
  dashboardDir: string;
  nodePath: string;
  uiPort?: number;
  apiPort?: number;
  version?: string;
}): DashboardLaunchAgentPlan[] {
  const { env, dashboardDir, nodePath } = opts;
  const uiPort = String(opts.uiPort ?? DEFAULT_UI_PORT);
  const apiPort = String(opts.apiPort ?? DEFAULT_API_PORT);
  const version = opts.version ?? VERSION;

  const home = resolveHomeDir(env);
  const launchAgentsDir = path.join(home, "Library", "LaunchAgents");
  const minimalPath = buildMinimalServicePath({ env });

  // UI: serves the built dashboard via the lightweight static-server.cjs.
  // This is the prod canonical path; cs-cli's `argent cs install` uses
  // `vite preview` for dev installs and is intentionally not touched here.
  const uiLabel = DASHBOARD_UI_LAUNCH_AGENT_LABEL;
  const uiProgramArguments = [nodePath, path.join(dashboardDir, "static-server.cjs")];
  const uiEnvironment: Record<string, string> = {
    HOME: home,
    PATH: minimalPath,
    HOST: "127.0.0.1",
    PORT: uiPort,
    API_PORT: apiPort,
    ARGENT_LAUNCHD_LABEL: uiLabel,
    ARGENT_LOG_PREFIX: "dashboard-ui",
    ARGENT_SERVICE_VERSION: version,
  };
  const uiLogs = logPathsForKind(env, "ui");
  const uiDescription = `ArgentOS Dashboard UI (v${version})`;
  const uiPlistContent = buildLaunchAgentPlist({
    label: uiLabel,
    comment: uiDescription,
    programArguments: uiProgramArguments,
    workingDirectory: dashboardDir,
    stdoutPath: uiLogs.stdoutPath,
    stderrPath: uiLogs.stderrPath,
    environment: uiEnvironment,
  });

  // API: long-running Node express server.
  const apiLabel = DASHBOARD_API_LAUNCH_AGENT_LABEL;
  const apiProgramArguments = [nodePath, path.join(dashboardDir, "api-server.cjs")];
  const apiEnvironment: Record<string, string> = {
    HOME: home,
    PATH: minimalPath,
    HOST: "127.0.0.1",
    API_PORT: apiPort,
    ARGENT_LAUNCHD_LABEL: apiLabel,
    ARGENT_LOG_PREFIX: "dashboard-api",
    ARGENT_SERVICE_VERSION: version,
  };
  const apiLogs = logPathsForKind(env, "api");
  const apiDescription = `ArgentOS Dashboard API (v${version})`;
  const apiPlistContent = buildLaunchAgentPlist({
    label: apiLabel,
    comment: apiDescription,
    programArguments: apiProgramArguments,
    workingDirectory: dashboardDir,
    stdoutPath: apiLogs.stdoutPath,
    stderrPath: apiLogs.stderrPath,
    environment: apiEnvironment,
  });

  return [
    {
      kind: "ui",
      label: uiLabel,
      plistPath: path.join(launchAgentsDir, `${uiLabel}.plist`),
      plistContent: uiPlistContent,
      programArguments: uiProgramArguments,
      workingDirectory: dashboardDir,
      environment: uiEnvironment,
      description: uiDescription,
      stdoutPath: uiLogs.stdoutPath,
      stderrPath: uiLogs.stderrPath,
    },
    {
      kind: "api",
      label: apiLabel,
      plistPath: path.join(launchAgentsDir, `${apiLabel}.plist`),
      plistContent: apiPlistContent,
      programArguments: apiProgramArguments,
      workingDirectory: dashboardDir,
      environment: apiEnvironment,
      description: apiDescription,
      stdoutPath: apiLogs.stdoutPath,
      stderrPath: apiLogs.stderrPath,
    },
  ];
}

function normalizePlistForCompare(content: string): string {
  // Tolerate trailing whitespace / CRLF differences between hand-edited plists
  // and the generated canonical form, but otherwise require byte equality. We
  // explicitly want to rewrite when version, paths, or env vars drift.
  return content.replace(/\r\n/g, "\n").trim();
}

const defaultReadExisting = async (plistPath: string): Promise<string | null> => {
  try {
    return await fs.readFile(plistPath, "utf8");
  } catch {
    return null;
  }
};

const defaultInstaller: PlanInstaller = async (plan, context) => {
  const installEnv: Record<string, string | undefined> = {
    ...context.env,
    ARGENT_LAUNCHD_LABEL: plan.label,
    ARGENT_LOG_PREFIX: plan.kind === "ui" ? "dashboard-ui" : "dashboard-api",
  };
  await installLaunchAgent({
    env: installEnv,
    stdout: context.stdout,
    programArguments: plan.programArguments,
    workingDirectory: plan.workingDirectory,
    environment: plan.environment,
    description: plan.description,
  });
};

/**
 * Ensure the canonical dashboard LaunchAgent plists exist and match the
 * canonical content. Idempotent: matching plists are left untouched.
 *
 * On non-darwin platforms this is a no-op unless an explicit `installer` is
 * supplied (used by tests).
 */
export async function ensureDashboardLaunchAgents(
  opts: {
    env?: Record<string, string | undefined>;
    stdout?: NodeJS.WritableStream;
    uiPort?: number;
    apiPort?: number;
    dashboardDir?: string | null;
    nodePath?: string;
    resolveDashboardDir?: () => string | null;
    readExisting?: (plistPath: string) => Promise<string | null>;
    installer?: PlanInstaller;
  } = {},
): Promise<EnsureDashboardLaunchAgentsResult> {
  const platformOverride = Boolean(opts.installer);
  if (process.platform !== "darwin" && !platformOverride) {
    return {
      installed: [],
      updated: [],
      unchanged: [],
      skipped: [DASHBOARD_UI_LAUNCH_AGENT_LABEL, DASHBOARD_API_LAUNCH_AGENT_LABEL],
      reason: "non-darwin",
    };
  }

  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const stdout = opts.stdout ?? process.stdout;
  const resolveDir = opts.resolveDashboardDir ?? findDashboardDir;
  const dashboardDir = opts.dashboardDir ?? resolveDir();
  if (!dashboardDir) {
    return {
      installed: [],
      updated: [],
      unchanged: [],
      skipped: [DASHBOARD_UI_LAUNCH_AGENT_LABEL, DASHBOARD_API_LAUNCH_AGENT_LABEL],
      reason: "dashboard-dir-not-found",
    };
  }

  let plans: DashboardLaunchAgentPlan[];
  try {
    plans = buildDashboardLaunchAgentPlans({
      env,
      dashboardDir,
      nodePath: opts.nodePath ?? process.execPath,
      uiPort: opts.uiPort,
      apiPort: opts.apiPort,
    });
  } catch (err) {
    return {
      installed: [],
      updated: [],
      unchanged: [],
      skipped: [DASHBOARD_UI_LAUNCH_AGENT_LABEL, DASHBOARD_API_LAUNCH_AGENT_LABEL],
      reason: `plan-build-failed: ${(err as Error).message}`,
    };
  }

  const readExisting = opts.readExisting ?? defaultReadExisting;
  const installer = opts.installer ?? defaultInstaller;

  const installed: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  for (const plan of plans) {
    const existing = await readExisting(plan.plistPath);
    if (existing == null) {
      await installer(plan, { env, stdout });
      installed.push(plan.label);
      continue;
    }
    if (normalizePlistForCompare(existing) === normalizePlistForCompare(plan.plistContent)) {
      unchanged.push(plan.label);
      continue;
    }
    await installer(plan, { env, stdout });
    updated.push(plan.label);
  }

  return { installed, updated, unchanged, skipped: [] };
}
