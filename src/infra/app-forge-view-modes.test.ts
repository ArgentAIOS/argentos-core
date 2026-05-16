import { describe, expect, it } from "vitest";
import {
  APP_FORGE_VIEW_MODE_REGISTRY,
  APP_FORGE_VIEW_MODES,
  getAppForgeViewModeDefaultName,
  getAppForgeViewModeEntry,
  getAppForgeViewModeGroupFieldHint,
  getAppForgeViewModeLabel,
  isAppForgeViewMode,
} from "./app-forge-view-modes.js";

describe("AppForge view-mode registry", () => {
  it("lists every supported view mode in canonical order", () => {
    expect(APP_FORGE_VIEW_MODES).toEqual([
      "grid",
      "kanban",
      "form",
      "review",
      "calendar",
      "gallery",
      "timeline",
      "gantt",
    ]);
  });

  it("registry entries are 1:1 with the id tuple and self-consistent", () => {
    const idsFromRegistry = APP_FORGE_VIEW_MODE_REGISTRY.map((entry) => entry.id);
    expect(idsFromRegistry).toEqual(APP_FORGE_VIEW_MODES);
    for (const entry of APP_FORGE_VIEW_MODE_REGISTRY) {
      expect(entry.label.trim()).not.toBe("");
      expect(entry.defaultViewName.trim()).not.toBe("");
    }
  });

  it("isAppForgeViewMode accepts every canonical id", () => {
    for (const id of APP_FORGE_VIEW_MODES) {
      expect(isAppForgeViewMode(id)).toBe(true);
    }
  });

  it("isAppForgeViewMode rejects unknown values", () => {
    expect(isAppForgeViewMode("list")).toBe(false);
    expect(isAppForgeViewMode("")).toBe(false);
    expect(isAppForgeViewMode(undefined)).toBe(false);
    expect(isAppForgeViewMode(null)).toBe(false);
    expect(isAppForgeViewMode(0)).toBe(false);
    expect(isAppForgeViewMode({ id: "grid" })).toBe(false);
    expect(isAppForgeViewMode("__never_a_real_view_mode__")).toBe(false);
  });

  it("getAppForgeViewModeEntry returns the matching registry entry", () => {
    expect(getAppForgeViewModeEntry("grid").label).toBe("Grid");
    expect(getAppForgeViewModeEntry("kanban").label).toBe("Kanban");
    expect(getAppForgeViewModeEntry("calendar").defaultViewName).toBe("Calendar");
  });

  it("getAppForgeViewModeLabel returns the human-readable label", () => {
    expect(getAppForgeViewModeLabel("grid")).toBe("Grid");
    expect(getAppForgeViewModeLabel("kanban")).toBe("Kanban");
    expect(getAppForgeViewModeLabel("form")).toBe("Form");
    expect(getAppForgeViewModeLabel("review")).toBe("Review");
    expect(getAppForgeViewModeLabel("calendar")).toBe("Calendar");
    expect(getAppForgeViewModeLabel("gallery")).toBe("Gallery");
    expect(getAppForgeViewModeLabel("timeline")).toBe("Timeline");
    expect(getAppForgeViewModeLabel("gantt")).toBe("Gantt");
  });

  it("getAppForgeViewModeDefaultName preserves the dashboard's per-mode names", () => {
    // Locks in parity with the pre-refactor `defaultViewName` helper in
    // useForgeStructuredData.ts so the operator-facing view-creation flow
    // suggests the same names it always has.
    expect(getAppForgeViewModeDefaultName("grid")).toBe("All records");
    expect(getAppForgeViewModeDefaultName("kanban")).toBe("By status");
    expect(getAppForgeViewModeDefaultName("form")).toBe("Intake form");
    expect(getAppForgeViewModeDefaultName("review")).toBe("Review queue");
    expect(getAppForgeViewModeDefaultName("calendar")).toBe("Calendar");
    expect(getAppForgeViewModeDefaultName("gallery")).toBe("Gallery");
    expect(getAppForgeViewModeDefaultName("timeline")).toBe("Timeline");
    expect(getAppForgeViewModeDefaultName("gantt")).toBe("Gantt");
  });

  it("getAppForgeViewModeGroupFieldHint preserves the dashboard's seeding hints", () => {
    // Locks in parity with the pre-refactor `defaultViewSettings` branch in
    // useForgeStructuredData.ts: kanban/timeline seed on the `status` field
    // (by name), calendar on the first date field, gallery on the first
    // attachment field. grid/form/review have no auto-seed.
    expect(getAppForgeViewModeGroupFieldHint("grid")).toEqual({ kind: "none" });
    expect(getAppForgeViewModeGroupFieldHint("kanban")).toEqual({
      kind: "fieldName",
      value: "status",
    });
    expect(getAppForgeViewModeGroupFieldHint("form")).toEqual({ kind: "none" });
    expect(getAppForgeViewModeGroupFieldHint("review")).toEqual({ kind: "none" });
    expect(getAppForgeViewModeGroupFieldHint("calendar")).toEqual({
      kind: "fieldType",
      value: "date",
    });
    expect(getAppForgeViewModeGroupFieldHint("gallery")).toEqual({
      kind: "fieldType",
      value: "attachment",
    });
    expect(getAppForgeViewModeGroupFieldHint("timeline")).toEqual({
      kind: "fieldName",
      value: "status",
    });
    expect(getAppForgeViewModeGroupFieldHint("gantt")).toEqual({
      kind: "fieldName",
      value: "status",
    });
  });
});
