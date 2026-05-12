import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import { DASHBOARD_API_LAUNCH_AGENT_LABEL, DASHBOARD_UI_LAUNCH_AGENT_LABEL } from "./constants.js";
import {
  buildDashboardLaunchAgentPlans,
  ensureDashboardLaunchAgents,
  type DashboardLaunchAgentPlan,
  type PlanInstaller,
} from "./dashboard-launchagent-install.js";

const BASE_ENV: Record<string, string | undefined> = {
  HOME: "/tmp/argent-test-home",
  PATH: "/usr/local/bin:/usr/bin:/bin",
};

const stdout = new PassThrough();
// Soak any logs from the installer
stdout.resume();

describe("buildDashboardLaunchAgentPlans", () => {
  it("emits canonical plans for both dashboard services", () => {
    const plans = buildDashboardLaunchAgentPlans({
      env: BASE_ENV,
      dashboardDir: "/opt/argentos/dashboard",
      nodePath: "/usr/local/bin/node",
      uiPort: 8080,
      apiPort: 9242,
      version: "1.2.3-test",
    });

    expect(plans).toHaveLength(2);
    const [ui, api] = plans;

    expect(ui.kind).toBe("ui");
    expect(ui.label).toBe(DASHBOARD_UI_LAUNCH_AGENT_LABEL);
    expect(ui.plistPath).toBe(
      "/tmp/argent-test-home/Library/LaunchAgents/ai.argent.dashboard-ui.plist",
    );
    expect(ui.programArguments).toEqual([
      "/usr/local/bin/node",
      "/opt/argentos/dashboard/static-server.cjs",
    ]);
    expect(ui.workingDirectory).toBe("/opt/argentos/dashboard");
    expect(ui.environment.PORT).toBe("8080");
    expect(ui.environment.API_PORT).toBe("9242");
    expect(ui.environment.ARGENT_LAUNCHD_LABEL).toBe(DASHBOARD_UI_LAUNCH_AGENT_LABEL);
    expect(ui.environment.ARGENT_LOG_PREFIX).toBe("dashboard-ui");
    expect(ui.environment.ARGENT_SERVICE_VERSION).toBe("1.2.3-test");
    expect(ui.plistContent).toContain("<string>ai.argent.dashboard-ui</string>");
    expect(ui.plistContent).toContain("static-server.cjs");

    expect(api.kind).toBe("api");
    expect(api.label).toBe(DASHBOARD_API_LAUNCH_AGENT_LABEL);
    expect(api.programArguments).toEqual([
      "/usr/local/bin/node",
      "/opt/argentos/dashboard/api-server.cjs",
    ]);
    expect(api.environment.API_PORT).toBe("9242");
    expect(api.environment.ARGENT_LOG_PREFIX).toBe("dashboard-api");
    expect(api.plistContent).toContain("<string>ai.argent.dashboard-api</string>");
    expect(api.plistContent).toContain("api-server.cjs");
  });

  it("falls back to default ports when none provided", () => {
    const plans = buildDashboardLaunchAgentPlans({
      env: BASE_ENV,
      dashboardDir: "/opt/dashboard",
      nodePath: "/usr/bin/node",
      version: "1.0.0",
    });
    const [ui, api] = plans;
    expect(ui.environment.PORT).toBe("8080");
    expect(api.environment.API_PORT).toBe("9242");
  });
});

describe("ensureDashboardLaunchAgents", () => {
  let tempHome: string;
  let dashboardDir: string;
  let installed: string[];
  let installer: PlanInstaller;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "argent-launchagent-"));
    await fs.mkdir(path.join(tempHome, "Library", "LaunchAgents"), { recursive: true });
    dashboardDir = path.join(tempHome, "dashboard");
    await fs.mkdir(dashboardDir, { recursive: true });
    installed = [];
    installer = async (plan, context) => {
      // Mirror what defaultInstaller does, but without invoking real launchctl.
      installed.push(plan.label);
      await fs.mkdir(path.dirname(plan.plistPath), { recursive: true });
      await fs.writeFile(plan.plistPath, plan.plistContent, "utf8");
      // Touch the stdout writer to ensure the contract is honored without
      // leaving the test logs noisy.
      context.stdout.write("");
    };
  });

  function makeEnv(): Record<string, string | undefined> {
    return {
      HOME: tempHome,
      PATH: "/usr/local/bin:/usr/bin:/bin",
    };
  }

  it("installs both LaunchAgents when no plists exist", async () => {
    const result = await ensureDashboardLaunchAgents({
      env: makeEnv(),
      stdout,
      dashboardDir,
      nodePath: "/usr/local/bin/node",
      installer,
    });

    expect(result.installed.toSorted()).toEqual(
      [DASHBOARD_API_LAUNCH_AGENT_LABEL, DASHBOARD_UI_LAUNCH_AGENT_LABEL].toSorted(),
    );
    expect(result.updated).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(installed.toSorted()).toEqual(
      [DASHBOARD_API_LAUNCH_AGENT_LABEL, DASHBOARD_UI_LAUNCH_AGENT_LABEL].toSorted(),
    );

    const uiPath = path.join(
      tempHome,
      "Library",
      "LaunchAgents",
      `${DASHBOARD_UI_LAUNCH_AGENT_LABEL}.plist`,
    );
    const apiPath = path.join(
      tempHome,
      "Library",
      "LaunchAgents",
      `${DASHBOARD_API_LAUNCH_AGENT_LABEL}.plist`,
    );
    await expect(fs.access(uiPath)).resolves.toBeUndefined();
    await expect(fs.access(apiPath)).resolves.toBeUndefined();
  });

  it("is idempotent: matching plists are left untouched", async () => {
    // First run installs both.
    await ensureDashboardLaunchAgents({
      env: makeEnv(),
      stdout,
      dashboardDir,
      nodePath: "/usr/local/bin/node",
      installer,
    });
    installed.length = 0;

    // Second run with identical inputs should be a no-op.
    const result = await ensureDashboardLaunchAgents({
      env: makeEnv(),
      stdout,
      dashboardDir,
      nodePath: "/usr/local/bin/node",
      installer,
    });

    expect(result.installed).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.unchanged.toSorted()).toEqual(
      [DASHBOARD_API_LAUNCH_AGENT_LABEL, DASHBOARD_UI_LAUNCH_AGENT_LABEL].toSorted(),
    );
    expect(installed).toEqual([]);
  });

  it("treats CRLF/trailing-whitespace diffs as unchanged", async () => {
    const plans = buildDashboardLaunchAgentPlans({
      env: makeEnv(),
      dashboardDir,
      nodePath: "/usr/local/bin/node",
    });

    // Pre-seed plists with CRLF line endings + trailing whitespace.
    for (const plan of plans) {
      await fs.writeFile(plan.plistPath, `${plan.plistContent.replace(/\n/g, "\r\n")}   \n`);
    }

    const result = await ensureDashboardLaunchAgents({
      env: makeEnv(),
      stdout,
      dashboardDir,
      nodePath: "/usr/local/bin/node",
      installer,
    });

    expect(result.installed).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.unchanged.toSorted()).toEqual(
      [DASHBOARD_API_LAUNCH_AGENT_LABEL, DASHBOARD_UI_LAUNCH_AGENT_LABEL].toSorted(),
    );
    expect(installed).toEqual([]);
  });

  it("rewrites plists whose content differs from canonical", async () => {
    const uiPath = path.join(
      tempHome,
      "Library",
      "LaunchAgents",
      `${DASHBOARD_UI_LAUNCH_AGENT_LABEL}.plist`,
    );
    // Stale plist (points at a non-canonical path).
    await fs.writeFile(uiPath, "<!-- stale plist pointing at legacy path -->\n", "utf8");

    const result = await ensureDashboardLaunchAgents({
      env: makeEnv(),
      stdout,
      dashboardDir,
      nodePath: "/usr/local/bin/node",
      installer,
    });

    expect(result.updated).toContain(DASHBOARD_UI_LAUNCH_AGENT_LABEL);
    expect(result.installed).toContain(DASHBOARD_API_LAUNCH_AGENT_LABEL);
    expect(result.unchanged).toEqual([]);
    expect(installed.toSorted()).toEqual(
      [DASHBOARD_API_LAUNCH_AGENT_LABEL, DASHBOARD_UI_LAUNCH_AGENT_LABEL].toSorted(),
    );

    // After install the plist should now match canonical exactly.
    const newContent = await fs.readFile(uiPath, "utf8");
    expect(newContent).toContain("static-server.cjs");
    expect(newContent).toContain(`<string>${DASHBOARD_UI_LAUNCH_AGENT_LABEL}</string>`);
  });

  it("only installs the missing plist when one is present and canonical", async () => {
    // Pre-seed only the UI plist with canonical content.
    const plans = buildDashboardLaunchAgentPlans({
      env: makeEnv(),
      dashboardDir,
      nodePath: "/usr/local/bin/node",
    });
    const uiPlan = plans.find((p) => p.kind === "ui") as DashboardLaunchAgentPlan;
    await fs.writeFile(uiPlan.plistPath, uiPlan.plistContent, "utf8");

    const result = await ensureDashboardLaunchAgents({
      env: makeEnv(),
      stdout,
      dashboardDir,
      nodePath: "/usr/local/bin/node",
      installer,
    });

    expect(result.unchanged).toEqual([DASHBOARD_UI_LAUNCH_AGENT_LABEL]);
    expect(result.installed).toEqual([DASHBOARD_API_LAUNCH_AGENT_LABEL]);
    expect(installed).toEqual([DASHBOARD_API_LAUNCH_AGENT_LABEL]);
  });

  it("skips both when the dashboard dir cannot be resolved", async () => {
    const result = await ensureDashboardLaunchAgents({
      env: makeEnv(),
      stdout,
      resolveDashboardDir: () => null,
      installer,
    });

    expect(result.installed).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.skipped.toSorted()).toEqual(
      [DASHBOARD_API_LAUNCH_AGENT_LABEL, DASHBOARD_UI_LAUNCH_AGENT_LABEL].toSorted(),
    );
    expect(result.reason).toBe("dashboard-dir-not-found");
    expect(installed).toEqual([]);
  });
});
