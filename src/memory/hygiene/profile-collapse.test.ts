import { describe, expect, it, vi } from "vitest";
import type { MemuStore } from "../memu-store.js";
import type { MemoryItem, Significance } from "../memu-types.js";
import { collapseOperationalProfileSnapshots } from "./profile-collapse.js";

function buildItem(
  id: string,
  summary: string,
  opts?: {
    reinforcementCount?: number;
    significance?: Significance;
    createdAt?: string;
  },
): MemoryItem {
  return {
    id,
    resourceId: null,
    memoryType: "profile",
    summary,
    embedding: null,
    happenedAt: null,
    contentHash: null,
    reinforcementCount: opts?.reinforcementCount ?? 1,
    lastReinforcedAt: null,
    extra: {},
    emotionalValence: 0,
    emotionalArousal: 0,
    moodAtCapture: null,
    significance: opts?.significance ?? "routine",
    reflection: null,
    lesson: null,
    createdAt: opts?.createdAt ?? "2026-02-25T00:00:00.000Z",
    updatedAt: "2026-02-25T00:00:00.000Z",
  };
}

function makeStore(initialItems: MemoryItem[]): MemuStore {
  const items = [...initialItems];
  const byId = () => new Map(items.map((item) => [item.id, item]));

  const store = {
    countItems: vi.fn((memoryType?: string) =>
      memoryType === "profile"
        ? items.filter((item) => item.memoryType === "profile").length
        : items.length,
    ),
    listItems: vi.fn((options?: { memoryType?: string; limit?: number; offset?: number }) => {
      const filtered = options?.memoryType
        ? items.filter((item) => item.memoryType === options.memoryType)
        : [...items];
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 50;
      return filtered.slice(offset, offset + limit);
    }),
    reinforceItem: vi.fn((id: string) => {
      const item = byId().get(id);
      if (!item) return null;
      item.reinforcementCount += 1;
      item.lastReinforcedAt = "2026-02-25T12:00:00.000Z";
      return item;
    }),
    deleteItem: vi.fn((id: string) => {
      const idx = items.findIndex((item) => item.id === id);
      if (idx < 0) return false;
      items.splice(idx, 1);
      return true;
    }),
  } as unknown as MemuStore;

  return store;
}

describe("collapseOperationalProfileSnapshots", () => {
  it("reports duplicate operational profile groups in dry-run mode", () => {
    const store = makeStore([
      buildItem("a", "Gateway status: 4 apps pending, checked 2026-02-25 10:00"),
      buildItem("b", "Gateway status: 7 apps pending, checked 2026-02-25 10:05"),
      buildItem("c", "Gateway status: 3 apps pending, checked 2026-02-25 10:10"),
      buildItem("d", "Atera technician is Jason Brashear."),
    ]);

    const report = collapseOperationalProfileSnapshots(store, { dryRun: true, maxSampleGroups: 5 });

    expect(report.dryRun).toBe(true);
    expect(report.scannedProfiles).toBe(4);
    expect(report.operationalProfiles).toBe(3);
    expect(report.uniqueSignatures).toBe(1);
    expect(report.duplicateGroups).toBe(1);
    expect(report.duplicatesFound).toBe(2);
    expect(report.groupsCollapsed).toBe(0);
    expect(report.duplicatesRemoved).toBe(0);
    expect(report.reinforcementsApplied).toBe(0);
    expect(report.exactDuplicateGroups).toBe(1);
    expect(report.tokenDuplicateGroups).toBe(0);
    expect(report.fuzzyDuplicateGroups).toBe(0);
    expect(report.samples).toHaveLength(1);
    expect(report.samples[0].groupSize).toBe(3);
    expect(store.deleteItem).not.toHaveBeenCalled();
    expect(store.reinforceItem).not.toHaveBeenCalled();
  });

  it("collapses duplicate operational profile groups and transfers reinforcement", () => {
    const canonical = buildItem("core", "Service status: 12 tasks pending at 2026-02-25 10:00", {
      significance: "core",
      reinforcementCount: 5,
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const dup1 = buildItem("dup-1", "Service status: 19 tasks pending at 2026-02-25 10:05", {
      reinforcementCount: 3,
      createdAt: "2026-02-21T00:00:00.000Z",
    });
    const dup2 = buildItem("dup-2", "Service status: 8 tasks pending at 2026-02-25 10:10", {
      reinforcementCount: 2,
      createdAt: "2026-02-22T00:00:00.000Z",
    });

    const store = makeStore([canonical, dup1, dup2]);
    const report = collapseOperationalProfileSnapshots(store, {
      dryRun: false,
      maxSampleGroups: 3,
    });

    expect(report.dryRun).toBe(false);
    expect(report.duplicateGroups).toBe(1);
    expect(report.duplicatesFound).toBe(2);
    expect(report.groupsCollapsed).toBe(1);
    expect(report.duplicatesRemoved).toBe(2);
    expect(report.reinforcementsApplied).toBe(5);
    expect(report.exactDuplicateGroups).toBe(1);
    expect(report.tokenDuplicateGroups).toBe(0);
    expect(report.fuzzyDuplicateGroups).toBe(0);
    expect(store.deleteItem).toHaveBeenCalledTimes(2);
    expect(store.reinforceItem).toHaveBeenCalledTimes(5);
    expect(canonical.reinforcementCount).toBe(10);
  });

  it("collapses paraphrased operational snapshots via token grouping", () => {
    const store = makeStore([
      buildItem("p1", "The conversation states there are 2 open tickets total in Atera.", {
        reinforcementCount: 1,
      }),
      buildItem("p2", "There are 4 total open tickets in the connected Atera environment.", {
        reinforcementCount: 2,
      }),
      buildItem("p3", "Jason Brashear has 0 tickets assigned to him in Atera.", {
        reinforcementCount: 1,
      }),
    ]);

    const report = collapseOperationalProfileSnapshots(store, {
      dryRun: false,
      maxSampleGroups: 10,
    });

    expect(report.exactDuplicateGroups).toBe(0);
    expect(report.tokenDuplicateGroups).toBe(1);
    expect(report.fuzzyDuplicateGroups).toBe(0);
    expect(report.duplicatesRemoved).toBe(1);
    expect(report.reinforcementsApplied).toBe(1);
    expect(store.deleteItem).toHaveBeenCalledTimes(1);
    expect(store.reinforceItem).toHaveBeenCalledTimes(1);
  });
});
