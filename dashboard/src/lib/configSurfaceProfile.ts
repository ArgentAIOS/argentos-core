export type DashboardSurfaceProfile = "full" | "public-core";
export type DashboardMode = "personal" | "operations";
export type OperationsWorkspaceTabId = "map" | "workflows" | "jobs" | "tasks" | "org" | "schedule";

export const PUBLIC_CORE_BLOCKED_CONFIG_TABS = new Set<string>([
  "systems",
  "capabilities",
  "intent",
  "security",
  "devices",
  "observability",
  "marketplace",
  "license",
  "logs",
]);

const OPERATIONS_WORKSPACE_TABS = [
  { id: "map", label: "Workflow Map" },
  { id: "workflows", label: "Workflows" },
  { id: "jobs", label: "Workloads" },
  { id: "tasks", label: "Task Manager" },
  { id: "org", label: "Org Chart" },
  { id: "schedule", label: "Schedule" },
] as const satisfies ReadonlyArray<{ id: OperationsWorkspaceTabId; label: string }>;

const PUBLIC_CORE_ALLOWED_OPERATIONS_TABS = new Set<OperationsWorkspaceTabId>([
  "map",
  "workflows",
  "jobs",
  "tasks",
  "org",
  "schedule",
]);

export function parseDashboardSurfaceProfile(
  rawConfigText: string | null | undefined,
): DashboardSurfaceProfile {
  if (!rawConfigText) {
    return "full";
  }
  try {
    const parsed = JSON.parse(rawConfigText);
    return parsed?.distribution?.surfaceProfile === "public-core" ? "public-core" : "full";
  } catch {
    return "full";
  }
}

export function parseDashboardMode(
  rawConfigText: string | null | undefined,
  surfaceProfile: DashboardSurfaceProfile,
): DashboardMode {
  if (!rawConfigText) {
    return surfaceProfile === "public-core" ? "personal" : "personal";
  }
  try {
    const parsed = JSON.parse(rawConfigText);
    const rawMode = parsed?.distribution?.dashboardMode;
    if (rawMode === "operations" && surfaceProfile !== "public-core") {
      return "operations";
    }
    return "personal";
  } catch {
    return "personal";
  }
}

export function isConfigTabAllowed(
  tabId: string,
  surfaceProfile: DashboardSurfaceProfile,
): boolean {
  if (surfaceProfile !== "public-core") {
    return true;
  }
  return !PUBLIC_CORE_BLOCKED_CONFIG_TABS.has(tabId);
}

export function filterConfigNavSections<T extends { id: string }>(
  sections: Array<{ label: string; items: T[] }>,
  surfaceProfile: DashboardSurfaceProfile,
): Array<{ label: string; items: T[] }> {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isConfigTabAllowed(item.id, surfaceProfile)),
    }))
    .filter((section) => section.items.length > 0);
}

export function isRawConfigEditorAllowed(surfaceProfile: DashboardSurfaceProfile): boolean {
  return surfaceProfile !== "public-core";
}

export function isOperationsSurfaceAllowed(surfaceProfile: DashboardSurfaceProfile): boolean {
  return surfaceProfile === "full" || surfaceProfile === "public-core";
}

export function isWorkforceSurfaceAllowed(surfaceProfile: DashboardSurfaceProfile): boolean {
  return surfaceProfile === "full";
}

export function isOperationsWorkspaceTabAllowed(
  tabId: OperationsWorkspaceTabId,
  surfaceProfile: DashboardSurfaceProfile,
): boolean {
  if (surfaceProfile !== "public-core") {
    return true;
  }
  return PUBLIC_CORE_ALLOWED_OPERATIONS_TABS.has(tabId);
}

export function getOperationsWorkspaceTabs(
  surfaceProfile: DashboardSurfaceProfile,
): Array<{ id: OperationsWorkspaceTabId; label: string }> {
  return OPERATIONS_WORKSPACE_TABS.filter((tab) =>
    isOperationsWorkspaceTabAllowed(tab.id, surfaceProfile),
  ).map((tab) => ({ ...tab }));
}

export function isDashboardModeAllowed(
  mode: DashboardMode,
  surfaceProfile: DashboardSurfaceProfile,
): boolean {
  if (mode === "operations") {
    return isOperationsSurfaceAllowed(surfaceProfile);
  }
  return true;
}
