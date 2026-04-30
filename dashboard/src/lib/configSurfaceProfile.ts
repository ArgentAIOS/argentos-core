export type DashboardSurfaceProfile = "full" | "public-core";
export type DashboardMode = "personal" | "operations";

/**
 * Tabs HIDDEN at runtime when surfaceProfile === "public-core".
 *
 * IMPORTANT: This is a UI visibility filter, NOT a code removal list.
 * The code for these tabs still ships in Core — they are just not rendered.
 * Do NOT use this list to decide what to add/remove from the export denylist
 * or public-core-denylist.json. The tier boundary (Core vs Business) is a
 * business decision that requires explicit sign-off from Jason.
 * See: ops/rules/never-do.md → "Core / Business Boundary"
 */
export const PUBLIC_CORE_BLOCKED_CONFIG_TABS = new Set<string>();

export function parseDashboardSurfaceProfile(
  rawConfigText: string | null | undefined,
): DashboardSurfaceProfile {
  if (!rawConfigText) {
    return "public-core";
  }
  try {
    const parsed = JSON.parse(rawConfigText);
    return parsed?.distribution?.surfaceProfile === "full" ? "full" : "public-core";
  } catch {
    return "public-core";
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

/**
 * Raw config editor is Business-only (too dangerous for Core users).
 * Runtime gate — does not affect code export.
 */
export function isRawConfigEditorAllowed(surfaceProfile: DashboardSurfaceProfile): boolean {
  return surfaceProfile !== "public-core";
}

export function isOperationsSurfaceAllowed(surfaceProfile: DashboardSurfaceProfile): boolean {
  return surfaceProfile === "full" || surfaceProfile === "public-core";
}

/**
 * Workforce surfaces (JobsBoard, OrgChart) are Business-only.
 * This is a runtime gate — the code ships in both tiers but only renders
 * when a Business overlay supplies an explicit enablement path.
 * Core must fail closed here so "full" Core dashboards do not expose gated
 * workforce controls.
 */
export function isWorkforceSurfaceAllowed(surfaceProfile: DashboardSurfaceProfile): boolean {
  void surfaceProfile;
  return false;
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
