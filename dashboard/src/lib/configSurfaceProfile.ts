export type DashboardSurfaceProfile = "full" | "public-core";
export type DashboardMode = "personal" | "operations";

export const PUBLIC_CORE_BLOCKED_CONFIG_TABS = new Set<string>([
  "systems",
  "capabilities",
  "intent",
  "security",
  "gateway",
  "database",
  "devices",
  "observability",
  "marketplace",
  "license",
  "logs",
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
    if (rawMode === "operations") {
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

export function isDashboardModeAllowed(
  mode: DashboardMode,
  surfaceProfile: DashboardSurfaceProfile,
): boolean {
  if (mode === "operations") {
    return isOperationsSurfaceAllowed(surfaceProfile);
  }
  return true;
}
