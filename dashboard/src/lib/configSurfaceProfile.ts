export type DashboardSurfaceProfile = "full" | "public-core";

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

export function isWorkforceSurfaceAllowed(surfaceProfile: DashboardSurfaceProfile): boolean {
  return surfaceProfile !== "public-core";
}
