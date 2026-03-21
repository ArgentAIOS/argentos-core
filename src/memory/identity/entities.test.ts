import { describe, expect, it } from "vitest";
import { __testing } from "./entities.js";

describe("entity low-value filtering", () => {
  it("rejects automation noise entities", () => {
    expect(__testing.isLowValueEntityName("cron job")).toBe(true);
    expect(__testing.isLowValueEntityName("Heartbeat")).toBe(true);
    expect(__testing.isLowValueEntityName("CT")).toBe(true);
    expect(__testing.isLowValueEntityName("2026")).toBe(true);
  });

  it("preserves valid person and organization names", () => {
    expect(__testing.isLowValueEntityName("Jason Brashear")).toBe(false);
    expect(__testing.isLowValueEntityName("Richard Avery")).toBe(false);
    expect(__testing.isLowValueEntityName("Titanium Computing")).toBe(false);
  });
});

describe("canonical person alias resolution", () => {
  it("maps an unambiguous short first name to a known full-name person", () => {
    expect(
      __testing.findCanonicalPersonAlias({
        name: "Jason",
        candidates: [
          { name: "Jason Brashear", entityType: "person", memoryCount: 20 },
          { name: "Maggie (Agent)", entityType: "project", memoryCount: 200 },
        ],
      }),
    ).toBe("Jason Brashear");
  });

  it("does not map when multiple full-name candidates share the same first name", () => {
    expect(
      __testing.findCanonicalPersonAlias({
        name: "Richard",
        candidates: [
          { name: "Richard Avery", entityType: "person", memoryCount: 12 },
          { name: "Richard Roe", entityType: "person", memoryCount: 9 },
        ],
      }),
    ).toBeNull();
  });

  it("does not map parenthetical agent labels", () => {
    expect(
      __testing.findCanonicalPersonAlias({
        name: "Maggie",
        candidates: [{ name: "Maggie (Agent)", entityType: "project", memoryCount: 50 }],
      }),
    ).toBeNull();
  });
});
