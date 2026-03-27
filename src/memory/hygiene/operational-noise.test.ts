import { describe, expect, it } from "vitest";
import {
  isGarbageOperationalCategoryName,
  isPrunableOperationalEntityCandidate,
} from "./operational-noise.js";

describe("operational category cleanup predicates", () => {
  it("flags year-only and parser-spill categories", () => {
    expect(isGarbageOperationalCategoryName("2026")).toBe(true);
    expect(isGarbageOperationalCategoryName("2026 2026")).toBe(true);
    expect(
      isGarbageOperationalCategoryName(
        "Automated Operations FACT: The Cron Job Checks For Pending Vip Emails | Categories: 2026",
      ),
    ).toBe(true);
  });

  it("preserves normal categories", () => {
    expect(isGarbageOperationalCategoryName("Forward Observer")).toBe(false);
    expect(isGarbageOperationalCategoryName("Professional History")).toBe(false);
  });
});

describe("operational entity cleanup predicates", () => {
  it("flags obvious operational identifiers and cron noise", () => {
    expect(
      isPrunableOperationalEntityCandidate({
        name: "cron job",
        entityType: "project",
        memoryCount: 3972,
        linkCount: 3972,
        cronLinks: 584,
        sessionLinks: 0,
        docpaneLinks: 0,
        directLinks: 3388,
      }),
    ).toBe(true);
    expect(
      isPrunableOperationalEntityCandidate({
        name: "2026",
        entityType: "project",
        memoryCount: 1288,
        linkCount: 1282,
        cronLinks: 675,
        sessionLinks: 1,
        docpaneLinks: 0,
        directLinks: 606,
      }),
    ).toBe(true);
    expect(
      isPrunableOperationalEntityCandidate({
        name: "ba83b300-b131-410a-baa5-0df47719642b",
        entityType: "project",
        memoryCount: 1439,
        linkCount: 1439,
        cronLinks: 90,
        sessionLinks: 0,
        docpaneLinks: 0,
        directLinks: 1349,
      }),
    ).toBe(true);
    expect(
      isPrunableOperationalEntityCandidate({
        name: "Technician ID 17",
        entityType: "person",
        memoryCount: 366,
        linkCount: 366,
        cronLinks: 213,
        sessionLinks: 2,
        docpaneLinks: 0,
        directLinks: 151,
      }),
    ).toBe(true);
    expect(
      isPrunableOperationalEntityCandidate({
        name: "CT",
        entityType: "place",
        memoryCount: 1584,
        linkCount: 1579,
        cronLinks: 1445,
        sessionLinks: 19,
        docpaneLinks: 0,
        directLinks: 115,
      }),
    ).toBe(true);
  });

  it("preserves real entities and useful abstractions", () => {
    expect(
      isPrunableOperationalEntityCandidate({
        name: "Jason Brashear",
        entityType: "person",
        memoryCount: 2708,
        linkCount: 2709,
        cronLinks: 1236,
        sessionLinks: 5,
        docpaneLinks: 0,
        directLinks: 1468,
      }),
    ).toBe(false);
    expect(
      isPrunableOperationalEntityCandidate({
        name: "Atera",
        entityType: "organization",
        memoryCount: 3118,
        linkCount: 3121,
        cronLinks: 1740,
        sessionLinks: 13,
        docpaneLinks: 0,
        directLinks: 1368,
      }),
    ).toBe(false);
    expect(
      isPrunableOperationalEntityCandidate({
        name: "VIP Email Check",
        entityType: "project",
        memoryCount: 2214,
        linkCount: 2214,
        cronLinks: 354,
        sessionLinks: 0,
        docpaneLinks: 0,
        directLinks: 1860,
      }),
    ).toBe(false);
    expect(
      isPrunableOperationalEntityCandidate({
        name: "SIS",
        entityType: "person",
        memoryCount: 449,
        linkCount: 448,
        cronLinks: 412,
        sessionLinks: 2,
        docpaneLinks: 0,
        directLinks: 34,
      }),
    ).toBe(false);
  });
});
