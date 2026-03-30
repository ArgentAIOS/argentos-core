import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getOperationsWorkspaceTabs,
  isConfigTabAllowed,
  isOperationsSurfaceAllowed,
  isRawConfigEditorAllowed,
  isOperationsWorkspaceTabAllowed,
  isWorkforceSurfaceAllowed,
  parseDashboardSurfaceProfile,
} from "../dashboard/src/lib/configSurfaceProfile.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(TEST_DIR, "../dashboard");
const API_SERVER_SOURCE = fs.readFileSync(path.join(DASHBOARD_ROOT, "api-server.cjs"), "utf8");
const APP_SOURCE = fs.readFileSync(path.join(DASHBOARD_ROOT, "src/App.tsx"), "utf8");
const CONFIG_PANEL_SOURCE = fs.readFileSync(
  path.join(DASHBOARD_ROOT, "src/components/ConfigPanel.tsx"),
  "utf8",
);
const ORG_CHART_SOURCE = fs.readFileSync(
  path.join(DASHBOARD_ROOT, "src/components/widgets/OrgChartWidget.tsx"),
  "utf8",
);
const WORKFLOW_MAP_SOURCE = fs.readFileSync(
  path.join(DASHBOARD_ROOT, "src/components/widgets/WorkflowMapCanvas.tsx"),
  "utf8",
);
const BLOCKED_API_PATTERNS_SECTION =
  API_SERVER_SOURCE.match(/const PUBLIC_CORE_BLOCKED_API_PATTERNS = \[(.*?)\];/s)?.[1] ?? "";

describe("dashboard surface profile", () => {
  it("parses public-core from raw config", () => {
    expect(
      parseDashboardSurfaceProfile(
        JSON.stringify({
          distribution: {
            surfaceProfile: "public-core",
          },
        }),
      ),
    ).toBe("public-core");
  });

  it("keeps the core config surface available in public-core", () => {
    expect(isConfigTabAllowed("gateway", "public-core")).toBe(true);
    expect(isConfigTabAllowed("database", "public-core")).toBe(true);
    expect(isConfigTabAllowed("systems", "public-core")).toBe(true);
    expect(isConfigTabAllowed("intent", "public-core")).toBe(true);
    expect(isConfigTabAllowed("security", "public-core")).toBe(true);
    expect(isConfigTabAllowed("devices", "public-core")).toBe(true);
    expect(isConfigTabAllowed("observability", "public-core")).toBe(true);
    expect(isConfigTabAllowed("marketplace", "public-core")).toBe(true);
    expect(isConfigTabAllowed("license", "public-core")).toBe(true);
    expect(isConfigTabAllowed("logs", "public-core")).toBe(true);
    expect(isConfigTabAllowed("capabilities", "public-core")).toBe(false);
    expect(isConfigTabAllowed("appearance", "public-core")).toBe(true);
  });

  it("disables raw config editing and workforce surfaces in public-core", () => {
    expect(isRawConfigEditorAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("public-core")).toBe(false);
    expect(isWorkforceSurfaceAllowed("full")).toBe(true);
  });

  it("keeps workload lanes in public-core operations", () => {
    expect(isOperationsSurfaceAllowed("public-core")).toBe(true);
    expect(isOperationsWorkspaceTabAllowed("jobs", "public-core")).toBe(true);
    expect(isOperationsWorkspaceTabAllowed("org", "public-core")).toBe(true);
    expect(isWorkforceSurfaceAllowed("public-core")).toBe(false);
    expect(getOperationsWorkspaceTabs("public-core").map((tab) => tab.id)).toEqual([
      "map",
      "workflows",
      "jobs",
      "tasks",
      "org",
      "schedule",
    ]);
  });

  it("treats workloads and workforce as distinct public-core surfaces", () => {
    const publicCoreTabs = getOperationsWorkspaceTabs("public-core").map((tab) => tab.id);
    expect(publicCoreTabs).toContain("jobs");
    expect(isWorkforceSurfaceAllowed("public-core")).toBe(false);
  });

  it("locks public-core api route gating around the approved core surfaces", () => {
    expect(BLOCKED_API_PATTERNS_SECTION).not.toContain('"/api/license/**"');
    expect(BLOCKED_API_PATTERNS_SECTION).not.toContain('"/api/settings/gateway/**"');
    expect(BLOCKED_API_PATTERNS_SECTION).not.toContain('"/api/settings/database/**"');
    expect(BLOCKED_API_PATTERNS_SECTION).not.toContain('"/api/settings/intent/**"');
    expect(BLOCKED_API_PATTERNS_SECTION).not.toContain('"/api/settings/load-profile"');
    expect(BLOCKED_API_PATTERNS_SECTION).not.toContain('"/api/logs/tail"');
    expect(BLOCKED_API_PATTERNS_SECTION).not.toContain('"/api/devices/**"');
    expect(BLOCKED_API_PATTERNS_SECTION).toContain('"/api/settings/agent/raw-config"');
    expect(BLOCKED_API_PATTERNS_SECTION).toContain('"/api/lockscreen/emergency-unlock"');
  });

  it("locks the operations workspace switch to operations instead of workforce", () => {
    expect(APP_SOURCE).toContain('ws.id === "operations" && allowOperationsSurface');
    expect(APP_SOURCE).not.toContain('ws.id === "operations" && allowWorkforceSurface');
  });

  it("keeps main and unassigned family agents visible in core org surfaces", () => {
    expect(ORG_CHART_SOURCE).toContain('const EXCLUDED_IDS = new Set(["dumbo", "argent"])');
    expect(ORG_CHART_SOURCE).toContain('if (t === "unassigned" || t === "") return "core";');
    expect(ORG_CHART_SOURCE).toContain('core: { name: "Core", color: "#60a5fa" }');

    expect(WORKFLOW_MAP_SOURCE).toContain(
      'const EXCLUDED_AGENT_IDS = new Set(["dumbo", "argent"])',
    );
    expect(WORKFLOW_MAP_SOURCE).toContain('if (t === "unassigned" || t === "") return "core";');
    expect(WORKFLOW_MAP_SOURCE).toContain('core: "Core"');
  });

  it("dedupes main alignment docs and uses dynamic operator naming in org chart", () => {
    expect(API_SERVER_SOURCE).toContain("const hasWorkspaceMain = fs.existsSync(WORKSPACE_MAIN);");
    expect(API_SERVER_SOURCE).toContain('if (hasWorkspaceMain && name === "main") return false;');
    expect(ORG_CHART_SOURCE).not.toContain(">Jason<");
    expect(ORG_CHART_SOURCE).toContain('const operatorLabel = operatorName?.trim() || "Operator";');
    expect(APP_SOURCE).toContain(
      "<OrgChartWidget operatorName={operatorDisplayName ?? undefined} />",
    );
  });

  it("keeps the public-core intent tab on the simplified safety-rules surface", () => {
    expect(CONFIG_PANEL_SOURCE).toContain("Public Core uses the simplified intent surface here");
    expect(CONFIG_PANEL_SOURCE).toContain("{!isPublicCoreSurface && (");
    expect(CONFIG_PANEL_SOURCE).toContain("Advanced Governance Console (Business)");
  });
});
